// Command-mode finished-run refresh: `bob-command-mode:run-finished`
// carries `{runId, argv, entryId, outcome, effect, invalidates}`, and each
// tag names a cache family this plugin owns. Unknown tags (for example
// `plugins`) belong to other plugins and are ignored. Every refresh below
// is scheduled and best-effort: one failing hook never breaks the event or
// another cache.

class BobLedgerToolsCommandModeRefreshMixin {
  setupCommandModeRunRefresh() {
    try {
      const workspace = this.app && this.app.workspace;
      if (!workspace || typeof workspace.on !== "function") {
        return;
      }
      if (typeof this.registerEvent !== "function") {
        return;
      }
      this.registerEvent(
        workspace.on("bob-command-mode:run-finished", (payload) => {
          this.refreshCachesForCommandModeRun(payload);
        }),
      );
    } catch (error) {
      // The refresh subscription is best-effort.
    }
  }

  refreshCachesForCommandModeRun(payload) {
    try {
      const tags =
        payload && Array.isArray(payload.invalidates) ? payload.invalidates : [];
      const seen = new Set();
      for (const tag of tags) {
        if (typeof tag !== "string" || seen.has(tag)) {
          continue;
        }
        seen.add(tag);
        try {
          if (tag === "themes") {
            this.refreshThemesForCommandModeRun();
          } else if (tag === "relations") {
            this.refreshRelationsForCommandModeRun();
          } else if (tag === "stats") {
            this.refreshStatsForCommandModeRun();
          } else if (tag === "references") {
            this.refreshReferencesForCommandModeRun();
          } else if (tag === "tasks") {
            this.refreshTasksForCommandModeRun();
          }
          // Unknown tags belong to other plugins; ignore them.
        } catch (error) {
          // One cache failure never blocks the others.
        }
      }
    } catch (error) {
      // Cache refresh is best-effort.
    }
  }

  refreshThemesForCommandModeRun() {
    if (typeof this.schedulePomodoroThemesFetch === "function") {
      this.schedulePomodoroThemesFetch("command-mode");
    }
  }

  refreshRelationsForCommandModeRun() {
    if (typeof this.scheduleRelationLabelsJournalRefresh === "function") {
      this.scheduleRelationLabelsJournalRefresh("command-mode");
    }
    if (typeof this.scheduleRelationIndexOverlayRefresh === "function") {
      this.scheduleRelationIndexOverlayRefresh();
    }
  }

  refreshStatsForCommandModeRun() {
    if (typeof this.scheduleStatsRevalidate === "function") {
      this.scheduleStatsRevalidate("command-mode");
    }
  }

  refreshReferencesForCommandModeRun() {
    if (typeof this.apiReadingBoardRefresh === "function") {
      void this.apiReadingBoardRefresh();
    }
  }

  refreshTasksForCommandModeRun() {
    if (typeof this.schedulePlanBlockRerender === "function") {
      this.schedulePlanBlockRerender();
    }
    if (typeof this.refreshTodayCacheFromDaily === "function") {
      this.refreshTodayCacheFromDaily();
    }
    if (typeof this.scheduleFreshnessMarksRefresh === "function") {
      this.scheduleFreshnessMarksRefresh();
    }
    if (typeof this.scheduleFreshnessStatusBar === "function") {
      this.scheduleFreshnessStatusBar();
    }
  }
}
