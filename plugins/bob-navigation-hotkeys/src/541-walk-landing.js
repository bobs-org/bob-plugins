// Shared walk landing: the cursor-moving core behind `]s` and `]w`.
// `landOnReviewQueueEntry` (review advance) is a thin wrapper that calls
// this and then records the review landing; the lane walk calls this
// directly so a `]w` landing never touches the `]s` walk.
const WALK_LANDING_SETTLE_TIMEOUT_MS = 1500;

class BobNavigationHotkeysWalkLandingMixin {
  async landOnWalkEntry(entry, options = {}) {
    const jumpOrigin =
      options && typeof options === "object" ? options.jumpOrigin : null;
    const path = entry && typeof entry.path === "string" ? entry.path : "";
    if (!path) {
      return { ok: false, stale: true, settled: Promise.resolve(false) };
    }
    const activeView = this.getActiveMarkdownView();
    const activeEditor = activeView && activeView.editor;
    const sameNote = Boolean(
      activeView &&
        activeView.file &&
        activeView.file.path === path &&
        activeEditor &&
        typeof activeEditor.getValue === "function",
    );
    let content = null;
    let file =
      activeView && activeView.file && activeView.file.path === path
        ? activeView.file
        : null;
    if (sameNote) {
      content = String(activeEditor.getValue() || "");
    } else {
      const vault = this.app && this.app.vault;
      file =
        file ||
        (vault && typeof vault.getAbstractFileByPath === "function"
          ? vault.getAbstractFileByPath(path)
          : null);
      if (!file) {
        return { ok: false, stale: true, settled: Promise.resolve(false) };
      }
      content = await this.readLinkPickerNoteContent(path, file);
      if (content === null) {
        return { ok: false, stale: false, settled: Promise.resolve(false) };
      }
    }
    const resolved = resolveReviewQueueLine(content, entry);
    if (!resolved.ok) {
      return { ok: false, stale: true, settled: Promise.resolve(false) };
    }
    if (sameNote) {
      if (!setEditorCursor(activeEditor, { line: resolved.line, ch: 0 })) {
        return { ok: false, stale: false, settled: Promise.resolve(false) };
      }
      scheduleOpenTaskJumpCenter(this, activeEditor, resolved.line, 0);
      if (jumpOrigin) {
        try {
          const jumpContext =
            this.createVimJumpContextWithOrigin(jumpOrigin);
          if (jumpContext) {
            const settled = this.enqueueVimJumpContextTransition(
              jumpContext,
              { path, line: resolved.line, ch: 0 },
              { expectedPath: path },
            );
            if (settled && typeof settled.catch === "function") {
              settled.catch(() => false);
            }
          }
        } catch (error) {
          // Jump history is best-effort after a successful landing.
        }
      }
      return { ok: true, stale: false, settled: Promise.resolve(true) };
    }
    const opened = await openMarkdownFileWithLeafReuse(
      this,
      file,
      `Review jump, but could not open ${path}`,
    );
    if (!opened) {
      return { ok: false, stale: false, settled: Promise.resolve(false) };
    }
    let settleResolve = null;
    const settled = new Promise((resolve) => {
      settleResolve = resolve;
    });
    let settledDone = false;
    const settleOnce = (value) => {
      if (settledDone) {
        return;
      }
      settledDone = true;
      try {
        settleResolve(value);
      } catch (error) {
        // Best-effort settle only.
      }
    };
    const timer =
      typeof setTimeout === "function"
        ? setTimeout(() => settleOnce(false), WALK_LANDING_SETTLE_TIMEOUT_MS)
        : null;
    const finishTimer = () => {
      if (timer !== null && typeof clearTimeout === "function") {
        clearTimeout(timer);
      }
    };
    void finishTimer;
    const wrappedSettle = (value) => {
      finishTimer();
      settleOnce(value);
    };
    if (jumpOrigin) {
      let jumpContext = null;
      try {
        jumpContext = this.createVimJumpContextWithOrigin(jumpOrigin);
      } catch (error) {
        jumpContext = null;
      }
      if (jumpContext) {
        const completion = {
          token: jumpContext.token,
          resolve: (result) => {
            try {
              if (result && result.ok && result.destination) {
                const transition = this.enqueueVimJumpContextTransition(
                  jumpContext,
                  result.destination,
                  { expectedPath: path },
                );
                if (transition && typeof transition.catch === "function") {
                  transition.catch(() => false);
                }
              }
            } catch (error) {
              // Jump history is best-effort after a successful landing.
            } finally {
              wrappedSettle(true);
            }
          },
        };
        this.jumpOrDeferTaskMoveDestination(
          path,
          { line: resolved.line, text: entry.originalMarkdown },
          TASK_MOVE_DESTINATION_JUMP_RETRIES,
          completion,
        );
      } else {
        this.jumpOrDeferTaskMoveDestination(path, {
          line: resolved.line,
          text: entry.originalMarkdown,
        });
        wrappedSettle(true);
      }
    } else {
      this.jumpOrDeferTaskMoveDestination(
        path,
        { line: resolved.line, text: entry.originalMarkdown },
        TASK_MOVE_DESTINATION_JUMP_RETRIES,
        () => wrappedSettle(true),
      );
      if (timer === null) {
        wrappedSettle(true);
      }
    }
    return { ok: true, stale: false, settled };
  }
}
