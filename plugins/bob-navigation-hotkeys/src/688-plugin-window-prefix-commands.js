// Window-prefix palette commands and the persistent focused-split underline.
// Palette verbs route through the same planner/executor/painter as the Ctrl+W
// prefix; a blocked command reports its reason as a Notice instead of a card
// nudge. The underline marks the focused split whenever the main area shows
// two or more splits (spike: `.workspace-tabs.mod-active` exists, so the CSS
// keys off it, gated by a `bob-wp-multi-split` body class this file owns).
const WINDOW_PREFIX_PALETTE_COMMANDS = [
  { id: "window-focus-left", name: "Focus split left", key: "h" },
  { id: "window-focus-right", name: "Focus split right", key: "l" },
  { id: "window-focus-next", name: "Focus next split", key: "w" },
  { id: "window-move-tab-left", name: "Move tab to left split", key: "H" },
  { id: "window-move-tab-right", name: "Move tab to right split", key: "L" },
];

function windowPrefixPaletteNotice(message) {
  try {
    if (typeof Notice === "function") new Notice(String(message));
  } catch (_error) {
    // Notices are best-effort in tests and during unload.
  }
}

class BobNavigationHotkeysWindowPrefixCommandsMixin {
  registerWindowPrefixCommands() {
    WINDOW_PREFIX_PALETTE_COMMANDS.forEach((command) => {
      this.addCommand({
        id: command.id,
        name: command.name,
        callback: () => this.runWindowPrefixPaletteKey(command.key),
      });
    });
    this.addCommand({
      id: "window-keys",
      name: "Show window keys",
      callback: () => this.openWindowPrefixFromPalette(),
    });
    this.setupWindowPrefixUnderline();
  }

  async runWindowPrefixPaletteKey(key) {
    const snapshot = typeof this.snapshotWindowPrefixLayout === "function"
      ? this.snapshotWindowPrefixLayout()
      : null;
    const layout = typeof normalizeWindowPrefixSnapshot === "function"
      ? normalizeWindowPrefixSnapshot(snapshot)
      : null;
    if (!layout) {
      windowPrefixPaletteNotice("Window keys need a main-area tab");
      return false;
    }
    const plan = typeof planWindowPrefixKey === "function"
      ? planWindowPrefixKey(snapshot, key)
      : null;
    if (!plan || plan.ok !== true || plan.available !== true ||
        plan.action === "noop" || plan.action === "unmapped" ||
        plan.action === "unavailable" || plan.action === "cancel") {
      windowPrefixPaletteNotice(windowPrefixBlockedMessage(plan, key));
      return false;
    }
    let result = null;
    try {
      result = await this.executeWindowPrefixPlan(plan, {
        activeLeafId: layout.activeLeafId,
        sourceSplitId: layout.activeSplitId,
      });
    } catch (_error) {
      windowPrefixPaletteNotice("Window action failed · check the layout");
      return false;
    }
    if (!result || result.ok !== true) {
      if (result && result.reason === "layout-changed") {
        windowPrefixPaletteNotice("Layout changed — try again");
        return false;
      }
      windowPrefixPaletteNotice(windowPrefixBlockedMessage((result && result.plan) || plan, key));
      return false;
    }
    if (result.skipped) {
      windowPrefixPaletteNotice(windowPrefixBlockedMessage((result && result.plan) || plan, key));
      return false;
    }
    await this.presentWindowPrefixPaletteSuccess(plan, result);
    return true;
  }

  async presentWindowPrefixPaletteSuccess(plan, result) {
    const after = typeof this.snapshotWindowPrefixLayout === "function"
      ? this.snapshotWindowPrefixLayout()
      : null;
    const host = typeof this.ensureWindowPrefixHintHost === "function"
      ? this.ensureWindowPrefixHintHost()
      : null;
    const model = after && typeof buildWindowPrefixViewModel === "function"
      ? buildWindowPrefixViewModel(after)
      : null;
    const destRect = windowPrefixActiveSplitRect(this, after);
    const areaRect = windowPrefixAreaRect(this, after);
    if (host && typeof host.showArmed === "function") host.showArmed(model, destRect, areaRect);
    const receipt = windowPrefixMoveReceiptText(plan, result, after);
    const linger = receipt ? 1600 : 220;
    if (receipt && host && typeof host.receipt === "function") host.receipt(receipt);
    if (host && typeof host.pulse === "function") host.pulse(destRect);
    if (typeof this.scheduleWindowPrefixTimeout === "function") {
      this.scheduleWindowPrefixTimeout(() => {
        if (typeof this.hideWindowPrefixHint === "function") this.hideWindowPrefixHint();
      }, linger, "linger");
    }
  }

  openWindowPrefixFromPalette() {
    const snapshot = typeof this.snapshotWindowPrefixLayout === "function"
      ? this.snapshotWindowPrefixLayout()
      : null;
    const layout = typeof normalizeWindowPrefixSnapshot === "function"
      ? normalizeWindowPrefixSnapshot(snapshot)
      : null;
    if (!layout) {
      windowPrefixPaletteNotice("Window keys need a main-area tab");
      return false;
    }
    if (typeof this.windowPrefixIsArmed !== "function" || !this.windowPrefixIsArmed()) {
      if (typeof this.armWindowPrefix === "function") this.armWindowPrefix();
    }
    if (typeof this.showWindowPrefixCardNow === "function") this.showWindowPrefixCardNow();
    return true;
  }

  windowPrefixUnderlineDocument() {
    const workspace = this.app && this.app.workspace;
    return (workspace && workspace.containerEl && workspace.containerEl.ownerDocument) ||
      this.windowPrefixDocument ||
      (typeof document !== "undefined" ? document : null);
  }

  setupWindowPrefixUnderline() {
    this.updateWindowPrefixUnderline();
    const workspace = this.app && this.app.workspace;
    if (workspace && typeof workspace.on === "function") {
      const update = () => this.updateWindowPrefixUnderline();
      let layoutRef = null;
      let leafRef = null;
      try { layoutRef = workspace.on("layout-change", update); } catch (_error) { /* best effort */ }
      try { leafRef = workspace.on("active-leaf-change", update); } catch (_error) { /* best effort */ }
      if (typeof this.registerEvent === "function") {
        if (layoutRef) this.registerEvent(layoutRef);
        if (leafRef) this.registerEvent(leafRef);
      } else if (typeof this.register === "function") {
        this.register(() => {
          try { if (typeof workspace.off === "function") workspace.off("layout-change", update); } catch (_error) { /* unload */ }
          try { if (typeof workspace.off === "function") workspace.off("active-leaf-change", update); } catch (_error) { /* unload */ }
        });
      }
    }
    if (typeof this.register === "function") {
      this.register(() => this.clearWindowPrefixUnderline());
    }
  }

  updateWindowPrefixUnderline() {
    const doc = this.windowPrefixUnderlineDocument();
    const body = doc && doc.body;
    if (!body || !body.classList) return;
    let splitCount = 0;
    let activeSplitEl = null;
    try {
      const snapshot = typeof this.snapshotWindowPrefixLayout === "function"
        ? this.snapshotWindowPrefixLayout()
        : null;
      const layout = typeof normalizeWindowPrefixSnapshot === "function"
        ? normalizeWindowPrefixSnapshot(snapshot)
        : null;
      if (layout) {
        splitCount = layout.splits.length;
        const group = this.windowPrefixSplitById && typeof this.windowPrefixSplitById.get === "function"
          ? this.windowPrefixSplitById.get(layout.activeSplitId)
          : null;
        activeSplitEl = (group && group.containerEl) || null;
      }
    } catch (_error) {
      // A half-torn layout never blocks the underline; it just clears it.
    }
    try {
      if (splitCount >= 2) body.classList.add("bob-wp-multi-split");
      else body.classList.remove("bob-wp-multi-split");
    } catch (_error) { /* classList is best-effort in stubs */ }
    // Fallback mark for builds without `.workspace-tabs.mod-active` (the spike
    // confirmed it exists in 1.15.1, so this usually mirrors what Obsidian
    // already paints). The CSS underlines either selector under the body gate.
    try {
      const workspace = this.app && this.app.workspace;
      const root = (workspace && workspace.containerEl) || (doc && doc.querySelector
        ? doc.querySelector(".workspace-split.mod-root")
        : null);
      const tabs = root && typeof root.querySelectorAll === "function"
        ? root.querySelectorAll(".workspace-tabs")
        : [];
      for (const tab of tabs) {
        if (tab && tab.classList && tab !== activeSplitEl) tab.classList.remove("bob-wp-active-split");
      }
      if (splitCount >= 2 && activeSplitEl && activeSplitEl.classList) {
        activeSplitEl.classList.add("bob-wp-active-split");
      }
    } catch (_error) { /* best effort */ }
  }

  clearWindowPrefixUnderline() {
    try {
      const doc = this.windowPrefixUnderlineDocument();
      if (doc && doc.body && doc.body.classList) doc.body.classList.remove("bob-wp-multi-split");
      const workspace = this.app && this.app.workspace;
      const root = workspace && workspace.containerEl;
      const tabs = root && typeof root.querySelectorAll === "function"
        ? root.querySelectorAll(".workspace-tabs")
        : [];
      for (const tab of tabs) {
        if (tab && tab.classList) tab.classList.remove("bob-wp-active-split");
      }
    } catch (_error) {
      // Unload cleanup never throws.
    }
  }
}
