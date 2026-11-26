// Property editor public entry points and props YAML excursion
// (bob-cli-pf.4.1.5 entrypoints-yaml). One opener for the bare `+` key, the
// palette, Command Mode, drawer actions, and sibling plugins, plus the
// species hand-offs and the `kind: "props"` YAML excursion with Done return.
// Pure helpers stay DOM-free; the mixin owns registration and teardown.

const PROPERTY_EDITOR_ENTRY_COMMAND_ID = "edit-note-properties";
const PROPERTY_EDITOR_ENTRY_COMMAND_NAME = "Edit note properties";

// Any Markdown note may host the editor. Non-Markdown targets refuse with
// a useful reason instead of opening on the wrong file.
function propertyEditorEntryIsMarkdownPath(path) {
  return typeof path === "string" && /\.md$/i.test(path);
}

function propertyEditorEntryNormalizePath(value) {
  if (typeof propertyNotePath === "function") return propertyNotePath(value);
  const path = value && typeof value.path === "string" ? value.path : value;
  return String(path || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

// An explicit path always wins; an omitted path means the active note.
// Returns { ok, path } or { ok: false, reason } for missing-path.
function propertyEditorEntryResolvePath(plugin, options = {}) {
  const explicit = options.filePath || options.path || "";
  if (explicit) return { ok: true, path: propertyEditorEntryNormalizePath(explicit) };
  try {
    if (typeof getActiveMarkdownView === "function") {
      const view = getActiveMarkdownView(plugin && plugin.app);
      const filePath = view && view.file && view.file.path;
      if (filePath) return { ok: true, path: propertyEditorEntryNormalizePath(filePath) };
    }
  } catch (_) {}
  try {
    const file = plugin && plugin.app && plugin.app.workspace && plugin.app.workspace.activeLeaf
      && plugin.app.workspace.activeLeaf.view && plugin.app.workspace.activeLeaf.view.file;
    if (file && file.path) return { ok: true, path: propertyEditorEntryNormalizePath(file.path) };
  } catch (_) {}
  return { ok: false, reason: "missing-path" };
}

// Card rows hand off to the owning species editor. The owner names the
// species; the wire editor is always "==" on card rows today.
function propertyEditorHandoffSpecies(input = {}) {
  const owner = String(input.owner || "").trim().toLowerCase();
  if (owner === "record") return "record";
  if (owner === "intentions" || owner === "intention") return "intentions";
  if (owner === "album") return "album";
  if (owner === "bank") return "bank";
  return null;
}

// Recovery line for a damaged show report: bob's parse-error line first,
// then the duplicate row's line for duplicate-key YAML, then the earliest
// surviving row line, else the frontmatter start, else the first line.
function propertyEditorYamlIssueLine(report) {
  try {
    if (typeof propertyEditorRecoveryDetails === "function") {
      const details = propertyEditorRecoveryDetails(report);
      if (details && Number.isInteger(details.line) && details.line > 0) return details.line;
    }
  } catch (_) {}
  try {
    const rows = Array.isArray(report && report.properties) ? report.properties : [];
    let line = null;
    for (const row of rows) {
      if (row && Number.isInteger(row.line) && row.line > 0) {
        if (line === null || row.line < line) line = row.line;
      }
    }
    if (line !== null) return line;
    const start = report && report.frontmatter && report.frontmatter.start_line;
    if (Number.isInteger(start) && start > 0) return start;
  } catch (_) {}
  return 1;
}

function propertyEditorEntryLeafAlive(plugin, leaf) {
  if (!leaf) return false;
  try {
    const live = plugin && plugin.app && plugin.app.workspace
      && typeof plugin.app.workspace.getLeavesOfType === "function"
      ? plugin.app.workspace.getLeavesOfType("markdown")
      : null;
    if (Array.isArray(live)) return live.includes(leaf);
  } catch (_) {}
  return true;
}

function propertyEditorEntryLeafShows(leaf, target) {
  try {
    return propertyEditorEntryNormalizePath(leaf && leaf.view && leaf.view.file && leaf.view.file.path) === target;
  } catch (_) {
    return false;
  }
}

// The YAML excursion targets the originating leaf first: the leaf the
// editor was opened from (recorded at open), then the active leaf, then
// any leaf showing the note.
function propertyEditorEntryLeafFor(plugin, path, preferred = null) {
  const target = propertyEditorEntryNormalizePath(path);
  const origin = preferred || (plugin && plugin.propertyEditorOriginLeaf) || null;
  if (origin && propertyEditorEntryLeafAlive(plugin, origin) && propertyEditorEntryLeafShows(origin, target)) {
    return origin;
  }
  try {
    const active = plugin && plugin.app && plugin.app.workspace && plugin.app.workspace.activeLeaf;
    if (active && propertyEditorEntryLeafShows(active, target)) return active;
  } catch (_) {}
  try {
    const leaves = plugin && plugin.app && plugin.app.workspace
      && typeof plugin.app.workspace.getLeavesOfType === "function"
      ? plugin.app.workspace.getLeavesOfType("markdown") || []
      : [];
    const match = leaves.find((leaf) => propertyEditorEntryNormalizePath(
      leaf && leaf.view && leaf.view.file && leaf.view.file.path,
    ) === target);
    if (match) return match;
  } catch (_) {}
  try {
    const recent = plugin && plugin.app && plugin.app.workspace
      && typeof plugin.app.workspace.getMostRecentLeaf === "function"
      ? plugin.app.workspace.getMostRecentLeaf()
      : null;
    if (recent) return recent;
  } catch (_) {}
  try {
    return (plugin && plugin.app && plugin.app.workspace && plugin.app.workspace.activeLeaf) || null;
  } catch (_) {
    return null;
  }
}

// Bare + opens the generic Property Editor. Card-specific settings are
// reached through their own row and handoff.
function propertyEditorEntryBarePlusOptions(plugin, path) {
  const target = propertyEditorEntryNormalizePath(path);
  if (!target) return {};
  return { filePath: target };
}

function propertyEditorEntryReadSource(plugin, path) {
  const key = propertyEditorEntryNormalizePath(path);
  if (!key) return Promise.resolve(null);
  return Promise.resolve().then(async () => {
    try {
      const file = plugin && plugin.app && plugin.app.vault
        && typeof plugin.app.vault.getAbstractFileByPath === "function"
        ? plugin.app.vault.getAbstractFileByPath(key)
        : null;
      if (file && plugin.app.vault && typeof plugin.app.vault.read === "function") {
        return await plugin.app.vault.read(file);
      }
    } catch (_) {}
    try {
      const adapter = plugin && plugin.app && plugin.app.vault && plugin.app.vault.adapter;
      if (adapter && typeof adapter.read === "function") return await adapter.read(key);
    } catch (_) {}
    return null;
  });
}

class BobLedgerToolsPropertyEditorEntrypointsMixin {
  setupPropertyEditorEntrypoints() {
    if (this.propertyEditorEntrypointsActive === true) return;
    this.propertyEditorEntrypointsActive = true;
    this.propertyEditorModal = null;
    try {
      // The manifest validator requires a string literal here; the
      // PROPERTY_EDITOR_ENTRY_* constants stay the testable source of truth.
      this.addCommand({
        id: "edit-note-properties",
        name: "Edit note properties",
        callback: () => { void this.openPropertyEditor({}); },
      });
    } catch (_) {}
    // The `+` arm accepts Shift (event.key is "+") and unshifted "+". It
    // runs on a bare Live Preview Vim normal-mode key through the
    // content-target gate. Counts, registers, a non-empty key buffer, and a
    // pending operator (including `=`) keep Vim's `+` motion. The
    // dispatcher does not inject <Esc>.
    try {
      if (typeof this.registerPropertyCardSecondKeyArm === "function") {
        this.registerPropertyCardSecondKeyArm({
          key: "+",
          reason: "property-editor",
          canAct: (context = {}) => propertyEditorEntryIsMarkdownPath(context && context.path),
          run: (context = {}) => {
            const options = context && context.path
              ? propertyEditorEntryBarePlusOptions(this, context.path)
              : {};
            void this.openPropertyEditor(options);
          },
        });
      }
    } catch (_) {}
    try {
      if (typeof propertyCardFootSetEditorHook === "function") {
        propertyCardFootSetEditorHook((path, options = {}) => {
          void this.openPropertyEditor({
            filePath: path,
            key: typeof options.key === "string" ? options.key : "",
            mode: options.mode === "add" ? "add" : "browse",
          });
        });
      }
    } catch (_) {}
    try { this.propertyEditorRefreshDrawers(); } catch (_) {}
  }

  teardownPropertyEditorEntrypoints() {
    this.propertyEditorEntrypointsActive = false;
    try { this.propertyEditorModal?.close?.(); } catch (_) {}
    this.propertyEditorModal = null;
    try {
      if (typeof this.unregisterPropertyCardSecondKeyArm === "function") {
        this.unregisterPropertyCardSecondKeyArm("+");
      }
    } catch (_) {}
    try {
      if (typeof propertyCardFootSetEditorHook === "function") {
        propertyCardFootSetEditorHook(null);
      }
    } catch (_) {}
    try { this.propertyEditorRefreshDrawers(); } catch (_) {}
  }

  propertyEditorEntryActivePath(overridePath = "") {
    if (overridePath) return propertyEditorEntryNormalizePath(overridePath);
    const resolved = propertyEditorEntryResolvePath(this, {});
    return resolved.ok === true ? resolved.path : "";
  }

  propertyEditorModalClosed(modal) {
    if (modal && this.propertyEditorModal === modal) this.propertyEditorModal = null;
  }

  // Public plugin API for sibling plugins and the later takeover. Resolves
  // only existing Markdown files; an omitted path means the active note.
  async openPropertyEditor(options = {}) {
    if (this.propertyEditorEntrypointsActive === false) {
      try { new Notice("The property editor has unloaded."); } catch (_) {}
      return { ok: false, reason: "unloaded" };
    }
    const resolved = propertyEditorEntryResolvePath(this, options);
    if (resolved.ok !== true) {
      try { new Notice("Open a Markdown note to edit its properties."); } catch (_) {}
      return { ok: false, reason: resolved.reason || "missing-path" };
    }
    const filePath = resolved.path;
    if (!propertyEditorEntryIsMarkdownPath(filePath)) {
      try { new Notice("The property editor only opens Markdown notes."); } catch (_) {}
      return { ok: false, reason: "non-markdown" };
    }
    let exists = false;
    try {
      exists = Boolean(this.app && this.app.vault
        && typeof this.app.vault.getAbstractFileByPath === "function"
        && this.app.vault.getAbstractFileByPath(filePath));
    } catch (_) {
      exists = false;
    }
    if (!exists) {
      try { new Notice("That note is missing — open an existing Markdown note."); } catch (_) {}
      return { ok: false, reason: "missing-note" };
    }
    const live = this.propertyEditorModal && this.propertyEditorModal.closed !== true
      ? this.propertyEditorModal
      : null;
    if (live && live.pendingApply === true) {
      try { new Notice("Wait for the property save to finish."); } catch (_) {}
      return { ok: false, reason: "busy" };
    }
    try { live?.close?.(); } catch (_) {}
    this.propertyEditorModal = null;
    let cacheRows = [];
    try {
      const frontmatter = typeof this.propertyCacheFrontmatter === "function"
        ? this.propertyCacheFrontmatter(filePath)
        : null;
      cacheRows = typeof propertyEditorCacheRows === "function"
        ? propertyEditorCacheRows(frontmatter)
        : [];
    } catch (_) {
      cacheRows = [];
    }
    const key = typeof options.key === "string" ? options.key : "";
    const selection = options.selection && typeof options.selection === "object" ? options.selection : null;
    const mode = options.mode === "add" || options.mode === "edit" ? options.mode : "browse";
    // A raw key that names a setting (theme, offclock, offclock_types, or a
    // setting id) becomes a setting-focus request in browse mode, so drawer
    // and foot callers land on the settings row instead of a stale source
    // id. An explicit setting option always wins; add/edit keep the key.
    let setting = typeof options.setting === "string" ? options.setting : "";
    if (!setting && mode === "browse" && !(selection && typeof selection.key === "string" && selection.key)
      && key && typeof propertyEditorSettingIdForKey === "function") {
      try {
        setting = propertyEditorSettingIdForKey(key) || "";
      } catch (_) {
        setting = "";
      }
    }
    const focusSettings = options.focusSettings === true;
    let modal = null;
    try {
      modal = openPropertyEditor(this.app, {
        plugin: this,
        filePath,
        key: (selection && typeof selection.key === "string" && selection.key) || key,
        selection,
        mode,
        cacheRows,
        setting,
        focusSettings,
        noteKind: typeof options.noteKind === "string" ? options.noteKind : undefined,
        onCardHandoff: (info = {}) => this.propertyEditorHandoff({ ...info, modal: info.modal || null }),
        onYamlEscape: (info = {}) => this.propertyEditorYamlEscape({ ...info, modal: info.modal || null }),
      });
    } catch (error) {
      try { new Notice("Could not open the property editor."); } catch (_) {}
      return { ok: false, reason: "open-failed", message: String((error && error.message) || error) };
    }
    if (!modal) return { ok: false, reason: "open-failed" };
    this.propertyEditorModal = modal;
    // Record the originating leaf so the YAML excursion can target it.
    try {
      this.propertyEditorOriginLeaf = (this.app && this.app.workspace && this.app.workspace.activeLeaf) || null;
    } catch (_) {
      this.propertyEditorOriginLeaf = null;
    }
    const owned = modal;
    const originalClose = typeof modal.close === "function" ? modal.close.bind(modal) : null;
    if (originalClose) {
      modal.close = (...args) => {
        try { this.propertyEditorModalClosed(owned); } catch (_) {}
        return originalClose(...args);
      };
    }
    // Mode "add" needs no eager start here: the modal's own
    // propertyEditorMaybeStartModeAdd begins the positioned add flow once
    // the validated current report arrives.
    return { ok: true, modal, readOnly: false };
  }

  // Card-row Enter and browse `=` land here. Species rows open their owning
  // card; ordinary notes keep the property modal open with an explanation.
  // Protected rows never reach this path: role gates keep them locked with
  // a YAML escape instead.
  async propertyEditorHandoff(input = {}) {
    const modal = input.modal || this.propertyEditorModal;
    const key = typeof input.key === "string" ? input.key : "";
    const species = propertyEditorHandoffSpecies(input);
    if (!species) {
      try {
        if (modal && modal.closed !== true) {
          modal.refusal = {
            code: "no-route",
            message: key
              ? `“${key}” has no card editor on this note.`
              : "This note has no card editor.",
            hint: "y opens YAML.",
          };
          modal.status = { kind: "refusal", text: modal.refusal.message };
          modal.paintPropertyEditor?.();
        }
      } catch (_) {}
      return { ok: false, reason: "no-route" };
    }
    const filePath = (modal && modal.filePath)
      || this.propertyEditorEntryActivePath(input.filePath || input.path || "");
    try { modal?.close?.(); } catch (_) {}
    if (modal) this.propertyEditorModalClosed(modal);
    try {
      if (species === "record" && typeof this.openRecordCard === "function") {
        return await this.openRecordCard({ filePath, field: key });
      }
      if (species === "intentions" && typeof this.openIntentionCard === "function") {
        return await this.openIntentionCard({ filePath, field: key });
      }
      if (species === "album" && typeof this.openAlbumSchemaEntry === "function") {
        return await this.openAlbumSchemaEntry({ filePath, field: key });
      }
      if (species === "bank" && typeof this.openBankSetupCard === "function") {
        return await this.openBankSetupCard({});
      }
    } catch (error) {
      return { ok: false, reason: "handoff-failed", message: String((error && error.message) || error) };
    }
    return { ok: false, reason: "handoff-unavailable" };
  }

  async propertyEditorYamlEscape(input = {}) {
    const modal = input.modal || this.propertyEditorModal;
    // An explicit path wins: the modal closes before the Source view
    // opens, so a closed modal can no longer supply its own filePath.
    const explicit = typeof input.filePath === "string" && input.filePath
      ? input.filePath
      : (typeof input.path === "string" && input.path ? input.path : "");
    const filePath = explicit
      ? propertyEditorEntryNormalizePath(explicit)
      : (modal && modal.filePath)
        || this.propertyEditorEntryActivePath(input.filePath || input.path || "");
    let selection = typeof propertyEditorNormalizeSelection === "function"
      ? propertyEditorNormalizeSelection(input.selection)
      : (input.selection && typeof input.selection === "object" ? input.selection : null);
    if (!selection && modal && typeof propertyEditorWantedSelection === "function") {
      try { selection = propertyEditorWantedSelection(modal); } catch (_) { selection = null; }
    }
    const key = typeof input.key === "string"
      ? input.key
      : (selection && typeof selection.key === "string" && selection.key)
        || (modal && modal.editorSelected && modal.editorSelected()?.row?.key)
        || "";
    return this.propertyEditorStartYamlExcursion({
      filePath, key, line: input.line, modal, selection, ordinal: input.ordinal,
    });
  }

  // y / Ctrl+E switches to Source at the reported key or the parse-error
  // line and installs the floating Done button. Damaged YAML opens the same
  // excursion; Done restores the leaf mode and reopens in recovery mode.
  async propertyEditorStartYamlExcursion(input = {}) {
    const filePath = propertyEditorEntryNormalizePath(input.filePath || input.path || "");
    if (!filePath || !propertyEditorEntryIsMarkdownPath(filePath)) {
      return { ok: false, reason: "missing-path" };
    }
    const key = typeof input.key === "string" ? input.key : "";
    const explicitLine = Number.isInteger(input.line) && input.line > 0 ? input.line : 0;
    let selection = typeof propertyEditorNormalizeSelection === "function"
      ? propertyEditorNormalizeSelection(input.selection)
      : (input.selection && typeof input.selection === "object" ? input.selection : null);
    if (!selection && input.modal && typeof propertyEditorWantedSelection === "function") {
      try { selection = propertyEditorWantedSelection(input.modal); } catch (_) { selection = null; }
    }
    if (!selection) {
      selection = {
        key,
        ordinal: Number.isInteger(input.ordinal) && input.ordinal >= 0 ? input.ordinal : 0,
        line: explicitLine || null,
      };
    } else if (!selection.key && key) {
      selection = { ...selection, key };
    }
    const leaf = propertyEditorEntryLeafFor(this, filePath);
    if (!leaf) {
      try {
        if (this.app && this.app.workspace && typeof this.app.workspace.openLinkText === "function") {
          await this.app.workspace.openLinkText(filePath.replace(/\.md$/i, ""), filePath, false);
        }
      } catch (_) {}
      return { ok: false, reason: "missing-leaf" };
    }
    let viewState = null;
    try { viewState = typeof leaf.getViewState === "function" ? leaf.getViewState() : null; } catch (_) {}
    let source = null;
    try { source = await propertyEditorEntryReadSource(this, filePath); } catch (_) { source = null; }
    let report = null;
    try {
      if (typeof this.apiPropertyShow === "function") {
        const outcome = await this.apiPropertyShow(filePath);
        if (outcome && outcome.ok === true && outcome.report) report = outcome.report;
      }
    } catch (_) {
      report = null;
    }
    let line = explicitLine;
    // Recovery follows Bob's parse diagnostic even when the cached selection
    // names an otherwise valid key. An explicitly selected duplicate wins.
    if (!line && report && typeof propertyEditorRecoveryDetails === "function") {
      line = propertyEditorRecoveryDetails(report)?.line || 0;
    }
    if (!line && (key || (selection && Number.isInteger(selection.line)))) {
      try {
        if (report && Array.isArray(report.properties) && typeof propertyEditorYamlReopenSelection === "function") {
          const resolved = propertyEditorYamlReopenSelection(report.properties, selection || { key, ordinal: 0, line: null });
          if (resolved && Number.isInteger(resolved.line) && resolved.line > 0) line = resolved.line;
          if (resolved) selection = resolved;
        } else if (report && Array.isArray(report.properties)) {
          const row = report.properties.find((entry) => entry && entry.key === key
            && Number.isInteger(entry.line) && entry.line > 0);
          if (row) line = row.line;
        }
      } catch (_) {}
      if (!line && typeof source === "string" && typeof recordSheetYamlKeyLine === "function") {
        try { line = recordSheetYamlKeyLine(source, key); } catch (_) {}
      }
    }
    if (!line && report) line = propertyEditorYamlIssueLine(report);
    if (!line) line = 1;
    let record = null;
    try {
      if (typeof this.albumYamlExcursionBegin === "function") {
        record = this.albumYamlExcursionBegin(leaf, {
          kind: "props",
          notePath: filePath,
          viewState,
          selectedKey: (selection && selection.key) || key,
          selection,
          reopenCard: true,
        });
      }
    } catch (_) {
      record = null;
    }
    const jumped = await this.propertyEditorYamlJump(filePath, line);
    if (!record) return { ok: Boolean(jumped && jumped.ok), reason: jumped && jumped.ok ? undefined : "excursion-rejected", line };
    return { ok: Boolean(jumped && jumped.ok), line };
  }

  async propertyEditorYamlJump(path, line) {
    const target = Number.isInteger(line) && line > 0 ? line : 1;
    try {
      const file = (this.app && this.app.vault
        && typeof this.app.vault.getAbstractFileByPath === "function"
        && this.app.vault.getAbstractFileByPath(path)) || { path };
      const leaf = propertyEditorEntryLeafFor(this, path);
      if (leaf && typeof leaf.openFile === "function") {
        await leaf.openFile(file, { state: { mode: "source", source: true } });
      } else if (leaf && typeof leaf.setViewState === "function") {
        const current = typeof leaf.getViewState === "function"
          ? leaf.getViewState()
          : { type: "markdown", state: {} };
        await leaf.setViewState({
          ...(current || {}),
          type: "markdown",
          state: { ...((current && current.state) || {}), mode: "source", source: true, file: path },
        });
      } else if (this.app && this.app.workspace && typeof this.app.workspace.openLinkText === "function") {
        await this.app.workspace.openLinkText(path.replace(/\.md$/i, ""), path, false);
      } else {
        return { ok: false, reason: "missing-leaf" };
      }
      const editor = leaf && leaf.view && leaf.view.editor;
      const cursorLine = target - 1;
      try {
        if (editor && typeof editor.setCursor === "function") {
          editor.setCursor({ line: cursorLine, ch: 0 });
          if (typeof editor.scrollIntoView === "function") {
            editor.scrollIntoView({ from: { line: cursorLine, ch: 0 }, to: { line: cursorLine, ch: 0 } }, true);
          }
          if (typeof editor.focus === "function") editor.focus();
        }
      } catch (_) {}
      try {
        if (this.app && this.app.workspace && typeof this.app.workspace.setActiveLeaf === "function") {
          this.app.workspace.setActiveLeaf(leaf, { focus: true });
        }
      } catch (_) {}
      return { ok: true, line: target };
    } catch (_) {
      return { ok: false, reason: "source-jump-failed" };
    }
  }

  // Done saves every pane showing the note, restores the leaf's original
  // mode, rereads props, and reopens on the same surviving key (nearest row
  // otherwise). The excursion itself never writes vault bytes.
  async propertyEditorYamlDoneAttempt(leaf, record) {
    const ownPath = record && record.notePath
      ? propertyEditorEntryNormalizePath(record.notePath)
      : "";
    if (typeof this.albumYamlExcursionStillCurrent !== "function"
      || !this.albumYamlExcursionStillCurrent(leaf, record)) {
      return { ok: false, reason: "stale-excursion" };
    }
    let save = { ok: true };
    try {
      save = await this.albumYamlSaveExcursionEditors([ownPath]);
    } catch (error) {
      save = { ok: false, code: "save-failed", message: String((error && error.message) || error) };
    }
    if (!this.albumYamlExcursionStillCurrent(leaf, record)) return { ok: false, reason: "stale-excursion" };
    if (!save || save.ok !== true) {
      try { new Notice(save?.message || "Saving the note pane failed — fix it before Done."); } catch (_) {}
      return { ok: false, reason: (save && save.code) || "save-failed" };
    }
    let restoreError = null;
    try {
      record.restoring = true;
      if (record.viewState && typeof leaf.setViewState === "function") {
        await leaf.setViewState(record.viewState);
      } else if (record.viewState && record.viewState.state && typeof leaf.openFile === "function") {
        const file = (this.app && this.app.vault
          && typeof this.app.vault.getAbstractFileByPath === "function"
          && this.app.vault.getAbstractFileByPath(ownPath)) || { path: ownPath };
        await leaf.openFile(file, { state: { ...(record.viewState.state || {}), file: ownPath } });
      }
    } catch (error) {
      restoreError = error;
    }
    record.restoring = false;
    if (typeof this.albumYamlExcursionForLeaf === "function"
      && this.albumYamlExcursionForLeaf(leaf) !== record && !restoreError) {
      return { ok: false, reason: "stale-excursion" };
    }
    if (restoreError) {
      return { ok: false, reason: "restore-failed", message: String(restoreError.message || restoreError) };
    }
    try {
      if (typeof this.albumYamlExcursionClear === "function") this.albumYamlExcursionClear(leaf);
    } catch (_) {}
    if (record.reopenCard === false) return { ok: true, reopened: false };
    const wanted = typeof propertyEditorNormalizeSelection === "function"
      ? (propertyEditorNormalizeSelection(record.selection)
        || propertyEditorNormalizeSelection({
          key: typeof record.selectedKey === "string" ? record.selectedKey : "",
          ordinal: 0,
          line: null,
        }))
      : (record.selection && typeof record.selection === "object"
        ? record.selection
        : { key: typeof record.selectedKey === "string" ? record.selectedKey : "", ordinal: 0, line: null });
    let selection = wanted;
    let key = wanted && typeof wanted.key === "string" ? wanted.key : "";
    try {
      if (typeof this.apiPropertyShow === "function") {
        const outcome = await this.apiPropertyShow(ownPath);
        const rows = outcome && outcome.ok === true && outcome.report && Array.isArray(outcome.report.properties)
          ? outcome.report.properties
          : null;
        if (rows) {
          if (typeof propertyEditorYamlReopenSelection === "function") {
            selection = propertyEditorYamlReopenSelection(rows, wanted) || wanted;
            key = selection && typeof selection.key === "string" ? selection.key : "";
          } else if (typeof propertyEditorNearestId === "function") {
            const nearest = propertyEditorNearestId(rows, wanted || { key, ordinal: 0, line: null });
            const match = rows.find((row, index) => {
              try {
                return typeof propertyEditorRowId === "function"
                  && propertyEditorRowId(row, index) === nearest;
              } catch (_) {
                return false;
              }
            });
            key = match && typeof match.key === "string" ? match.key : "";
            selection = match
              ? { key, ordinal: 0, line: Number.isInteger(match.line) ? match.line : null }
              : wanted;
          } else {
            key = rows.length && typeof rows[0].key === "string" ? rows[0].key : "";
            selection = key ? { key, ordinal: 0, line: Number.isInteger(rows[0].line) ? rows[0].line : null } : wanted;
          }
        }
      }
    } catch (_) {}
    const opened = await this.openPropertyEditor({
      filePath: ownPath,
      key,
      ...(selection ? { selection } : {}),
    });
    return { ok: true, reopened: Boolean(opened && opened.ok) };
  }

  // Already-open drawers build their opener handlers per paint, so they
  // pick up hook registration on the next repaint. Nudge every known foot
  // host to repaint after register and unregister.
  propertyEditorRefreshDrawers() {
    const schedulers = [
      "scheduleAlbumHeaderRefresh",
      "scheduleRecordSheetRefresh",
      "scheduleBankSetupRefresh",
    ];
    for (const name of schedulers) {
      try {
        if (typeof this[name] === "function") this[name]();
      } catch (_) {}
    }
    try {
      const host = typeof this.intentionCardHost === "function" ? this.intentionCardHost() : null;
      if (host && typeof host.scheduleRefresh === "function") host.scheduleRefresh();
    } catch (_) {}
  }
}
