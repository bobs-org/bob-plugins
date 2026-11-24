// The album card: the note's title block (stack tile, ALBUM kicker with owner
// links, title, summary subtitle) painted from local data at once, with the
// report-backed schema body joining inside the same node. On desktop Live
// Preview and Reading it mounts in the title slot and owns the title through
// the adopter glue (240k); embeds, popovers, mobile, and failed mounts keep
// today's body placement with a demoted heading. No Markdown or frontmatter
// is rewritten.
const albumHeaderNodeSignatures = new WeakMap();
const albumHeaderObsidianKeymap = (() => {
  try { return require("obsidian").Keymap || null; } catch (_) { return null; }
})();

function albumHeaderDefer(callback) {
  if (typeof queueMicrotask === "function") queueMicrotask(callback);
  else Promise.resolve().then(callback);
}

// Modifier-aware like a Markdown link: Mod opens a tab, Mod+Alt a split,
// middle click a tab (Obsidian's Keymap.isModEvent when present).
function albumHeaderLinkPane(event) {
  if (!event) return false;
  let pane = Boolean(event.ctrlKey || event.metaKey);
  if (event.type === "auxclick" && event.button === 1) pane = "tab";
  try {
    if (albumHeaderObsidianKeymap && typeof albumHeaderObsidianKeymap.isModEvent === "function") {
      pane = albumHeaderObsidianKeymap.isModEvent(event);
    }
  } catch (_) {}
  return pane || false;
}

class BobLedgerToolsAlbumHeaderMixin {
  albumPropertyCardHost() {
    if (this._albumPropertyCardHost) return this._albumPropertyCardHost;
    const plugin = this;
    this._albumPropertyCardHost = createPropertyCardHost({
      plugin,
      kind: "album",
      readingPriority: 49,
      allowEmbedDisplay: true,
      titleOwnership: true,
      fields: {
        active: "albumHeaderActive",
        reading: "albumHeaderReading",
        readingPending: "albumHeaderReadingPending",
        readingTimers: "albumHeaderReadingTimers",
        editors: "albumHeaderEditors",
        editorScopes: "albumHeaderEditorScopes",
        refreshTimer: "albumHeaderRefreshTimer",
        keySlots: "albumHeaderKeySlots",
      },
      setTimeout: (fn, ms) => plugin.albumSetTimeout?.(fn, ms),
      clearTimeout: (id) => plugin.albumClearTimeout?.(id),
      pathOf: albumHeaderPath,
      readingRoot: (el) => plugin.albumHeaderReadingRoot(el),
      readingScope: (root) => plugin.albumHeaderReadingScope(root),
      acceptReading: (el, ctx) => Boolean(el && ctx?.sourcePath && !notebookInsideCode(el)),
      paintReading: (el, path) => plugin.paintAlbumHeaderReading(el, path),
      removeReading: (root, scope, path) => plugin.albumHeaderRemoveReading(root, scope, path),
      onResolveSurface: (widget, root) => {
        if (!root) plugin.albumHeaderRemoveStrays(widget.el, widget.path);
      },
      livePath: (view) => plugin.albumHeaderLivePath(view),
      buildDecorations: (view) => plugin.buildAlbumHeaderDecorations(view),
      cleanEditor: (view) => plugin.albumHeaderCleanEditor(view),
      ownKeys: (scope, path) => plugin.albumHeaderOwnKeys(scope, path),
      releaseKeys: (scope, path) => plugin.albumHeaderReleaseKeys(scope, path),
      onSetup: () => {
        try { propertyCardFrontmatterCoordinatorBind?.(plugin, "album"); } catch (_) {}
        if (!(plugin.albumHeaderExpanded instanceof Map)) plugin.albumHeaderExpanded = new Map();
        plugin.albumHeaderUnsubscribe = plugin.apiAlbumSubscribe?.((state) => {
          plugin.albumHeaderLastState = state;
          plugin.scheduleAlbumHeaderRefresh();
        }) || null;
        try { plugin.albumHeaderFootBind?.(); } catch (_) {}
      },
      onDisposeStart: () => {
        try { propertyCardFrontmatterCoordinatorReleaseKind?.(plugin, "album"); } catch (_) {}
        try { plugin.albumHeaderFootUnbind?.(); } catch (_) {}
        plugin.albumHeaderUnsubscribe?.();
        plugin.albumHeaderUnsubscribe = null;
        try { plugin.albumSchemaCardModal?.close?.(); } catch (_) {}
        plugin.albumSchemaCardModal = null;
      },
      onDisposeEnd: () => {
        plugin.albumHeaderExpanded?.clear?.();
      },
    });
    return this._albumPropertyCardHost;
  }

  setupAlbumHeader() {
    this.albumPropertyCardHost().setup();
  }

  teardownAlbumHeader() {
    this.albumPropertyCardHost().dispose();
  }

  albumHeaderDesktop() {
    return albumHeaderIsDesktopPlatform();
  }

  albumHeaderExpandedMap() {
    if (!(this.albumHeaderExpanded instanceof Map)) this.albumHeaderExpanded = new Map();
    return this.albumHeaderExpanded;
  }

  albumHeaderIsExpanded(path, model) {
    const key = albumHeaderPath(path);
    const map = this.albumHeaderExpandedMap();
    if (key && map.has(key)) return map.get(key) === true;
    return albumHeaderDefaultExpanded(model);
  }

  albumHeaderSetExpanded(path, expanded) {
    const key = albumHeaderPath(path);
    if (key) this.albumHeaderExpandedMap().set(key, expanded === true);
    this.refreshAlbumHeaderReading();
    this.refreshAlbumHeaderEditors();
  }

  albumHeaderState() {
    try {
      return typeof this.albumReportState === "function"
        ? this.albumReportState()
        : this.albumHeaderLastState || null;
    } catch (_) {
      return this.albumHeaderLastState || null;
    }
  }

  albumHeaderOptions(sourcePath, state, model) {
    const desktop = this.albumHeaderDesktop();
    const expanded = this.albumHeaderIsExpanded(sourcePath, model);
    return {
      sourcePath,
      hue: notebookHostHueName(sourcePath, this.app?.metadataCache, this.app?.vault),
      metadataCache: this.app?.metadataCache,
      vault: this.app?.vault,
      desktop,
      expanded,
      handlers: {
        openPath: (path, event) => { void this.albumHeaderOpenPath(path, sourcePath, event); },
        copyCapture: (item) => this.albumHeaderCopyCapture(item),
        toggleSchema: (next) => this.albumHeaderSetExpanded(sourcePath, next),
        openSchemaCard: (item) => (typeof this.openAlbumSchemaEntry === "function" ? this.openAlbumSchemaEntry({ filePath: sourcePath }) : this.openAlbumSchemaCard?.(item, sourcePath)),
        jumpYaml: (line) => { void this.albumHeaderJumpYaml(sourcePath, line); },
      },
      state,
    };
  }

  albumHeaderModelFor(sourcePath, state, sourceText) {
    try {
      const current = state || this.albumHeaderState();
      const report = current?.report || null;
      return albumHeaderModel(report, sourcePath, {
        sourceText,
        sourcePath,
        metadataCache: this.app?.metadataCache,
        vault: this.app?.vault,
      });
    } catch (_) {
      return null;
    }
  }

  // { identity, body, title, subtitle } for the album card, or null.
  albumHeaderCardModelFor(sourcePath, state, sourceText) {
    try {
      const current = state || this.albumHeaderState();
      return albumHeaderCardModel(current?.report || null, sourcePath, {
        sourceText,
        sourcePath,
        metadataCache: this.app?.metadataCache,
        vault: this.app?.vault,
      });
    } catch (_) {
      return null;
    }
  }

  async albumHeaderCopyCapture(model) {
    const value = String(model?.captureText || "");
    if (!value) return { ok: false, reason: model?.routeReason || "The capture route is unavailable." };
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : null;
    if (!clipboard || typeof clipboard.writeText !== "function") {
      try { new Notice("Clipboard is unavailable."); } catch (_) {}
      return { ok: false, reason: "clipboard is unavailable" };
    }
    try {
      await clipboard.writeText(value);
      try { new Notice(`Copied ${value}.`); } catch (_) {}
      return { ok: true, value };
    } catch (_) {
      try { new Notice("Could not copy the album capture route."); } catch (_) {}
      return { ok: false, reason: "clipboard write failed" };
    }
  }

  async albumHeaderOpenPath(path, sourcePath, event) {
    const target = albumHeaderPath(path);
    if (!target) return { ok: false };
    try {
      const workspace = this.app?.workspace;
      if (workspace && typeof workspace.openLinkText === "function") {
        await workspace.openLinkText(target.replace(/\.md$/i, ""), sourcePath || "", albumHeaderLinkPane(event));
        return { ok: true };
      }
    } catch (_) {}
    try { new Notice("Could not open the album owner."); } catch (_) {}
    return { ok: false };
  }

  albumHeaderMarkdownLeaf(path) {
    const target = albumHeaderPath(path);
    try {
      const leaves = this.app?.workspace?.getLeavesOfType?.("markdown") || [];
      return leaves.find((leaf) => albumHeaderPath(leaf?.view?.file?.path) === target)
        || this.app?.workspace?.getMostRecentLeaf?.()
        || this.app?.workspace?.activeLeaf
        || null;
    } catch (_) {
      return null;
    }
  }

  async albumHeaderJumpYaml(sourcePath, line) {
    const path = albumHeaderPath(sourcePath);
    if (!path) return { ok: false, reason: "missing path" };
    const targetLine = Number.isInteger(line) && line > 0 ? line : albumHeaderYamlLine(
      this.albumHeaderModelFor(path),
      { line },
    );
    try {
      this.albumSchemaCardModal?.close?.();
    } catch (_) {}
    try {
      const file = this.app?.vault?.getAbstractFileByPath?.(path) || { path };
      const leaf = this.albumHeaderMarkdownLeaf(path);
      let excursionViewState = null;
      let excursionSelectedKey = "stats";
      let excursionFingerprint = "";
      try {
        excursionViewState = typeof leaf?.getViewState === "function" ? leaf.getViewState() : null;
        excursionSelectedKey = String(this.albumSchemaCardModal?.selectedKey || "stats");
        excursionFingerprint = String(this.albumSchemaCardModal?.schemaModel?.schemaFingerprint || this.albumHeaderModelFor(path)?.schemaFingerprint || "");
      } catch (_) {}
      if (leaf && typeof leaf.openFile === "function") {
        await leaf.openFile(file, { state: { mode: "source" } });
      } else if (leaf && typeof leaf.setViewState === "function") {
        const current = typeof leaf.getViewState === "function" ? leaf.getViewState() : { type: "markdown", state: {} };
        const next = {
          ...(current || {}),
          type: "markdown",
          state: { ...((current && current.state) || {}), mode: "source", file: path },
        };
        await leaf.setViewState(next);
      } else if (this.app?.workspace?.openLinkText) {
        await this.app.workspace.openLinkText(path.replace(/\.md$/i, ""), path, false);
      }
      const editor = leaf?.view?.editor;
      const cursorLine = Number.isInteger(targetLine) && targetLine > 0 ? targetLine - 1 : 0;
      if (editor && typeof editor.setCursor === "function") {
        editor.setCursor({ line: cursorLine, ch: 0 });
        if (typeof editor.scrollIntoView === "function") {
          editor.scrollIntoView({ from: { line: cursorLine, ch: 0 }, to: { line: cursorLine, ch: 0 } }, true);
        }
      }
      try {
        if (leaf && typeof this.albumYamlExcursionBegin === "function") {
          this.albumYamlExcursionBegin(leaf, { albumPath: path, viewState: excursionViewState, selectedKey: excursionSelectedKey, fingerprint: excursionFingerprint });
        }
      } catch (_) {}
      return { ok: true, line: cursorLine + 1 };
    } catch (_) {
      try { new Notice("Could not open the album schema in Source mode."); } catch (__) {}
      return { ok: false, reason: "source jump failed" };
    }
  }

  albumHeaderReadingRoot(el) {
    return propertyCardReadingRoot(el);
  }

  albumHeaderReadingScope(root) {
    return propertyCardReadingScope(root);
  }

  albumHeaderNodeBelongs(node, root) {
    return propertyCardNodeBelongs(node, root);
  }

  // A sourcePath releases only that path's mount: a pane reuses its scope, so
  // a stale binding for an earlier note must not unhide the current card.
  albumHeaderReleaseKeys(scope, sourcePath = "") {
    try { propertyCardSlotRelease(this.albumHeaderKeySlots, scope, albumHeaderPath(sourcePath)); } catch (_) {}
  }

  albumHeaderOwnKeys(scope, sourcePath = "") {
    try {
      if (!(this.albumHeaderKeySlots instanceof Map)) this.albumHeaderKeySlots = new Map();
      return propertyCardSlotOwn(this.albumHeaderKeySlots, scope, albumHeaderPath(sourcePath),
        propertyCardOwnAlbumKeys(scope, this.albumHeaderDesktop?.()));
    } catch (_) { return null; }
  }

  albumHeaderReleaseAdoption(scope, sourcePath = "", options = {}) {
    try { return propertyCardAdoptRelease(scope, sourcePath || undefined, "album", options); } catch (_) { return false; }
  }

  // Body-placed card nodes for this path under root: never the slot node,
  // never another path's card, never a nested embed's card.
  albumHeaderBodyNodes(root, sourcePath, exclude = null) {
    const path = albumHeaderPath(sourcePath);
    return Array.from(root?.querySelectorAll?.(`.${ALBUM_HEADER_CLASS}`) || []).filter((node) => {
      if (node === exclude || !this.albumHeaderNodeBelongs(node, root)) return false;
      if (node.classList?.contains?.(PROPERTY_CARD_TITLE_SLOT_CLASS)) return false;
      const ownedPath = albumHeaderPath(node.getAttribute?.("data-album-source") || "");
      return !path || !ownedPath || ownedPath === path;
    });
  }

  // The slot card (glue entry) is released first: it lives in .mod-header,
  // inside the sizer root, so the sweep would otherwise tear it out while it
  // still owned the title.
  albumHeaderRemoveReading(root, scope = root, sourcePath = "") {
    if (!root) return;
    this.albumHeaderReleaseFrontmatter(scope, sourcePath);
    try { this.albumHeaderTrackFoot?.(scope, sourcePath, null); } catch (_) {}
    this.albumHeaderReleaseAdoption(scope, sourcePath, { preserveFallback: true });
    for (const node of Array.from(root.querySelectorAll?.(`.${ALBUM_HEADER_CLASS}`) || [])) {
      if (!this.albumHeaderNodeBelongs(node, root)) continue;
      const ownedPath = albumHeaderPath(node.getAttribute?.("data-album-source") || "");
      if (sourcePath && ownedPath && ownedPath !== albumHeaderPath(sourcePath)) continue;
      try { node.remove?.(); } catch (_) { node.parentNode?.removeChild?.(node); }
    }
    this.albumHeaderReleaseKeys(scope, sourcePath);
    const anotherOwner = Array.from(this.albumHeaderReading || []).some((item) =>
      item.surface === root && item.path !== sourcePath);
    if (!anotherOwner) scope?.classList?.remove?.(ALBUM_HEADER_SURFACE_CLASS);
  }

  // A bare report model (older callers) still builds: identity from itself.
  albumHeaderCardFrom(model) {
    if (!model) return null;
    if (model.identity) return model;
    const owners = (Array.isArray(model.crumbs) ? model.crumbs : []).filter((crumb) => crumb && crumb.current !== true);
    const title = String(model.title || model.stem || "");
    return {
      identity: {
        kind: "album", path: albumHeaderPath(model.path), stem: String(model.stem || ""), title,
        emoji: String(model.emoji || "").trim(), summary: "", owners, ancestryBroken: Boolean(model.ancestryMessage),
      },
      body: model,
      title,
      subtitle: "",
    };
  }

  albumHeaderAppendActions(slot, body, options, doc) {
    if (!slot || !body) return;
    const copy = notebookCreateEl(doc, "button", "bob-album-header-copy");
    copy.setAttribute?.("type", "button");
    copy.setAttribute?.("data-album-header-focus", "copy");
    const disabledReason = body.routeReason || "";
    copy.disabled = Boolean(disabledReason);
    copy.setAttribute?.("aria-disabled", copy.disabled ? "true" : "false");
    copy.setAttribute?.("title", disabledReason || `Copy ${body.captureText}`);
    copy.setAttribute?.("aria-label", disabledReason
      ? `Copy capture route unavailable: ${disabledReason}`
      : `Copy ${body.captureLabel} capture route`);
    notebookSetText(copy, disabledReason ? `＋ ${body.captureLabel || "record"}` : `＋ ${body.captureLabel}`);
    copy.addEventListener?.("click", (event) => {
      event.preventDefault?.();
      if (!copy.disabled) options?.handlers?.copyCapture?.(body);
    });
    slot.appendChild(copy);
    if (options?.desktop !== false) {
      const schema = notebookCreateEl(doc, "button", "bob-album-header-schema");
      schema.setAttribute?.("type", "button");
      schema.setAttribute?.("data-album-header-focus", "schema");
      schema.setAttribute?.("aria-label", "Open schema card");
      notebookSetText(schema, "⊞ Schema");
      schema.addEventListener?.("click", (event) => {
        event.preventDefault?.();
        options?.handlers?.openSchemaCard?.(body);
      });
      slot.appendChild(schema);
    }
  }

  // section.bob-album-header.bob-property-card: the kit title block first
  // (title from local identity, never the report), then, once the report
  // body exists, the actions in the kicker row, the ancestry note, the
  // schema summary and chips, and the mobile hint.
  albumHeaderBuildEl(model, options, doc) {
    try {
      const card = this.albumHeaderCardFrom(model);
      const identity = card?.identity;
      if (!identity || !doc) return null;
      const body = card.body || null;
      const title = String(card.title || identity.title || identity.stem || "").trim();
      const header = notebookCreateEl(doc, "section", `${ALBUM_HEADER_CLASS} bob-property-card`);
      if (!header || !title) return null;
      header.setAttribute?.("data-album-header", "true");
      header.setAttribute?.("data-album-source", identity.path);
      header.setAttribute?.("data-album-body", body ? "report" : "pending");
      if (options?.hue) header.setAttribute?.("data-root-hue", options.hue);
      propertyCardApplyIdentity(header, { kind: "album", title });
      const block = propertyCardBuildTitleBlock(doc, {
        kind: "album",
        title,
        subtitle: card.subtitle || "",
        tile: { emoji: identity.emoji || "" },
        kicker: (identity.owners || []).map((owner) => ({
          text: owner.title || owner.stem || "",
          target: albumHeaderPath(owner.path),
        })),
        onLink: (target, event) => options?.handlers?.openPath?.(target, event),
      });
      if (!block) return null;
      header.appendChild(block.element);
      for (const link of Array.from(block.element.querySelectorAll?.(".bob-property-card-kicker-link") || [])) {
        link.classList?.add?.(ALBUM_HEADER_CRUMB_CLASS);
        link.setAttribute?.("data-album-header-focus", `crumb:${link.getAttribute?.("data-href") || ""}`);
      }
      if (!body) {
        this.albumHeaderAppendFoot?.(header, card, options, doc);
        return header;
      }
      this.albumHeaderAppendActions(block.actions, body, options, doc);
      if (body.ancestryMessage) {
        const note = notebookCreateEl(doc, "p", "bob-album-header-ancestry-note");
        notebookSetText(note, body.ancestryMessage);
        note.setAttribute?.("role", "note");
        header.appendChild(note);
      }
      albumSchemaHeaderAppend(header, body, options, doc);
      this.albumHeaderAppendFoot?.(header, card, options, doc);
      return header;
    } catch (_) {
      return null;
    }
  }

  albumHeaderReadingAnchor(root) {
    try {
      const h1 = Array.from(root?.querySelectorAll?.("h1") || [])
        .find((node) => !notebookInsideCode(node));
      return h1 || null;
    } catch (_) {
      return null;
    }
  }

  albumHeaderFocusKey(node, doc) {
    const active = doc?.activeElement;
    return active && node?.contains?.(active) ? active.getAttribute?.("data-album-header-focus") || "" : "";
  }

  albumHeaderRestoreFocus(node, focusKey) {
    if (!focusKey || !node) return;
    const next = Array.from(node.querySelectorAll?.("[data-album-header-focus]") || [])
      .find((item) => item.getAttribute?.("data-album-header-focus") === focusKey);
    next?.focus?.({ preventScroll: true });
  }

  // Body placement (fallback): today's spot right after the first non-code
  // H1, else the start of the root. A node already there stays put.
  albumHeaderPlaceInBody(root, header) {
    const anchor = this.albumHeaderReadingAnchor(root);
    if (anchor?.parentNode?.insertBefore) {
      if (header.parentNode === anchor.parentNode && anchor.nextSibling === header) return true;
      anchor.parentNode.insertBefore(header, anchor.nextSibling || null);
      return true;
    }
    if (header.parentNode === root && root.firstChild === header) return true;
    if (root.insertBefore) root.insertBefore(header, root.firstChild || null);
    else root.prepend?.(header);
    return true;
  }

  paintAlbumHeaderReading(el, sourcePath, state) {
    const root = this.albumHeaderReadingRoot(el);
    const scope = this.albumHeaderReadingScope(root);
    if (!root || !sourcePath) return null;
    // Remove old reading chrome stranded in editor callout chunks, while
    // leaving the legitimate CodeMirror decoration and other sources alone.
    this.albumHeaderRemoveStrays(root, sourcePath);
    let card = null;
    try {
      card = this.albumHeaderCardModelFor(sourcePath, state, this.albumHeaderSourceCache?.get?.(sourcePath));
    } catch (_) {
      card = null;
    }
    const reading = scope?.classList?.contains?.("markdown-preview-view")
      ? propertyCardReadingViewFor(this.app, scope) : null;
    const leafPath = reading ? reading.currentPath() : "";
    // A stale binding for a note this leaf no longer shows paints nothing.
    if (!card || (leafPath && leafPath !== sourcePath)) {
      this.albumHeaderRemoveReading(root, scope, sourcePath);
      return null;
    }
    const doc = notebookDomDoc(root) || (typeof document !== "undefined" ? document : null);
    const adopted = propertyCardAdoptedEntry(scope);
    const slotNode = adopted && adopted.path === sourcePath && adopted.mode === "slot" ? adopted.node : null;
    const bodyNodes = this.albumHeaderBodyNodes(root, sourcePath, slotNode);
    let header = slotNode || bodyNodes[0] || null;
    const focusKey = this.albumHeaderFocusKey(header, doc);
    const extra = typeof this.albumHeaderFootExtra === "function" ? this.albumHeaderFootExtra(sourcePath, card) : null;
    const options = { ...this.albumHeaderOptions(sourcePath, state, card.body), footSpec: extra?.footSpec };
    const signature = JSON.stringify([albumHeaderCardSignature(card, options), extra?.footDigest || "", extra?.footOpen === true]);
    if (!header || albumHeaderNodeSignatures.get(header) !== signature) {
      let fresh = null;
      try {
        fresh = this.albumHeaderBuildEl(card, options, doc);
      } catch (_) {
        fresh = null;
      }
      if (!fresh) {
        this.albumHeaderRemoveReading(root, scope, sourcePath);
        return null;
      }
      // The body joins (or the title changes) inside the same node.
      header = header ? propertyCardAdoptPatch(header, fresh) : fresh;
      albumHeaderNodeSignatures.set(header, signature);
    }
    for (const node of bodyNodes) {
      if (node !== header) node.remove?.();
    }
    scope?.classList?.add?.(ALBUM_HEADER_SURFACE_CLASS);
    const adoption = propertyCardAdoptTitle(scope, header, {
      path: sourcePath,
      kind: "album",
      view: reading?.view || null,
      currentPath: reading?.currentPath || null,
      recognizer: propertyCardAlbumTitleRecognizer(card.title),
      onLost: () => this.scheduleAlbumHeaderRefresh(),
      onMount: (mount) => this.albumHeaderOwnMountedFrontmatter(
        scope, null, sourcePath, mount, undefined, reading?.currentPath || (() => ""),
      ),
    });
    if (adoption.mode !== "slot") {
      try {
        this.albumHeaderPlaceInBody(root, header);
      } catch (_) {
        this.albumHeaderRemoveReading(root, scope, sourcePath);
        return null;
      }
    }
    this.albumHeaderRestoreFocus(header, focusKey);
    try { this.albumHeaderTrackFoot?.(scope || root, sourcePath, header); } catch (_) {}
    try { this.albumHeaderEnsureSource?.(sourcePath); } catch (_) {}
    if (adoption.mode === "slot") {
      this.albumHeaderOwnMountedFrontmatter(
        scope, null, sourcePath, header, this.albumHeaderSourceCache?.get?.(sourcePath),
        reading?.currentPath || (() => ""),
      );
    } else {
      this.albumHeaderReleaseFrontmatter(scope, sourcePath);
    }
    // Owned Properties rows (record) hide only once the report body paints.
    if (card.body) this.albumHeaderOwnKeys(scope, sourcePath);
    else this.albumHeaderReleaseKeys(scope, sourcePath);
    return header;
  }

  albumHeaderRemoveStrays(root, sourcePath) {
    for (const node of Array.from(root?.querySelectorAll?.(`.${ALBUM_HEADER_CLASS}`) || [])) {
      if (node.getAttribute?.("data-cm-widget") === "true") continue;
      if (!node.closest?.(".cm-widgetBuffer, .cm-content")) continue;
      if (albumHeaderPath(node.getAttribute?.("data-album-source")) !== albumHeaderPath(sourcePath)) continue;
      node.remove?.();
    }
  }

  renderAlbumHeaderInReading(el, ctx) {
    this.albumPropertyCardHost().renderInReading(el, ctx);
  }

  albumHeaderBindReading(el, ctx, root) {
    return this.albumPropertyCardHost().bindReading(el, ctx, root);
  }

  refreshAlbumHeaderReading() {
    this.albumPropertyCardHost().refreshReading();
  }

  albumHeaderLivePath(view) {
    try {
      return this.notebookCatalogLivePath?.(view) || null;
    } catch (_) {
      return null;
    }
  }

  albumHeaderOwnMountedFrontmatter(scope, view, path, mount, sourceText, currentPath) {
    if (typeof propertyCardFrontmatterOwnMounted !== "function") return null;
    const sourceFor = () => {
      if (view?.state?.doc && typeof view.state.doc.toString === "function") return view.state.doc.toString();
      return this.albumHeaderSourceCache?.get?.(albumHeaderPath(path));
    };
    const current = () => {
      const text = sourceFor();
      return Boolean(text && this.albumHeaderCardModelFor(path, this.albumHeaderState(), text));
    };
    return propertyCardFrontmatterOwnMounted(this, {
      scope, view: view?.dom === scope ? view : null, path, kind: "album", mount,
      sourceText, getSource: sourceFor, currentPath, isCurrent: current,
      active: () => this.albumHeaderActive === true,
    });
  }

  albumHeaderReleaseFrontmatter(scope, path = "") {
    try {
      return propertyCardFrontmatterReleaseMounted?.(scope, { plugin: this, kind: "album", path }) || false;
    } catch (_) { return false; }
  }

  // Patch a slot-mounted Live Preview card outside the CodeMirror update.
  albumHeaderPatchLive(view, adopted, fresh, signature) {
    const target = adopted.node;
    albumHeaderDefer(() => {
      const entry = propertyCardAdoptedEntry(view?.dom);
      if (!entry || entry.node !== target || entry.generation !== adopted.generation) return;
      const doc = notebookDomDoc(target) || (typeof document !== "undefined" ? document : null);
      const focusKey = this.albumHeaderFocusKey(target, doc);
      propertyCardAdoptPatch(target, fresh);
      albumHeaderNodeSignatures.set(target, signature);
      propertyCardSyncTitleHeading(target, entry.owned);
      this.albumHeaderRestoreFocus(target, focusKey);
    });
  }

  buildAlbumHeaderDecorations(view) {
    try {
      if (!Decoration || !RangeSetBuilder || !WidgetType) return Decoration?.none || null;
      const path = this.albumHeaderLivePath(view);
      if (!path || !view?.state?.doc) {
        this.albumHeaderReleaseFrontmatter(view?.dom);
        this.albumHeaderSetEditorScope(view, false);
        this.albumHeaderReleaseKeys(view?.dom);
        this.albumHeaderReleaseAdoption(view?.dom);
        return Decoration.none;
      }
      const text = view.state.doc.toString();
      try { this.albumHeaderRememberSource?.(path, text); } catch (_) {}
      const state = this.albumHeaderState();
      const card = this.albumHeaderCardModelFor(path, state, text);
      this.albumHeaderSetEditorScope(view, Boolean(card));
      if (!card) {
        this.albumHeaderReleaseFrontmatter(view?.dom, path);
        try { this.albumHeaderTrackFoot?.(view?.dom, path, null); } catch (_) {}
        this.albumHeaderReleaseKeys(view?.dom);
        this.albumHeaderReleaseAdoption(view?.dom);
        return Decoration.none;
      }
      const doc = notebookDomDoc(view.dom) || (typeof document !== "undefined" ? document : null);
      const extra = typeof this.albumHeaderFootExtra === "function" ? this.albumHeaderFootExtra(path, card) : null;
      const options = { ...this.albumHeaderOptions(path, state, card.body), footSpec: extra?.footSpec };
      const signature = JSON.stringify([albumHeaderCardSignature(card, options), extra?.footDigest || "", extra?.footOpen === true]);
      const adopted = propertyCardAdoptedEntry(view.dom);
      let header = adopted && adopted.path === path && adopted.mode === "slot" ? adopted.node : null;
      if (!header || albumHeaderNodeSignatures.get(header) !== signature) {
        const fresh = this.albumHeaderBuildEl(card, options, doc);
        if (!fresh) {
          this.albumHeaderReleaseFrontmatter(view?.dom, path);
          try { this.albumHeaderTrackFoot?.(view?.dom, path, null); } catch (_) {}
          this.albumHeaderReleaseKeys(view?.dom);
          this.albumHeaderReleaseAdoption(view?.dom);
          return Decoration.none;
        }
        if (header) this.albumHeaderPatchLive(view, adopted, fresh, signature);
        else {
          header = fresh;
          albumHeaderNodeSignatures.set(header, signature);
        }
      }
      const adoption = propertyCardAdoptTitle(view.dom, header, {
        path,
        kind: "album",
        view,
        recognizer: propertyCardAlbumTitleRecognizer(card.title),
        currentPath: () => propertyCardLiveCurrentPath(view),
        onLost: () => this.scheduleAlbumHeaderRefresh(),
      });
      // Native Properties live under the CodeMirror editor, not the
      // .markdown-source-view that carries the surface class. The record row
      // hides only once the report body paints.
      if (card.body) this.albumHeaderOwnKeys(view?.dom, path);
      else this.albumHeaderReleaseKeys(view?.dom, path);
      try { this.albumHeaderTrackFoot?.(view?.dom, path, header); } catch (_) {}
      if (adoption.mode === "slot") {
        this.albumHeaderOwnMountedFrontmatter(
          view.dom, view, path, header, text, () => this.albumHeaderLivePath(view) || "",
        );
        return Decoration.none;
      }

      // Fallback: today's inline widget at the end of the first `# ` line.
      const plugin = this;
      const anchor = this.notebookHeaderLiveAnchor?.(text) ?? -1;
      const frontmatterEnd = this.notebookHeaderFrontmatterEnd?.(text) ?? -1;
      const widget = new class extends WidgetType {
        constructor() {
          super();
          this.path = path;
          this.signature = signature;
        }
        eq(other) { return Boolean(other && other.path === this.path && other.signature === this.signature); }
        toDOM() {
          header.setAttribute?.("data-cm-widget", "true");
          header.setAttribute?.("data-album-source", path);
          propertyCardFrontmatterOwnMountedDeferred?.(plugin, {
            scope: view.dom, view, path, kind: "album", mount: header, sourceText: text,
            getSource: () => view?.state?.doc?.toString?.() || "",
            currentPath: () => plugin.albumHeaderLivePath(view) || "",
            active: () => plugin.albumHeaderActive === true,
            isCurrent: () => {
              const source = view?.state?.doc?.toString?.() || "";
              return Boolean(source && plugin.albumHeaderCardModelFor(path, plugin.albumHeaderState(), source));
            },
          });
          return header;
        }
      }();
      let at = 0;
      let side = 1;
      if (anchor >= 0) {
        at = view.state.doc.line(anchor + 1).to;
      } else if (frontmatterEnd >= 0) {
        const nextLine = frontmatterEnd + 2;
        at = nextLine <= (view.state.doc.lines || 0)
          ? view.state.doc.line(nextLine).from
          : (view.state.doc.length || 0);
        side = 1;
      }
      const builder = new RangeSetBuilder();
      builder.add(at, at, Decoration.widget({ widget, side }));
      return builder.finish();
    } catch (_) {
      this.albumHeaderReleaseFrontmatter(view?.dom);
      return Decoration?.none || null;
    }
  }

  albumHeaderSetEditorScope(view, enabled) {
    this.albumPropertyCardHost().setEditorScope(view, enabled, {
      scopeOf: (root) => {
        try {
          return root.closest?.(".markdown-source-view") || root.closest?.(".markdown-preview-view") || root;
        } catch (_) {
          return root;
        }
      },
      mark: (scope) => { scope?.classList?.add?.(ALBUM_HEADER_SURFACE_CLASS); },
      unmark: (scope) => { scope?.classList?.remove?.(ALBUM_HEADER_SURFACE_CLASS); },
    });
  }

  albumHeaderCleanEditor(view) {
    this.albumHeaderReleaseFrontmatter(view?.dom);
    try { this.albumHeaderTrackFoot?.(view?.dom, this.albumHeaderLivePath(view), null); } catch (_) {}
    this.albumHeaderReleaseAdoption(view?.dom);
    this.albumPropertyCardHost().cleanEditor(view, {
      unmark: (scope) => { scope?.classList?.remove?.(ALBUM_HEADER_SURFACE_CLASS); },
    });
  }

  createAlbumHeaderExtension() {
    return this.albumPropertyCardHost().createExtension();
  }

  refreshAlbumHeaderEditors() {
    this.albumPropertyCardHost().refreshEditors();
  }

  scheduleAlbumHeaderRefresh() {
    this.albumPropertyCardHost().scheduleRefresh();
  }
}
