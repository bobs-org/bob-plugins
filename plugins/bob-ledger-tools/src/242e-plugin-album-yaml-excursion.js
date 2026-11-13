// Pane-scoped YAML excursion with validated Done (schema-entrypoints).
// `y` still closes the card and focuses the exact field/issue line; this
// fragment adds the per-leaf excursion record (album path, original view
// state, selected key, session identity) and the small accessible Done
// affordance for that album's Source surface. Source mode lacks the regular
// header, so Done has an explicit mount/cleanup lifecycle outside the note
// text. Done awaits editor save, forces a current report, and only returns
// to the prior view/reopens the card when bob reports a valid schema.
function albumYamlErrorFocus(model) {
  const issues = Array.isArray(model?.issues) ? model.issues : [];
  const error = issues.find((issue) => issue && issue.severity === "error") || null;
  if (!error) return null;
  const line = Number.isInteger(error.line) && error.line > 0 ? error.line : null;
  const message = String(error.message || "The album schema has errors.");
  const suggestions = (Array.isArray(error.suggestions) ? error.suggestions : [])
    .map((item) => String(item || "")).filter(Boolean);
  return { line, message, suggestions, code: String(error.code || "") };
}

function albumYamlDoneDecision(input = {}) {
  if (!input.save || input.save.ok !== true) {
    const code = input.save && input.save.code ? String(input.save.code) : "save-failed";
    return {
      ok: false, reason: code === "save-unsupported" ? "save-unsupported" : "save-failed",
      message: (input.save && input.save.message) || "Saving the album pane failed — fix it before Done.",
    };
  }
  const state = input.reportState || null;
  const generation = Number.isInteger(state?.generation) ? state.generation : null;
  const reportGeneration = Number.isInteger(state?.reportGeneration) ? state.reportGeneration : generation;
  if (!state || !state.report || state.unavailable === true || state.stale === true || state.refreshing === true || state.error ||
      (generation !== null && reportGeneration !== generation)) {
    return { ok: false, reason: "unavailable", message: "Album data is unavailable — fix sync before Done." };
  }
  const model = input.model || null;
  if (!model) {
    return { ok: false, reason: "unavailable", message: "That album is no longer available — it may have been deleted or retyped." };
  }
  const focus = albumYamlErrorFocus(model);
  if (focus) {
    const hint = focus.suggestions.length ? ` Suggestions: ${focus.suggestions.join(" ")}` : "";
    return {
      ok: false, reason: "schema-errors", focus,
      message: `${focus.message}${hint}`,
    };
  }
  return { ok: true, reason: "valid" };
}

function albumYamlDoneButtonDoc(host) {
  try {
    if (host && host.ownerDocument) return host.ownerDocument;
  } catch (_) {}
  try {
    if (typeof document !== "undefined") return document;
  } catch (_) {}
  return null;
}

function albumYamlBuildDoneEl(doc, albumPath) {
  if (!doc || typeof doc.createElement !== "function") return null;
  let button = null;
  try {
    button = doc.createElement("button");
  } catch (_) {
    return null;
  }
  if (!button) return null;
  button.setAttribute("type", "button");
  button.setAttribute("class", "bob-album-yaml-done");
  button.setAttribute("data-album-yaml-done", albumPath || "");
  button.setAttribute("aria-label", "Done editing album schema");
  try {
    button.textContent = "Done";
  } catch (_) {}
  return button;
}

class BobLedgerToolsAlbumYamlExcursionMixin {
  setupAlbumYamlExcursion() {
    this.albumYamlExcursionDisposed = false;
    if (!(this.albumYamlExcursions instanceof Map)) this.albumYamlExcursions = new Map();
    if (this.albumYamlExcursionWired) return;
    this.albumYamlExcursionWired = true;
    try {
      const workspace = this.app?.workspace;
      if (workspace && typeof workspace.on === "function" && typeof this.registerEvent === "function") {
        this.registerEvent(workspace.on("file-open", (file) => {
          try { this.albumYamlExcursionHandleFileOpen(file); } catch (_) {}
        }));
        this.registerEvent(workspace.on("active-leaf-change", (leaf) => {
          try { this.albumYamlExcursionHandleLeafChange(leaf); } catch (_) {}
        }));
        this.registerEvent(workspace.on("layout-change", () => {
          try { this.albumYamlExcursionPruneClosedLeaves(); } catch (_) {}
        }));
      }
    } catch (_) {}
  }

  teardownAlbumYamlExcursion() {
    this.albumYamlExcursionDisposed = true;
    try {
      for (const leaf of Array.from(this.albumYamlExcursions?.keys?.() || [])) {
        try { this.albumYamlExcursionClear(leaf); } catch (_) {}
      }
    } catch (_) {}
    if (this.albumYamlExcursions instanceof Map) this.albumYamlExcursions.clear();
    this.albumYamlExcursionWired = false;
  }

  albumYamlExcursionLeafKey(leaf) {
    return leaf || null;
  }

  albumYamlExcursionForLeaf(leaf) {
    if (!leaf || !(this.albumYamlExcursions instanceof Map)) return null;
    return this.albumYamlExcursions.get(leaf) || null;
  }

  albumYamlExcursionStillCurrent(leaf, record) {
    if (this.albumYamlExcursionDisposed === true || !leaf || !record ||
        this.albumYamlExcursionForLeaf(leaf) !== record) return false;
    let path = "";
    try {
      path = leaf?.view?.file?.path
        ? (typeof albumHeaderPath === "function" ? albumHeaderPath(leaf.view.file.path) : String(leaf.view.file.path))
        : "";
    } catch (_) {}
    return Boolean(path && path === record.albumPath);
  }

  albumYamlSaveExcursionEditors(paths) {
    return typeof albumSchemaSaveOpenEditors === "function"
      ? albumSchemaSaveOpenEditors(this, paths)
      : Promise.resolve({ ok: true });
  }

  albumYamlExcursionActiveLeaf() {
    try {
      return this.app?.workspace?.activeLeaf || null;
    } catch (_) {
      return null;
    }
  }

  albumYamlExcursionBegin(leaf, details = {}) {
    if (!leaf) return null;
    if (!(this.albumYamlExcursions instanceof Map)) this.albumYamlExcursions = new Map();
    const albumPath = typeof albumHeaderPath === "function" ? albumHeaderPath(details.albumPath || "") : String(details.albumPath || "");
    if (!albumPath) return null;
    try { this.albumYamlExcursionClear(leaf); } catch (_) {}
    const record = {
      albumPath,
      viewState: details.viewState || null,
      selectedKey: typeof details.selectedKey === "string" ? details.selectedKey : "stats",
      fingerprint: typeof details.fingerprint === "string" ? details.fingerprint : "",
      startedAt: Date.now(),
      doneEl: null,
      container: null,
      completionPromise: null,
    };
    this.albumYamlExcursions.set(leaf, record);
    this.albumYamlExcursionMount(leaf, record);
    return record;
  }

  albumYamlExcursionMount(leaf, record) {
    if (!leaf || !record) return null;
    let container = null;
    try {
      container = leaf.view?.containerEl || leaf.containerEl || null;
    } catch (_) {
      container = null;
    }
    let doc = null;
    try {
      doc = container?.ownerDocument || (typeof document !== "undefined" ? document : null);
    } catch (_) {
      doc = null;
    }
    if (!doc && typeof document !== "undefined") {
      try { doc = document; } catch (_) {}
    }
    const el = albumYamlBuildDoneEl(doc || albumYamlDoneButtonDoc(container), record.albumPath);
    if (!el) return null;
    try {
      el.addEventListener?.("click", (event) => {
        try { event.preventDefault?.(); } catch (_) {}
        void this.albumYamlDone({ leaf });
      });
    } catch (_) {}
    try {
      if (container && typeof container.appendChild === "function") container.appendChild(el);
      else if (doc?.body && typeof doc.body.appendChild === "function") { doc.body.appendChild(el); container = doc.body; }
      else return null;
    } catch (_) {
      return null;
    }
    record.doneEl = el;
    record.container = container;
    return el;
  }

  albumYamlExcursionClear(leaf) {
    if (!leaf || !(this.albumYamlExcursions instanceof Map)) return false;
    const record = this.albumYamlExcursions.get(leaf);
    if (!record) return false;
    try {
      const el = record.doneEl;
      if (el) {
        if (typeof el.remove === "function") el.remove();
        else if (el.parentNode && typeof el.parentNode.removeChild === "function") el.parentNode.removeChild(el);
      }
    } catch (_) {}
    try {
      this.albumYamlExcursions.delete(leaf);
    } catch (_) {}
    return true;
  }

  albumYamlExcursionHandleFileOpen(file) {
    if (!(this.albumYamlExcursions instanceof Map)) return;
    const openPath = file && file.path
      ? (typeof albumHeaderPath === "function" ? albumHeaderPath(file.path) : String(file.path))
      : "";
    for (const [leaf, record] of Array.from(this.albumYamlExcursions.entries())) {
      try {
        const leafPath = leaf?.view?.file?.path
          ? (typeof albumHeaderPath === "function" ? albumHeaderPath(leaf.view.file.path) : String(leaf.view.file.path))
          : openPath;
        if (openPath && leafPath && openPath !== record.albumPath && leafPath !== record.albumPath) {
          this.albumYamlExcursionClear(leaf);
        } else if (!openPath && !leafPath) {
          this.albumYamlExcursionClear(leaf);
        }
      } catch (_) {}
    }
  }

  albumYamlExcursionHandleLeafChange() {
    try {
      this.albumYamlExcursionPruneClosedLeaves();
    } catch (_) {}
  }

  albumYamlExcursionPruneClosedLeaves() {
    if (!(this.albumYamlExcursions instanceof Map)) return;
    let live = null;
    try {
      live = this.app?.workspace?.getLeavesOfType?.("markdown") || null;
    } catch (_) {
      live = null;
    }
    if (!Array.isArray(live)) return;
    const liveSet = new Set(live);
    for (const leaf of Array.from(this.albumYamlExcursions.keys())) {
      if (!liveSet.has(leaf)) {
        try { this.albumYamlExcursionClear(leaf); } catch (_) {}
      }
    }
  }

  async albumYamlDone(options = {}) {
    const leaf = options.leaf || this.albumYamlExcursionActiveLeaf();
    if (!leaf) {
      try { new Notice("No active album pane for Done."); } catch (_) {}
      return { ok: false, reason: "missing-leaf" };
    }
    const record = this.albumYamlExcursionForLeaf(leaf);
    if (!record) {
      try { new Notice("No album YAML excursion in this pane."); } catch (_) {}
      return { ok: false, reason: "missing-excursion" };
    }
    if (record.completionPromise) return record.completionPromise;
    const completion = this.albumYamlDoneAttempt(leaf, record);
    record.completionPromise = completion;
    try {
      return await completion;
    } finally {
      if (record.completionPromise === completion) record.completionPromise = null;
    }
  }

  async albumYamlDoneAttempt(leaf, record) {
    if (!this.albumYamlExcursionStillCurrent(leaf, record)) return { ok: false, reason: "stale-excursion" };
    let save = { ok: true };
    try {
      save = await this.albumYamlSaveExcursionEditors([record.albumPath]);
    } catch (error) {
      save = { ok: false, code: "save-failed", message: String((error && error.message) || error) };
    }
    if (!this.albumYamlExcursionStillCurrent(leaf, record)) return { ok: false, reason: "stale-excursion" };
    if (!save || save.ok !== true) {
      try { new Notice(save?.message || "Saving the album pane failed — fix it before Done."); } catch (_) {}
      return { ok: false, reason: save?.code || "save-failed" };
    }
    let reportState = null;
    try {
      if (typeof this.apiAlbumReport === "function") {
        // A vault event can advance the generation while the forced list is
        // running. In that case its waiter can receive a report that is
        // already stale by the time it resolves; join a fresh flight before
        // deciding whether Done may return to the card.
        for (let attempt = 0; attempt < 3; attempt += 1) {
          reportState = await this.apiAlbumReport({ force: true, wait: true });
          const generation = Number.isInteger(reportState?.generation) ? reportState.generation : null;
          const reportGeneration = Number.isInteger(reportState?.reportGeneration)
            ? reportState.reportGeneration
            : generation;
          if (reportState?.report && reportState.unavailable !== true
              && reportState.stale !== true && reportState.refreshing !== true
              && !reportState.error
              && (generation === null || reportGeneration >= generation)) break;
          if (!this.albumYamlExcursionStillCurrent(leaf, record)) return { ok: false, reason: "stale-excursion" };
        }
      } else {
        reportState = typeof this.albumReportState === "function" ? this.albumReportState() : null;
      }
    } catch (_) {
      reportState = null;
    }
    if (!this.albumYamlExcursionStillCurrent(leaf, record)) return { ok: false, reason: "stale-excursion" };
    let model = null;
    try {
      model = typeof this.albumHeaderModelFor === "function" ? this.albumHeaderModelFor(record.albumPath, reportState) : null;
    } catch (_) {
      model = null;
    }
    const decision = albumYamlDoneDecision({ save: { ok: true }, reportState, model });
    if (!decision.ok) {
      if (decision.reason === "schema-errors" && decision.focus) {
        try {
          const editor = leaf?.view?.editor;
          const line = Number.isInteger(decision.focus.line) && decision.focus.line > 0 ? decision.focus.line - 1 : 0;
          if (editor && typeof editor.setCursor === "function") {
            editor.setCursor({ line, ch: 0 });
            if (typeof editor.scrollIntoView === "function") {
              editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
            }
          }
        } catch (_) {}
      }
      try { new Notice(decision.message); } catch (_) {}
      return { ok: false, reason: decision.reason, focus: decision.focus || null };
    }
    if (!this.albumYamlExcursionStillCurrent(leaf, record)) return { ok: false, reason: "stale-excursion" };
    let restoreError = null;
    try {
      const prior = record.viewState;
      if (prior && typeof leaf.setViewState === "function") {
        await leaf.setViewState(prior);
      } else if (prior && prior.state && typeof leaf.openFile === "function") {
        const file = this.app?.vault?.getAbstractFileByPath?.(record.albumPath) || { path: record.albumPath };
        await leaf.openFile(file, { state: { ...(prior.state || {}), file: record.albumPath } });
      }
    } catch (error) {
      restoreError = error;
    }
    if (!this.albumYamlExcursionStillCurrent(leaf, record)) return { ok: false, reason: "stale-excursion" };
    if (restoreError) {
      return { ok: false, reason: "restore-failed", message: String(restoreError.message || restoreError) };
    }
    try { this.albumYamlExcursionClear(leaf); } catch (_) {}
    try {
      const fresh = typeof this.albumHeaderModelFor === "function" ? this.albumHeaderModelFor(record.albumPath) : model;
      const target = fresh || model;
      if (target) {
        const opened = this.openAlbumSchemaCard?.(target, record.albumPath);
        if (opened && opened.modal && record.selectedKey) {
          try {
            if (typeof opened.modal.schemaSelect === "function") opened.modal.schemaSelect(record.selectedKey);
            else { opened.modal.selectedKey = record.selectedKey; }
          } catch (_) {}
        }
        return { ok: true, reopened: true };
      }
    } catch (_) {}
    return { ok: true, reopened: false };
  }
}
