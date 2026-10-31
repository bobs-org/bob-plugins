// Due-row review capture (nav-gestures): Alt+N answers from any due walk
// row, not only the exact `]s` landing. The cursor row counts when the
// pre-write freshness queue holds an entry with the same note path and the
// exact current line text; any review group counts. After a resolving write
// the walk advances exactly once to the answered row's walk successor,
// planned anchor-only from the pre-write queue. A task that is not due
// keeps today's behavior (plain notice, no advance). Never throws.
class BobNavigationHotkeysReviewDueRowMixin {
  // Synchronous due-row check for Alt+N (`options.dueRow`). Requires the
  // active view's editor to be `editor`, finds the cursor row in the
  // pre-write queue with `findReviewResumeIndex`, and builds the origin
  // with the shared builder. Returns null when there is no match: the
  // gesture then behaves as today. Never throws.
  captureReviewDueRowGesture(editor) {
    try {
      const view = this.getActiveMarkdownView();
      if (
        !view ||
        !view.file ||
        typeof view.file.path !== "string" ||
        !view.editor ||
        view.editor !== editor
      ) {
        return null;
      }
      const cursor = getEditorCursor(editor);
      const lineText = cursor ? getEditorLine(editor, cursor.line) : null;
      if (!cursor || lineText === null) {
        return null;
      }
      const todayText = this.laneReleaseDateText({});
      const queueBefore = this.readFreshnessQueue(
        getReviewFreshnessApi(this.app),
      );
      if (!Array.isArray(queueBefore) || queueBefore.length === 0) {
        return null;
      }
      let found = null;
      try {
        const index = findReviewResumeIndex(queueBefore, {
          path: view.file.path,
          text: lineText,
          line: cursor.line + 1,
        });
        if (index >= 0) {
          found = queueBefore[index];
        }
      } catch (error) {
        found = null;
      }
      if (!found) {
        return null;
      }
      let key = "";
      try {
        key = reviewQueueEntryKey(found);
      } catch (error) {
        return null;
      }
      if (!key) {
        return null;
      }
      let tier = null;
      try {
        tier = reviewEntryMachineTier(found) || null;
      } catch (error) {
        tier = null;
      }
      if (typeof this.buildReviewGestureOrigin !== "function") {
        return null;
      }
      return this.buildReviewGestureOrigin(found, queueBefore, todayText, {
        path: view.file.path,
        line: cursor.line,
        text: lineText,
        key,
        tier,
        offLanding: true,
      });
    } catch (error) {
      return null;
    }
  }
}
