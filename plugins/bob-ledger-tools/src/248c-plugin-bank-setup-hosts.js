// Report-driven Bank Setup headers in Reading view and Live Preview, plus
// Source-mode config lint. The only editor decorations are widgets; no
// Markdown or frontmatter is rewritten. One header per hub surface, mounted
// after the first H1 exactly where the album header mounts.

function bankSetupClockLabel(timestamp) {
  try {
    if (!Number.isFinite(timestamp)) {
      return null;
    }
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const suffix = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    if (hours === 0) {
      hours = 12;
    }
    return `${hours}:${minutes} ${suffix}`;
  } catch (error) {
    return null;
  }
}

class BobLedgerToolsBankSetupMixin {
  bankPropertyCardHost() {
    if (this._bankPropertyCardHost) return this._bankPropertyCardHost;
    const plugin = this;
    this._bankPropertyCardHost = createPropertyCardHost({
      plugin,
      kind: "bank",
      readingPriority: 47,
      allowEmbedDisplay: true,
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
      afterRefreshReading: () => plugin.bankSetupSyncSurfaces(),
      livePath: (view) => plugin.bankSetupLivePath(view),
      sourcePath: (view) => plugin.bankSetupSourcePath(view),
      viewPath: (view) => plugin.bankSetupLivePath(view) || plugin.bankSetupSourcePath(view),
      buildDecorations: (view) => plugin.buildBankSetupDecorations(view),
      cleanEditor: (view) => plugin.bankSetupCleanEditor(view),
      ownKeys: (scope, path) => plugin.bankSetupOwnKeys(scope, path),
      releaseKeys: (scope, path) => plugin.bankSetupReleaseKeys(scope, path),
      onSetup: () => {
        if (!(plugin.bankSetupExpanded instanceof Map)) plugin.bankSetupExpanded = new Map();
        if (!(plugin.bankSetupSurfaces instanceof Set)) plugin.bankSetupSurfaces = new Set();
        if (!(plugin.bankSetupLintCache instanceof Map)) plugin.bankSetupLintCache = new Map();
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

  bankSetupModelFor(sourcePath) {
    try {
      const entry = this.bankSetupEntry();
      const expandedMap = this.bankSetupExpanded instanceof Map
        ? this.bankSetupExpanded
        : new Map();
      const key = bankSetupHubPath(sourcePath);
      return bankSetupModel(entry.report, {
        error: entry.error,
        stale: entry.stale,
        refreshing: entry.refreshing,
        desktop: this.bankSetupDesktop(),
        expanded: (key && expandedMap.has(key)) ? expandedMap.get(key) === true : BANK_SETUP_DEFAULT_EXPANDED,
        lastGoodAt: this.bankSetupLastGoodAt,
        lastGoodLabel: bankSetupClockLabel(this.bankSetupLastGoodAt),
      });
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
      if (!(this.bankSetupExpanded instanceof Map)) {
        this.bankSetupExpanded = new Map();
      }
      const model = this.bankSetupModelFor(sourcePath);
      this.bankSetupExpanded.set(key, model && model.expanded === true ? false : true);
      this.refreshBankSetupReading();
      this.refreshBankSetupEditors();
    } catch (error) {}
  }

  bankSetupOptions(sourcePath, model) {
    const self = this;
    return {
      sourcePath,
      expanded: Boolean(model && model.expanded),
      desktop: this.bankSetupDesktop(),
      handlers: {
        onToggle: () => self.bankSetupToggleExpanded(sourcePath),
        onYaml: () => {
          if (self.bankSetupDesktop()) {
            void self.bankSetupStartYamlExcursion({ sourcePath, line: model && model.line, fromCard: false });
          } else {
            void self.bankSetupJumpYaml(sourcePath, model && model.line);
          }
        },
        onEdit: () => { void self.openBankSetupCard({ sourcePath }); },
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
    if (!root) {
      return;
    }
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
      const header = bankSetupBuildEl(model, options.handlers, doc);
      if (!header) {
        return null;
      }
      header.setAttribute?.("data-bank-setup-source", options.sourcePath);
      header.setAttribute?.("data-bank-setup-signature", model.signature);
      try {
        const hue = typeof this.bankCardRootHue === "function"
          ? this.bankCardRootHue(options.sourcePath)
          : null;
        if (hue) {
          header.setAttribute?.("data-root-hue", hue);
        }
      } catch (error) {}
      return header;
    } catch (error) {
      return null;
    }
  }

  paintBankSetupReading(el, sourcePath) {
    const root = this.bankSetupReadingRoot(el);
    const scope = this.bankSetupReadingScope(root);
    if (!root || !bankSetupIsHubPath(sourcePath)) {
      return null;
    }
    let model = null;
    try {
      model = this.bankSetupModelFor(sourcePath);
    } catch (error) {
      model = null;
    }
    const doc = (typeof notebookDomDoc === "function" ? notebookDomDoc(root) : null)
      || (typeof document !== "undefined" ? document : null);
    const old = Array.from(root.querySelectorAll?.(`.${BANK_SETUP_CLASS}`) || [])
      .find((node) => this.bankSetupNodeBelongs(node, root));
    const active = doc?.activeElement;
    const focusKey = active && old?.contains?.(active)
      ? active.getAttribute?.("data-bank-setup-focus") : "";
    if (old && model && old.getAttribute?.("data-bank-setup-signature") === model.signature
      && old.getAttribute?.("data-bank-setup-source") === bankSetupHubPath(sourcePath)) {
      this.bankSetupOwnKeys(scope, sourcePath);
      return old;
    }
    this.bankSetupRemoveReading(root, scope, sourcePath);
    if (!model) {
      return null;
    }
    try {
      scope?.classList?.add?.(BANK_SETUP_SURFACE_CLASS);
      this.bankSetupSurfaces?.add?.(scope);
    } catch (error) {}
    const options = this.bankSetupOptions(sourcePath, model);
    let header = null;
    try {
      header = this.bankSetupBuildReading(model, options, doc);
    } catch (error) {
      header = null;
    }
    if (!header) {
      this.bankSetupReleaseKeys(scope);
      try {
        scope?.classList?.remove?.(BANK_SETUP_SURFACE_CLASS);
      } catch (error) {}
      return null;
    }
    const anchor = this.bankSetupReadingAnchor(root);
    try {
      if (anchor?.parentNode?.insertBefore) {
        anchor.parentNode.insertBefore(header, anchor.nextSibling || null);
      } else if (root.insertBefore) {
        root.insertBefore(header, root.firstChild || null);
      } else {
        root.prepend?.(header);
      }
    } catch (error) {
      this.bankSetupReleaseKeys(scope);
      return null;
    }
    if (focusKey) {
      try {
        const next = header.querySelector?.(`[data-bank-setup-focus="${focusKey}"]`);
        next?.focus?.({ preventScroll: true });
      } catch (error) {}
    }
    this.bankSetupOwnKeys(scope, sourcePath);
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
        this.bankSetupSetEditorScope(view, false);
        return Decoration.none;
      }
      const livePath = this.bankSetupLivePath(view);
      if (livePath && bankSetupIsHubPath(livePath)) {
        return this.bankSetupLiveDecorations(view, livePath);
      }
      const lint = this.bankSetupLintState(view);
      if (!lint) {
        this.bankSetupSetEditorScope(view, false);
        return Decoration.none;
      }
      return this.bankSetupLintDecorations(view, lint);
    } catch (error) {
      return Decoration?.none || null;
    }
  }

  bankSetupLiveDecorations(view, livePath) {
    const text = view.state.doc.toString();
    const model = this.bankSetupModelFor(livePath);
    this.bankSetupSetEditorScope(view, Boolean(model));
    if (!model) {
      this.bankSetupReleaseKeys(view?.dom);
      return Decoration.none;
    }
    const doc = (typeof notebookDomDoc === "function" ? notebookDomDoc(view.dom) : null)
      || (typeof document !== "undefined" ? document : null);
    const options = this.bankSetupOptions(livePath, model);
    const header = this.bankSetupBuildReading(model, options, doc);
    if (!header) {
      this.bankSetupReleaseKeys(view?.dom);
      return Decoration.none;
    }
    // Native Properties live under the CodeMirror editor (view.dom), not the
    // .markdown-source-view that carries the surface class.
    this.bankSetupOwnKeys(view?.dom, livePath);
    const anchor = this.notebookHeaderLiveAnchor?.(text) ?? -1;
    const frontmatterEnd = this.notebookHeaderFrontmatterEnd?.(text) ?? -1;
    const widget = new class extends WidgetType {
      constructor() {
        super();
        this.path = livePath;
        this.signature = bankSetupSignature(model, {
          expanded: options.expanded,
          desktop: options.desktop,
        });
      }
      eq(other) {
        return Boolean(other && other.path === this.path && other.signature === this.signature);
      }
      toDOM() {
        header.setAttribute?.("data-cm-widget", "true");
        header.setAttribute?.("data-bank-setup-source", livePath);
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

// Line-shift deltas between two document texts, for lint-mark mapping.
// Pure and testable: each delta marks the 1-based line where saved bytes
// changed, with the net line-count shift below it.
function bankSetupLintDeltas(beforeText, afterText) {
  const before = String(beforeText === null || beforeText === undefined ? "" : beforeText).split("\n");
  const after = String(afterText === null || afterText === undefined ? "" : afterText).split("\n");
  if (before.join("\n") === after.join("\n")) {
    return [];
  }
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) {
    suffix += 1;
  }
  return [{
    fromLine: prefix + 1,
    delta: (after.length - suffix) - (before.length - suffix),
  }];
}
