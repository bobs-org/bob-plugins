// Block-ID rename writes (plan 202611/lost_task_guards.md, rename_atomic).
//
// A rename touches several notes: link rewrites in each referencing note plus
// the `^id` itself in the destination. Each note is written exactly once:
//
// - A note open in any markdown leaf (active or not) is written with ONE
//   editor transaction holding all of that note's edits. One transaction is
//   one CM6 history event, so one undo reverts the whole note. Applying the
//   edits one `replaceRange` at a time left separate undo events: a single vim
//   `u` reverted only the `^id` and left the same-note links on the new ID.
// - A note not open anywhere is written with `vault.process`, comparing the
//   file to the planned before-image inside the atomic read-modify-write so a
//   concurrent change (a sync pull, another writer) refuses instead of being
//   overwritten.
//
// Closed notes are written first and rolled back when any of them refuses;
// open notes are verified and written last in one synchronous pass, so a
// refusal never leaves half a rename behind.

function renameEditorText(editor) {
  try {
    return editor && typeof editor.getValue === "function"
      ? String(editor.getValue() || "")
      : null;
  } catch (error) {
    return null;
  }
}

class BlockIdPromptRenameWritesMixin {
  // Authoritative planning read: the live editor buffer when the note is open
  // (unsaved edits win over stale disk, and editor offsets stay valid),
  // otherwise the vault. Disagreeing buffers for one note refuse.
  async readRenameSnapshot(file, source) {
    const snapshot = await readAuthoritativePromptTargetContent(this, source, file);
    if (snapshot.ambiguous) {
      return { content: null, editor: null, ambiguous: true };
    }
    return { content: snapshot.content, editor: snapshot.editor || null };
  }

  async applyReferenceRewritePlan(plan, source) {
    const targets = await this.prepareRenameWrites(plan, source);
    if (!targets) {
      return false;
    }

    if (!(await this.commitRenameWrites(targets))) {
      return false;
    }

    if (plan.rename) {
      this.recordBlockRename(plan, targets);
    }

    return true;
  }

  // Re-read every planned note and refuse when any changed since planning.
  // Returns the write targets (planned before/after text plus the live editor
  // when the note is open) or null with a notice already shown.
  async prepareRenameWrites(plan, source) {
    const targets = [];
    for (const filePlan of plan.filePlans) {
      const snapshot = await this.readRenameSnapshot(filePlan.file, source);
      if (snapshot.ambiguous) {
        new Notice(
          `Block ID rename blocked: ${filePlan.file.path} changed before rewrite`,
        );
        return null;
      }
      if (snapshot.content === null) {
        new Notice(`Block ID rename blocked: ${filePlan.file.path} could not be read`);
        return null;
      }
      if (snapshot.content !== filePlan.content) {
        new Notice(
          `Block ID rename blocked: ${filePlan.file.path} changed before rewrite`,
        );
        return null;
      }

      targets.push({
        file: filePlan.file,
        path: filePlan.file.path,
        content: filePlan.content,
        edits: filePlan.edits,
        after: applyTextEdits(filePlan.content, filePlan.edits),
        editor: snapshot.editor,
        isSource: filePlan.file.path === source.sourcePath,
      });
    }

    return targets;
  }

  async commitRenameWrites(targets) {
    const closedTargets = targets.filter((target) => !target.editor);
    const openTargets = targets.filter((target) => target.editor);
    const written = [];

    for (const target of closedTargets) {
      const outcome = await this.writeClosedRenameTarget(target);
      if (outcome !== "written") {
        await this.rollbackClosedRenameWrites(written);
        this.noticeRenameWriteRefusal(target, outcome);
        return false;
      }
      written.push(target);
    }

    // No await between this check and the last transaction: the editors
    // cannot change underneath the verified before-image.
    for (const target of openTargets) {
      if (renameEditorText(target.editor) !== target.content) {
        await this.rollbackClosedRenameWrites(written);
        this.noticeRenameWriteRefusal(target, "changed");
        return false;
      }
    }

    for (const target of openTargets) {
      let applied = false;
      try {
        applied = this.applyRenameTransaction(target);
      } catch (error) {
        console.error("Block ID Prompt failed to modify open note", error);
      }
      if (!applied) {
        await this.rollbackClosedRenameWrites(written);
        this.noticeRenameWriteRefusal(target, "failed");
        return false;
      }
    }

    return true;
  }

  // Compare-and-swap write of one closed note. Resolves "written",
  // "changed" (the file no longer matches the planned before-image), or
  // "failed".
  async writeClosedRenameTarget(target) {
    let changed = false;
    try {
      await this.app.vault.process(target.file, (data) => {
        if (data !== target.content) {
          changed = true;
          return data;
        }
        return target.after;
      });
    } catch (error) {
      console.error("Block ID Prompt failed to modify note", error);
      return "failed";
    }

    return changed ? "changed" : "written";
  }

  // Undo closed writes already made when a later note refuses. A note that
  // changed again since our write cannot be restored safely; it is named so
  // its links can be checked by hand.
  async rollbackClosedRenameWrites(written) {
    const stuck = [];
    for (const target of written.slice().reverse()) {
      let restored = false;
      try {
        await this.app.vault.process(target.file, (data) => {
          if (data === target.after) {
            restored = true;
            return target.content;
          }
          return data;
        });
      } catch (error) {
        console.error("Block ID Prompt failed to roll back note", error);
      }
      if (!restored) {
        stuck.push(target.path);
      }
    }

    if (stuck.length > 0) {
      new Notice(
        `Block ID rename was stopped, but ${stuck.join(", ")} could not be restored; check its links`,
        0,
      );
    }
  }

  noticeRenameWriteRefusal(target, outcome) {
    if (outcome === "changed") {
      new Notice(`Block ID rename blocked: ${target.path} changed before rewrite`);
    } else if (target.isSource && target.editor) {
      new Notice("Block ID rename stopped: active note could not be modified");
    } else {
      new Notice(`Block ID rename stopped: ${target.path} could not be modified`);
    }
  }

  // One editor transaction per note: every edit is expressed against the
  // planned before-image, so they land together and undo together.
  applyRenameTransaction(target) {
    const editor = target.editor;
    const ordered = [...target.edits].sort((left, right) => left.start - right.start);
    this.suppressEditorScans();
    this.renameFollowApplying = true;

    try {
      if (editor && typeof editor.transaction === "function") {
        editor.transaction({
          changes: ordered.map((edit) => ({
            from: indexToEditorPosition(target.content, edit.start),
            to: indexToEditorPosition(target.content, edit.end),
            text: edit.replacement,
          })),
        });
        return true;
      }

      if (editor && typeof editor.replaceRange === "function") {
        for (const edit of ordered.slice().reverse()) {
          editor.replaceRange(
            edit.replacement,
            indexToEditorPosition(target.content, edit.start),
            indexToEditorPosition(target.content, edit.end),
          );
        }
        return true;
      }

      return false;
    } finally {
      this.renameFollowApplying = false;
    }
  }
}
