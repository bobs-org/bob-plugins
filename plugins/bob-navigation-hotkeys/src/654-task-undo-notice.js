// Shared task-operation Undo notice. Callers pass exact pre/postimages from a
// guarded operation; restore refuses before writing if any postimage changed.
class BobNavigationHotkeysTaskUndoMixin {
  showGuardedUndoNotice(message, restores, options = {}) {
    const notice = new Notice(String(message || ""), 15000);
    try {
      const container = notice && notice.noticeEl;
      if (container && typeof container.createEl === "function") {
        const button = container.createEl("button", {
          text: options.actionLabel || "Undo",
        });
        button.addEventListener("click", () => {
          void this.restoreGuardedUndoChanges(restores, {
            notice,
            successMessage: options.successMessage || "Undid change",
            failureLabel: options.failureLabel || "Could not undo change",
          });
        });
      }
    } catch (_error) {
      // Keep the operation notice if the host cannot render an action button.
    }
    return notice;
  }

  async restoreGuardedUndoChanges(restores, options = {}) {
    const source = Array.isArray(restores) ? restores : [];
    const vault = this.app && this.app.vault;
    const failureLabel = options.failureLabel || "Could not undo change";
    if (!vault || typeof vault.cachedRead !== "function") {
      new Notice(`${failureLabel} — vault is unavailable`);
      return false;
    }

    const rows = [];
    const changed = [];
    for (const restore of source) {
      if (!restore || typeof restore.path !== "string") {
        continue;
      }
      try {
        const editor =
          typeof this.getOpenMarkdownEditorForPath === "function"
            ? this.getOpenMarkdownEditorForPath(restore.path)
            : null;
        const file =
          restore.file ||
          (typeof vault.getAbstractFileByPath === "function"
            ? vault.getAbstractFileByPath(restore.path)
            : null);
        if (!file) {
          changed.push(restore.path);
          continue;
        }
        const current =
          editor && typeof editor.getValue === "function"
            ? String(editor.getValue() || "")
            : String((await vault.cachedRead(file)) || "");
        if (current !== restore.after) {
          changed.push(restore.path);
          continue;
        }
        rows.push({ ...restore, file, editor });
      } catch (_error) {
        changed.push(restore.path);
      }
    }
    if (changed.length > 0) {
      const paths = [...new Set(changed)];
      new Notice(`${failureLabel} — changed since: ${paths.join(", ")}`);
      return false;
    }

    const applied = [];
    const deletedCreated = [];
    let activePath = null;
    try {
      for (const restore of rows.slice().reverse()) {
        activePath = restore.path;
        if (restore.created === true) {
          const current = String((await vault.cachedRead(restore.file)) || "");
          if (current !== restore.after) {
            throw new Error(`postimage changed: ${restore.path}`);
          }
          deletedCreated.push(restore);
          await vault.delete(restore.file);
          continue;
        }
        applied.push(
          await this.writeTaskMoveChange(
            restore.path,
            { before: restore.after, after: restore.before },
            restore.file,
            { sourcePath: null, editor: null },
          ),
        );
      }
    } catch (error) {
      const partial = error && error.taskMoveAppliedEntry;
      if (
        partial &&
        partial.path &&
        !applied.some((entry) => entry.path === partial.path)
      ) {
        applied.push(partial);
      }
      const failedPaths = [];
      for (const restore of deletedCreated.slice().reverse()) {
        try {
          if (!vault.getAbstractFileByPath(restore.path)) {
            await vault.create(restore.path, restore.after);
          }
        } catch (_restoreError) {
          failedPaths.push(restore.path);
        }
      }
      failedPaths.push(...(await this.rollbackTaskMoveChanges(applied)));
      if (activePath) {
        failedPaths.push(activePath);
      }
      const paths = [...new Set(failedPaths)];
      new Notice(
        paths.length > 0
          ? `${failureLabel} — review: ${paths.join(", ")}`
          : `${failureLabel} — retry after checking the note`,
      );
      return false;
    }

    try {
      if (options.notice && typeof options.notice.hide === "function") {
        options.notice.hide();
      }
    } catch (_error) {
      // The success notice below confirms the guarded restore.
    }
    new Notice(options.successMessage || "Undid change");
    return true;
  }
}
