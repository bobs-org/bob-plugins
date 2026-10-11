const REVIEW_JOURNAL_OUTCOMES = new Set([
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
const REVIEW_JOURNAL_RETRY_MS = 15000;
const REVIEW_JOURNAL_PENDING_CAP = 500;
const REVIEW_JOURNAL_PLUGIN_FALLBACK = "bob-navigation-hotkeys@2.x";

function reviewCardJournalOutcome(beforeLine, afterLine, dayText) {
  const after = String(afterLine ?? "");
  const before = String(beforeLine ?? "");
  const status = reviewAdvanceLineTaskStatus(after);
  if (status === "x") {
    return "done";
  }
  if (status === "-") {
    return "drop";
  }
  const day =
    typeof dayText === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dayText.trim())
      ? dayText.trim()
      : "";
  const afterScheduled = reviewAdvanceLineInlineDate(after, "scheduled");
  const beforeScheduled = reviewAdvanceLineInlineDate(before, "scheduled");
  if (
    afterScheduled &&
    day &&
    afterScheduled > day &&
    afterScheduled !== beforeScheduled
  ) {
    return "defer";
  }
  const beforeIds = reviewAdvanceLineDependsOnIds(before);
  for (const id of reviewAdvanceLineDependsOnIds(after)) {
    if (!beforeIds.has(id)) {
      return "sequence";
    }
  }
  return "card";
}

function reviewJournalOutcomeToken(raw) {
  const token = String(raw || "").trim();
  const outcomes = {
    complete: "done",
    "link-today": "today",
    keep: "keep",
    done: "done",
    drop: "drop",
    defer: "defer",
    lane: "lane",
    route: "route",
    today: "today",
    sequence: "sequence",
    card: "card",
    checklist: "checklist",
  };
  if (Object.prototype.hasOwnProperty.call(outcomes, token)) {
    return outcomes[token];
  }
  if (/^decay:(?:notNow|level:\d+|lessOften|reword|drop|keep)$/.test(token)) {
    return token;
  }
  return null;
}

function reviewJournalOutcome(value, dayText) {
  const input = value && typeof value === "object" ? value : null;
  if (input) {
    const explicit = input.journalOutcome;
    if (explicit != null && String(explicit).trim() !== "") {
      return reviewJournalOutcomeToken(explicit);
    }
    if (String(input.kind || "") === "card") {
      return reviewCardJournalOutcome(input.beforeLine, input.afterLine, dayText);
    }
  }
  return reviewJournalOutcomeToken(
    input ? input.outcome || input.action || input.kind || "" : value || "",
  );
}

function buildReviewAnswerEvents(origin, outcome, refs) {
  try {
    if (!origin || typeof origin !== "object") {
      return Object.freeze([]);
    }
    const day = typeof origin.day === "string" ? origin.day.trim() : "";
    const normalizedOutcome = reviewJournalOutcome(outcome, day);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !normalizedOutcome) {
      return Object.freeze([]);
    }
    const queue = Array.isArray(origin.queueBefore) ? origin.queueBefore : [];
    const rowByKey = new Map();
    for (const row of queue) {
      if (!row || typeof row !== "object") {
        continue;
      }
      try {
        const key = reviewQueueEntryKey(row);
        if (key && !rowByKey.has(key)) {
          rowByKey.set(key, row);
        }
      } catch (error) {
        // Keep the rest of the queue usable if one row is malformed.
      }
    }
    const inputs = Array.isArray(refs) && refs.length > 0 ? refs : [origin];
    const seen = new Set();
    const events = [];
    for (const ref of inputs) {
      const key =
        typeof ref === "string"
          ? ref
          : ref && typeof ref.key === "string"
            ? ref.key
            : ref && typeof ref.rowKey === "string"
              ? ref.rowKey
              : "";
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      const row = rowByKey.get(key);
      const tier = String(
        (row && row.tier) ||
          (ref && typeof ref === "object" && ref.tier) ||
          origin.tier ||
          "",
      ).trim();
      if (!tier) {
        continue;
      }
      events.push(
        Object.freeze({
          day,
          tier,
          outcome: normalizedOutcome,
          key,
        }),
      );
    }
    return Object.freeze(events);
  } catch (error) {
    return Object.freeze([]);
  }
}

class BobNavigationHotkeysReviewJournalMixin {
  reviewJournalPluginLabel() {
    try {
      const version = this.manifest && this.manifest.version;
      if (typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version.trim())) {
        return `bob-navigation-hotkeys@${version.trim()}`;
      }
    } catch (error) {
      // Tests and unload can omit a manifest.
    }
    return REVIEW_JOURNAL_PLUGIN_FALLBACK;
  }

  reviewJournalStatsApi() {
    try {
      const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
      const ledger = plugins && plugins["bob-ledger-tools"];
      const stats = ledger && ledger.api && ledger.api.stats;
      if (!stats || typeof stats.append !== "function") {
        return null;
      }
      if (typeof stats.version === "number" && stats.version < 1) {
        return null;
      }
      return stats;
    } catch (error) {
      return null;
    }
  }

  enqueueReviewJournalEvent(event) {
    if (!Array.isArray(this.reviewJournalPending)) {
      this.reviewJournalPending = [];
    }
    this.reviewJournalPending.push(event);
    let dropped = 0;
    while (this.reviewJournalPending.length > REVIEW_JOURNAL_PENDING_CAP) {
      this.reviewJournalPending.shift();
      dropped += 1;
    }
    if (dropped === 0) {
      return;
    }
    this.reviewJournalDropped = (this.reviewJournalDropped || 0) + dropped;
    if (this.reviewJournalDropWarned === true) {
      return;
    }
    this.reviewJournalDropWarned = true;
    try {
      console.warn(
        `Review journal dropped ${this.reviewJournalDropped} oldest pending answers (cap ${REVIEW_JOURNAL_PENDING_CAP})`,
      );
    } catch (error) {
      // Ignore console failures.
    }
  }

  noticeReviewJournalMissingApi() {
    if (this.reviewJournalMissingApiNoticed === true) {
      return;
    }
    this.reviewJournalMissingApiNoticed = true;
    try {
      new Notice("Update Bob Ledger Tools to record review stats");
    } catch (error) {
      // Best effort during plugin teardown.
    }
  }

  noticeReviewJournalWriteFailure() {
    if (this.reviewJournalBurst === true) {
      return;
    }
    this.reviewJournalBurst = true;
    try {
      new Notice("Review answer not recorded — will retry");
    } catch (error) {
      // Best effort during plugin teardown.
    }
  }

  noticeReviewJournalRecovered(count) {
    try {
      new Notice(`Review journal recovered: ${count} answers written`);
    } catch (error) {
      // Best effort during plugin teardown.
    }
  }

  recordReviewAnswer(origin, outcome, refs) {
    try {
      const events = buildReviewAnswerEvents(origin, outcome, refs);
      if (events.length === 0) {
        return;
      }
      const plugin = this.reviewJournalPluginLabel();
      for (const event of events) {
        this.enqueueReviewJournalEvent(
          Object.freeze({
            ...event,
            plugin,
          }),
        );
      }
      this.flushReviewJournal();
    } catch (error) {
      // Journaling is independent of the answer and must never throw here.
    }
  }

  scheduleReviewJournalRetry() {
    try {
      if (
        !Array.isArray(this.reviewJournalPending) ||
        this.reviewJournalPending.length === 0 ||
        this.reviewJournalRetryTimer !== null
      ) {
        return;
      }
      this.reviewJournalRetryTimer = setTimeout(() => {
        this.reviewJournalRetryTimer = null;
        this.flushReviewJournal();
      }, REVIEW_JOURNAL_RETRY_MS);
      if (
        this.reviewJournalRetryTimer &&
        typeof this.reviewJournalRetryTimer.unref === "function"
      ) {
        this.reviewJournalRetryTimer.unref();
      }
    } catch (error) {
      this.reviewJournalRetryTimer = null;
    }
  }

  flushReviewJournal() {
    if (this.reviewJournalDraining === true) {
      return;
    }
    const queue = Array.isArray(this.reviewJournalPending)
      ? this.reviewJournalPending
      : [];
    if (queue.length === 0) {
      return;
    }
    this.reviewJournalDraining = true;
    const hadBurst = this.reviewJournalBurst === true;
    const state = { wrote: 0, missingApi: false };
    Promise.resolve()
      .then(async () => {
        while (queue.length > 0) {
          const stats = this.reviewJournalStatsApi();
          if (!stats) {
            state.missingApi = true;
            this.noticeReviewJournalMissingApi();
            throw new Error("Stats journal API is unavailable");
          }
          const event = queue[0];
          try {
            await stats.append(event);
          } catch (error) {
            if (error && error.code === "invalid_review_event") {
              if (queue[0] === event) {
                queue.shift();
              }
              try {
                console.warn("Review journal dropped invalid event", error);
              } catch (warnError) {
                // Ignore console failures.
              }
              continue;
            }
            throw error;
          }
          if (queue[0] === event) {
            queue.shift();
          }
          state.wrote += 1;
        }
      })
      .catch(() => {
        if (state.missingApi) {
          return;
        }
        this.noticeReviewJournalWriteFailure();
      })
      .finally(() => {
        this.reviewJournalDraining = false;
        if (
          state.wrote > 0 &&
          Array.isArray(this.reviewJournalPending) &&
          this.reviewJournalPending.length === 0
        ) {
          if (hadBurst) {
            this.noticeReviewJournalRecovered(state.wrote);
          }
          this.reviewJournalBurst = false;
          this.reviewJournalDropWarned = false;
        }
        this.scheduleReviewJournalRetry();
      });
  }

  recordFreshnessDecayReviewAnswer(cardCtx, action) {
    try {
      if (!cardCtx || typeof cardCtx !== "object" || !cardCtx.entry) {
        return;
      }
      const key = reviewQueueEntryKey(cardCtx.entry);
      this.recordReviewAnswer(
        {
          day: cardCtx.dateText,
          key,
          rowKey: key,
          tier: reviewEntryMachineTier(cardCtx.entry),
          queueBefore: cardCtx.queueBefore,
        },
        `decay:${String(action || "")}`,
        [{ key, text: cardCtx.entry.originalMarkdown }],
      );
    } catch (error) {
      // The task write remains successful even if a card row cannot be keyed.
    }
  }
}
