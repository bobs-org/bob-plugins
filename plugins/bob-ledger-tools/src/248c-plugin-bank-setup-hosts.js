// Report-driven Bank Setup card in Reading view and Live Preview, plus
// Source-mode config lint. The only editor decorations are widgets; no
// Markdown or frontmatter is rewritten. The card owns the note top through
// the title-slot adopter glue (240k); embeds, popovers, mobile, and failed
// mounts keep today's body placement after the first H1.

class BobLedgerToolsBankSetupMixin {
  bankPropertyCardHost() {
    if (this._bankPropertyCardHost) return this._bankPropertyCardHost;
    const plugin = this;
    this._bankPropertyCardHost = createPropertyCardHost({
      plugin,
      kind: "bank",
      readingPriority: 47,
      allowEmbedDisplay: true,
      titleOwnership: true,
      fields: {
        active: "bankSetupActive",
        reading: "bankSetupReading",
        readingPending: "bankSetupReadingPending",
        readingTimers: "bankSetupReadingTimers",
        editors: "bankSetupEditors",
        editorScopes: "bankSetupEditorScopes",
        refreshTimer: "bankSetupRefreshTimer",
        keySlots: "bankSetupKeySlots",
      },
      setTimeout: (fn, ms) => (typeof plugin.bankSetTimeout === "function"
        ? plugin.bankSetTimeout(fn, ms)
        : setTimeout(fn, ms)),
      clearTimeout: (id) => {
        if (typeof plugin.bankClearTimeout === "function") plugin.bankClearTimeout(id);
      },
      pathOf: bankSetupHubPath,
      readingRoot: (el) => plugin.bankSetupReadingRoot(el),
      readingScope: (root) => plugin.bankSetupReadingScope(root),
      acceptReading: (el, ctx) => Boolean(
        el && ctx?.sourcePath && !notebookInsideCode?.(el) && bankSetupIsHubPath(ctx.sourcePath),
      ),
      paintReading: (el, path) => plugin.paintBankSetupReading(el, path),
      removeReading: (root, scope, path) => plugin.bankSetupRemoveReading(root, scope, path),
      onResolveSurface: (widget, root) => {
        if (!root) plugin.bankSetupRemoveStrays(widget.el, widget.path);
      },
      afterRefreshReading: () => plugin.bankSetupSyncSurfaces(),
      livePath: (view) => plugin.bankSetupLivePath(view),
      sourcePath: (view) => plugin.bankSetupSourcePath(view),
      viewPath: (view) => plugin.bankSetupLivePath(view) || plugin.bankSetupSourcePath(view),
      buildDecorations: (view, update) => plugin.buildBankSetupDecorations(view, update),
      shouldRebuild: (update) => {
        if (!editorLivePreviewField || !update?.startState || !update?.state) return false;
        try { return update.startState.field(editorLivePreviewField) !== update.state.field(editorLivePreviewField); }
        catch (_) { return false; }
      },
      cleanEditor: (view) => plugin.bankSetupCleanEditor(view),
      ownKeys: (scope, path) => plugin.bankSetupOwnKeys(scope, path),
      releaseKeys: (scope, path) => plugin.bankSetupReleaseKeys(scope, path),
      onSetup: () => {
        if (!(plugin.bankSetupExpanded instanceof Map)) plugin.bankSetupExpanded = new Map();
        if (!(plugin.bankSetupSurfaces instanceof Set)) plugin.bankSetupSurfaces = new Set();
        if (!(plugin.bankSetupLintCache instanceof Map)) plugin.bankSetupLintCache = new Map();
        try { propertyCardFrontmatterCoordinatorBind?.(plugin, "bank"); } catch (_) {}
        try { plugin.bankSetupFootBind?.(); } catch (_) {}
        plugin.bankSetupFoldUnregister = typeof propertyCardRegisterFoldKind === "function"
          ? propertyCardRegisterFoldKind(plugin, "bank", {
            toggle(path) {
              plugin.bankSetupToggleExpanded(path);
              return true;
            },
          })
          : null;
        if (plugin.bankSetupDesktop()) {
          try {
            plugin.bankSetupUnsubscribe = plugin.apiBankSubscribe
              ? plugin.apiBankSubscribe({ command: "config" }, (state) => {
                plugin.bankSetupLastState = state;
                plugin.bankSetupNoteReport(state);
                plugin.scheduleBankSetupRefresh();
              })
              : null;
          } catch (error) {
            plugin.bankSetupUnsubscribe = null;
          }
        } else {
          plugin.bankSetupUnsubscribe = null;
        }
      },
      onDisposeStart: () => {
        try {
          if (typeof plugin.bankSetupFoldUnregister === "function") plugin.bankSetupFoldUnregister();
        } catch (_) {}
        plugin.bankSetupFoldUnregister = null;
        try {
          for (const path of plugin.bankSetupExpanded?.keys?.() || []) {
            try { propertyCardFoldClearPendingReveal?.(path); } catch (_) {}
          }
        } catch (_) {}
        try { propertyCardFrontmatterCoordinatorReleaseKind?.(plugin, "bank"); } catch (_) {}
        try { plugin.bankSetupFootUnbind?.(); } catch (_) {}
        try {
          if (typeof plugin.bankSetupUnsubscribe === "function") plugin.bankSetupUnsubscribe();
        } catch (error) {}
        plugin.bankSetupUnsubscribe = null;
      },
      onDisposeEnd: () => {
        for (const scope of plugin.bankSetupSurfaces || []) {
          try { scope?.classList?.remove?.(BANK_SETUP_SURFACE_CLASS); } catch (error) {}
        }
        plugin.bankSetupSurfaces?.clear();
        plugin.bankSetupExpanded?.clear();
        plugin.bankSetupLintCache?.clear();
        plugin.bankSetupLastState = null;
      },
    });
    return this._bankPropertyCardHost;
  }

  setupBankSetup() {
    this.bankPropertyCardHost().setup();
  }

  teardownBankSetup() {
    this.bankPropertyCardHost().dispose();
  }

  bankSetupDesktop() {
    try {
      if (typeof albumHeaderIsDesktopPlatform === "function") {
        return albumHeaderIsDesktopPlatform();
      }
    } catch (error) {}
    try {
      return Boolean(typeof Platform !== "undefined" && Platform && Platform.isDesktopApp === true);
    } catch (error) {
      return false;
    }
  }

  bankSetupConfigKey() {
    try {
      return bankCacheKey(bankBuildArgs({ command: "config" }));
    } catch (error) {
      return null;
    }
  }

  bankSetupEntry() {
    try {
      const state = this.bankSetupLastState;
      const key = this.bankSetupConfigKey();
      if (!state || !key || !state.results) {
        return { report: null, stale: false, error: null, refreshing: false };
      }
      const entry = state.results[key];
      if (!entry) {
        return { report: null, stale: false, error: null, refreshing: false };
      }
      return {
        report: entry.report || null,
        stale: entry.stale === true,
        error: entry.error || null,
        refreshing: entry.refreshing === true,
      };
    } catch (error) {
      return { report: null, stale: false, error: null, refreshing: false };
    }
  }

  bankSetupNoteReport(state) {
    try {
      const key = this.bankSetupConfigKey();
      const entry = key && state && state.results ? state.results[key] : null;
      if (entry && entry.report) {
        this.bankSetupLastGoodAt = Date.now();
      }
    } catch (error) {}
  }

  bankSetupExpandedMap() {
    if (!(this.bankSetupExpanded instanceof Map)) this.bankSetupExpanded = new Map();
    return this.bankSetupExpanded;
  }

  bankSetupIsExpanded(sourcePath, model) {
    const key = bankSetupHubPath(sourcePath);
    const map = this.bankSetupExpandedMap();
    let probe = model;
    try {
      if (!probe) {
        const entry = this.bankSetupEntry();
        probe = bankSetupModel(entry.report, {
          error: entry.error,
          stale: entry.stale,
          refreshing: entry.refreshing,
          desktop: this.bankSetupDesktop(),
          expanded: false,
          lastGoodAt: this.bankSetupLastGoodAt,
          lastGoodLabel: bankSetupClockLabel(this.bankSetupLastGoodAt),
        });
      }
    } catch (_) {
      probe = model || null;
    }
    const problems = probe && typeof probe.problems === "string"
      ? probe.problems
      : bankSetupFoldProblems(probe || { state: "valid", findings: [] });
    let stored = key ? map.get(key) : null;
    if (typeof stored === "boolean") {
      stored = { open: stored === true, problems: "" };
    }
    const restamped = typeof propertyCardFoldRestamp === "function"
      ? propertyCardFoldRestamp(stored, problems)
      : stored;
    if (key && restamped !== stored && restamped) {
      map.set(key, restamped);
    }
    let foldDefault = false;
    try {
      foldDefault = propertyCardSpecies?.("bank")?.foldDefault === true;
    } catch (_) {
      foldDefault = false;
    }
    return typeof propertyCardFoldResolve === "function"
      ? propertyCardFoldResolve({ choice: restamped, problems, foldDefault })
      : Boolean(restamped && restamped.open);
  }

  bankSetupSetExpanded(sourcePath, expanded, problems) {
    const key = bankSetupHubPath(sourcePath);
    if (!key) {
      return;
    }
    let signature = problems;
    if (typeof signature !== "string") {
      try {
        signature = this.bankSetupModelFor(sourcePath)?.problems || "";
      } catch (_) {
        signature = "";
      }
    }
    const choice = typeof propertyCardFoldChoice === "function"
      ? propertyCardFoldChoice(expanded === true, signature || "")
      : { open: expanded === true, problems: signature || "" };
    this.bankSetupExpandedMap().set(key, choice);
    this.refreshBankSetupReading();
    this.refreshBankSetupEditors();
  }

  bankSetupModelFor(sourcePath) {
    try {
      const entry = this.bankSetupEntry();
      const desktop = this.bankSetupDesktop();
      const lastGoodLabel = bankSetupClockLabel(this.bankSetupLastGoodAt);
      const baseOptions = {
        error: entry.error,
        stale: entry.stale,
        refreshing: entry.refreshing,
        desktop,
        lastGoodAt: this.bankSetupLastGoodAt,
        lastGoodLabel,
      };
      let probe = null;
      try {
        probe = bankSetupModel(entry.report, { ...baseOptions, expanded: false });
      } catch (_) {
        probe = null;
      }
      const expanded = this.bankSetupIsExpanded(sourcePath, probe);
      if (probe && probe.expanded === expanded) {
        return probe;
      }
      return bankSetupModel(entry.report, { ...baseOptions, expanded });
    } catch (error) {
      return null;
    }
  }

  bankSetupToggleExpanded(sourcePath) {
    try {
      const key = bankSetupHubPath(sourcePath);
      if (!key) {
        return;
      }
      const model = this.bankSetupModelFor(sourcePath);
      const open = Boolean(model && model.expanded);
      const problems = model && typeof model.problems === "string" ? model.problems : "";
      this.bankSetupSetExpanded(sourcePath, !open, problems);
    } catch (error) {}
  }

  bankSetupOptions(sourcePath, model, surface = "reading") {
    const self = this;
    let keyLive = false;
    try {
      keyLive = typeof propertyCardFoldKeyLive === "function"
        ? propertyCardFoldKeyLive(self, surface) === true
        : false;
    } catch (_) {
      keyLive = false;
    }
    let hue = null;
    try {
      hue = typeof self.bankSetupTitleHue === "function" ? self.bankSetupTitleHue(sourcePath) : null;
    } catch (_) {
      hue = null;
    }
    return {
      sourcePath,
      hue,
      expanded: Boolean(model && model.expanded),
      desktop: this.bankSetupDesktop(),
      keyLive,
      handlers: {
        onToggle: () => self.bankSetupToggleExpanded(sourcePath),
        onYaml: () => {
          if (self.bankSetupDesktop()) {
            void self.bankSetupStartYamlExcursion({ sourcePath, line: model && model.line, fromCard: false });
          } else {
            void self.bankSetupJumpYaml(sourcePath, model && model.line);
          }
        },
        onSetup: () => { void self.openBankSetupCard({ sourcePath }); },
        onKicker: (target, event) => { void self.bankSetupKickerOpen(target, sourcePath, event); },
        onJump: (line) => {
          void self.bankSetupJumpYaml(
            sourcePath,
            Number.isInteger(line) && line > 0 ? line : model && model.line,
          );
        },
        onCopyStarter: () => self.bankSetupCopyStarter(model && model.starter),
        onRetry: () => {
          try {
            if (typeof self.apiBankRefresh === "function") {
              void self.apiBankRefresh({ command: "config" });
            }
          } catch (error) {}
        },
      },
    };
  }

  async bankSetupCopyStarter(starter) {
    const value = typeof starter === "string" && starter ? starter : "";
    if (!value) {
      return { ok: false, reason: "no starter" };
    }
    try {
      const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : null;
      if (clipboard && typeof clipboard.writeText === "function") {
        await clipboard.writeText(value);
        try {
          new Notice("Starter copied — paste it into bank.md frontmatter.");
        } catch (error) {}
        return { ok: true };
      }
    } catch (error) {}
    try {
      new Notice("Clipboard is unavailable.");
    } catch (error) {}
    return { ok: false, reason: "clipboard unavailable" };
  }

  bankSetupMarkdownLeaf(path) {
    const target = bankSetupHubPath(path);
    if (!target) {
      return null;
    }
    try {
      const leaves = this.app?.workspace?.getLeavesOfType?.("markdown") || [];
      return leaves.find((leaf) => bankSetupHubPath(leaf?.view?.file?.path) === target)
        || this.app?.workspace?.getMostRecentLeaf?.()
        || this.app?.workspace?.activeLeaf
        || null;
    } catch (error) {
      return null;
    }
  }

  async bankSetupJumpYaml(sourcePath, line) {
    const path = bankSetupIsHubPath(sourcePath) ? bankSetupHubPath(sourcePath) : BANK_SETUP_HUB_PATH;
    if (!path) {
      return { ok: false, reason: "missing path" };
    }
    const targetLine = Number.isInteger(line) && line > 0 ? line : 1;
    try {
      const file = this.app?.vault?.getAbstractFileByPath?.(path) || { path };
      const leaf = this.bankSetupMarkdownLeaf(path);
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
      } else if (this.app?.workspace?.openLinkText) {
        await this.app.workspace.openLinkText(path.replace(/\.md$/i, ""), path, false);
      }
      const editor = leaf?.view?.editor;
      const cursorLine = targetLine - 1;
      if (editor && typeof editor.setCursor === "function") {
        editor.setCursor({ line: cursorLine, ch: 0 });
        if (typeof editor.scrollIntoView === "function") {
          editor.scrollIntoView({ from: { line: cursorLine, ch: 0 }, to: { line: cursorLine, ch: 0 } }, true);
        }
      }
      return { ok: true, line: targetLine };
    } catch (error) {
      try {
        new Notice("Could not open bank setup in Source mode.");
      } catch (noticeError) {}
      return { ok: false, reason: "source jump failed" };
    }
  }

  bankSetupReadingRoot(el) {
    return propertyCardReadingRoot(el);
  }

  bankSetupReadingScope(root) {
    return propertyCardReadingScope(root);
  }

  bankSetupNodeBelongs(node, root) {
    return propertyCardNodeBelongs(node, root);
  }

  bankSetupReleaseKeys(scope, sourcePath = "") {
    try { propertyCardSlotRelease(this.bankSetupKeySlots, scope, bankSetupHubPath(sourcePath)); } catch (error) {}
  }

  bankSetupOwnKeys(scope, sourcePath = "") {
    if (!(this.bankSetupKeySlots instanceof Map)) this.bankSetupKeySlots = new Map();
    try { return propertyCardSlotOwn(this.bankSetupKeySlots, scope, bankSetupHubPath(sourcePath), propertyCardOwnBankKeys(scope, this.bankSetupDesktop?.())); } catch (_) { return null; }
  }

  bankSetupRemoveReading(root, scope = root, sourcePath = "") {
    this.bankSetupReleaseFrontmatter(scope, sourcePath);
    if (!root) {
      return;
    }
    this.bankSetupReleaseAdoption(scope, sourcePath, { preserveFallback: true });
    try { this.bankSetupTrackFoot?.(scope, sourcePath, null); } catch (_) {}
    for (const node of Array.from(root.querySelectorAll?.(`.${BANK_SETUP_CLASS}`) || [])) {
      if (!this.bankSetupNodeBelongs(node, root)) {
        continue;
      }
      const ownedPath = bankSetupHubPath(node.getAttribute?.("data-bank-setup-source") || "");
      if (sourcePath && ownedPath && ownedPath !== bankSetupHubPath(sourcePath)) {
        continue;
      }
      try {
        node.remove?.();
      } catch (error) {
        try {
          node.parentNode?.removeChild?.(node);
        } catch (childError) {}
      }
    }
    this.bankSetupReleaseKeys(scope, sourcePath);
    const anotherOwner = Array.from(this.bankSetupReading || []).some((item) =>
      item.surface === root && item.scope && item.scope.classList
      && item.surface.querySelector?.(`.${BANK_SETUP_CLASS}`));
    if (!anotherOwner) {
      try {
        scope?.classList?.remove?.(BANK_SETUP_SURFACE_CLASS);
      } catch (error) {}
      try {
        this.bankSetupSurfaces?.delete(scope);
      } catch (error) {}
    }
  }

  bankSetupReadingAnchor(root) {
    try {
      const headings = Array.from(root?.querySelectorAll?.("h1") || []);
      const inside = typeof notebookInsideCode === "function" ? notebookInsideCode : null;
      return headings.find((node) => !(inside && inside(node))) || null;
    } catch (error) {
      return null;
    }
  }

  bankSetupBuildReading(model, options, doc) {
    try {
      const header = bankSetupBuildEl(model, options, doc);
      if (!header) {
        return null;
      }
      const extra = options.footExtra || (typeof this.bankSetupFootExtra === "function"
        ? this.bankSetupFootExtra(options.sourcePath)
        : null);
      header.setAttribute?.("data-bank-setup-source", options.sourcePath);
      header.setAttribute?.("data-bank-setup-signature", typeof this.bankSetupFootSignature === "function"
        ? this.bankSetupFootSignature(model, extra, options)
        : model.signature);
      try {
        const hue = (options && options.hue)
          || (typeof this.bankCardRootHue === "function" ? this.bankCardRootHue(options.sourcePath) : null);
        if (hue) {
          header.setAttribute?.("data-root-hue", hue);
        }
      } catch (error) {}
      this.bankSetupAppendFoot?.(header, options.sourcePath, doc, extra?.footSpec);
      return header;
    } catch (error) {
      return null;
    }
  }

  // Body placement (fallback): today's spot right after the first non-code
  // H1, else the start of the root. A node already there stays put.
  bankSetupPlaceInBody(root, header) {
    const anchor = this.bankSetupReadingAnchor(root);
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

  paintBankSetupReading(el, sourcePath) {
    const root = this.bankSetupReadingRoot(el);
    const scope = this.bankSetupReadingScope(root);
    if (!root || !bankSetupIsHubPath(sourcePath)) {
      return null;
    }
    // Remove old reading chrome stranded in editor callout chunks, while
    // leaving the legitimate slot mount and other sources alone.
    this.bankSetupRemoveStrays(root, sourcePath);
    let card = null;
    try {
      card = this.bankSetupCardFor(sourcePath);
    } catch (_) {
      card = null;
    }
    const reading = scope?.classList?.contains?.("markdown-preview-view")
      ? propertyCardReadingViewFor(this.app, scope)
      : null;
    const leafPath = reading ? reading.currentPath() : "";
    // A stale binding for a note this leaf no longer shows paints nothing.
    if (!card || !card.model || (leafPath && leafPath !== sourcePath)) {
      this.bankSetupRemoveReading(root, scope, sourcePath);
      return null;
    }
    const doc = (typeof notebookDomDoc === "function" ? notebookDomDoc(root) : null)
      || (typeof document !== "undefined" ? document : null);
    const adopted = typeof propertyCardAdoptedEntry === "function" ? propertyCardAdoptedEntry(scope) : null;
    const slotNode = adopted && adopted.path === sourcePath && adopted.kind === "bank" && adopted.mode === "slot" ? adopted.node : null;
    const bodyNodes = this.bankSetupBodyNodes(root, sourcePath, slotNode);
    let header = slotNode || bodyNodes[0] || null;
    const active = doc?.activeElement;
    const focusKey = active && header?.contains?.(active)
      ? active.getAttribute?.("data-bank-setup-focus") : "";
    const extra = typeof this.bankSetupFootExtra === "function"
      ? this.bankSetupFootExtra(sourcePath, this.bankSetupFootCard(card))
      : null;
    const options = {
      ...this.bankSetupOptions(sourcePath, card.model, "reading"),
      footExtra: extra,
      identity: card.identity,
    };
    const signature = JSON.stringify([typeof this.bankSetupFootSignature === "function"
      ? this.bankSetupFootSignature(card.model, extra, options)
      : (card.model && card.model.signature), bankSetupIdentityDigest(card.identity)]);
    if (!header || bankSetupNodeSignatures.get(header) !== signature) {
      let fresh = null;
      try {
        fresh = this.bankSetupBuildReading(card.model, options, doc);
      } catch (_) {
        fresh = null;
      }
      if (!fresh) {
        this.bankSetupRemoveReading(root, scope, sourcePath);
        return null;
      }
      // The body joins (or the title changes) inside the same node.
      header = header ? this.bankSetupPatchAdopted(header, fresh) : fresh;
      bankSetupNodeSignatures.set(header, signature);
    }
    for (const node of bodyNodes) {
      if (node === header) continue;
      try {
        node.remove?.();
      } catch (_) {
        try { node.parentNode?.removeChild?.(node); } catch (_) {}
      }
    }
    try {
      scope?.classList?.add?.(BANK_SETUP_SURFACE_CLASS);
      this.bankSetupSurfaces?.add?.(scope);
    } catch (_) {}
    const desktop = this.bankSetupDesktop();
    const adoption = desktop
      ? this.bankSetupAdoptTitle(scope, header, sourcePath, card.identity, {
        view: reading?.view || null,
        currentPath: reading?.currentPath || null,
      })
      : { mode: "fallback", release: () => {} };
    if (adoption.mode !== "slot") {
      this.bankSetupReleaseFrontmatter(scope, sourcePath);
      try {
        this.bankSetupPlaceInBody(root, header);
      } catch (_) {
        this.bankSetupRemoveReading(root, scope, sourcePath);
        return null;
      }
    } else {
      this.bankSetupOwnMountedFrontmatter(
        scope, reading?.view || null, sourcePath, header,
        this.bankSetupSourceCache?.get?.(bankSetupHubPath(sourcePath)),
        reading?.currentPath || (() => sourcePath),
      );
    }
    if (focusKey) {
      try {
        const next = header.querySelector?.(`[data-bank-setup-focus="${focusKey}"]`);
        next?.focus?.({ preventScroll: true });
      } catch (_) {}
    }
    this.bankSetupOwnKeys(scope, sourcePath);
    try { this.bankSetupTrackFoot?.(scope, sourcePath, header); } catch (_) {}
    try { this.bankSetupEnsureSource?.(sourcePath); } catch (_) {}
    return header;
  }

  renderBankSetupInReading(el, ctx) {
    this.bankPropertyCardHost().renderInReading(el, ctx);
  }

  bankSetupBindReading(el, ctx, root) {
    return this.bankPropertyCardHost().bindReading(el, ctx, root);
  }

  refreshBankSetupReading() {
    this.bankPropertyCardHost().refreshReading();
  }

  bankSetupLivePath(view) {
    try {
      if (typeof this.notebookHeaderLivePath === "function") {
        return this.notebookHeaderLivePath(view);
      }
      if (typeof this.notebookCatalogLivePath === "function") {
        return this.notebookCatalogLivePath(view);
      }
    } catch (error) {}
    return null;
  }

  bankSetupSourcePath(view) {
    try {
      const leaves = this.app?.workspace?.getLeavesOfType?.("markdown") || [];
      for (const leaf of leaves) {
        try {
          if (leaf?.view?.editor?.cm === view) {
            const path = leaf?.view?.file?.path;
            return typeof path === "string" && path ? path : null;
          }
        } catch (error) {}
      }
    } catch (error) {}
    return null;
  }

  // Source-mode lint state. Fresh findings win on every new report
  // (fingerprint change); between reports, marks map through edits and drop
  // from edited lines. The report always reflects saved bytes.
  bankSetupLintState(view) {
    const path = this.bankSetupSourcePath(view);
    if (!path || !bankSetupIsHubPath(path)) {
      return null;
    }
    if (this.bankSetupLivePath(view)) {
      return null;
    }
    if (!(this.bankSetupLintCache instanceof Map)) {
      this.bankSetupLintCache = new Map();
    }
    const entry = this.bankSetupEntry();
    const findings = entry.report && Array.isArray(entry.report.findings) ? entry.report.findings : [];
    const fresh = bankSetupLintMarks(findings);
    const fingerprint = entry.report && entry.report.fingerprint ? entry.report.fingerprint : "nofp";
    let text = null;
    try {
      text = view?.state?.doc ? String(view.state.doc.toString()) : null;
    } catch (error) {
      text = null;
    }
    const previous = this.bankSetupLintCache.get(path);
    if (!previous || previous.fingerprint !== fingerprint) {
      this.bankSetupLintCache.set(path, { fingerprint, text, marks: fresh });
      return { path, marks: fresh };
    }
    if (text === null || text === previous.text) {
      return { path, marks: previous.marks };
    }
    const deltas = bankSetupLintDeltas(previous.text || "", text);
    const mapped = bankSetupMapFindingLines(previous.marks, deltas);
    this.bankSetupLintCache.set(path, { fingerprint, text, marks: mapped });
    return { path, marks: mapped };
  }

  buildBankSetupDecorations(view) {
    try {
      if (!Decoration || !RangeSetBuilder || !WidgetType) {
        return Decoration?.none || null;
      }
      if (!view?.state?.doc) {
        this.bankSetupReleaseFrontmatter(view?.dom);
        this.bankSetupReleaseAdoptionOnScope(view);
        this.bankSetupSetEditorScope(view, false);
        this.bankSetupReleaseKeys(view?.dom);
        return Decoration.none;
      }
      const livePath = this.bankSetupLivePath(view);
      if (livePath && bankSetupIsHubPath(livePath)) {
        return this.bankSetupLiveDecorations(view, livePath);
      }
      const lint = this.bankSetupLintState(view);
      if (!lint) {
        this.bankSetupReleaseFrontmatter(view?.dom);
        this.bankSetupReleaseAdoptionOnScope(view);
        this.bankSetupSetEditorScope(view, false);
        this.bankSetupReleaseKeys(view?.dom);
        return Decoration.none;
      }
      // Source mode: the slot card, title ownership, keys, and foot release
      // explicitly, so a mode flip never leaves a hidden H1 or a stranded
      // slot card. Lint marks still paint through the branch below.
      this.bankSetupReleaseAdoptionOnScope(view);
      this.bankSetupReleaseFrontmatter(view?.dom);
      this.bankSetupReleaseKeys(view?.dom);
      try { this.bankSetupTrackFoot?.(view?.dom, this.bankSetupSourcePath(view), null); } catch (_) {}
      return this.bankSetupLintDecorations(view, lint);
    } catch (error) {
      try { this.bankSetupReleaseFrontmatter(view?.dom); } catch (_) {}
      return Decoration?.none || null;
    }
  }

  bankSetupLiveDecorations(view, livePath) {
    const text = view.state.doc.toString();
    try { this.bankSetupRememberSource?.(livePath, text); } catch (_) {}
    let card = null;
    try {
      card = this.bankSetupCardFor(livePath, text);
    } catch (_) {
      card = null;
    }
    this.bankSetupSetEditorScope(view, Boolean(card && card.model));
    if (!card || !card.model) {
      this.bankSetupReleaseFrontmatter(view?.dom, livePath);
      try { this.bankSetupTrackFoot?.(view?.dom, livePath, null); } catch (_) {}
      this.bankSetupReleaseAdoption(view?.dom, livePath);
      this.bankSetupReleaseKeys(view?.dom);
      return Decoration.none;
    }
    const doc = (typeof notebookDomDoc === "function" ? notebookDomDoc(view.dom) : null)
      || (typeof document !== "undefined" ? document : null);
    const adopted = typeof propertyCardAdoptedEntry === "function" ? propertyCardAdoptedEntry(view.dom) : null;
    let header = adopted && adopted.path === livePath && adopted.kind === "bank" && adopted.mode === "slot" ? adopted.node : null;
    const extra = typeof this.bankSetupFootExtra === "function"
      ? this.bankSetupFootExtra(livePath, this.bankSetupFootCard(card))
      : null;
    const options = {
      ...this.bankSetupOptions(livePath, card.model, "live-preview"),
      footSpec: extra?.footSpec,
      identity: card.identity,
    };
    const signature = JSON.stringify([typeof this.bankSetupFootSignature === "function"
      ? this.bankSetupFootSignature(card.model, extra, options)
      : (card.model && card.model.signature), bankSetupIdentityDigest(card.identity)]);
    if (!header || bankSetupNodeSignatures.get(header) !== signature) {
      const fresh = this.bankSetupBuildReading(card.model, options, doc);
      if (!fresh) {
        this.bankSetupReleaseFrontmatter(view?.dom, livePath);
        try { this.bankSetupTrackFoot?.(view?.dom, livePath, null); } catch (_) {}
        this.bankSetupReleaseAdoption(view?.dom, livePath);
        this.bankSetupReleaseKeys(view?.dom);
        return Decoration.none;
      }
      if (header) this.bankSetupPatchLive(view, adopted, fresh, signature);
      else {
        header = fresh;
        bankSetupNodeSignatures.set(header, signature);
      }
    }
    const desktop = this.bankSetupDesktop();
    const adoption = desktop
      ? this.bankSetupAdoptTitle(view.dom, header, livePath, card.identity, {
        view,
        currentPath: () => propertyCardLiveCurrentPath(view),
      })
      : { mode: "fallback", release: () => {} };
    // Native Properties live under the CodeMirror editor (view.dom), not the
    // .markdown-source-view that carries the surface class.
    this.bankSetupOwnKeys(view?.dom, livePath);
    try { this.bankSetupTrackFoot?.(view?.dom, livePath, header); } catch (_) {}
    if (adoption.mode === "slot") {
      this.bankSetupOwnMountedFrontmatterDeferred(view.dom, view, livePath, header, text,
        () => this.bankSetupLivePath(view) || "");
      return Decoration.none;
    }
    this.bankSetupReleaseFrontmatter(view?.dom, livePath);

    // Fallback: today's inline widget at the end of the first `# ` line.
    // When the Area adapter owns bank.md's title slot, the literal H1 line is
    // hidden with that title. Place Bank Setup after frontmatter so its body
    // remains visible below the Area card instead of inside the hidden title.
    const anchor = arbitration.owner ? -1 : (this.notebookHeaderLiveAnchor?.(text) ?? -1);
    const frontmatterEnd = this.notebookHeaderFrontmatterEnd?.(text) ?? -1;
    const plugin = this;
    const widget = new class extends WidgetType {
      constructor() {
        super();
        this.path = livePath;
        this.signature = signature;
      }
      eq(other) { return Boolean(other && other.path === this.path && other.signature === this.signature); }
      toDOM() {
        header.setAttribute?.("data-cm-widget", "true");
        header.setAttribute?.("data-bank-setup-source", livePath);
        plugin.bankSetupOwnMountedFrontmatterDeferred?.(
          view.dom, view, livePath, header, text,
          () => plugin.bankSetupLivePath(view) || "",
        );
        return header;
      }
    }();
    let at = 0;
    const side = 1;
    if (anchor >= 0) {
      at = view.state.doc.line(anchor + 1).to;
    } else if (frontmatterEnd >= 0) {
      const nextLine = frontmatterEnd + 2;
      at = nextLine <= (view.state.doc.lines || 0)
        ? view.state.doc.line(nextLine).from
        : (view.state.doc.length || 0);
    }
    const builder = new RangeSetBuilder();
    builder.add(at, at, Decoration.widget({ widget, side }));
    return builder.finish();
  }

  bankSetupLintDecorations(view, lint) {
    const enabled = lint.marks.length > 0;
    this.bankSetupSetEditorScope(view, true);
    if (!enabled) {
      return Decoration.none;
    }
    const doc = view.state.doc;
    const builder = new RangeSetBuilder();
    for (const mark of lint.marks) {
      try {
        const line = doc.line(mark.line);
        if (!line) {
          continue;
        }
        const tone = mark.severity === "warning" ? "warning" : "error";
        builder.add(
          line.from,
          line.to,
          Decoration.mark({
            class: `bob-bank-setup-lint-${tone}`,
            attributes: { title: mark.tooltip },
          }),
        );
        const endWidget = new class extends WidgetType {
          eq(other) {
            return Boolean(other && other.markLine === mark.line && other.markText === mark.message);
          }
          toDOM() {
            const span = typeof document !== "undefined" && document
              ? document.createElement("span")
              : null;
            if (!span) {
              return span;
            }
            span.className = `bob-bank-setup-lint-note is-${tone}`;
            span.textContent = mark.message;
            span.setAttribute("aria-label", mark.tooltip);
            return span;
          }
        }();
        endWidget.markLine = mark.line;
        endWidget.markText = mark.message;
        builder.add(line.to, line.to, Decoration.widget({ widget: endWidget, side: 1 }));
      } catch (error) {}
    }
    return builder.finish();
  }

  bankSetupSetEditorScope(view, enabled) {
    const livePath = this.bankSetupLivePath(view);
    const sourcePath = livePath || this.bankSetupSourcePath(view);
    const hub = Boolean(sourcePath && bankSetupIsHubPath(sourcePath));
    const on = enabled && hub;
    this.bankPropertyCardHost().setEditorScope(view, on, {
      scopeOf: (root) => {
        try {
          return root.closest?.(".markdown-source-view") || root.closest?.(".markdown-preview-view") || root;
        } catch (error) {
          return root;
        }
      },
      mark: (scope) => {
        scope?.classList?.add?.(BANK_SETUP_SURFACE_CLASS);
        this.bankSetupSurfaces?.add?.(scope);
      },
      unmark: (scope) => {
        scope?.classList?.remove?.(BANK_SETUP_SURFACE_CLASS);
        this.bankSetupSurfaces?.delete(scope);
      },
    });
  }

  bankSetupCleanEditor(view) {
    try { this.bankSetupTrackFoot?.(view?.dom, this.bankSetupLivePath(view), null); } catch (_) {}
    this.bankSetupReleaseAdoptionOnScope(view);
    this.bankPropertyCardHost().cleanEditor(view, {
      unmark: (scope) => {
        scope?.classList?.remove?.(BANK_SETUP_SURFACE_CLASS);
        this.bankSetupSurfaces?.delete(scope);
      },
    });
  }

  bankSetupSyncSurfaces() {
    try {
      for (const scope of Array.from(this.bankSetupSurfaces || [])) {
        if (!scope) {
          this.bankSetupSurfaces.delete(scope);
          continue;
        }
        let owned = false;
        try {
          owned = Boolean(scope.querySelector?.(`.${BANK_SETUP_CLASS}`));
        } catch (error) {
          owned = false;
        }
        const tracked = Array.from(this.bankSetupEditorScopes?.values?.() || []).includes(scope)
          || Array.from(this.bankSetupReading || []).some((item) => item.scope === scope);
        if (!owned && !tracked) {
          try {
            scope.classList?.remove?.(BANK_SETUP_SURFACE_CLASS);
          } catch (error) {}
          this.bankSetupSurfaces.delete(scope);
        }
      }
    } catch (error) {}
  }

  createBankSetupExtension() {
    return this.bankPropertyCardHost().createExtension();
  }

  refreshBankSetupEditors() {
    this.bankPropertyCardHost().refreshEditors();
  }

  scheduleBankSetupRefresh() {
    this.bankPropertyCardHost().scheduleRefresh();
  }
}
