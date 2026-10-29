// Runtime adapter for the pure Task Card theme projection. Task Link targets
// carry the exact live note text captured during resolution; local and
// counted targets use the modal's current editor snapshot.
function buildTaskCardThemeRuntimeContext(modal) {
  const app = modal && modal.app;
  let themeApi = null;
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const ledger = plugins && plugins["bob-ledger-tools"];
    const themes = ledger && ledger.api && ledger.api.themes;
    if (themes && Number(themes.version) >= 1) {
      themeApi = themes;
    }
  } catch (_error) {
    themeApi = null;
  }
  let content = "";
  try {
    content = String(
      modal && typeof modal.getEditorContent === "function"
        ? modal.getEditorContent() || ""
        : "",
    );
  } catch (_error) {
    content = "";
  }
  const filePath = normalizeVaultRelativePath((modal && modal.filePath) || "");
  const session = taskCardSessionContext({
    content,
    lineText: modal && modal.lineText,
    cursorLine: modal && modal.cursor ? modal.cursor.line : 0,
    filePath,
    taskSession: modal && modal.taskSession,
    linkSession: modal && modal.linkSession,
  });
  const noteContents = new Map();
  for (const { target } of deduplicateTaskCardTargets(session.targets)) {
    const path = normalizeVaultRelativePath(
      (target && (target.path || target.filePath)) || filePath,
    );
    if (!path) {
      continue;
    }
    if (path === filePath) {
      noteContents.set(path, content);
    } else if (target && typeof target.content === "string") {
      noteContents.set(path, target.content);
    } else if (target && typeof target.noteText === "string") {
      noteContents.set(path, target.noteText);
    }
  }
  return Object.freeze({
    themeApi,
    themeNoteContents: noteContents,
  });
}
