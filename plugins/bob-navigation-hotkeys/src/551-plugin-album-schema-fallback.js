// Album-only Task Card chord fallback (schema-entrypoints). Ctrl+Shift+P
// opens the Schema Card on album notes only where the Task Card has no
// target. Actual tasks and existing property routes retain priority: this
// fallback never swallows a recognized Task Card target merely because its
// own operation refuses. No second unconditional Ctrl+Shift+P registration;
// the existing `set-bullet-property` command calls here after Task Link and
// dependency/relation targeting have had priority.
function albumSchemaFallbackGate(state = {}) {
  if (state.countExplicit === true || state.hasTaskSession === true) {
    return { attempt: false, reason: "counted" };
  }
  if (
    state.initialProperty || state.initialTaskCardRow || state.directStage === true ||
    state.reopenBlocks === true || state.reopenLinks === true || state.reopenLinkedFrom === true
  ) {
    return { attempt: false, reason: "direct-stage" };
  }
  if (state.isTask === true) return { attempt: false, reason: "task" };
  if (state.isLink === true) return { attempt: false, reason: "task-link" };
  if (state.hasDependencyEntry === true) return { attempt: false, reason: "dependency" };
  return { attempt: true, reason: "album-fallback" };
}

class BobNavigationHotkeysAlbumSchemaFallbackMixin {
  albumSchemaFallbackLedger() {
    try {
      const plugins = this.app?.plugins?.plugins;
      const ledger = plugins ? plugins["bob-ledger-tools"] : null;
      if (!ledger || typeof ledger.openAlbumSchemaEntry !== "function") return null;
      try {
        if (typeof ledger.albumHeaderDesktop === "function" && !ledger.albumHeaderDesktop()) return null;
      } catch (_) {}
      return ledger;
    } catch (_) {
      return null;
    }
  }

  albumSchemaFallbackForCursor(cm, content, cursor, lineText, options = {}) {
    const line = cursor && Number.isInteger(cursor.line) ? cursor.line : null;
    const text = String(lineText || "");
    const body = String(content || "");
    let isTask = false;
    let isLink = false;
    let hasDependencyEntry = false;
    let isBullet = false;
    try {
      isTask = typeof isObsidianTaskAtLine === "function" && line !== null
        ? isObsidianTaskAtLine(body, line)
        : false;
    } catch (_) {
      isTask = false;
    }
    try {
      isLink = typeof parseLinkPickerTaskLink === "function" ? Boolean(parseLinkPickerTaskLink(text)) : false;
    } catch (_) {
      isLink = false;
    }
    try {
      const entry = typeof resolveDependencyStageEntry === "function" && line !== null
        ? resolveDependencyStageEntry(body, line)
        : null;
      hasDependencyEntry = Boolean(entry && entry.ok);
    } catch (_) {
      hasDependencyEntry = false;
    }
    try {
      isBullet = typeof isBulletLine === "function" ? isBulletLine(text) : false;
    } catch (_) {
      isBullet = false;
    }
    const gate = albumSchemaFallbackGate({
      countExplicit: options.countExplicit === true || Boolean(options.taskSession && options.taskSession.explicit),
      hasTaskSession: Boolean(options.taskSession),
      initialProperty: options.initialProperty || null,
      initialTaskCardRow: options.initialTaskCardRow || null,
      directStage: options.directStage === true,
      reopenBlocks: options.reopenBlocksStage === true,
      reopenLinks: options.reopenLinksStage === true,
      reopenLinkedFrom: options.reopenLinkedFromStage === true,
      isTask,
      isLink,
      hasDependencyEntry,
      isBullet,
    });
    if (!gate.attempt) return { handled: false, reason: gate.reason };
    const ledger = this.albumSchemaFallbackLedger();
    if (!ledger) return { handled: false, reason: "missing-plugin" };
    let filePath = "";
    try {
      const view = typeof this.getActiveMarkdownView === "function" ? this.getActiveMarkdownView() : null;
      filePath = view?.file?.path || "";
    } catch (_) {}
    if (!filePath) {
      try {
        filePath = this.app?.workspace?.activeLeaf?.view?.file?.path || "";
      } catch (_) {}
    }
    if (!filePath && cm && typeof cm.getValue === "function") {
      try {
        const active = typeof this.getActiveMarkdownView === "function" ? this.getActiveMarkdownView() : null;
        if (active && active.editor === cm && active.file && active.file.path) filePath = active.file.path;
      } catch (_) {}
    }
    if (!filePath) return { handled: false, reason: "missing-path" };
    let target = null;
    try {
      target = typeof ledger.albumSchemaEntryTargetForFile === "function"
        ? ledger.albumSchemaEntryTargetForFile(filePath)
        : null;
    } catch (_) {
      target = null;
    }
    if (!target || target.ok !== true) return { handled: false, reason: target?.reason || "not-album" };
    if (target.kind !== "album") return { handled: false, reason: "not-direct-album" };
    try {
      void ledger.openAlbumSchemaEntry({ filePath });
    } catch (_) {}
    return { handled: true, reason: "album-fallback", albumPath: target.albumPath };
  }
}
