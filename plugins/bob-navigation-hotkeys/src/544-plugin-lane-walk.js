// Lane-walk runtime: `]w` / `[w` step, `]W` / `[W` jump to the first
// task of the next / previous lane. Navigation-only: never writes, never
// touches the `]s` walk state.
const LANE_WALK_STALE_NOTICE = "Lane walk changed — try again";
const LANE_WALK_API_REQUIRED_NOTICE =
  "Bob Ledger Tools lane walk api required";
const LANE_WALK_TASKS_NOTICE =
  "Lane walk unavailable — Tasks is still indexing";
const LANE_WALK_TODAY_NOTICE =
  "Lane walk unavailable — today's plan is still loading";
const LANE_WALK_JUMP_FAILURE_NOTICE = "Could not jump to task";

class BobNavigationHotkeysLaneWalkMixin {
  readLaneWalkQueue(api) {
    try {
      if (!api || typeof api.queue !== "function") {
        return null;
      }
      const result = api.queue();
      if (!result || typeof result !== "object") {
        return null;
      }
      if (result.available === false) {
        return result;
      }
      if (!Array.isArray(result.entries)) {
        return null;
      }
      const entries = result.entries.filter(
        (entry) => normalizeLaneWalkLane(entry && entry.lane) !== null,
      );
      return { ...result, entries };
    } catch (error) {
      return null;
    }
  }

  consumePendingLaneWalkRepeat(options) {
    if (options && options.repeat !== undefined && options.repeat !== null) {
      return normalizeVimRepeat(options.repeat);
    }
    try {
      const view = this.getActiveMarkdownView();
      const editor = view && view.editor;
      if (!editor || !this.isVimNormalModeEditor(editor, view)) {
        return 1;
      }
      const cm = this.resolveVimCodeMirror(editor, view);
      const pending = getPendingVimRepeat(cm);
      if (!pending.explicit) {
        return 1;
      }
      resetPendingVimInputState(cm, "counted-lane-walk");
      return normalizeVimRepeat(pending.repeat);
    } catch (error) {
      return 1;
    }
  }

  laneWalkQueueUnavailableNotice(queue) {
    if (!queue || queue.available !== false) {
      return null;
    }
    if (queue.reason === "today") {
      return LANE_WALK_TODAY_NOTICE;
    }
    return LANE_WALK_TASKS_NOTICE;
  }

  async jumpToLaneTask(direction, options = {}) {
    if (this.reviewWalkBusy()) {
      return false;
    }
    const step = direction < 0 ? -1 : 1;
    const laneJump = Boolean(options && options.laneJump === true);
    const repeat = this.consumePendingLaneWalkRepeat(options);
    const run = async () => {
      const api = getLaneWalkApi(this.app);
      if (!api) {
        new Notice(LANE_WALK_API_REQUIRED_NOTICE);
        return false;
      }
      const jumpOrigin = this.getReviewWalkOriginCursor();
      const todayText = this.laneReleaseDateText({});
      let queue = this.readLaneWalkQueue(api);
      if (!queue) {
        new Notice(LANE_WALK_API_REQUIRED_NOTICE);
        return false;
      }
      if (queue.available === false) {
        new Notice(
          this.laneWalkQueueUnavailableNotice(queue) || LANE_WALK_TASKS_NOTICE,
        );
        return false;
      }
      const cursor = this.getReviewJumpCursor();
      const anchor =
        this.laneWalkAnchor && typeof this.laneWalkAnchor === "object"
          ? this.laneWalkAnchor
          : null;
      const planFrom = (entries) => {
        const args = {
          direction: step,
          cursor,
          anchor,
          todayText,
          repeat,
        };
        return laneJump
          ? planLaneWalkLaneJump(entries, args)
          : planLaneWalkJump(entries, args);
      };
      let entries = Array.isArray(queue.entries) ? queue.entries : [];
      if (entries.length === 0) {
        this.laneWalkAnchor = null;
        showLaneWalkNotice(
          this,
          buildLaneWalkEmptyNoticeModel(queue.counts || {}),
        );
        return false;
      }
      let plan = planFrom(entries);
      if (!plan || plan.kind === "empty") {
        this.laneWalkAnchor = null;
        showLaneWalkNotice(
          this,
          buildLaneWalkEmptyNoticeModel(queue.counts || {}),
        );
        return false;
      }
      let landed = await this.landOnWalkEntry(plan.entry, { jumpOrigin });
      if (!landed.ok && landed.stale) {
        queue = this.readLaneWalkQueue(api);
        if (!queue) {
          new Notice(LANE_WALK_API_REQUIRED_NOTICE);
          return false;
        }
        if (queue.available === false) {
          new Notice(
            this.laneWalkQueueUnavailableNotice(queue) || LANE_WALK_TASKS_NOTICE,
          );
          return false;
        }
        entries = Array.isArray(queue.entries) ? queue.entries : [];
        if (entries.length === 0) {
          this.laneWalkAnchor = null;
          showLaneWalkNotice(
            this,
            buildLaneWalkEmptyNoticeModel(queue.counts || {}),
          );
          return false;
        }
        plan = planFrom(entries);
        if (!plan || plan.kind === "empty") {
          this.laneWalkAnchor = null;
          showLaneWalkNotice(
            this,
            buildLaneWalkEmptyNoticeModel(queue.counts || {}),
          );
          return false;
        }
        landed = await this.landOnWalkEntry(plan.entry, { jumpOrigin });
      }
      if (!landed.ok) {
        new Notice(
          landed.stale ? LANE_WALK_STALE_NOTICE : LANE_WALK_JUMP_FAILURE_NOTICE,
        );
        return false;
      }
      try {
        if (landed.settled && typeof landed.settled.then === "function") {
          await landed.settled;
        }
      } catch (error) {
        // Settling never fails the landing.
      }
      this.laneWalkAnchor = buildLaneWalkAnchor(plan.entry, todayText);
      let workLog = null;
      try {
        const view = this.getActiveMarkdownView();
        const editor = view && view.editor;
        if (
          view &&
          view.file &&
          view.file.path === plan.entry.path &&
          editor &&
          typeof editor.getValue === "function" &&
          typeof editor.getCursor === "function"
        ) {
          const cursorPos = getEditorCursor(editor);
          const content = String(editor.getValue() || "");
          if (cursorPos) {
            workLog = readLatestWorkLog(content, cursorPos.line);
          }
        } else {
          const file = plan.entry.path
            ? this.app &&
              this.app.vault &&
              typeof this.app.vault.getAbstractFileByPath === "function"
              ? this.app.vault.getAbstractFileByPath(plan.entry.path)
              : null
            : null;
          if (file) {
            const content = await this.readLinkPickerNoteContent(
              plan.entry.path,
              file,
            );
            if (typeof content === "string") {
              const resolved = resolveReviewQueueLine(content, plan.entry);
              if (resolved.ok) {
                workLog = readLatestWorkLog(content, resolved.line);
              }
            }
          }
        }
      } catch (error) {
        workLog = null;
      }
      const model = buildLaneWalkNoticeModel(plan.entry, {
        rank: plan.rank,
        total: plan.total,
        laneRank: plan.laneRank,
        laneTotal: plan.laneTotal,
        wrapped: plan.wrapped,
        list: entries,
        workLog,
      });
      showLaneWalkNotice(this, model);
      return true;
    };
    const previous = this.laneWalkChain || Promise.resolve();
    const chained = previous.then(run, run);
    this.laneWalkChain = chained.then(
      () => undefined,
      () => undefined,
    );
    return chained;
  }
}
