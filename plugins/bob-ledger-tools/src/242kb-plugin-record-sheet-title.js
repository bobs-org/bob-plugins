// Record card title-slot adopter: paints the kit title block from local
// identity, joins the report body inside the same node, and mounts in the
// title slot through the shared glue (240k). Mixins cannot share method
// names with 242k, so paint/remove/card-model live here.
const recordSheetNodeSignatures = new WeakMap();

function recordSheetDefer(callback) {
  if (typeof queueMicrotask === "function") queueMicrotask(callback);
  else Promise.resolve().then(callback);
}

class BobLedgerToolsRecordSheetTitleMixin {
  recordSheetCardModelFor(path, sourceText) {
    try {
      const filePath = recordSheetPath(path);
      if (!filePath) return null;
      const frontmatter = this.recordSheetFrontmatter(filePath);
      const cache = this.recordSheetCache(filePath);
      const currentSource = typeof sourceText === "string"
        ? sourceText
        : this.recordSheetSourceCache?.get?.(filePath);
      const heading = typeof sourceText === "string"
        ? recordSheetFirstHeading(sourceText)
        : recordSheetHeadingFromCache(cache);
      return recordSheetCardModel(filePath, {
        frontmatter,
        heading,
        sourceText: currentSource,
        metadataCache: typeof propertyCardSettledMetadataCache === "function"
          ? propertyCardSettledMetadataCache(this.app) : this.app?.metadataCache,
        vault: this.app?.vault,
        desktop: this.recordSheetDesktop(),
        cache,
        body: () => this.recordSheetModelFor(filePath, sourceText),
      });
    } catch (_) {
      return null;
    }
  }

  recordSheetOwnMountedFrontmatter(scope, view, path, mount, sourceText, currentPath) {
    if (typeof propertyCardFrontmatterOwnMounted !== "function") return null;
    const key = recordSheetPath(path);
    const sourceFor = () => {
      if (view?.state?.doc && typeof view.state.doc.toString === "function") return view.state.doc.toString();
      return this.recordSheetSourceCache?.get?.(key);
    };
    const current = () => {
      const text = sourceFor();
      return Boolean(text && this.recordSheetCardModelFor(key, text));
    };
    return propertyCardFrontmatterOwnMounted(this, {
      scope, view: view?.dom === scope ? view : null, path: key, kind: "record", mount,
      sourceText, getSource: sourceFor, currentPath, isCurrent: current,
      active: () => this.recordSheetActive === true,
    });
  }

  recordSheetReleaseFrontmatter(scope, path = "") {
    try {
      return propertyCardFrontmatterReleaseMounted?.(scope, {
        plugin: this, kind: "record", path,
      }) || false;
    } catch (_) { return false; }
  }

  recordSheetReleaseAdoption(scope, sourcePath = "", options = {}) {
    try { return propertyCardAdoptRelease(scope, sourcePath || undefined, "record", options); } catch (_) { return false; }
  }

  recordSheetBodyNodes(root, sourcePath, exclude = null) {
    const path = recordSheetPath(sourcePath);
    return Array.from(root?.querySelectorAll?.(`.${RECORD_SHEET_CLASS}`) || []).filter((node) => {
      if (node === exclude || !this.recordSheetNodeBelongs(node, root)) return false;
      if (node.classList?.contains?.(PROPERTY_CARD_TITLE_SLOT_CLASS)) return false;
      const ownedPath = recordSheetPath(node.getAttribute?.("data-record-source") || "");
      return !path || !ownedPath || ownedPath === path;
    });
  }

  recordSheetFocusKey(node, doc) {
    const active = doc?.activeElement;
    return active && node?.contains?.(active) ? active.getAttribute?.("data-record-sheet-focus") || "" : "";
  }

  recordSheetRestoreFocus(node, focusKey) {
    if (!focusKey || !node) return;
    const next = Array.from(node.querySelectorAll?.("[data-record-sheet-focus]") || [])
      .find((item) => item.getAttribute?.("data-record-sheet-focus") === focusKey);
    next?.focus?.({ preventScroll: true });
  }

  recordSheetPlaceInBody(root, sheet) {
    const anchor = this.albumHeaderReadingAnchor?.(root);
    if (anchor?.parentNode?.insertBefore) {
      if (sheet.parentNode === anchor.parentNode && sheet.nextSibling === anchor) return true;
      anchor.parentNode.insertBefore(sheet, anchor);
      return true;
    }
    if (sheet.parentNode === root && root.firstChild === sheet) return true;
    if (root.insertBefore) root.insertBefore(sheet, root.firstChild || null);
    else root.prepend?.(sheet);
    return true;
  }

  recordSheetRemoveReading(root, scope = root, sourcePath = "") {
    if (!root) return;
    this.recordSheetReleaseFrontmatter(scope, sourcePath);
    this.recordSheetReleaseAdoption(scope, sourcePath, { preserveFallback: true });
    try {
      if (typeof propertyCardFootReleaseScope === "function") {
        propertyCardFootReleaseScope(root, sourcePath);
      }
    } catch (_) {}
    this.recordWalkRemoveReading(root, sourcePath);
    for (const node of Array.from(root.querySelectorAll?.(`.${RECORD_SHEET_CLASS}`) || [])) {
      if (!this.recordSheetNodeBelongs(node, root)) continue;
      const ownedPath = recordSheetPath(node.getAttribute?.("data-record-source") || "");
      if (sourcePath && ownedPath && ownedPath !== recordSheetPath(sourcePath)) continue;
      try { node.remove?.(); } catch (_) { node.parentNode?.removeChild?.(node); }
    }
    const anotherOwner = Array.from(this.recordSheetReading || []).some((item) =>
      item.surface === root && item.path !== sourcePath);
    if (!anotherOwner) scope?.classList?.remove?.(RECORD_SHEET_SURFACE_CLASS);
    scope?.classList?.remove?.(RECORD_SHEET_HIDES_CLASS);
    root?.classList?.remove?.(RECORD_SHEET_HIDES_CLASS);
    this.recordSheetClearNativeProperties(scope);
  }

  paintRecordSheetReading(el, sourcePath) {
    const root = this.recordSheetReadingRoot(el);
    const scope = this.recordSheetReadingScope(root);
    if (!root || !sourcePath) return null;
    this.recordSheetRemoveStrays(root, sourcePath);
    let card = null;
    try {
      card = this.recordSheetCardModelFor(sourcePath);
    } catch (_) {
      card = null;
    }
    const reading = scope?.classList?.contains?.("markdown-preview-view")
      ? propertyCardReadingViewFor(this.app, scope) : null;
    const leafPath = reading ? reading.currentPath() : "";
    const embed = recordSheetScopeIsEmbed(scope) || recordSheetScopeIsEmbed(root);
    // The host leaf path is the wrapping note; an embed's sourcePath is the
    // nested file, so that mismatch must not sweep a demoted embed card.
    if (!card || (!embed && leafPath && leafPath !== sourcePath)) {
      this.recordSheetRemoveReading(root, scope, sourcePath);
      this.recordWalkPaintReading(root, sourcePath, null);
      this.recordSheetNotifyOwnership();
      return null;
    }
    const doc = recordSheetDomDoc(root) || (typeof document !== "undefined" ? document : null);
    const adopted = propertyCardAdoptedEntry(scope);
    const slotNode = adopted && adopted.path === sourcePath && adopted.mode === "slot" ? adopted.node : null;
    const bodyNodes = this.recordSheetBodyNodes(root, sourcePath, slotNode);
    let sheet = slotNode || bodyNodes[0] || null;
    const focusKey = this.recordSheetFocusKey(sheet, doc);
    const options = this.recordSheetOptions(sourcePath, card.body);
    const walk = card.body?.walk || this.recordWalkFor(sourcePath);
    const footExtra = this.recordSheetFootExtra(sourcePath, card);
    const signature = recordSheetCardSignature(card, { ...options, walk, ...footExtra });
    if (!sheet || recordSheetNodeSignatures.get(sheet) !== signature) {
      let fresh = null;
      try {
        fresh = this.recordSheetBuildMounted(card, options, doc, { footSpec: footExtra.footSpec });
      } catch (_) {
        fresh = null;
      }
      if (!fresh) {
        this.recordSheetRemoveReading(root, scope, sourcePath);
        this.recordSheetNotifyOwnership();
        return null;
      }
      sheet = sheet ? propertyCardAdoptPatch(sheet, fresh) : fresh;
      recordSheetNodeSignatures.set(sheet, signature);
    }
    // The toggle API resolves live mounts: track this mount after every
    // successful paint, including signature-stable repaints.
    this.recordSheetTrackFoot(scope || root, sourcePath, sheet);
    for (const node of bodyNodes) {
      if (node !== sheet) node.remove?.();
    }
    scope?.classList?.add?.(RECORD_SHEET_SURFACE_CLASS);
    const sourceText = this.recordSheetSourceCache?.get?.(sourcePath);
    const recognizer = recordSheetTitleRecognizer({
      path: sourcePath,
      title: card.title,
      walk,
      sourceText,
    });
    const adoption = propertyCardAdoptTitle(scope, sheet, {
      path: sourcePath,
      kind: "record",
      view: reading?.view || null,
      currentPath: reading?.currentPath || null,
      recognizer,
      onLost: () => this.scheduleRecordSheetRefresh(),
      onMount: (mount) => this.recordSheetOwnMountedFrontmatter(
        scope, null, sourcePath, mount, sourceText, reading?.currentPath || (() => ""),
      ),
    });
    if (adoption.mode !== "slot") {
      try {
        this.recordSheetPlaceInBody(root, sheet);
      } catch (_) {
        this.recordSheetRemoveReading(root, scope, sourcePath);
        this.recordSheetNotifyOwnership();
        return null;
      }
    }
    this.recordSheetRestoreFocus(sheet, focusKey);
    this.recordWalkPaintReading(root, sourcePath, sheet, { owned: adoption.mode === "slot" });
    if (card.body?.hideEligible === true && !recordSheetScopeIsEmbed(scope)) {
      scope?.classList?.add?.(RECORD_SHEET_HIDES_CLASS);
    } else {
      scope?.classList?.remove?.(RECORD_SHEET_HIDES_CLASS);
      root?.classList?.remove?.(RECORD_SHEET_HIDES_CLASS);
    }
    this.recordSheetSetNativeProperties(scope, card.body);
    this.recordSheetOwnMountedFrontmatter(
      scope, null, sourcePath, sheet, sourceText, reading?.currentPath || (() => ""),
    );
    this.recordSheetNotifyOwnership();
    return sheet;
  }

  recordSheetPatchLive(view, adopted, fresh, signature) {
    const target = adopted.node;
    recordSheetDefer(() => {
      const entry = propertyCardAdoptedEntry(view?.dom);
      if (!entry || entry.node !== target || entry.generation !== adopted.generation) return;
      const doc = recordSheetDomDoc(target) || (typeof document !== "undefined" ? document : null);
      const focusKey = this.recordSheetFocusKey(target, doc);
      propertyCardAdoptPatch(target, fresh);
      recordSheetNodeSignatures.set(target, signature);
      propertyCardSyncTitleHeading(target, entry.owned);
      this.recordSheetRestoreFocus(target, focusKey);
    });
  }
}
