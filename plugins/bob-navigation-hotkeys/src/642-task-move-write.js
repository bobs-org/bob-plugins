// The move/split write primitive lives in its own fragment so persistence
// guards stay easy to audit independently of picker and move discovery code.
Object.assign(BobNavigationHotkeysNotesMoveMixin.prototype, {
  async writeTaskMoveChange(path, change, file, session, finalCursor = null) {
    const sourceEditor =
      path === session.sourcePath ? session.editor : null;
    const editor = sourceEditor || this.getOpenMarkdownEditorForPath(path);
    if (editor && typeof editor.getValue === "function") {
      if (String(editor.getValue() || "") !== change.before) {
        throw new Error(`Task move preimage changed: ${path}`);
      }
      let applied = false;
      let settleOutcome = null;
      let actualAfter = String(change.after);
      try {
        if (
          session &&
          session.settleNav === true &&
          typeof this.applyNavSettledEditorWrite === "function"
        ) {
          settleOutcome = this.applyNavSettledEditorWrite(editor, path, {
            expected: change.before,
            contents: typeof change.settleInput === "string"
              ? change.settleInput
              : change.after,
            today: session.settleToday,
            dailyPath: session.dailyPath,
          });
          applied = Boolean(settleOutcome && settleOutcome.applied === true);
          actualAfter = settleOutcome && settleOutcome.contents != null
            ? String(settleOutcome.contents)
            : String(editor.getValue() || "");
        } else {
          applied = applyEditorContentTransaction(
            editor,
            change.before,
            change.after,
            finalCursor,
          );
        }
      } catch (error) {
        const live = String(editor.getValue() || "");
        if (live !== change.before) {
          error.taskMoveAppliedEntry = Object.freeze({
            path,
            file,
            editor,
            change: Object.freeze({ before: change.before, after: live }),
          });
        }
        throw error;
      }
      if (!applied || String(editor.getValue() || "") !== actualAfter) {
        const error = new Error(`Task move editor transaction failed: ${path}`);
        const live = String(editor.getValue() || "");
        if (live !== change.before) {
          error.taskMoveAppliedEntry = Object.freeze({
            path,
            file,
            editor,
            change: Object.freeze({ before: change.before, after: live }),
          });
        }
        throw error;
      }
      return Object.freeze({
        path,
        file,
        editor,
        change: Object.freeze({ before: change.before, after: actualAfter }),
        settleOutcome,
      });
    }

    const vault = this.app && this.app.vault;
    if (!vault || typeof vault.process !== "function") {
      throw new Error("Vault content updates are unavailable");
    }
    let transformed = false;
    try {
      await vault.process(file, (content) => {
        if (String(content || "") !== change.before) {
          throw new Error(`Task move preimage changed: ${path}`);
        }
        transformed = true;
        return change.after;
      });
    } catch (error) {
      try {
        if (
          typeof vault.cachedRead === "function" &&
          String((await vault.cachedRead(file)) || "") === change.after
        ) {
          error.taskMoveAppliedEntry = Object.freeze({
            path,
            file,
            editor: null,
            change,
          });
        }
      } catch (_ignoredError) {
        // The original process error remains authoritative.
      }
      throw error;
    }
    if (!transformed) {
      throw new Error(`Task move file transaction failed: ${path}`);
    }
    return Object.freeze({
      path,
      file,
      editor: null,
      change: Object.freeze({ before: change.before, after: change.after }),
      settleOutcome: null,
    });
  },
});
