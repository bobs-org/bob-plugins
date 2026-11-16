// Digit glue for the Ctrl+W prefix: freeze the armed tab catalog, light and
// flash numerals, and settle focus-tab outcomes. 687 calls these helpers so
// it stays under 1000 lines.
class BobNavigationHotkeysWindowTabJumpMixin {
  captureWindowPrefixArmedTabState() {
    this.windowPrefixArmGeneration = (this.windowPrefixArmGeneration || 0) + 1;
    const snapshot = this.windowPrefixArmedSnapshot;
    this.windowPrefixArmedTabCatalog = typeof buildWindowPrefixTabCatalog === "function"
      ? buildWindowPrefixTabCatalog(snapshot)
      : null;
    if (typeof this.refreshWindowTabNumbersNow === "function") {
      try { this.refreshWindowTabNumbersNow({ snapshot }); } catch (_error) { /* never throw */ }
    }
  }

  releaseWindowPrefixArmedTabState() {
    this.windowPrefixArmGeneration = (this.windowPrefixArmGeneration || 0) + 1;
    this.windowPrefixArmedTabCatalog = null;
    this.unlightWindowTabNumbers();
  }

  windowPrefixMappedExecuteOptions(generation) {
    const gen = generation == null ? this.windowPrefixArmGeneration : generation;
    return {
      activeLeafId: this.windowPrefixArmedSnapshot && this.windowPrefixArmedSnapshot.activeLeafId,
      sourceSplitId: this.windowPrefixArmedSnapshot && this.windowPrefixArmedSnapshot.activeSplitId,
      armedCatalog: this.windowPrefixArmedTabCatalog,
      isCurrent: () => this.windowPrefixArmGeneration === gen,
    };
  }

  windowPrefixPaletteExecuteOptions(layout) {
    const workspace = this.app && this.app.workspace;
    const startLeaf = workspace && workspace.activeLeaf;
    return {
      activeLeafId: layout && layout.activeLeafId,
      sourceSplitId: layout && layout.activeSplitId,
      isCurrent: () => {
        try { return workspace && workspace.activeLeaf === startLeaf; } catch (_error) { return false; }
      },
    };
  }

  decorateWindowPrefixTabsModel(model) {
    if (!model || !model.tabs || typeof this.windowTabNumbersHeadersHidden !== "function") return model;
    try {
      if (this.windowTabNumbersHeadersHidden() === true) model.tabs.numbersHidden = true;
    } catch (_error) { /* never throw */ }
    return model;
  }

  lightWindowTabNumbers() {
    if (typeof this.setWindowTabNumbersLit === "function") {
      try { this.setWindowTabNumbersLit(true); } catch (_error) { /* never throw */ }
    }
  }

  unlightWindowTabNumbers() {
    if (typeof this.setWindowTabNumbersLit === "function") {
      try { this.setWindowTabNumbersLit(false); } catch (_error) { /* never throw */ }
    }
  }

  presentWindowPrefixJumpFeedback(plan, result) {
    if (!plan || plan.action !== "focus-tab") return;
    const leafId = (result && result.leafId) || plan.targetLeafId;
    if (leafId != null && typeof this.flashWindowTabNumber === "function") {
      try { this.flashWindowTabNumber(leafId); } catch (_error) { /* never throw */ }
    }
    this.unlightWindowTabNumbers();
  }

  presentWindowPrefixTabsChanged(plan, key) {
    this.presentWindowPrefixBlocked(plan || {
      action: "noop",
      available: false,
      reason: "tabs-changed",
      preview: "Tabs changed — try again",
      key,
    }, key);
    this.disarmWindowPrefix({ keepHint: true });
    this.scheduleWindowPrefixTimeout(() => this.hideWindowPrefixHint(), 900, "linger");
  }

  handleWindowPrefixUnavailablePlan(plan, key) {
    if (plan && (plan.disarm === true || plan.reason === "tabs-changed")) {
      this.presentWindowPrefixTabsChanged(plan, key);
      return true;
    }
    return false;
  }

  handleWindowPrefixMappedFailure(result, key) {
    if (result && result.reason === "superseded") return true;
    const plan = result && result.plan;
    if (result && (result.reason === "tabs-changed" ||
        (plan && (plan.disarm === true || plan.reason === "tabs-changed")))) {
      this.presentWindowPrefixTabsChanged(plan, key);
      return true;
    }
    return false;
  }

  scheduleWindowTabNumbersFromPreventedCtrlW(verdict) {
    if (!verdict || verdict.reason !== "default-prevented") return;
    if (typeof this.scheduleWindowTabNumbersRefresh === "function") {
      try { this.scheduleWindowTabNumbersRefresh(); } catch (_error) { /* never throw */ }
    }
  }
}
