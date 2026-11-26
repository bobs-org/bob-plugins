// Home-card mount ownership (bob-cli-pl.9.1.1 home-ownership). Release
// lifecycle plus shared frontmatter-coordinator acquisition and the
// row-level fallback for the Area/Project cards. Whole-frontmatter
// ownership goes through propertyCardFrontmatterOwnMounted only after the
// connected card and foot mount, with current source/cache evidence, the
// typed settings contract, and working editor/native-command routing; any
// loss releases every owned scope in the same frame (fail open). The
// row-level fallback claims only values the connected card represents.
// Painting never spawns bob and never writes: evidence probes run from the
// capability controller's lifecycle schedule only.
function homeCardFallbackKeys(model) {
  const keys = [];
  const seen = new Set();
  const add = (key) => {
    if (typeof key !== "string" || !key || seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };
  try {
    if (!model || typeof model !== "object") return keys;
    // Policy chips open their own setting in the Property Editor, so the
    // native row for each painted chip key hides while the card owns it.
    for (const chip of Array.isArray(model.chips) ? model.chips : []) {
      add(chip && chip.key);
    }
    // The area summary subtitle and the created foot row show authored
    // values with an editor route; unknown, loose, and invalid-policy keys
    // stay native.
    const subtitle = model.subtitle && typeof model.subtitle === "object" ? model.subtitle : null;
    if (subtitle && subtitle.kind === "summary" && String(subtitle.text || "").trim()) add("summary");
    if (model.created && model.created.present === true) add("created");
  } catch (_) {}
  return keys;
}

class BobLedgerToolsHomeCardOwnershipMixin {
  homeCardBindFrontmatterOwnership() {
    try { propertyCardFrontmatterCoordinatorBind?.(this, "area"); } catch (_) {}
    try { propertyCardFrontmatterCoordinatorBind?.(this, "project"); } catch (_) {}
    return true;
  }

  homeCardReleaseFrontmatterKinds() {
    let released = 0;
    try { released += propertyCardFrontmatterCoordinatorReleaseKind?.(this, "area") || 0; } catch (_) {}
    try { released += propertyCardFrontmatterCoordinatorReleaseKind?.(this, "project") || 0; } catch (_) {}
    return released;
  }

  // Acquire whole-frontmatter ownership for one connected home mount. The
  // coordinator checks the card and foot, current path and mount, desktop
  // Live Preview/Reading, closed valid YAML with matching source/cache
  // values, current props_v1 plus the typed settings contract, and working
  // editor/native-command routing. Returns a generation-bound release
  // handle, or null when any evidence is missing (native stays visible).
  homeCardOwnMountedFrontmatter(scope, view, path, mount, kind, sourceText, currentPath) {
    if (typeof propertyCardFrontmatterOwnMounted !== "function") return null;
    // Once the Area mount is live on bank.md, the independent bank adapter
    // must not retain or reacquire whole-frontmatter ownership, even when
    // this Area mount fails its stricter settings-contract gate.
    if (kind === "area" && homeCardPath(path) === "bank.md") {
      try { propertyCardFrontmatterReleaseMounted?.(scope, { plugin: this, kind: "bank", path: "bank.md" }); } catch (_) {}
    }
    const plugin = this;
    const sourceFor = () => {
      if (view?.state?.doc && typeof view.state.doc.toString === "function") return view.state.doc.toString();
      return plugin.homeCardSourceCache?.get?.(homeCardPath(path));
    };
    const current = () => {
      const text = sourceFor();
      return Boolean(text && plugin.homeCardCardModelFor(path, text));
    };
    return propertyCardFrontmatterOwnMounted(plugin, {
      scope,
      view: view && view.dom === scope ? view : null,
      path,
      kind,
      mount,
      sourceText,
      getSource: sourceFor,
      currentPath,
      isCurrent: current,
      active: () => plugin.homeCardActive === true,
    });
  }

  homeCardReleaseFrontmatter(scope, path = "") {
    try {
      return propertyCardFrontmatterReleaseMounted?.(scope, { plugin: this, path }) || false;
    } catch (_) { return false; }
  }

  // Row-level fallback: claim only values the connected card represents,
  // and only while whole-frontmatter ownership is unavailable for this
  // scope. On card loss or a denied context, remove all row ownership.
  homeCardOwnKeys(scope, sourcePath = "") {
    const path = homeCardPath(sourcePath);
    try {
      if (!(this.homeCardKeySlots instanceof Map)) this.homeCardKeySlots = new Map();
      if (!path || this.homeCardDesktop?.() !== true) {
        propertyCardSlotRelease(this.homeCardKeySlots, scope, path);
        return null;
      }
      // Whole ownership already hides the container; rows add nothing.
      let wholeOwned = false;
      try {
        const mounted = typeof propertyCardFrontmatterMountOwners !== "undefined"
          ? propertyCardFrontmatterMountOwners.get(scope)
          : null;
        wholeOwned = Boolean(mounted && mounted.plugin === this && mounted.path === path
          && (mounted.kind === "area" || mounted.kind === "project"));
      } catch (_) {
        wholeOwned = false;
      }
      if (wholeOwned) {
        propertyCardSlotRelease(this.homeCardKeySlots, scope, path);
        return null;
      }
      const model = this.homeCardCardModelFor(path, this.homeCardSourceCache?.get?.(path));
      const keys = homeCardFallbackKeys(model);
      if (!keys.length) {
        propertyCardSlotRelease(this.homeCardKeySlots, scope, path);
        return null;
      }
      return propertyCardSlotOwn(this.homeCardKeySlots, scope, path, propertyCardOwnKeys(scope, keys));
    } catch (_) {
      try { propertyCardSlotRelease(this.homeCardKeySlots, scope, path); } catch (_) {}
      return null;
    }
  }

  homeCardReleaseKeys(scope, sourcePath = "") {
    try {
      return propertyCardSlotRelease(this.homeCardKeySlots, scope, homeCardPath(sourcePath));
    } catch (_) { return false; }
  }

  homeCardReleaseAdoption(scope, sourcePath = "") {
    let mounted = null;
    try { mounted = propertyCardAdoptedEntry?.(scope) || null; } catch (_) {}
    if (mounted?.kind === HOME_CARD_HOST_KIND && mounted.path === "bank.md") {
      try { propertyCardHomeBankAreaRelease(scope, mounted.path, mounted.node, this); } catch (_) {}
    }
    try { return propertyCardAdoptRelease(scope, sourcePath || undefined, HOME_CARD_HOST_KIND, { preserveFallback: true }); } catch (_) { return false; }
  }

  homeCardRegisterBankAreaMount(scope, sourcePath, kind, mount) {
    try { return propertyCardHomeBankAreaRegister(this, scope, sourcePath, kind, mount); } catch (_) { return null; }
  }

  homeCardReleaseBankAreaMount(scope, sourcePath, mount) {
    try { return propertyCardHomeBankAreaRelease(scope, sourcePath, mount, this); } catch (_) { return false; }
  }

  homeCardReleaseBankAreaMounts(scope, sourcePath = "") {
    const key = homeCardPath(sourcePath);
    let released = 0;
    for (const node of Array.from(scope?.querySelectorAll?.(`.${HOME_CARD_CLASS}[data-home-source]`) || [])) {
      const path = homeCardPath(node.getAttribute?.("data-home-source") || "");
      if (key && key !== path) continue;
      if (this.homeCardReleaseBankAreaMount(scope, path, node)) released += 1;
    }
    return released;
  }

  // Path-bound Reading removal: releases this path's title/H1 in the same
  // frame so a failed mount, path change, or unload never leaves a hidden
  // title. Also releases whole-frontmatter and row ownership for the path.
  // Never touches another path's mount in the same scope.
  homeCardRemoveReading(root, scope = root, sourcePath = "") {
    if (!root) return;
    try { this.homeCardClearGoal?.(root); } catch (_) {}
    try { this.homeCardTrackFoot?.(scope, sourcePath, null); } catch (_) {}
    this.homeCardReleaseAdoption(scope, sourcePath);
    try { this.homeCardReleaseFrontmatter?.(scope, sourcePath); } catch (_) {}
    for (const node of Array.from(root.querySelectorAll?.(`.${HOME_CARD_CLASS}`) || [])) {
      if (!propertyCardNodeBelongs(node, root)) continue;
      const ownedPath = homeCardPath(node.getAttribute?.("data-home-source") || "");
      if (sourcePath && ownedPath && ownedPath !== homeCardPath(sourcePath)) continue;
      try { this.homeCardReleaseBankAreaMount(scope, ownedPath, node); } catch (_) {}
      try { node.remove?.(); } catch (_) { node.parentNode?.removeChild?.(node); }
    }
    try { this.homeCardReleaseKeys?.(scope, sourcePath); } catch (_) {}
    const anotherOwner = Array.from(this.homeCardReading || []).some((item) =>
      item.surface === root && item.path !== sourcePath);
    if (!anotherOwner) scope?.classList?.remove?.(HOME_CARD_SURFACE_CLASS);
  }

  homeCardRemoveStrays(root, sourcePath) {
    for (const node of Array.from(root?.querySelectorAll?.(`.${HOME_CARD_CLASS}`) || [])) {
      if (node.getAttribute?.("data-cm-widget") === "true") continue;
      if (!node.closest?.(".cm-widgetBuffer, .cm-content")) continue;
      if (homeCardPath(node.getAttribute?.("data-home-source")) !== homeCardPath(sourcePath)) continue;
      try { node.remove?.(); } catch (_) {}
    }
  }

  homeCardSetEditorScope(view, enabled) {
    try {
      return this.homePropertyCardHost().setEditorScope(view, enabled, {
        scopeOf: (root) => {
          try {
            return root.closest?.(".markdown-source-view") || root.closest?.(".markdown-preview-view") || root;
          } catch (_) {
            return root;
          }
        },
        mark: (scope) => { scope?.classList?.add?.(HOME_CARD_SURFACE_CLASS); },
        unmark: (scope) => { scope?.classList?.remove?.(HOME_CARD_SURFACE_CLASS); },
      });
    } catch (_) {
      return null;
    }
  }

  homeCardCleanEditor(view) {
    try { this.homeCardTrackFoot?.(view?.dom, this.homeCardLivePath(view), null); } catch (_) {}
    try { this.homeCardReleaseAdoption(view?.dom); } catch (_) {}
    try { this.homeCardReleaseBankAreaMounts?.(view?.dom); } catch (_) {}
    try { this.homeCardReleaseFrontmatter?.(view?.dom, this.homeCardLivePath(view)); } catch (_) {}
    try {
      return this.homePropertyCardHost().cleanEditor(view, {
        unmark: (scope) => { scope?.classList?.remove?.(HOME_CARD_SURFACE_CLASS); },
      });
    } catch (_) {}
  }
}
