// Shared USED BEFORE band for Obsidian text fields. The host owns its input,
// preview, submit, and Esc behavior; this controller only fills that input.
const LOG_RECALL_KIND_META = Object.freeze({
  schedule: { emoji: "🗓️", label: "Schedule" },
  work: { emoji: "🛠️", label: "Work" },
  rotten: { emoji: "🥀", label: "Rotten" },
  cancel: { emoji: "❌", label: "Cancel" },
});

function getNavigationLogHistoryApi(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const holder = plugins && plugins["bob-ledger-tools"];
    const logs = holder && holder.api && holder.api.logs;
    return logs && Number(logs.version) >= 1 && typeof logs.fetch === "function" && typeof logs.snapshot === "function" ? logs : null;
  } catch (_error) {
    return null;
  }
}

function getNavigationLogRecallApi(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const holder = plugins && plugins["bob-navigation-hotkeys"];
    const api = holder && holder.api && holder.api.logRecall;
    return api && Number(api.version) >= 1 && typeof api.attach === "function" ? api : null;
  } catch (_error) {
    return null;
  }
}

function noteNavigationLogRecallUsed(app, kind, text) {
  try {
    const value = String(text == null ? "" : text).replace(/\s+/gu, " ").trim();
    if (!value) return false;
    const api = getNavigationLogRecallApi(app);
    return api && typeof api.noteUsed === "function"
      ? api.noteUsed(kind, value) === true
      : false;
  } catch (_error) {
    return false;
  }
}

function logRecallCreateElement(parent, tag, cls, text) {
  if (!parent) return null;
  let element = null;
  try {
    if (tag === "span" && typeof parent.createSpan === "function") element = parent.createSpan({ cls, text });
    else if (tag === "button" && typeof parent.createEl === "function") element = parent.createEl(tag, { cls, text });
    else if (typeof parent.createDiv === "function") element = parent.createDiv({ cls, text });
    else if (typeof parent.createEl === "function") element = parent.createEl(tag, { cls, text });
  } catch (_error) {
    return null;
  }
  return element;
}

function logRecallAddClass(element, name, enabled) {
  try {
    if (element && element.classList && typeof element.classList.toggle === "function") element.classList.toggle(name, enabled);
    else if (element && enabled && typeof element.addClass === "function") element.addClass(name);
    else if (element && !enabled && typeof element.removeClass === "function") element.removeClass(name);
  } catch (_error) {}
}

function logRecallSetAttr(element, name, value) {
  try {
    if (element && typeof element.setAttribute === "function") element.setAttribute(name, String(value));
    else if (element && element.attr) element.attr[name] = String(value);
  } catch (_error) {}
}

function logRecallHighlight(row, text, query) {
  const source = String(text || "");
  const q = normalizeLogRecallQuery(query);
  const lower = source.normalize("NFC").toLowerCase();
  const index = q ? lower.indexOf(q) : -1;
  if (index < 0 || typeof row.createSpan !== "function") {
    row.textContent = source;
    return;
  }
  if (index > 0 && typeof row.appendText === "function") row.appendText(source.slice(0, index));
  const match = row.createSpan({ cls: "bob-log-recall-match", text: source.slice(index, index + q.length) });
  if (index + q.length < source.length && typeof row.appendText === "function") row.appendText(source.slice(index + q.length));
  if (!match) row.textContent = source;
}

function attachLogRecall(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const inputEl = opts.inputEl || null;
  const bandHost = opts.bandHost || null;
  const app = opts.app || (inputEl && inputEl.closest && inputEl.closest(".modal") && inputEl.closest(".modal").app) || null;
  const logsApi = opts.logsApi || getNavigationLogHistoryApi(app);
  const density = opts.density === "dense" ? "dense" : "roomy";
  const maxRows = Number.isInteger(opts.maxRows) ? Math.max(0, opts.maxRows) : null;
  let pinnedSlots = Number.isInteger(opts.pinnedSlots) && opts.pinnedSlots >= 0 ? Math.floor(opts.pinnedSlots) : null;
  let kind = LOG_RECALL_KIND_META[opts.kind] ? opts.kind : "work";
  let catalog = null;
  let pendingCatalog = null;
  let visibleLatch = false;
  let ownFill = false;
  let disposed = false;
  let fetchGeneration = 0;
  let unsubscribe = () => {};
  let scopeHandler = null;
  let state = logRecallInitialState({ kind, draft: inputEl && inputEl.value || "" });
  let currentRows = [];
  let totalForKind = 0;
  const id = `bob-log-recall-${Math.random().toString(36).slice(2, 10)}`;

  const readSnapshot = () => {
    try { return logsApi && typeof logsApi.snapshot === "function" ? logsApi.snapshot() : null; }
    catch (_error) { return null; }
  };
  const phraseRows = (source = catalog, query = state.draft) => {
    const log = source && Array.isArray(source.logs) ? source.logs.find((entry) => entry && entry.kind === kind) : null;
    if (!log) return [];
    const overlay = source && source.overlay ? source.overlay : [];
    return rankLogRecall(log, overlay, query, kind);
  };
  const setInputValue = (value) => {
    if (!inputEl) return;
    ownFill = true;
    try {
      inputEl.value = String(value == null ? "" : value);
      if (typeof inputEl.setSelectionRange === "function") inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
      if (typeof Event !== "undefined" && typeof inputEl.dispatchEvent === "function") {
        const EventClass = inputEl.ownerDocument && inputEl.ownerDocument.defaultView && inputEl.ownerDocument.defaultView.Event || Event;
        inputEl.dispatchEvent(new EventClass("input", { bubbles: true }));
      }
    } catch (_error) {
      try { inputEl.value = String(value == null ? "" : value); } catch (_ignored) {}
    } finally {
      ownFill = false;
    }
  };
  const refreshRows = () => {
    currentRows = phraseRows(catalog, state.draft);
    state = logRecallReduce(state, { type: "rows", rows: currentRows });
    const log = catalog && Array.isArray(catalog.logs) ? catalog.logs.find((entry) => entry && entry.kind === kind) : null;
    totalForKind = log ? logRecallMergePhrases(log, catalog.overlay || [], kind).length : 0;
  };
  const bump = (where) => {
    state = logRecallReduce(state, { type: "rows", rows: currentRows });
    state = { ...state, edge: where };
    if (bandHost) {
      logRecallAddClass(bandHost, "is-edge-bump", true);
      const schedule = typeof window !== "undefined" && typeof window.setTimeout === "function" ? window.setTimeout.bind(window) : setTimeout;
      schedule(() => logRecallAddClass(bandHost, "is-edge-bump", false), 120);
    }
    render();
  };
  const fillSelected = (row) => {
    if (!row) return;
    state = logRecallReduce(state, { type: "click", row });
    setInputValue(row.text);
    render();
    try {
      const live = bandHost && bandHost.querySelector && bandHost.querySelector(".bob-log-recall-live");
      if (live) live.textContent = `Recalled ${currentRows.findIndex((item) => item.key === row.key) + 1} of ${currentRows.length}: ${row.text}`;
    } catch (_error) {}
  };
  const render = () => {
    if (!bandHost || disposed) return;
    refreshRows();
    const denseReveal = density !== "dense" || visibleLatch || normalizeLogRecallQuery(state.draft).length >= 2;
    const visible = totalForKind > 0 && denseReveal;
    try { bandHost.empty(); } catch (_error) {
      while (bandHost.firstChild) bandHost.removeChild(bandHost.firstChild);
    }
    logRecallAddClass(bandHost, "bob-log-recall-band", visible);
    logRecallAddClass(bandHost, "is-hidden", !visible);
    if (!visible) {
      if (inputEl) {
        try { inputEl.removeAttribute("aria-controls"); inputEl.removeAttribute("aria-activedescendant"); } catch (_error) {}
      }
      return;
    }
    const cap = maxRows == null ? (density === "dense" ? 3 : 5) : maxRows;
    const autoSlots = Math.min(cap, Math.max(1, totalForKind));
    const slots = pinnedSlots == null ? autoSlots : Math.min(cap, Math.max(1, pinnedSlots));
    try { bandHost.style.setProperty("--bob-log-recall-slots", String(slots)); } catch (_error) {}
    const root = logRecallCreateElement(bandHost, "div", "bob-log-recall-inner");
    const meta = LOG_RECALL_KIND_META[kind];
    const header = logRecallCreateElement(root, "div", "bob-log-recall-header");
    let title = `${meta.emoji} USED BEFORE`;
    const selectedIndex = currentRows.findIndex((row) => row.key === state.selectedKey);
    if (state.mode === "recalling" && selectedIndex >= 0) {
      title += ` · ${selectedIndex + 1} of ${currentRows.length}`;
    } else if (normalizeLogRecallQuery(state.draft)) {
      title += currentRows.length ? ` · matching “${state.draft}”` : ` · no match for “${state.draft}”`;
    }
    logRecallCreateElement(header, "span", "bob-log-recall-title", title);
    const hints = logRecallCreateElement(header, "span", "bob-log-recall-hints");
    if (state.mode === "recalling" && selectedIndex >= 0) {
      const restore = state.draft ? `esc restores “${state.draft}”` : "esc clears";
      logRecallCreateElement(hints, "span", "bob-log-recall-hint", restore);
    } else if (currentRows.length) {
      logRecallCreateElement(hints, "span", "bob-log-recall-keycap", "⌃N");
      logRecallCreateElement(hints, "span", "bob-log-recall-keycap", "⌃P");
    }
    const list = logRecallCreateElement(root, "div", "bob-log-recall-rows");
    logRecallSetAttr(list, "id", id);
    logRecallSetAttr(list, "role", "listbox");
    logRecallSetAttr(list, "aria-label", `${meta.label} phrases used before`);
    for (let index = 0; index < slots; index += 1) {
      const row = currentRows[index];
      if (!row) {
        logRecallCreateElement(list, "div", "bob-log-recall-row is-empty");
        continue;
      }
      const rowId = `${id}-${index}`;
      const rowEl = logRecallCreateElement(list, "div", `bob-log-recall-row${state.mode === "recalling" && row.key === state.selectedKey ? " is-selected" : ""}`);
      logRecallSetAttr(rowEl, "id", rowId);
      logRecallSetAttr(rowEl, "role", "option");
      logRecallSetAttr(rowEl, "aria-selected", state.mode === "recalling" && row.key === state.selectedKey ? "true" : "false");
      const tooltip = `Last used ${row.last_used || "unknown"} · ${Number(row.uses) || 1} ${Number(row.uses) === 1 ? "use" : "uses"}`;
      logRecallSetAttr(rowEl, "title", tooltip);
      const textEl = logRecallCreateElement(rowEl, "span", "bob-log-recall-text");
      logRecallHighlight(textEl, row.text, state.draft);
      const age = formatLogRecallAge(row, kind === "work" ? "minute" : "day");
      logRecallCreateElement(rowEl, "span", "bob-log-recall-meta", `${Number(row.uses) || 1}× · ${age}`);
      if (rowEl && typeof rowEl.addEventListener === "function") {
        rowEl.addEventListener("mousedown", (event) => event.preventDefault());
        rowEl.addEventListener("click", () => fillSelected(row));
      }
    }
    const live = logRecallCreateElement(root, "span", "bob-log-recall-live");
    logRecallSetAttr(live, "aria-live", "polite");
    logRecallSetAttr(live, "role", "status");
    logRecallAddClass(live, "bob-log-recall-sr-only", true);
    if (inputEl) {
      logRecallSetAttr(inputEl, "aria-controls", id);
      if (state.mode === "recalling" && selectedIndex >= 0) logRecallSetAttr(inputEl, "aria-activedescendant", `${id}-${selectedIndex}`);
      else try { inputEl.removeAttribute("aria-activedescendant"); } catch (_error) {}
      logRecallAddClass(inputEl, "is-recalling", state.mode === "recalling");
    }
  };
  const inputListener = () => {
    if (ownFill || disposed || !inputEl) return;
    const text = String(inputEl.value || "");
    state = logRecallReduce(state, { type: "draft", text, rows: currentRows });
    if (density === "dense" && normalizeLogRecallQuery(text).length >= 2) visibleLatch = true;
    if (pendingCatalog && state.mode === "draft") { catalog = pendingCatalog; pendingCatalog = null; }
    render();
  };
  const restoreDraft = () => {
    const draft = state.draft;
    state = logRecallReduce(state, { type: "backOut" });
    if (pendingCatalog) { catalog = pendingCatalog; pendingCatalog = null; }
    setInputValue(draft);
    render();
    return true;
  };
  const handleKeydown = (event) => {
    if (!event || event.isComposing || event.shiftKey || event.altKey || event.metaKey) return false;
    const key = String(event.key || "").toLowerCase();
    let direction = 0;
    if (event.ctrlKey && (key === "n" || key === "p")) direction = key === "n" ? 1 : -1;
    else if (!event.ctrlKey && opts.arrowKeys !== false && (key === "arrowdown" || key === "arrowup")) direction = key === "arrowdown" ? 1 : -1;
    if (!direction) return false;
    const latest = readSnapshot();
    if (latest) {
      if (state.mode === "recalling") pendingCatalog = latest;
      else catalog = latest;
    }
    refreshRows();
    if (!catalog || totalForKind === 0) return false;
    if (density === "dense") visibleLatch = true;
    if (!currentRows.length) {
      bump("empty");
      return true;
    }
    if (direction > 0) {
      const before = state.selectedKey;
      state = logRecallReduce(state, { type: "next", rows: currentRows });
      if (state.edge === "bottom") { bump("bottom"); return true; }
      const selected = currentRows.find((row) => row.key === state.selectedKey);
      if (selected && (state.mode !== "recalling" || before !== state.selectedKey)) setInputValue(selected.text);
    } else {
      const wasRecalling = state.mode === "recalling";
      const before = state.selectedKey;
      state = logRecallReduce(state, { type: "previous", rows: currentRows });
      if (state.edge === "empty") { bump("empty"); return true; }
      if (state.mode === "draft" && wasRecalling) {
        if (pendingCatalog) { catalog = pendingCatalog; pendingCatalog = null; }
        setInputValue(state.draft);
      } else if (state.selectedKey !== before) {
        const selected = currentRows.find((row) => row.key === state.selectedKey);
        if (selected) setInputValue(selected.text);
      }
    }
    render();
    const selectedIndex = currentRows.findIndex((row) => row.key === state.selectedKey);
    const selected = currentRows[selectedIndex];
    if (selected) {
      try {
        const live = bandHost && bandHost.querySelector && bandHost.querySelector(".bob-log-recall-live");
        if (live) live.textContent = `Recalled ${selectedIndex + 1} of ${currentRows.length}: ${selected.text}`;
      } catch (_error) {}
    }
    return true;
  };
  const backOut = () => state.mode === "recalling" ? restoreDraft() : false;
  const captureKeydown = (event) => {
    const key = String(event && event.key || "").toLowerCase();
    const escChord = key === "escape" || (event && event.ctrlKey && key === "[");
    const consumed = escChord ? backOut() : handleKeydown(event);
    if (consumed) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    }
    return consumed;
  };
  const refreshFromApi = (snapshot) => {
    if (disposed) return;
    const next = snapshot || readSnapshot();
    if (!next) return;
    if (state.mode === "recalling") pendingCatalog = next;
    else catalog = next;
    render();
  };
  if (inputEl && typeof inputEl.addEventListener === "function") {
    inputEl.addEventListener("input", inputListener);
    if (opts.ownKeys === true) inputEl.addEventListener("keydown", captureKeydown, true);
  }
  if (opts.ownKeys === true && opts.scope && typeof opts.scope.register === "function") {
    try {
      scopeHandler = opts.scope.register(null, null, (event) => {
        try {
          const doc = inputEl && inputEl.ownerDocument;
          if (doc && doc.activeElement && doc.activeElement !== inputEl) return true;
          if (typeof document !== "undefined" && document.activeElement && document.activeElement !== inputEl) return true;
        } catch (_error) {}
        return captureKeydown(event) ? false : true;
      });
    } catch (_error) { scopeHandler = null; }
  }
  try {
    if (logsApi && typeof logsApi.onChange === "function") unsubscribe = logsApi.onChange(refreshFromApi) || (() => {});
  } catch (_error) { unsubscribe = () => {}; }
  catalog = readSnapshot();
  render();
  if (logsApi && typeof logsApi.fetch === "function") {
    const generation = ++fetchGeneration;
    Promise.resolve().then(() => logsApi.fetch()).then((result) => {
      if (disposed || generation !== fetchGeneration || !result) return;
      if (result.catalog) refreshFromApi(result.catalog);
    }).catch(() => {});
  }
  return {
    handleKeydown,
    backOut,
    isRecalling: () => state.mode === "recalling",
    setPinnedSlots(next) {
      pinnedSlots = Number.isInteger(next) && next >= 0 ? Math.floor(next) : null;
      render();
      return true;
    },
    setKind(nextKind) {
      if (!LOG_RECALL_KIND_META[nextKind]) return false;
      kind = nextKind;
      state = logRecallReduce(state, { type: "kind", kind, rows: [] });
      state.draft = String(inputEl && inputEl.value || "");
      visibleLatch = density === "dense" && normalizeLogRecallQuery(state.draft).length >= 2;
      catalog = readSnapshot() || catalog;
      render();
      return true;
    },
    detach() {
      if (disposed) return;
      disposed = true;
      fetchGeneration += 1;
      try { unsubscribe(); } catch (_error) {}
      if (inputEl && typeof inputEl.removeEventListener === "function") {
        inputEl.removeEventListener("input", inputListener);
        if (opts.ownKeys === true) inputEl.removeEventListener("keydown", captureKeydown, true);
      }
      try { if (scopeHandler && opts.scope && typeof opts.scope.unregister === "function") opts.scope.unregister(scopeHandler); } catch (_error) {}
      try { bandHost.empty(); } catch (_error) {}
      logRecallAddClass(inputEl, "is-recalling", false);
      if (inputEl) {
        try { inputEl.removeAttribute("aria-controls"); inputEl.removeAttribute("aria-activedescendant"); } catch (_error) {}
      }
    },
  };
}
