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

function reviewJournalOutcome(value) {
  const input = value && typeof value === "object" ? value : null;
  const raw = String(
    input
      ? input.journalOutcome || input.outcome || input.action || input.kind || ""
      : value || "",
  ).trim();
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
  if (Object.prototype.hasOwnProperty.call(outcomes, raw)) {
    return outcomes[raw];
  }
  if (/^decay:(?:notNow|level:\d+|lessOften|reword|drop|keep)$/.test(raw)) {
    return raw;
  }
  return null;
}

function buildReviewAnswerEvents(origin, outcome, refs) {
  try {
    if (!origin || typeof origin !== "object") {
      return Object.freeze([]);
    }
    const day = typeof origin.day === "string" ? origin.day.trim() : "";
    const normalizedOutcome = reviewJournalOutcome(outcome);
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
  recordReviewAnswer(origin, outcome, refs) {
    try {
      const events = buildReviewAnswerEvents(origin, outcome, refs);
      if (events.length === 0) {
        return;
      }
      if (!Array.isArray(this.reviewJournalPending)) {
        this.reviewJournalPending = [];
      }
      this.reviewJournalPending.push(...events);
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
    Promise.resolve()
      .then(async () => {
        while (queue.length > 0) {
          const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
          const ledger = plugins && plugins["bob-ledger-tools"];
          const stats = ledger && ledger.api && ledger.api.stats;
          if (!stats || typeof stats.append !== "function") {
            throw new Error("Stats journal API is unavailable");
          }
          const event = queue[0];
          await stats.append(event);
          if (queue[0] === event) {
            queue.shift();
          }
        }
      })
      .catch(() => {
        try {
          new Notice("Review answer not recorded");
        } catch (error) {
          // Best effort during plugin teardown.
        }
      })
      .finally(() => {
        this.reviewJournalDraining = false;
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
