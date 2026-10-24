// Relation-label stage controls mirrored from the Bob Mac Capture card.
class BulletPropertyPickerRelationLabelVocabularyMixin extends FilteredPickerModal {
  relationLabelsApi() {
    try {
      const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
      const holder = plugins && plugins["bob-ledger-tools"];
      const api = holder && holder.api && holder.api.relationLabels;
      return api && Number(api.version) >= 1 ? api : null;
    } catch (_error) {
      return null;
    }
  }

  subscribeRelationLabelChanges() {
    this.clearRelationLabelSubscriptions();
    this.relationLabelSubscriptions = [];
    const refresh = () => {
      if (this.stage === "relation-label" && typeof this.renderResults === "function") {
        this.renderResults();
      }
    };
    try {
      const plugins = (this.app && this.app.plugins && this.app.plugins.plugins) || {};
      const holder = plugins["bob-ledger-tools"];
      const api = holder && holder.api;
      for (const source of [api && api.relationLabels, api && api.relationIndex]) {
        if (!source || typeof source.onChange !== "function") continue;
        const unsubscribe = source.onChange(refresh);
        if (typeof unsubscribe === "function") this.relationLabelSubscriptions.push(unsubscribe);
      }
    } catch (_error) {
      // The stage remains usable if an older provider cannot subscribe.
    }
  }

  clearRelationLabelSubscriptions() {
    const subscriptions = Array.isArray(this.relationLabelSubscriptions)
      ? this.relationLabelSubscriptions
      : [];
    this.relationLabelSubscriptions = [];
    for (const unsubscribe of subscriptions) {
      try {
        unsubscribe();
      } catch (_error) {
        // Unsubscribing is best-effort during stage teardown.
      }
    }
  }

  readRelationLabelSuggestions(prefix, options = {}) {
    try {
      const plugins = (this.app && this.app.plugins && this.app.plugins.plugins) || {};
      const holder = plugins["bob-ledger-tools"];
      const api = holder && holder.api;
      const labels = api && api.relationLabels;
      if (labels && Number(labels.version) >= 1 && typeof labels.rows === "function") {
        const rows = labels.rows(prefix || "", options || { hidden: "exclude" });
        if (rows && typeof rows.then === "function") return [];
        if (!Array.isArray(rows)) return [];
        return rows
          .filter((row) => row && row.name)
          .map((row) => ({
            key: String(row.key || normalizeRelationLabel(row.name).toLowerCase()),
            label: String(row.name),
            count: Math.max(0, Math.floor(numericOrDefault(row.count, 0))),
            hidden: row.hidden === true,
            inverse: typeof row.inverse === "string" ? row.inverse : null,
          }));
      }
      const index = api && api.relationIndex;
      if (!index || Number(index.version) < 1 || typeof index.labelSuggestions !== "function") return [];
      const rows = index.labelSuggestions(prefix || "");
      if (rows && typeof rows.then === "function" || !Array.isArray(rows)) return [];
      return rows
        .filter((row) => row && row.label)
        .map((row) => ({
          key: normalizeRelationLabel(row.label).toLowerCase(),
          label: String(row.label),
          count: Math.max(0, Math.floor(numericOrDefault(row.count, 0))),
          hidden: false,
          inverse: null,
        }))
        .slice(0, 12);
    } catch (_error) {
      return [];
    }
  }

  readRelationLabelHiddenCount() {
    try {
      const api = this.relationLabelsApi();
      return api && typeof api.hiddenCount === "function"
        ? Math.max(0, Math.floor(numericOrDefault(api.hiddenCount(), 0)))
        : 0;
    } catch (_error) {
      return 0;
    }
  }

  refreshRelationLabelHeader() {
    if (this.stage !== "relation-label") return;
    const count = this.readRelationLabelHiddenCount();
    this.title = `${this.relationLabelTitleBase || "🪢 Relation"}${count > 0 ? ` · ◌ ${count} hidden ⌃H` : ""}`;
    if (this.titleEl) this.titleEl.textContent = this.title;
  }

  getRelationLabelFooterHints() {
    const raw = this.getRawQuery ? String(this.getRawQuery() || "") : "";
    const item = (this.visibleItems || [])[this.selectedIndex] || null;
    const noSelection = !item || item.typed === true || item.plain === true || this.selectedIndex === 0;
    let tabLabel = "accept top match";
    if (!noSelection) tabLabel = "accept selected";
    else if (this.relationLabelTabNoMatch === true) tabLabel = "no match";
    const hideLabel = noSelection
      ? raw.trim()
        ? this.relationLabelOneOff === true ? "keep visible" : "one-off"
        : "type a label first"
      : item.hidden === true ? "unhide" : "hide";
    return [
      { keys: ["⇥"], label: tabLabel },
      { keys: ["⌃D"], label: hideLabel },
      { keys: ["⌃H"], label: this.relationLabelShowHidden === true ? "hide list" : `Hidden ${this.readRelationLabelHiddenCount()}` },
      { keys: ["⌃R"], label: "rename selected" },
      { keys: ["↵"], label: this.relationLabelMode === "relabel" ? "relabel" : "link" },
      { keys: ["esc"], label: "back to list" },
    ];
  }

  moveRelationLabelSelection(delta) {
    const items = Array.isArray(this.visibleItems) ? this.visibleItems : [];
    if (items.length === 0) return;
    let index = this.selectedIndex;
    for (let step = 0; step < items.length; step += 1) {
      index = (index + delta + items.length) % items.length;
      if (items[index] && items[index].nonSelectable !== true) {
        this.selectedIndex = index;
        this.relationLabelTabNoMatch = false;
        this.renderResults();
        return;
      }
    }
  }

  relationLabelSelectKey(key) {
    const items = this.getRelationLabelPreviewItems();
    const index = items.findIndex((row) => row && row.key === key && row.typed !== true);
    this.selectedIndex = index >= 0 ? index : 0;
  }

  async toggleRelationLabelVisibility(item) {
    if (!item || item.kind !== "relation-label" || !item.key || item.typed === true) return false;
    const key = String(item.key);
    if (this.relationLabelWrites.has(key)) return false;
    const previous = this.relationLabelGhosts.get(key);
    const hidden = item.hidden !== true;
    const label = String(item.label || "");
    this.relationLabelGhosts.set(key, { hidden });
    this.relationLabelSelectKey(key);
    this.renderResults();
    this.relationLabelWrites.add(key);
    let result;
    try {
      const api = this.relationLabelsApi();
      const write = hidden ? api && api.hide : api && api.unhide;
      result = typeof write === "function"
        ? await write(label)
        : { ok: false, message: "Bob Ledger Tools api.relationLabels is required." };
    } catch (_error) {
      result = { ok: false, message: "Could not update relation-label suggestions." };
    } finally {
      this.relationLabelWrites.delete(key);
    }
    if (!result || result.ok !== true) {
      if (previous) this.relationLabelGhosts.set(key, previous);
      else this.relationLabelGhosts.delete(key);
      this.relationLabelSelectKey(key);
      this.renderResults();
      new Notice((result && result.message) || "Could not update relation-label suggestions.");
      return false;
    }
    this.relationLabelSelectKey(key);
    this.renderResults();
    return true;
  }

  handleRelationLabelKeydown(event) {
    if (
      !event || typeof event.key !== "string" || event.isComposing === true || event.keyCode === 229 ||
      this.stage !== "relation-label"
    ) return false;
    const noMetaAlt = event.metaKey !== true && event.altKey !== true;
    if (event.key === "Tab" && noMetaAlt && event.ctrlKey !== true) {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey === true) return true;
      if (this.opening) return true;
      const selected = (this.visibleItems || [])[this.selectedIndex];
      let index = this.selectedIndex;
      if (!selected || selected.typed === true || selected.plain === true || this.selectedIndex === 0) {
        const top = selected && selected.key === this.relationLabelTopMatchKey && selected.hidden !== true
          ? 0
          : (this.visibleItems || []).findIndex((row, rowIndex) =>
            rowIndex > 0 && row && row.kind === "relation-label" && row.hidden !== true && row.ghost !== true,
          );
        if (top < 0) {
          this.relationLabelTabNoMatch = true;
          this.renderResults();
          return true;
        }
        index = top;
      }
      this.relationLabelTabNoMatch = false;
      void this.openItemAtIndex(index);
      return true;
    }
    if (event.key.toLowerCase() === "r" && event.ctrlKey === true && noMetaAlt && event.shiftKey !== true) {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat !== true) {
        const item = (this.visibleItems || [])[this.selectedIndex] || null;
        this.openRelationLabelRenameForStage(item);
      }
      return true;
    }
    if (
      event.key === "ArrowDown" ||
      (event.key.toLowerCase() === "n" && event.ctrlKey === true && noMetaAlt && event.shiftKey !== true)
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.moveRelationLabelSelection(1);
      return true;
    }
    if (
      event.key === "ArrowUp" ||
      (event.key.toLowerCase() === "p" && event.ctrlKey === true && noMetaAlt && event.shiftKey !== true)
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.moveRelationLabelSelection(-1);
      return true;
    }
    if (event.key === "|" && noMetaAlt && event.ctrlKey !== true) {
      event.preventDefault();
      event.stopPropagation();
      if (String(this.getRawQuery ? this.getRawQuery() : "").trim()) {
        this.relationLabelOneOff = true;
        this.relationLabelTabNoMatch = false;
        this.renderResults();
      }
      return true;
    }
    if (event.key.toLowerCase() === "d" && event.ctrlKey === true && noMetaAlt && event.shiftKey !== true) {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat === true) return true;
      const item = (this.visibleItems || [])[this.selectedIndex] || null;
      if (this.selectedIndex === 0 || !item || item.typed === true || item.plain === true) {
        if (String(this.getRawQuery ? this.getRawQuery() : "").trim()) {
          this.relationLabelOneOff = !this.relationLabelOneOff;
          this.renderResults();
        }
        return true;
      }
      if (!item.nonSelectable) void this.toggleRelationLabelVisibility(item);
      return true;
    }
    if (event.key.toLowerCase() === "h" && event.ctrlKey === true && noMetaAlt && event.shiftKey !== true) {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat !== true) {
        this.relationLabelShowHidden = this.relationLabelShowHidden !== true;
        this.selectedIndex = 0;
        this.relationLabelTabNoMatch = false;
        this.renderResults();
      }
      return true;
    }
    return false;
  }
}
