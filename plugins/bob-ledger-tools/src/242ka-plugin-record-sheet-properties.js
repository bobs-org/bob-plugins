// Native Properties remain usable for metadata outside the album schema.
// Shared property-card ownership (240b) paints the owned rows with
// bob-property-card-owned-property; this adapter keeps one generation-bound
// release handle per scope, so it never clears another card's newer owner.
class BobLedgerToolsRecordSheetPropertiesMixin {
  recordSheetClearNativeProperties(scope) {
    const state = this.recordSheetNativePropertiesScopes?.get(scope);
    if (!state) return;
    this.recordSheetNativePropertiesScopes.delete(scope);
    try { state.release?.(); } catch (_) {}
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
    const previous = this.recordSheetNativePropertiesScopes.get(scope);
    if (previous && previous.keys && previous.keys.size === keys.size
      && Array.from(keys).every((key) => previous.keys.has(key))) {
      return;
    }
    this.recordSheetClearNativeProperties(scope);
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
    this.recordSheetNativePropertiesScopes.set(scope, { keys, release });
  }
}
