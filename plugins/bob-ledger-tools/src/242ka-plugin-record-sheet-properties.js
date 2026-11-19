// Native Properties remain usable for metadata outside the album schema.
// The ownership paths below were captured in the real Obsidian sheet proof.
const RECORD_SHEET_PROPERTY_CLASS = "bob-record-sheet-owned-property";

function recordSheetNativeProperties(scope) {
  const child = (root, name) => Array.from(root?.children || [])
    .find((node) => node.classList?.contains(name));
  if (scope?.classList?.contains("cm-editor")) {
    return child(child(child(scope, "cm-scroller"), "cm-sizer"), "metadata-container");
  }
  if (scope?.classList?.contains("markdown-preview-view")) {
    return child(child(child(scope, "markdown-preview-sizer"), "mod-header"), "metadata-container");
  }
  return null;
}

class BobLedgerToolsRecordSheetPropertiesMixin {
  recordSheetClearNativeProperties(scope) {
    try {
      if (typeof propertyCardReleaseScope === "function") propertyCardReleaseScope(scope);
    } catch (_) {}
    const state = this.recordSheetNativePropertiesScopes?.get(scope);
    if (!state) return;
    try { state.release?.(); } catch (_) {}
    try { state.observer?.disconnect(); } catch (_) {}
    for (const row of state.rows || []) {
      try { row.classList?.remove(RECORD_SHEET_PROPERTY_CLASS); } catch (_) {}
    }
    this.recordSheetNativePropertiesScopes.delete(scope);
  }

  recordSheetSetNativeProperties(scope, model) {
    if (!scope) return;
    if (!this.recordSheetNativePropertiesScopes) this.recordSheetNativePropertiesScopes = new Map();
    if (model?.hideEligible !== true || recordSheetScopeIsEmbed(scope)) {
      this.recordSheetClearNativeProperties(scope);
      return;
    }
    const keys = new Set([...(model.rows || []), ...(model.ghosts || [])].map((row) => row.key));
    if (model.coverage && model.coverage.title === "sheet") keys.add("title");
    let release = null;
    try {
      if (typeof propertyCardOwnKeys === "function") release = propertyCardOwnKeys(scope, keys);
    } catch (_) {
      release = null;
    }
    if (release == null) {
      this.recordSheetClearNativeProperties(scope);
      return;
    }
    this.recordSheetNativePropertiesScopes.set(scope, { rows: new Set(), keys, observer: null, release });
  }

  recordSheetPaintNativeProperties(scope, state) {
    if (this.recordSheetNativePropertiesScopes?.get(scope) !== state) return;
    const container = recordSheetNativeProperties(scope);
    const next = new Set();
    for (const row of container?.querySelectorAll?.(".metadata-property") || []) {
      if (row.closest?.(".metadata-container") !== container || recordSheetScopeIsEmbed(row)) continue;
      if (!state.keys.has(row.getAttribute("data-property-key"))) continue;
      next.add(row);
      if (!row.classList.contains(RECORD_SHEET_PROPERTY_CLASS)) row.classList.add(RECORD_SHEET_PROPERTY_CLASS);
    }
    for (const row of state.rows) {
      if (!next.has(row)) row.classList?.remove(RECORD_SHEET_PROPERTY_CLASS);
    }
    state.rows = next;
  }
}
