// Bob Command Mode: output pager view and standalone sheet-shaped modal.
// The sheet phase remounts the same view in its output stage.

function cmPagerEl(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function cmPagerHasSelection() {
  try {
    const selection = typeof window !== "undefined" && window.getSelection ? window.getSelection() : null;
    return Boolean(selection && String(selection.toString() || "").length);
  } catch (error) {
    return false;
  }
}

async function cmPagerWriteClipboard(text) {
  try {
    const clipboard = typeof navigator !== "undefined" && navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") return { ok: false, reason: "clipboard unavailable" };
    await clipboard.writeText(String(text || ""));
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: String((error && error.message) || error) };
  }
}

function cmPagerReadCapped(fsModule, filePath, cap) {
  let fd = null;
  try {
    const size = fsModule.statSync(filePath).size;
    const length = Math.min(Math.max(0, cap), Math.max(0, size));
    const buffer = Buffer.alloc(length);
    fd = fsModule.openSync(filePath, "r");
    fsModule.readSync(fd, buffer, 0, length, 0);
    return { buffer, truncated: size > cap };
  } catch (error) {
    return { buffer: Buffer.alloc(0), truncated: false };
  } finally {
    if (fd !== null) {
      try { fsModule.closeSync(fd); } catch (error) { /* Best effort. */ }
    }
  }
}

function cmPagerQueuedBehind(runner) {
  if (!runner || !runner.live) return "";
  try {
    for (const live of runner.live.values()) {
      const record = live && live.record;
      if (record && record.outcome === "running" && record.effect !== "reads") {
        return record.title || record.entry_id || cmPagerDisplayArgv(record);
      }
    }
  } catch (error) {
    return "";
  }
  return "";
}

function cmPagerFindRecord(runner, runId) {
  if (!runner) return null;
  const id = String(runId || "");
  if (!id) return null;
  try {
    const live = runner.live && runner.live.get(id);
    if (live && live.record) return live.record;
  } catch (error) {
    // Fall through to the store.
  }
  try {
    const records = cmListRecords(runner.fs(), runner.runsDir());
    return records.find((record) => record && record.id === id) || null;
  } catch (error) {
    return null;
  }
}

function cmPagerLoadPayload(runner, runId) {
  const id = String(runId || "");
  if (!runner || !id) return null;
  let live = null;
  try { live = runner.live && runner.live.get(id); } catch (error) { live = null; }
  if (live && live.state) {
    return {
      record: live.record,
      stdout: Buffer.from(String(live.state.stdout || ""), "utf8"),
      stderr: Buffer.from(String(live.state.stderr || ""), "utf8"),
      truncated: Boolean(live.state.truncated || (live.record && live.record.truncated)),
      live: true,
    };
  }
  const record = cmPagerFindRecord(runner, id);
  if (!record) return null;
  const paths = cmRunFilePaths(runner.runsDir(), id, runner.pathModule());
  const out = cmPagerReadCapped(runner.fs(), paths.out, CM_MEM_CAP_BYTES);
  const err = cmPagerReadCapped(runner.fs(), paths.err, CM_MEM_CAP_BYTES);
  return {
    record,
    stdout: out.buffer,
    stderr: err.buffer,
    truncated: Boolean(record.truncated || out.truncated || err.truncated),
    live: false,
    paths,
  };
}

function cmBuildPagerView(payload, options = {}) {
  const record = (payload && payload.record) || {};
  const sequenceStamp = record.sequence && typeof record.sequence === "object"
    ? { index: Number(record.sequence.index), total: Number(record.sequence.total) }
    : null;
  const nowMs = typeof options.nowMs === "number" ? options.nowMs : Date.now();
  const rawChunks = Array.isArray(options.chunks)
    ? options.chunks
    : cmReplayInterleave(payload && payload.stdout, payload && payload.stderr, record.interleave);
  const chunks = cmDecoratePagerChunks(rawChunks, {
    app: options.app,
    vaultBase: options.vaultBase,
  });
  const history = options.history || cmPagerHistoryState(options.records || [], record.id);
  const search = options.search || cmDefaultPagerSearch();
  const visible = cmPagerVisibleText(chunks);
  if (search.mode !== "off" && search.query) search.matches = cmFindSearchMatches(visible, search.query);
  return {
    record,
    status: cmPagerStatusMeta(record, nowMs, options.queuedBehind || ""),
    argv: cmPagerDisplayArgv(record),
    ...(sequenceStamp && Number.isFinite(sequenceStamp.index) && Number.isFinite(sequenceStamp.total)
      ? { sequence: sequenceStamp }
      : {}),
    started: cmFormatStartTime(record.started_at),
    history,
    stopVisible: record.outcome === "running",
    stopConfirm: Boolean(options.stopConfirm),
    wrap: Boolean(options.wrap),
    truncated: Boolean(payload && payload.truncated),
    search,
    chunks,
    visible,
  };
}

function cmPagerMarkSearch(text, offset, search) {
  const source = String(text || "");
  if (!search || search.mode === "off" || !search.matches || !search.matches.length) {
    return [{ text: source, hit: false, current: false }];
  }
  const parts = [];
  let cursor = 0;
  const start = offset;
  const end = offset + source.length;
  for (let index = 0; index < search.matches.length; index += 1) {
    const match = search.matches[index];
    if (match.end <= start || match.start >= end) continue;
    const localStart = Math.max(0, match.start - start);
    const localEnd = Math.min(source.length, match.end - start);
    if (localStart > cursor) parts.push({ text: source.slice(cursor, localStart), hit: false, current: false });
    parts.push({ text: source.slice(localStart, localEnd), hit: true, current: index === search.current });
    cursor = localEnd;
  }
  if (cursor < source.length) parts.push({ text: source.slice(cursor), hit: false, current: false });
  return parts.length ? parts : [{ text: source, hit: false, current: false }];
}

function cmRenderPagerText(parent, node, offset, search, handlers) {
  const pieces = cmPagerMarkSearch(node.text || "", offset, search);
  for (const piece of pieces) {
    let el = cmPagerEl(node.href ? "a" : "span", "bob-cmd-ansi");
    if (node.kind === "key") el.classList.add("bob-cmd-json-key");
    if (node.href) {
      el.classList.add("bob-cmd-link");
      el.setAttribute("href", node.href);
      el.setAttribute("data-link-path", node.path || node.href);
      if (node.line != null) el.setAttribute("data-link-line", String(node.line));
      el.addEventListener("click", (event) => {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
        if (typeof handlers.onLink === "function") {
          handlers.onLink({
            path: node.path || node.href,
            href: node.href,
            line: node.line,
            newLeaf: Boolean(event && (event.metaKey || event.ctrlKey)),
          });
        }
      });
    }
    const css = cmAnsiStyleToCss(node.style);
    if (css) el.setAttribute("style", css);
    if (piece.hit) {
      const mark = cmPagerEl("mark", "bob-cmd-search-hit" + (piece.current ? " is-current" : ""), piece.text);
      el.appendChild(mark);
    } else {
      el.textContent = piece.text;
    }
    parent.appendChild(el);
  }
  return (node.text || "").length;
}

function cmRenderPagerView(root, view, handlers = {}) {
  if (!root) return null;
  root.empty ? root.empty() : (root.textContent = "");
  if (root.replaceChildren) root.replaceChildren();
  else root.children = root.children || [];
  root.className = "bob-cmd-pager-view" + (view.wrap ? " is-wrap" : "");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Command output");

  const header = cmPagerEl("header", "bob-cmd-pager-header");
  const pill = cmPagerEl("span", "bob-cmd-pill " + view.status.className, view.status.glyph + " " + view.status.text);
  pill.setAttribute("aria-live", "polite");
  const argv = cmPagerEl("code", "bob-cmd-pager-argv", view.argv);
  argv.setAttribute("title", view.argv);
  const started = cmPagerEl("span", "bob-cmd-pager-started", view.started);
  header.append(pill, argv);
  if (view.sequence) {
    header.appendChild(cmPagerEl("span", "bob-cmd-pager-seq", "step " + view.sequence.index + " of " + view.sequence.total));
  }
  header.appendChild(started);
  if (view.history && view.history.label) {
    header.appendChild(cmPagerEl("span", "bob-cmd-pager-index", view.history.label));
  }
  if (view.stopVisible) {
    const stop = cmPagerEl("button", "bob-cmd-pager-stop", view.stopConfirm ? "Confirm stop" : "Stop");
    stop.type = "button";
    stop.addEventListener("click", (event) => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (typeof handlers.onStop === "function") handlers.onStop();
    });
    header.appendChild(stop);
  }
  root.appendChild(header);

  if (view.truncated) {
    const truncated = cmPagerEl("div", "bob-cmd-pager-truncated", "View truncated — open the full log");
    truncated.setAttribute("role", "button");
    truncated.setAttribute("tabindex", "0");
    truncated.addEventListener("click", () => { if (typeof handlers.onOpenLog === "function") handlers.onOpenLog(); });
    root.appendChild(truncated);
  }
  const body = cmPagerEl("div", "bob-cmd-pager-body" + (view.wrap ? " is-wrap" : ""));
  body.setAttribute("tabindex", "0");
  let offset = 0;
  for (const chunk of view.chunks || []) {
    const row = cmPagerEl("div", "bob-cmd-chunk" + (chunk.stream === "err" ? " is-stderr" : ""));
    const nodes = Array.isArray(chunk.nodes) ? chunk.nodes : [{ text: chunk.text || "", style: cmDefaultAnsiStyle() }];
    for (const node of nodes) offset += cmRenderPagerText(row, node, offset, view.search, handlers);
    body.appendChild(row);
  }
  if (!(view.chunks && view.chunks.length)) {
    body.appendChild(cmPagerEl("div", "bob-cmd-chunk is-empty", "No output yet"));
  }
  root.appendChild(body);

  const footer = cmPagerEl("footer", "bob-cmd-pager-footer");
  if (view.search && view.search.mode === "editing") {
    footer.appendChild(cmPagerEl("span", "bob-cmd-pager-search", "/" + view.search.query));
  } else if (view.search && view.search.mode === "idle") {
    const count = view.search.matches.length;
    const current = count && view.search.current >= 0 ? (view.search.current + 1) + "/" + count : "0/" + count;
    footer.appendChild(cmPagerEl("span", "bob-cmd-pager-search", "/" + view.search.query + "  " + current));
  } else if (view.stopConfirm) {
    footer.appendChild(cmPagerEl("span", "bob-cmd-pager-confirm", "Stop this writer? y confirm · esc cancel"));
  } else {
    footer.appendChild(cmPagerEl("span", "bob-cmd-pager-hints", "j k d u g G  / n N  w wrap  y copy  Y argv  r rerun  [ ] history  q close"));
  }
  root.appendChild(footer);
  return { root, header, body, footer };
}

function cmPagerAdvanceSearch(search, dir) {
  const count = search.matches.length;
  if (!count) {
    search.current = -1;
    return search;
  }
  if (search.current < 0) search.current = dir > 0 ? 0 : count - 1;
  else search.current = (search.current + dir + count) % count;
  return search;
}

class CommandModePagerModal extends Modal {
  constructor(app, plugin, options = {}) {
    super(app);
    this.plugin = plugin;
    this.pagerOpen = false;
    this.fromList = Boolean(options.fromList);
    this.runId = String(options.runId || "");
    this.wrap = false;
    this.stopConfirm = false;
    this.search = cmDefaultPagerSearch();
    this.view = null;
    this.nodes = null;
    this.tailTimer = null;
    this.copied = "";
    this.clipboardWrite = typeof options.clipboardWrite === "function" ? options.clipboardWrite : cmPagerWriteClipboard;
  }

  open() {
    if (this.pagerOpen) return this;
    this.pagerOpen = true;
    try {
      return super.open();
    } catch (error) {
      this.pagerOpen = false;
      throw error;
    }
  }

  close() {
    if (!this.pagerOpen) return this;
    this.pagerOpen = false;
    return super.close();
  }

  onOpen() {
    if (this.containerEl && this.containerEl.addClass) this.containerEl.addClass("bob-cmd-pager-host");
    if (this.modalEl && this.modalEl.addClass) this.modalEl.addClass("bob-cmd-pager");
    this.contentEl.empty();
    if (this.contentEl.addClass) this.contentEl.addClass("bob-cmd-pager-content");
    this.viewEl = cmPagerEl("div", "bob-cmd-pager-view");
    this.contentEl.appendChild(this.viewEl);
    if (this.modalEl && this.modalEl.addEventListener) {
      this.modalEl.addEventListener("keydown", (event) => this.handlePagerKeydown(event));
    }
    this.refresh();
    this.startTail();
    if (this.modalEl) {
      this.modalEl.setAttribute("tabindex", "-1");
      if (typeof this.modalEl.focus === "function") this.modalEl.focus();
    }
  }

  onClose() {
    this.stopTail();
    this.pagerOpen = false;
    if (this.plugin && this.plugin.commandModePager === this) this.plugin.commandModePager = null;
    this.contentEl.empty();
  }

  startTail() {
    this.stopTail();
    this.tailTimer = setInterval(() => this.refresh(), CM_TAIL_POLL_MS);
    if (this.tailTimer && typeof this.tailTimer.unref === "function") this.tailTimer.unref();
  }

  stopTail() {
    if (this.tailTimer) {
      try { clearInterval(this.tailTimer); } catch (error) { /* Best effort. */ }
      this.tailTimer = null;
    }
  }

  showRun(runId) {
    this.runId = String(runId || "");
    this.stopConfirm = false;
    this.search = cmDefaultPagerSearch();
    this.refresh();
  }

  payload() {
    return cmPagerLoadPayload(this.plugin && this.plugin.commandModeRunner, this.runId);
  }

  records() {
    const runner = this.plugin && this.plugin.commandModeRunner;
    if (!runner) return [];
    try { return cmListRecords(runner.fs(), runner.runsDir()); }
    catch (error) { return []; }
  }

  refresh() {
    const payload = this.payload();
    if (!payload) {
      if (this.viewEl) {
        this.viewEl.empty ? this.viewEl.empty() : (this.viewEl.textContent = "Run not found");
      }
      return null;
    }
    const runner = this.plugin.commandModeRunner;
    const vaultBase = runner && typeof runner.deps.vaultBase === "function" ? runner.deps.vaultBase() : cmVaultBasePath(this.app);
    const previous = this.nodes && this.nodes.body;
    const wasAtBottom = previous
      ? (Number(previous.scrollTop) || 0) + (Number(previous.clientHeight) || 0) >= (Number(previous.scrollHeight) || 0) - 8
      : true;
    const savedTop = previous ? Number(previous.scrollTop) || 0 : 0;
    this.view = cmBuildPagerView(payload, {
      app: this.app,
      vaultBase,
      records: this.records(),
      search: this.search,
      wrap: this.wrap,
      stopConfirm: this.stopConfirm,
      queuedBehind: cmPagerQueuedBehind(runner),
      nowMs: Date.now(),
    });
    this.nodes = cmRenderPagerView(this.viewEl, this.view, {
      onStop: () => this.requestStop(),
      onOpenLog: () => this.openFullLog(),
      onLink: (link) => this.openLink(link),
    });
    if (this.nodes && this.nodes.body) {
      const body = this.nodes.body;
      body.scrollTop = wasAtBottom ? (body.scrollHeight || 0) : savedTop;
    }
    return this.view;
  }

  openFullLog() {
    const runner = this.plugin && this.plugin.commandModeRunner;
    if (!runner || typeof this.plugin.commandModeOpenPath !== "function") return { ok: false };
    const paths = cmRunFilePaths(runner.runsDir(), this.runId, runner.pathModule());
    return this.plugin.commandModeOpenPath(paths.out);
  }

  openLink(link) {
    const workspace = this.app && this.app.workspace;
    if (!workspace || typeof workspace.openLinkText !== "function") return { ok: false, reason: "note opener unavailable" };
    const target = link.href || link.path;
    const eState = {};
    if (typeof link.line === "number") eState.line = Math.max(0, link.line - 1);
    try {
      const opened = workspace.openLinkText(target, "", Boolean(link.newLeaf), { eState });
      if (!link.newLeaf) this.close();
      return opened && typeof opened.then === "function" ? opened.then(() => ({ ok: true })) : { ok: true };
    } catch (error) {
      return { ok: false, reason: String((error && error.message) || error) };
    }
  }

  requestStop() {
    const record = this.view && this.view.record;
    if (!record || record.outcome !== "running") return { ok: false, reason: "run is not active" };
    if (record.effect !== "reads" && !this.stopConfirm) {
      this.stopConfirm = true;
      this.refresh();
      return { ok: true, confirm: true };
    }
    this.stopConfirm = false;
    const runner = this.plugin && this.plugin.commandModeRunner;
    if (!runner || typeof runner.stop !== "function") return { ok: false, reason: "run is not active" };
    const result = runner.stop(this.runId);
    this.refresh();
    return result;
  }

  backToList() {
    if (typeof this.onBackToList === "function") {
      this.onBackToList();
      return;
    }
    this.close();
  }

  handlePagerKeydown(event) {
    const action = cmHandlePagerKey(event, {
      search: this.search,
      stopConfirm: this.stopConfirm,
      hasSelection: cmPagerHasSelection(),
    });
    if (!action || action.type === "none") return false;
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    if (event && typeof event.stopPropagation === "function") event.stopPropagation();
    this.applyPagerAction(action);
    return true;
  }

  applyPagerAction(action) {
    const body = this.nodes && this.nodes.body;
    switch (action.type) {
      case "scroll": {
        if (!body) return;
        body.scrollTop = cmPagerApplyScroll({
          top: Number(body.scrollTop) || 0,
          view: Number(body.clientHeight) || 0,
          height: Number(body.scrollHeight) || 0,
        }, action);
        return;
      }
      case "wrap":
        this.wrap = !this.wrap;
        this.refresh();
        return;
      case "copy-output":
        void this.clipboardWrite(cmPagerCopyOutput(this.view && this.view.chunks)).then((result) => {
          if (result && result.ok) this.copied = "output";
        });
        return;
      case "copy-command":
        void this.clipboardWrite(cmPagerCopyCommand(this.view && this.view.record)).then((result) => {
          if (result && result.ok) this.copied = "command";
        });
        return;
      case "rerun":
        if (this.plugin && typeof this.plugin.commandModeRerun === "function") {
          void Promise.resolve(this.plugin.commandModeRerun(this.view && this.view.record)).then((result) => {
            if (result && result.runId) this.showRun(result.runId);
          });
        }
        return;
      case "history": {
        const history = this.view && this.view.history;
        const nextId = action.dir > 0 ? history && history.olderId : history && history.newerId;
        if (nextId) this.showRun(nextId);
        return;
      }
      case "stop-request":
        this.requestStop();
        return;
      case "stop":
        this.stopConfirm = true;
        this.requestStop();
        return;
      case "stop-cancel":
        this.stopConfirm = false;
        this.refresh();
        return;
      case "search-start":
        this.search = { ...cmDefaultPagerSearch(), mode: "editing" };
        this.refresh();
        return;
      case "search-type":
        this.search.query = String(this.search.query || "") + action.char;
        this.refresh();
        return;
      case "search-backspace":
        this.search.query = String(this.search.query || "").slice(0, -1);
        this.refresh();
        return;
      case "search-commit":
        if (!this.search.query) {
          this.search = cmDefaultPagerSearch();
        } else {
          this.search.mode = "idle";
          this.search.matches = cmFindSearchMatches(this.view && this.view.visible, this.search.query);
          this.search.current = this.search.matches.length ? 0 : -1;
        }
        this.refresh();
        return;
      case "search-cancel":
        this.search = cmDefaultPagerSearch();
        this.refresh();
        return;
      case "search-next":
        cmPagerAdvanceSearch(this.search, 1);
        this.refresh();
        return;
      case "search-prev":
        cmPagerAdvanceSearch(this.search, -1);
        this.refresh();
        return;
      case "back":
        this.backToList();
        return;
      case "escape":
        if (this.fromList) this.backToList();
        else this.close();
        return;
      case "close":
        this.close();
        return;
      default:
        return;
    }
  }
}
