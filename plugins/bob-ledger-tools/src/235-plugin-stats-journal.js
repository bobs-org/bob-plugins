const STATS_REVIEW_DIRECTORY = ".bob/stats/review";
const STATS_REVIEW_KIND = "review.answer";
const STATS_REVIEW_PLUGIN = "bob-navigation-hotkeys@2.x";
const STATS_REVIEW_PLUGIN_PATTERN = /^[a-z0-9-]+@\d+\.\d+\.\d+$/;
const STATS_REVIEW_OUTCOMES = new Set([
  "keep",
  "done",
  "drop",
  "defer",
  "lane",
  "route",
  "today",
  "sequence",
  "card",
  "checklist",
]);

function statsInvalidReviewEvent(message) {
  const error = new TypeError(message);
  error.code = "invalid_review_event";
  return error;
}

function statsReviewHost(raw) {
  const cut = String(raw || "")
    .toLowerCase()
    .split(".")[0];
  const sanitized = cut.replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "host";
}

function statsReviewPlugin(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  return STATS_REVIEW_PLUGIN_PATTERN.test(raw) ? raw : STATS_REVIEW_PLUGIN;
}

function statsReviewDay(value) {
  const day = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw statsInvalidReviewEvent("Review journal day must be YYYY-MM-DD");
  }
  const [year, month, date] = day.split("-").map(Number);
  const parsed = new Date(year, month - 1, date);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== date
  ) {
    throw statsInvalidReviewEvent("Review journal day must be a real calendar date");
  }
  return day;
}

function statsReviewTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const absOffset = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`
  );
}

async function statsReviewEnsureDirectory(adapter, path) {
  const segments = String(path || "").split("/").filter(Boolean);
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    if (!(await adapter.exists(current))) {
      await adapter.mkdir(current);
    }
  }
}

class BobLedgerToolsStatsJournalMixin {
  apiStatsHost() {
    try {
      const osModule = planRequireOptionalNodeModule("os");
      const raw =
        osModule && typeof osModule.hostname === "function"
          ? String(osModule.hostname() || "")
          : "";
      return statsReviewHost(raw);
    } catch (error) {
      return "host";
    }
  }

  apiStatsAppend(event) {
    const run = async () => {
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        throw statsInvalidReviewEvent("Review journal event must be an object");
      }
      const day = statsReviewDay(event.day);
      const tier = typeof event.tier === "string" ? event.tier.trim() : "";
      const outcome = typeof event.outcome === "string" ? event.outcome.trim() : "";
      const key = typeof event.key === "string" ? event.key.trim() : "";
      const validOutcome =
        STATS_REVIEW_OUTCOMES.has(outcome) ||
        /^decay:(?:notNow|level:\d+|lessOften|reword|drop|keep)$/.test(outcome);
      if (!tier || !key || !validOutcome) {
        throw statsInvalidReviewEvent(
          "Review journal event has an invalid tier, key, or outcome",
        );
      }
      const osModule = planRequireOptionalNodeModule("os");
      const rawHost =
        osModule && typeof osModule.hostname === "function"
          ? String(osModule.hostname() || "")
          : "";
      const host = statsReviewHost(rawHost);
      const adapter = this.app && this.app.vault && this.app.vault.adapter;
      if (
        !adapter ||
        typeof adapter.exists !== "function" ||
        typeof adapter.mkdir !== "function" ||
        typeof adapter.write !== "function" ||
        typeof adapter.append !== "function"
      ) {
        throw new Error("Vault adapter cannot append the review journal");
      }
      const [year, month] = day.split("-");
      const directory = normalizePath(STATS_REVIEW_DIRECTORY);
      const path = normalizePath(`${directory}/${year}-${month}.${host}.jsonl`);
      await statsReviewEnsureDirectory(adapter, directory);
      if (!(await adapter.exists(path))) {
        await adapter.write(path, "");
      }
      const record = {
        v: 1,
        ts: statsReviewTimestamp(new Date()),
        day,
        host,
        kind: STATS_REVIEW_KIND,
        tier,
        outcome,
        key,
        plugin: statsReviewPlugin(event.plugin),
      };
      await adapter.append(path, `${JSON.stringify(record)}\n`);
      try {
        if (typeof this.statsAfterJournalAppend === "function") {
          this.statsAfterJournalAppend();
        }
      } catch (error) {
        // Journal revalidation is best-effort.
      }
      return record;
    };
    const previous = this.statsAppendQueue || Promise.resolve();
    const pending = Promise.resolve(previous).catch(() => {}).then(run);
    this.statsAppendQueue = pending.catch(() => {});
    return pending;
  }
}
