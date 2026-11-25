// Mirror note-switch guard (bob-cli-py): the debounced hand-edit mirror
// must never read or write across notes. The ]s walk reuses one editor for
// the next row, so a pending pass armed in note A can fire while that same
// editor shows note B. Every guarded path drops the pass when the editor no
// longer shows the snapshot's parent path; reconcile heals what is dropped.
class BobNavigationHotkeysDependencyMirrorGuardMixin {
  dependencyMirrorPathForEditor(editor) {
    if (!editor) {
      return null;
    }
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.getLeavesOfType === "function") {
        const leaves = workspace.getLeavesOfType("markdown") || [];
        for (const leaf of leaves) {
          const view = leaf && leaf.view;
          if (
            view &&
            view.editor === editor &&
            view.file &&
            view.file.path
          ) {
            return normalizeVaultRelativePath(view.file.path);
          }
        }
      }
    } catch (_leavesError) {
      // Best-effort: fall through to the active view.
    }
    try {
      if (typeof this.getActiveMarkdownView === "function") {
        const activeView = this.getActiveMarkdownView();
        if (
          activeView &&
          activeView.editor === editor &&
          activeView.file &&
          activeView.file.path
        ) {
          return normalizeVaultRelativePath(activeView.file.path);
        }
      }
    } catch (_activeViewError) {
      // Best-effort: unknown means the caller decides.
    }
    return null;
  }

  dependencyMirrorEditorShowsPath(editor, parentPath) {
    const expected = normalizeVaultRelativePath(parentPath || "");
    if (!expected || !editor) {
      return false;
    }
    const current = this.dependencyMirrorPathForEditor(editor);
    if (current === null) {
      return true;
    }
    return current === expected;
  }

  cancelPendingDependencyHandEditMirror() {
    if (this.pendingDependencyMirror) {
      clearTimeout(this.pendingDependencyMirror);
      this.pendingDependencyMirror = null;
    }
    this.pendingDependencyMirrorSnapshot = null;
  }

  cancelPendingDependencyHandEditMirrorIfNoteChanged() {
    const snapshot = this.pendingDependencyMirrorSnapshot;
    if (!snapshot || !snapshot.parentPath || !snapshot.editor) {
      return false;
    }
    let known = false;
    let current = null;
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.getLeavesOfType === "function") {
        const leaves = workspace.getLeavesOfType("markdown") || [];
        for (const leaf of leaves) {
          const view = leaf && leaf.view;
          if (
            view &&
            view.editor === snapshot.editor &&
            view.file &&
            view.file.path
          ) {
            current = normalizeVaultRelativePath(view.file.path);
            known = true;
            break;
          }
        }
      }
      if (!known && typeof this.getActiveMarkdownView === "function") {
        const activeView = this.getActiveMarkdownView();
        if (
          activeView &&
          activeView.editor === snapshot.editor &&
          activeView.file &&
          activeView.file.path
        ) {
          current = normalizeVaultRelativePath(activeView.file.path);
          known = true;
        }
      }
    } catch (_lookupError) {
      return false;
    }
    if (!known) {
      return false;
    }
    if (current === normalizeVaultRelativePath(snapshot.parentPath)) {
      return false;
    }
    this.cancelPendingDependencyHandEditMirror();
    return true;
  }
}
