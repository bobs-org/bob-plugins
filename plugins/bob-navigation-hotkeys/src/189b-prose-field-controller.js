// Two-mode proseField controller (phase bob-cli-om.3). One keyboard owner
// for USED BEFORE and the LINK band. Insertion is undo-safe. Never writes
// the vault. Fail-open: a thrown matcher or missing index hides the band.

const attachLogRecallWithoutLinks = attachLogRecall;
attachLogRecall = function attachLogRecallWithLinks(options) {
  const opts = options && typeof options === "object" ? options : {};
  if (opts.links === true) {
    try {
      const handle = attachProseField({ ...opts, recall: opts.recall || opts.kind || null });
      if (handle) return handle;
    } catch (_error) {}
    const rest = { ...opts };
    delete rest.links;
    return attachLogRecallWithoutLinks(rest);
  }
  return attachLogRecallWithoutLinks(opts);
};

// logRecall.attach passes only `app`, so resolve nav's own plugin instance:
// one lazy index per plugin (listeners cleaned up through registerEvent),
// never a fresh vault walk per keystroke.
const PROSE_LINK_INDEX_BY_APP = new WeakMap();

function proseNavPluginFromApp(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const holder = plugins && plugins["bob-navigation-hotkeys"];
    return holder && typeof holder === "object" ? holder : null;
  } catch (_error) {
    return null;
  }
}

// nav's published proseField v1 namespace, or null (hosts then type plainly).
function getNavigationProseFieldApi(app) {
  try {
    const holder = proseNavPluginFromApp(app);
    const api = holder && holder.api && holder.api.proseField;
    return api && Number(api.version) >= 1 && typeof api.attach === "function" ? api : null;
  } catch (_error) {
    return null;
  }
}

// The one note every path names, else null (mixed, missing, or empty), so a
// multi-note prompt never guesses a home note for `[[#…`.
function proseSharedSourcePath(paths) {
  try {
    let shared = null;
    for (const value of Array.isArray(paths) ? paths : []) {
      const path = typeof value === "string" ? value.trim() : "";
      if (!path || (shared !== null && shared !== path)) return null;
      shared = path;
    }
    return shared;
  } catch (_error) {
    return null;
  }
}

function getProseLinkIndex(plugin, app) {
  try {
    const owner = plugin || proseNavPluginFromApp(app);
    if (owner && owner._bobProseLinkIndex) return owner._bobProseLinkIndex;
    const host = app || (owner && owner.app) || null;
    if (!owner && host && PROSE_LINK_INDEX_BY_APP.has(host)) return PROSE_LINK_INDEX_BY_APP.get(host);
    const index = createLinkIndex(host, owner);
    if (owner) owner._bobProseLinkIndex = index;
    else if (host && typeof host === "object") PROSE_LINK_INDEX_BY_APP.set(host, index);
    return index;
  } catch (_error) {
    return null;
  }
}

function proseOwnerDocument(inputEl) {
  try {
    if (inputEl && inputEl.ownerDocument) return inputEl.ownerDocument;
  } catch (_error) {}
  try { if (typeof document !== "undefined") return document; } catch (_ignored) {}
  return null;
}

function proseOwnerWindow(inputEl) {
  const doc = proseOwnerDocument(inputEl);
  try {
    if (doc && doc.defaultView) return doc.defaultView;
  } catch (_error) {}
  try { if (typeof window !== "undefined") return window; } catch (_ignored) {}
  return null;
}

function proseCreateChild(parent, cls) {
  if (!parent) return null;
  try {
    if (typeof parent.querySelector === "function") {
      const existing = parent.querySelector(`.${cls}`);
      if (existing) return existing;
    }
    if (parent.children && Array.isArray(parent.children)) {
      const found = parent.children.find((child) => child && child.classes && child.classes.includes(cls));
      if (found) return found;
    }
  } catch (_error) {}
  return logRecallCreateElement(parent, "div", cls);
}

function proseInsertText(inputEl, start, end, text) {
  if (!inputEl) return false;
  const inserted = String(text == null ? "" : text);
  const doc = proseOwnerDocument(inputEl);
  const win = proseOwnerWindow(inputEl);
  try {
    if (typeof inputEl.focus === "function") inputEl.focus();
  } catch (_error) {}
  try {
    if (typeof inputEl.setSelectionRange === "function") inputEl.setSelectionRange(start, end);
  } catch (_error) {}
  try {
    if (doc && typeof doc.execCommand === "function") {
      const ok = doc.execCommand("insertText", false, inserted);
      if (ok) return true;
    }
  } catch (_error) {}
  try {
    if (typeof inputEl.setRangeText === "function") {
      inputEl.setRangeText(inserted, start, end, "end");
      const EventClass = (win && (win.InputEvent || win.Event)) || (typeof InputEvent !== "undefined" ? InputEvent : Event);
      const event = EventClass
        ? new EventClass("input", { bubbles: true, inputType: "insertReplacementText" })
        : { type: "input", inputType: "insertReplacementText", bubbles: true };
      if (typeof inputEl.dispatchEvent === "function") inputEl.dispatchEvent(event);
      return true;
    }
  } catch (_error) {}
  return false;
}

function attachProseField(options) {
  const opts = options && typeof options === "object" ? options : {};
  let inputEl = opts.inputEl || null;
  let bandHost = opts.bandHost || null;
  const plugin = opts.plugin || null;
  const app = opts.app || (plugin && plugin.app) || null;
  const density = opts.density === "dense" ? "dense" : "roomy";
  const mode = opts.mode === "field" ? "field" : "inline";
  const ownKeys = opts.ownKeys === true;
  const arrowKeys = opts.arrowKeys !== false;
  const linksEnabled = opts.links !== false;
  const hintDelay = Number.isInteger(opts.hintDebounceMs) ? Math.max(0, opts.hintDebounceMs) : PROSE_HINT_DEBOUNCE_MS;
  const id = `bob-link-band-${Math.random().toString(36).slice(2, 10)}`;
  let sourcePathOpt = opts.sourcePath;
  let minOffsetOpt = opts.minOffset;
  let disposed = false;
  let composing = false;
  let swallowEnter = false;
  let fadePlayed = false;
  let linkOpen = false;
  let aliasStage = false;
  let field = null;
  let rows = [];
  let selectedKey = null;
  let dismissed = null;
  let edge = null;
  let previewToken = 0;
  let hintTimer = null;
  let hintMessages = [];
  let scopeHandler = null;
  let escapeScopeHandler = null;
  let recallHandle = null;
  let recallHost = null;
  let linkHost = null;
  let hintHost = null;
  let keyupBound = null;
  let selectionBound = null;
  const notesOverride = Array.isArray(opts.notes) ? opts.notes : null;
  const resolveOverride = typeof opts.resolveLink === "function" ? opts.resolveLink : null;
  const previewOverride = typeof opts.blockPreview === "function" ? opts.blockPreview : null;

  const sourcePathNow = () => proseResolveSourcePath(sourcePathOpt);
  const fieldOptions = () => ({
    sourcePath: sourcePathNow(),
    minOffset: minOffsetOpt,
    mode,
  });

  const ensureHosts = () => {
    if (!bandHost) return;
    recallHost = proseCreateChild(bandHost, "bob-prose-recall-slot");
    linkHost = proseCreateChild(bandHost, "bob-prose-link-slot");
    hintHost = proseCreateChild(bandHost, "bob-prose-hint-slot");
  };

  const notesNow = () => {
    if (notesOverride) return notesOverride;
    try {
      const index = opts.index || getProseLinkIndex(plugin, app);
      if (index && typeof index.getNotes === "function") return index.getNotes() || [];
    } catch (_error) {}
    return [];
  };

  const nearbyContext = () => {
    const sourcePath = sourcePathNow();
    return {
      nearbyIndex: notesNow(),
      sourcePath,
      parentPaths: opts.parentPaths || proseParentPaths(app, sourcePath),
      linkedPaths: opts.linkedPaths || proseLinkedPaths(app, sourcePath),
      recentPaths: opts.recentPaths || proseRecentPaths(app),
    };
  };

  const rankNow = (nextField, text) => {
    try {
      return proseRankRows(nextField, notesNow(), { ...nearbyContext(), text });
    } catch (_error) {
      return { rows: [], total: 0 };
    }
  };

  const bumpEdge = (where) => {
    edge = where;
    if (linkHost) {
      logRecallAddClass(linkHost, "is-edge-bump", true);
      const win = proseOwnerWindow(inputEl);
      const schedule = win && typeof win.setTimeout === "function" ? win.setTimeout.bind(win) : setTimeout;
      schedule(() => logRecallAddClass(linkHost, "is-edge-bump", false), 120);
    }
    renderLink();
  };

  const currentView = () => {
    const slots = density === "dense" ? PROSE_LINK_SLOTS_DENSE : PROSE_LINK_SLOTS_ROOMY;
    const selectedIndex = rows.length ? proseSelectedIndex(rows, selectedKey) : -1;
    const windowed = proseWindowRows(rows, Math.max(0, selectedIndex), slots);
    const selected = selectedIndex >= 0 ? rows[selectedIndex] : null;
    const sourcePath = sourcePathNow();
    return {
      open: linkOpen,
      aliasStage,
      field,
      rows,
      view: windowed.view,
      selectedKey,
      selectedIndex,
      total: rows.length,
      crumb: aliasStage ? "alias" : proseCrumb(field, selected),
      density,
      fadePlayed,
      listId: id,
      message: aliasStage ? "Type the label — ↵ finishes the link" : proseQuietMessage(field, rows, sourcePath),
      resultLink: aliasStage
        ? (inputEl && inputEl.value && field ? String(inputEl.value).slice(field.linkStart || 0) : "")
        : (selected && selected.resultLink) || "",
      onRowClick: (row) => acceptRow(row),
    };
  };

  const renderLink = () => {
    if (disposed) return;
    const view = currentView();
    try { renderProseLinkBand(linkHost, view); } catch (_error) {}
    try { proseBindInputAria(inputEl, view); } catch (_error) {}
    if (recallHost) logRecallAddClass(recallHost, "is-hidden", linkOpen === true);
    if (hintHost) logRecallAddClass(hintHost, "is-hidden", linkOpen === true || hintMessages.length === 0);
    if (linkOpen) fadePlayed = true;
  };

  const renderHint = () => {
    if (disposed) return;
    try { renderProseLinkHint(hintHost, linkOpen ? [] : hintMessages); } catch (_error) {}
  };

  const closeBand = (memory) => {
    if (!linkOpen && !aliasStage) return;
    if (memory && field) {
      dismissed = { opener: field.linkStart, query: field.query };
    } else if (!memory) {
      dismissed = null;
    }
    linkOpen = false;
    aliasStage = false;
    field = null;
    rows = [];
    selectedKey = null;
    renderLink();
    scheduleHint();
  };

  const openBand = (nextField, text, keepKey) => {
    field = nextField;
    aliasStage = false;
    const ranked = rankNow(nextField, text);
    rows = ranked.rows;
    if (keepKey && rows.some((row) => row.key === keepKey)) selectedKey = keepKey;
    else selectedKey = rows[0] ? rows[0].key : null;
    linkOpen = true;
    dismissed = null;
    renderLink();
    hydratePreviews();
  };

  const openAlias = (alias) => {
    field = alias;
    aliasStage = true;
    linkOpen = true;
    rows = [];
    selectedKey = null;
    dismissed = null;
    renderLink();
  };

  const readState = () => {
    if (!inputEl) return { text: "", caret: 0 };
    const text = String(inputEl.value || "");
    return { text, caret: proseReadCaret(inputEl) };
  };

  const considerOpen = (fromInput) => {
    if (disposed || !linksEnabled || composing) return;
    if (!proseCaretIsCollapsed(inputEl)) {
      if (linkOpen) closeBand(false);
      else scheduleHint();
      return;
    }
    const { text, caret } = readState();
    const alias = proseAliasAt(text, caret, { minOffset: minOffsetOpt });
    if (alias) {
      if (!fromInput && !linkOpen) {
        scheduleHint();
        return;
      }
      if (dismissed && dismissed.opener === alias.linkStart && dismissed.query === alias.query) return;
      openAlias(alias);
      return;
    }
    const next = proseFieldAt(text, caret, fieldOptions());
    if (!next) {
      if (linkOpen) closeBand(false);
      else scheduleHint();
      return;
    }
    if (!fromInput && !linkOpen) {
      scheduleHint();
      return;
    }
    if (dismissed && dismissed.opener === next.linkStart && dismissed.query === next.query) return;
    openBand(next, text, selectedKey);
  };

  // Only an Enter acceptance arms the held-Enter swallow; a Tab or click
  // acceptance must leave the next Enter free to submit the host.
  const acceptRow = (row, viaEnter) => {
    if (!row || !field || !inputEl) {
      closeBand(false);
      return true;
    }
    const applied = proseApplyInsert(String(inputEl.value || ""), field, row.replacement);
    const ok = proseInsertText(inputEl, applied.start, applied.end, applied.replacement);
    if (!ok) {
      try {
        inputEl.value = applied.text;
        if (typeof inputEl.setSelectionRange === "function") inputEl.setSelectionRange(applied.caret, applied.caret);
      } catch (_error) {}
    }
    if (viaEnter === true) swallowEnter = true;
    closeBand(false);
    return true;
  };

  const finishAlias = () => {
    const { text, caret } = readState();
    const alias = proseAliasAt(text, caret) || field;
    if (!alias) {
      closeBand(false);
      return true;
    }
    if (!alias.closed) {
      proseInsertText(inputEl, alias.innerEnd, alias.innerEnd, "]]");
    } else if (typeof inputEl.setSelectionRange === "function") {
      try { inputEl.setSelectionRange(alias.closeEnd, alias.closeEnd); } catch (_error) {}
    }
    swallowEnter = true;
    closeBand(false);
    return true;
  };

  const drill = (suffix) => {
    const selected = rows.find((row) => row && row.key === selectedKey);
    if (!selected || !field) return false;
    const target = String(selected.insert || "").split("|")[0];
    if (!target) return false;
    const applied = proseApplyInsert(String(inputEl.value || ""), field, `${target}${suffix}`);
    proseInsertText(inputEl, applied.start, applied.end, applied.replacement);
    return true;
  };

  const moveSelection = (direction) => {
    if (!rows.length) {
      bumpEdge("empty");
      return true;
    }
    const index = proseSelectedIndex(rows, selectedKey);
    const next = index + direction;
    if (next < 0) {
      bumpEdge("top");
      return true;
    }
    if (next >= rows.length) {
      bumpEdge("bottom");
      return true;
    }
    selectedKey = rows[next].key;
    edge = null;
    renderLink();
    return true;
  };

  const handleLinkKey = (event) => {
    if (!event) return false;
    if (event.isComposing || composing) return false;
    const key = String(event.key || "");
    const lower = key.toLowerCase();
    if ((event.altKey || event.metaKey) && lower !== "enter") return false;
    if (event.shiftKey && lower !== "enter" && lower !== "tab") return false;
    if (lower === "arrowdown" || (event.ctrlKey && lower === "n")) {
      if (event.ctrlKey && lower === "n" || (arrowKeys && !event.ctrlKey)) return moveSelection(1);
    }
    if (lower === "arrowup" || (event.ctrlKey && lower === "p")) {
      if (event.ctrlKey && lower === "p" || (arrowKeys && !event.ctrlKey)) return moveSelection(-1);
    }
    if (lower === "tab" && event.shiftKey) return false;
    if (lower === "tab") {
      if (!rows.length) return false;
      return acceptRow(rows.find((row) => row.key === selectedKey) || rows[0]);
    }
    if (lower === "enter") {
      const isTextarea = String(inputEl && inputEl.tagName || "").toLowerCase() === "textarea";
      if (event.shiftKey && isTextarea) {
        closeBand(false);
        return false;
      }
      if (aliasStage) return finishAlias();
      if (!rows.length) {
        closeBand(false);
        return true;
      }
      return acceptRow(rows.find((row) => row.key === selectedKey) || rows[0], true);
    }
    if (key === "#" && field && field.context === LINK_CONTEXT_NOTE && field.query && selectedKey) {
      return drill("#");
    }
    if (key === "^" && field && field.context === LINK_CONTEXT_NOTE && field.query && selectedKey) {
      return drill("#^");
    }
    if (key === "|" && field && field.context === LINK_CONTEXT_NOTE && selectedKey) {
      return drill("|");
    }
    if (lower === "arrowleft" || lower === "arrowright" || lower === "home" || lower === "end") {
      return false;
    }
    if (lower === "q") return false;
    return false;
  };

  const handleKeydown = (event) => {
    if (disposed || !event) return false;
    if (event.isComposing || composing) return false;
    const key = String(event.key || "");
    if (swallowEnter && key === "Enter") return true;
    if (linkOpen) return handleLinkKey(event);
    if (recallHandle && typeof recallHandle.handleKeydown === "function") {
      try { if (recallHandle.handleKeydown(event)) return true; } catch (_error) {}
    }
    return false;
  };

  const backOut = () => {
    if (linkOpen || aliasStage) {
      closeBand(true);
      return true;
    }
    if (recallHandle && typeof recallHandle.backOut === "function") {
      try { if (recallHandle.backOut()) return true; } catch (_error) {}
    }
    return false;
  };

  const captureKeydown = (event) => {
    const key = String(event && event.key || "").toLowerCase();
    const escChord = key === "escape" || (event && event.ctrlKey && !event.altKey && !event.metaKey && key === "[");
    const consumed = escChord ? backOut() : handleKeydown(event);
    if (consumed) {
      try { event.preventDefault(); } catch (_error) {}
      try { event.stopPropagation(); } catch (_error) {}
      try {
        if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      } catch (_error) {}
    }
    return consumed;
  };

  const onKeyup = (event) => {
    if (event && event.key === "Enter") swallowEnter = false;
    if (disposed) return;
    const key = String(event && event.key || "").toLowerCase();
    if (key === "arrowleft" || key === "arrowright" || key === "home" || key === "end") {
      considerOpen(false);
    }
  };

  const onInput = (event) => {
    if (disposed) return;
    const type = event && event.inputType;
    const blocked = !type
      || type === "insertFromPaste"
      || type === "insertFromDrop"
      || type === "insertFromYank"
      || Boolean(event && event.isComposing);
    if (blocked && !linkOpen) {
      scheduleHint();
      return;
    }
    considerOpen(true);
  };

  const onCompositionStart = () => { composing = true; };
  const onCompositionEnd = () => {
    composing = false;
    considerOpen(true);
  };

  const onBlur = () => {
    if (linkOpen) closeBand(false);
  };

  const onSelectionChange = () => {
    if (disposed || composing) return;
    const doc = proseOwnerDocument(inputEl);
    try {
      if (doc && doc.activeElement && doc.activeElement !== inputEl) return;
    } catch (_error) {}
    considerOpen(false);
  };

  const resolveComplete = (link, sourcePath) => {
    if (resolveOverride) return resolveOverride(link, sourcePath);
    if (!app || !app.metadataCache) return true;
    try {
      const cache = app.metadataCache;
      let dest = null;
      if (link.target) {
        dest = typeof cache.getFirstLinkpathDest === "function"
          ? cache.getFirstLinkpathDest(link.target, sourcePath || "")
          : null;
      } else if (sourcePath && typeof app.vault.getAbstractFileByPath === "function") {
        dest = app.vault.getAbstractFileByPath(sourcePath);
      }
      if (!dest) return null;
      if (!link.heading && !link.blockId) return dest;
      const fileCache = typeof cache.getFileCache === "function" ? cache.getFileCache(dest) : null;
      if (link.heading) {
        const headings = (fileCache && fileCache.headings) || [];
        return headings.some((heading) => heading && heading.heading === link.heading) ? dest : null;
      }
      if (link.blockId) {
        const blocks = (fileCache && fileCache.blocks) || {};
        return blocks[link.blockId] ? dest : null;
      }
      return dest;
    } catch (_error) {
      return null;
    }
  };

  const scheduleHint = () => {
    const win = proseOwnerWindow(inputEl);
    const schedule = win && typeof win.setTimeout === "function" ? win.setTimeout.bind(win) : setTimeout;
    const clear = win && typeof win.clearTimeout === "function" ? win.clearTimeout.bind(win) : clearTimeout;
    if (hintTimer) {
      try { clear(hintTimer); } catch (_error) {}
      hintTimer = null;
    }
    const run = () => {
      hintTimer = null;
      if (disposed || linkOpen) {
        hintMessages = [];
        renderHint();
        return;
      }
      try {
        const text = String(inputEl && inputEl.value || "");
        const minOffset = proseResolveMinOffset(minOffsetOpt);
        const links = proseCompleteLinks(text).filter((link) => !(link.start < minOffset));
        hintMessages = proseUnresolvedMessages(links, resolveComplete, sourcePathNow());
      } catch (_error) {
        hintMessages = [];
      }
      renderHint();
    };
    if (hintDelay === 0) run();
    else hintTimer = schedule(run, hintDelay);
  };

  const hydratePreviews = () => {
    const token = ++previewToken;
    const visible = (currentView().view || []).filter((row) => row && row.kind === "block" && row.blockId && !row.preview);
    if (!visible.length) return;
    const index = opts.index || (notesOverride ? null : getProseLinkIndex(plugin, app));
    for (const row of visible) {
      Promise.resolve()
        .then(async () => {
          if (previewOverride) return previewOverride(row.path, row.blockId);
          if (index && typeof index.blockPreview === "function") return index.blockPreview(row.path, row.blockId);
          if (!app || !app.vault) return "";
          const file = typeof app.vault.getAbstractFileByPath === "function"
            ? app.vault.getAbstractFileByPath(row.path)
            : null;
          const read = app.vault.cachedRead || app.vault.read;
          if (!file || typeof read !== "function") return "";
          const text = await read.call(app.vault, file);
          return proseBlockPreviewText(text, row.blockId);
        })
        .then((preview) => {
          if (disposed || token !== previewToken || !preview) return;
          const target = rows.find((item) => item && item.key === row.key);
          if (target) target.preview = String(preview);
          renderLink();
        })
        .catch(() => {});
    }
  };

  const bindInput = (el) => {
    if (!el || typeof el.addEventListener !== "function") return;
    el.addEventListener("input", onInput);
    el.addEventListener("compositionstart", onCompositionStart);
    el.addEventListener("compositionend", onCompositionEnd);
    el.addEventListener("blur", onBlur);
    if (ownKeys) el.addEventListener("keydown", captureKeydown, true);
    el.addEventListener("keyup", onKeyup, true);
    const doc = proseOwnerDocument(el);
    if (doc && typeof doc.addEventListener === "function") {
      selectionBound = onSelectionChange;
      doc.addEventListener("selectionchange", selectionBound);
    }
    keyupBound = onKeyup;
  };

  const unbindInput = (el) => {
    if (!el || typeof el.removeEventListener !== "function") return;
    el.removeEventListener("input", onInput);
    el.removeEventListener("compositionstart", onCompositionStart);
    el.removeEventListener("compositionend", onCompositionEnd);
    el.removeEventListener("blur", onBlur);
    if (ownKeys) el.removeEventListener("keydown", captureKeydown, true);
    el.removeEventListener("keyup", onKeyup, true);
    const doc = proseOwnerDocument(el);
    if (doc && selectionBound && typeof doc.removeEventListener === "function") {
      doc.removeEventListener("selectionchange", selectionBound);
    }
    proseClearInputAria(el);
  };

  ensureHosts();
  if (opts.recall && recallHost) {
    try {
      recallHandle = attachLogRecallWithoutLinks({
        ...opts,
        inputEl,
        bandHost: recallHost,
        kind: opts.recall,
        ownKeys: false,
        links: false,
      });
    } catch (_error) {
      recallHandle = null;
    }
  }
  bindInput(inputEl);
  if (ownKeys && opts.scope && typeof opts.scope.register === "function") {
    const focusedElsewhere = () => {
      try {
        const doc = proseOwnerDocument(inputEl);
        if (doc && doc.activeElement && doc.activeElement !== inputEl) return true;
        if (typeof document !== "undefined" && document.activeElement && document.activeElement !== inputEl) return true;
      } catch (_error) {}
      return false;
    };
    // Obsidian's Scope runs handlers in registration order, and Modal bound
    // Escape to onEscapeKey at construction, so the trailing catch-all below
    // never sees a real Escape. This catch-all goes first and takes only the
    // escape chords: it returns false once the band or recall backed out, and
    // undefined otherwise, so the scope falls through to the host's close.
    try {
      escapeScopeHandler = opts.scope.register(null, null, (event) => {
        if (focusedElsewhere()) return undefined;
        const key = String(event && event.key || "").toLowerCase();
        const escChord = key === "escape" || (event && event.ctrlKey && !event.altKey && !event.metaKey && key === "[");
        if (!escChord) return undefined;
        return captureKeydown(event) ? false : undefined;
      });
      const keys = opts.scope.keys;
      const index = Array.isArray(keys) ? keys.indexOf(escapeScopeHandler) : -1;
      if (index > 0) {
        keys.splice(index, 1);
        keys.unshift(escapeScopeHandler);
      }
    } catch (_error) {
      escapeScopeHandler = null;
    }
    try {
      scopeHandler = opts.scope.register(null, null, (event) => {
        if (focusedElsewhere()) return true;
        return captureKeydown(event) ? false : true;
      });
    } catch (_error) {
      scopeHandler = null;
    }
  }
  renderLink();
  scheduleHint();

  return {
    handleKeydown,
    backOut,
    isLinkOpen: () => linkOpen === true,
    isRecalling: () => {
      try { return recallHandle && typeof recallHandle.isRecalling === "function" ? recallHandle.isRecalling() : false; }
      catch (_error) { return false; }
    },
    rebind(next) {
      const patch = next && typeof next === "object" ? next : {};
      if (patch.inputEl && patch.inputEl !== inputEl) {
        unbindInput(inputEl);
        inputEl = patch.inputEl;
        bindInput(inputEl);
        if (recallHandle && typeof recallHandle.rebind === "function") {
          try { recallHandle.rebind({ inputEl }); } catch (_error) {}
        } else if (recallHandle && opts.recall) {
          try { recallHandle.detach(); } catch (_error) {}
          try {
            recallHandle = attachLogRecallWithoutLinks({
              ...opts,
              inputEl,
              bandHost: recallHost,
              kind: opts.recall,
              ownKeys: false,
              links: false,
            });
          } catch (_error) {}
        }
      }
      if (patch.bandHost && patch.bandHost !== bandHost) {
        bandHost = patch.bandHost;
        ensureHosts();
        if (recallHandle && opts.recall) {
          try { recallHandle.detach(); } catch (_error) {}
          try {
            recallHandle = attachLogRecallWithoutLinks({
              ...opts,
              inputEl,
              bandHost: recallHost,
              kind: opts.recall,
              ownKeys: false,
              links: false,
            });
          } catch (_error) {}
        }
      }
      fadePlayed = true;
      if (linkOpen) considerOpen(true);
      else renderLink();
      return true;
    },
    setSourcePath(next) {
      sourcePathOpt = next;
      if (linkOpen) considerOpen(true);
      else scheduleHint();
      return true;
    },
    setKind(nextKind) {
      if (recallHandle && typeof recallHandle.setKind === "function") {
        try { return recallHandle.setKind(nextKind); } catch (_error) { return false; }
      }
      return false;
    },
    setPinnedSlots(next) {
      if (recallHandle && typeof recallHandle.setPinnedSlots === "function") {
        try { return recallHandle.setPinnedSlots(next); } catch (_error) { return false; }
      }
      return true;
    },
    detach() {
      if (disposed) return;
      disposed = true;
      previewToken += 1;
      if (hintTimer) {
        try { clearTimeout(hintTimer); } catch (_error) {}
        hintTimer = null;
      }
      unbindInput(inputEl);
      try {
        if (scopeHandler && opts.scope && typeof opts.scope.unregister === "function") {
          opts.scope.unregister(scopeHandler);
        }
        if (escapeScopeHandler && opts.scope && typeof opts.scope.unregister === "function") {
          opts.scope.unregister(escapeScopeHandler);
        }
      } catch (_error) {}
      try { if (recallHandle && typeof recallHandle.detach === "function") recallHandle.detach(); } catch (_error) {}
      try { proseClearHost(linkHost); } catch (_error) {}
      try { proseClearHost(hintHost); } catch (_error) {}
      try { proseClearHost(recallHost); } catch (_error) {}
      linkOpen = false;
      aliasStage = false;
      recallHandle = null;
    },
  };
}

function createProseFieldApi(plugin) {
  return Object.freeze({
    version: 1,
    attach(options) {
      try {
        const opts = options && typeof options === "object" ? options : {};
        return attachProseField({ ...opts, plugin, app: opts.app || (plugin && plugin.app) });
      } catch (_error) {
        return null;
      }
    },
  });
}
