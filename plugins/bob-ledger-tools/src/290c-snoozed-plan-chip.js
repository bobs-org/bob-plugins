class BobLedgerToolsSnoozedPlanChipMixin {
  snoozedPlanDataForRender(tasks, content, dailyPath, now) {
    const neutral = {
      isOffClockLink: undefined,
      snoozedAvailable: false,
      snoozedQueue: null,
      snoozedTodayCount: null,
    };
    try {
      const isOffClockLink =
        typeof this.planBudgetOffClockPredicate === "function" &&
        typeof content === "string"
          ? this.planBudgetOffClockPredicate(dailyPath, content)
          : undefined;
      const cache = this.snoozedCache;
      const cacheReady =
        Array.isArray(tasks) &&
        typeof content === "string" &&
        typeof this.isSnoozedCacheReady === "function" &&
        this.isSnoozedCacheReady(now) &&
        cache &&
        sameVaultPath(cache.dailyPath || "", dailyPath);
      const todayReady =
        typeof this.isTodayCacheReady === "function" &&
        this.isTodayCacheReady(now);
      if (!cacheReady || !todayReady) return neutral;
      const todayKeys =
        this.todayCache && Array.isArray(this.todayCache.keys)
          ? this.todayCache.keys
          : [];
      const rows = cache && Array.isArray(cache.rows) ? cache.rows : [];
      const queue = rows.map((row) => ({
        id: row && (row.key || row.identity),
        state: row && row.state,
        target: row && row.hhmm,
        minutes: row && row.minutes,
        on_clock:
          !!row &&
          row.state !== "blocked" &&
          typeof isOffClockLink === "function" &&
          !isOffClockLink(row.route, row.blockId),
      }));
      return {
        isOffClockLink,
        snoozedAvailable: true,
        snoozedQueue: queue,
        snoozedTodayCount: todayKeys.length,
      };
    } catch (error) {
      return neutral;
    }
  }

  paintSnoozedPlanChip(container, meter, dailyPath) {
    try {
      if (!container || !meter || meter.chip !== true) return null;
      const due = meter.tone === "amber";
      const cls =
        "bob-plan-chip bob-plan-snoozed" +
        (due ? " bob-plan-snoozed-due" : "");
      const chip = container.createEl("a", { cls });
      const text = typeof meter.text === "string" ? meter.text : "⏰";
      const rest = text.replace(/^⏰\s*/, "");
      const glyph = chip.createEl("span", { cls: "bob-snooze-plan-glyph" });
      glyph.setAttribute("aria-hidden", "true");
      chip.appendText(rest);
      chip.setAttribute("href", "#");
      chip.setAttribute("title", meter.tooltip || "Snoozed tasks");
      chip.setAttribute("aria-label", meter.tooltip || "Snoozed tasks");
      chip.addEventListener("click", (event) => {
        try {
          if (event && typeof event.preventDefault === "function") {
            event.preventDefault();
          }
          if (event && typeof event.stopPropagation === "function") {
            event.stopPropagation();
          }
          if (typeof this.jumpToSnoozedSection === "function") {
            void this.jumpToSnoozedSection(dailyPath);
          }
        } catch (error) {
          // The meter stays readable if a workspace is closing.
        }
      });
      return chip;
    } catch (error) {
      return null;
    }
  }
}
