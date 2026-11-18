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
    const state = this.recordSheetNativePropertiesScopes?.get(scope);
    if (!state) return;
    state.observer?.disconnect();
    for (const row of state.rows) row.classList?.remove(RECORD_SHEET_PROPERTY_CLASS);
    this.recordSheetNativePropertiesScopes.delete(scope);
  }

  recordSheetSetNativeProperties(scope, model) {
    if (!scope) return;
    if (model?.hideEligible !== true || recordSheetScopeIsEmbed(scope)) {
      this.recordSheetClearNativeProperties(scope);
      return;
    }
    if (!this.recordSheetNativePropertiesScopes) this.recordSheetNativePropertiesScopes = new Map();
    let state = this.recordSheetNativePropertiesScopes.get(scope);
    if (!state) {
      state = { rows: new Set(), keys: new Set(), observer: null };
      this.recordSheetNativePropertiesScopes.set(scope, state);
      // Obsidian can replace Properties after the sheet paints (notably on tab
      // return). Observe DOM replacement and key edits, never our class changes.
      const Observer = scope.ownerDocument?.defaultView?.MutationObserver;
      if (Observer) {
        state.observer = new Observer(() => this.recordSheetPaintNativeProperties(scope, state));
        state.observer.observe(scope, {
          childList: true, subtree: true, attributes: true, attributeFilter: ["data-property-key"],
        });
      }
    }
    state.keys = new Set([...model.rows, ...model.ghosts].map((row) => row.key));
    if (model.coverage.title === "sheet") state.keys.add("title");
    this.recordSheetPaintNativeProperties(scope, state);
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
