// Read-only Snooze Card facts for the navigation runtime controller
// (`snoozeFacts` namespace v1, additive: the top-level api stays v3). Every
// member is synchronous and never throws: missing providers degrade to null
// so the card renders unavailable text instead of invented facts. Consumers
// feature-detect `api?.snoozeFacts?.version >= 1`.
function createSnoozeFactsApi(plugin) {
  const safe = (fn, fallback) => {
    try {
      const value = fn();
      return value === undefined ? fallback : value;
    } catch (_) {
      return fallback;
    }
  };
  const coerceClock = (now) => {
    if (now instanceof Date && Number.isFinite(now.getTime())) return now;
    if (typeof now === "string" || typeof now === "number") {
      const parsed = new Date(now);
      if (Number.isFinite(parsed.getTime())) return parsed;
    }
    return new Date();
  };
  return Object.freeze({
    version: 1,
    zoneName: () => safe(() => {
      if (typeof snoozedLocalZoneName !== "function") return null;
      const zone = snoozedLocalZoneName();
      return typeof zone === "string" && zone ? zone : null;
    }, null),
    dateText: (now) => safe(() => {
      if (typeof snoozedTodayTextFromClock !== "function") return null;
      const text = snoozedTodayTextFromClock(coerceClock(now));
      return typeof text === "string" && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
    }, null),
    nowMinutes: (now) => safe(() => {
      if (typeof snoozedNowMinutesFromClock !== "function") return null;
      const minutes = snoozedNowMinutesFromClock(coerceClock(now));
      return Number.isInteger(minutes) ? minutes : null;
    }, null),
    todayEvents: (dailyContents) => safe(() => {
      if (typeof dailyContents !== "string" || typeof gcalEventsScanMarkdown !== "function") return null;
      const lines = dailyContents.replace(/\r\n/g, "\n").split("\n");
      const scanned = gcalEventsScanMarkdown(lines, {});
      if (!scanned || !Array.isArray(scanned.rows)) return [];
      return scanned.rows.map((row) => {
        const text = Number.isInteger(row && row.line) ? String(lines[row.line] || "") : "";
        const title = text.replace(/^\s*[-*+]\s+(?:\[[ xX*?/-]\]\s+#task\s+)?\*\*(?:\d{4}-\d{4}|all day)\*\*\s*/i, "").trim() || "Event";
        return {
          title,
          kind: row && row.kind === "task" ? "task" : "context",
          startMin: Number.isInteger(row && row.startMinutes) ? row.startMinutes : null,
          endMin: Number.isInteger(row && row.endMinutes) ? row.endMinutes : null,
        };
      });
    }, null),
    activeRow: (identityKey) => safe(() => {
      if (typeof identityKey !== "string" || !identityKey) return null;
      if (!plugin || typeof plugin.snoozedRows !== "function") return null;
      const rows = plugin.snoozedRows();
      if (!Array.isArray(rows)) return null;
      const want = identityKey.replace("#^", "#");
      const found = rows.find((row) => row && (row.key === want || row.identity === identityKey)) || null;
      if (!found) return null;
      if (found.state !== "asleep" && found.state !== "due" && found.state !== "blocked") return null;
      return {
        hhmm: typeof found.hhmm === "string" ? found.hhmm : null,
        minutes: Number.isInteger(found.minutes) ? found.minutes : null,
        state: found.state,
        target: typeof found.target === "string" ? found.target : null,
        blockId: typeof found.blockId === "string" ? found.blockId : null,
        route: typeof found.route === "string" ? found.route : null,
      };
    }, null),
    planCounts: (dailyContents) => safe(() => {
      if (typeof dailyContents !== "string") return null;
      if (typeof computePlanBudget !== "function" || typeof loadPlanCaps !== "function") return null;
      const budget = computePlanBudget(dailyContents, loadPlanCaps().caps, null, {});
      const links = budget && budget.links;
      if (!links || !Number.isInteger(links.count) || !Number.isInteger(links.cap)) return null;
      return { count: links.count, cap: links.cap, over: links.count > links.cap };
    }, null),
  });
}
