// --- Task link marks: Reading view, embeds, popovers, and query rows ---
// Owned by bob-cli docs/task-link-marks.md (bob-cli-f5 phase reading).
// The shared resolver and ring host come from the Live Preview phase.
// Reading post-processing is source-path aware and leaves the vault text
// untouched. Refreshes revisit stamped anchors and unstamped Tasks /
// Dataview query rows, including popouts.

const TASK_LINK_MARK_READING_DETACHED_RETRIES = 3;
const TASK_LINK_MARK_READING_PENDING_RETRIES = 60;

class BobLedgerToolsTaskLinkMarksReadingMixin {
  setupTaskLinkMarksReading() {
    try {
      this.taskLinkMarkReadingClickDocs = new WeakSet();
      this.taskLinkMarkReadingState = taskLinkMarkNewViewState();
      this.taskLinkMarkReadingQueue = [];
      this.taskLinkMarkReadingPending = false;
      if (typeof this.registerMarkdownPostProcessor === "function") {
        this.registerMarkdownPostProcessor(
          (el, ctx) => this.renderTaskLinkMarksIn(el, ctx),
          55,
        );
      }
      for (const doc of this.taskLinkMarkReadingDocuments()) {
        this.taskLinkMarkReadingBindClicks(doc);
      }
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.on === "function" && typeof this.registerEvent === "function") {
        this.registerEvent(
          workspace.on("window-open", (win) => {
            try {
              this.taskLinkMarkReadingBindClicks(win && (win.document || win.doc));
            } catch (error) {
              // Popout click handling is best-effort.
            }
          }),
        );
      }
      if (typeof this.register === "function") {
        this.register(() => this.cancelTaskLinkMarkReadingQueryRows());
      }
    } catch (error) {
      // Reading-view wiring never blocks plugin startup.
    }
  }

  taskLinkMarkReadingTag(node) {
    try {
      return String((node && (node.tagName || node.nodeName)) || "").toUpperCase();
    } catch (error) {
      return "";
    }
  }

  taskLinkMarkReadingHasClass(node, name) {
    try {
      if (!node || !name) return false;
      if (node.classList && typeof node.classList.contains === "function") {
        return node.classList.contains(name);
      }
      const raw = typeof node.getAttribute === "function"
        ? node.getAttribute("class") || ""
        : typeof node.className === "string" ? node.className : "";
      return String(raw).split(/\s+/).includes(name);
    } catch (error) {
      return false;
    }
  }

  taskLinkMarkReadingAttribute(node, name) {
    try {
      return node && typeof node.getAttribute === "function"
        ? node.getAttribute(name)
        : null;
    } catch (error) {
      return null;
    }
  }

  taskLinkMarkReadingSetAttribute(node, name, value) {
    try {
      if (node && typeof node.setAttribute === "function") {
        node.setAttribute(name, String(value));
      }
    } catch (error) {
      // Stamps are best-effort.
    }
  }

  taskLinkMarkReadingRemoveAttribute(node, name) {
    try {
      if (node && typeof node.removeAttribute === "function") {
        node.removeAttribute(name);
      }
    } catch (error) {
      // Clearing a stale stamp is best-effort.
    }
  }

  taskLinkMarkReadingDocuments() {
    try {
      if (typeof this.markGateDocuments === "function") {
        return this.markGateDocuments();
      }
      if (typeof this.todayMarksReadingDocuments === "function") {
        return this.todayMarksReadingDocuments();
      }
    } catch (error) {
      // Fall through to the main document.
    }
    try {
      return typeof document !== "undefined" && document ? [document] : [];
    } catch (error) {
      return [];
    }
  }

  taskLinkMarkReadingBindClicks(doc) {
    try {
      if (!doc || typeof doc !== "object") return;
      if (!(this.taskLinkMarkReadingClickDocs instanceof WeakSet)) {
        this.taskLinkMarkReadingClickDocs = new WeakSet();
      }
      if (this.taskLinkMarkReadingClickDocs.has(doc)) return;
      const handler = (event) => this.taskLinkMarkReadingHandleMouseDown(event);
      if (typeof this.registerDomEvent === "function") {
        this.registerDomEvent(doc, "mousedown", handler);
      } else if (typeof doc.addEventListener === "function") {
        doc.addEventListener("mousedown", handler);
      } else {
        return;
      }
      this.taskLinkMarkReadingClickDocs.add(doc);
    } catch (error) {
      // One document's listener never affects the others.
    }
  }

  taskLinkMarkReadingClosestMark(node) {
    try {
      let current = node && node.nodeType === 3 ? node.parentNode : node;
      let guard = 0;
      while (current && guard < 100) {
        guard += 1;
        if (this.taskLinkMarkReadingHasClass(current, "bob-task-link-mark")) {
          return current;
        }
        current = current.parentNode || null;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  taskLinkMarkReadingAnchorForMark(mark) {
    try {
      let node = mark && mark.nextSibling ? mark.nextSibling : null;
      if (!node) return null;
      if (["DEL", "S", "STRIKE"].includes(this.taskLinkMarkReadingTag(node))) {
        const children = node.childNodes || [];
        if (children.length !== 1) return null;
        node = children[0];
      }
      return this.taskLinkMarkReadingTag(node) === "A" &&
        this.taskLinkMarkReadingHasClass(node, "internal-link")
        ? node
        : null;
    } catch (error) {
      return null;
    }
  }

  taskLinkMarkReadingHandleMouseDown(event) {
    try {
      if (!event || (event.button !== undefined && event.button !== 0)) return;
      const mark = this.taskLinkMarkReadingClosestMark(event.target);
      if (!mark) return;
      let isMac = false;
      try {
        isMac = Boolean(Platform && Platform.isMacOS);
      } catch (error) {
        isMac = false;
      }
      const modified = typeof todayMarkModifierPressed === "function"
        ? todayMarkModifierPressed(event, isMac)
        : (isMac ? Boolean(event.metaKey) : Boolean(event.ctrlKey));
      if (!modified) return;
      const anchor = this.taskLinkMarkReadingAnchorForMark(mark);
      const sourcePath = this.taskLinkMarkReadingAttribute(anchor, "data-bob-task-link-src");
      const spec = this.taskLinkMarkReadingLinkSpec(anchor);
      if (!anchor || !sourcePath || !spec) return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      if (typeof event.stopPropagation === "function") event.stopPropagation();
      this.taskLinkMarkOpenLink(spec.linktext, sourcePath);
    } catch (error) {
      // A ring click never breaks the rendered view.
    }
  }

  taskLinkMarkReadingLinkSpec(anchor) {
    try {
      let raw = this.taskLinkMarkReadingAttribute(anchor, "data-href") ||
        this.taskLinkMarkReadingAttribute(anchor, "href") || "";
      raw = String(raw).trim();
      if (!raw) return null;
      const pipe = raw.indexOf("|");
      if (pipe !== -1) raw = raw.slice(0, pipe).trim();
      if (raw.startsWith("<") && raw.endsWith(">")) raw = raw.slice(1, -1).trim();
      raw = taskLinkMarkDecodeDest(raw);
      const marker = raw.lastIndexOf("#^");
      if (marker < 0) return null;
      const linkpath = raw.slice(0, marker).trim();
      const blockId = raw.slice(marker + 2).trim();
      if (!/^[A-Za-z0-9-]+$/u.test(blockId)) return null;
      if (linkpath.includes("#") || linkpath.includes("^") || taskLinkMarkIsUriScheme(linkpath)) return null;
      return Object.freeze({
        linkpath,
        blockId,
        linktext: linkpath + "#^" + blockId,
      });
    } catch (error) {
      return null;
    }
  }

  taskLinkMarkReadingIsCandidate(anchor) {
    try {
      const raw = String(
        this.taskLinkMarkReadingAttribute(anchor, "data-href") ||
        this.taskLinkMarkReadingAttribute(anchor, "href") ||
        "",
      );
      return /#(?:\^|%5e)/iu.test(raw);
    } catch (error) {
      return false;
    }
  }

  taskLinkMarkReadingIsQueryRow(row, node) {
    try {
      return Boolean(
        (row && this.taskLinkMarkReadingHasClass(row, "plugin-tasks-list-item")) ||
        (typeof taskThemeQueryAncestor === "function" && taskThemeQueryAncestor(row || node, null)),
      );
    } catch (error) {
      return false;
    }
  }

  // Tasks MarkdownRenderer.render(task.path) runs our post-processor
  // on a description fragment already inside the query row. Trust that
  // ctx.sourcePath only then. A parent-note processor (query file path)
  // must not leak onto nested query rows whose origin is unproven.
  taskLinkMarkReadingRenderRootIsInsideRow(row, renderRoot) {
    try {
      if (!row || !renderRoot) return false;
      let current = renderRoot;
      let guard = 0;
      while (current && guard < 100) {
        guard += 1;
        if (current === row) return true;
        current = current.parentNode || null;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  taskLinkMarkReadingSourcePathFor(anchor, ctx, renderRoot) {
    try {
      const row = typeof taskThemeClosestRow === "function"
        ? taskThemeClosestRow(anchor)
        : null;
      if (this.taskLinkMarkReadingIsQueryRow(row, anchor)) {
        const origin = typeof this.taskThemeOriginFor === "function"
          ? this.taskThemeOriginFor(row, anchor, ctx)
          : null;
        if (origin && typeof origin.path === "string" && origin.path) {
          return origin.path;
        }
        if (
          ctx &&
          typeof ctx.sourcePath === "string" &&
          ctx.sourcePath &&
          this.taskLinkMarkReadingRenderRootIsInsideRow(row, renderRoot)
        ) {
          return ctx.sourcePath;
        }
        return "";
      }
      return ctx && typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
    } catch (error) {
      return "";
    }
  }

  taskLinkMarkReadingClosestListItem(node) {
    try {
      let current = node || null;
      let guard = 0;
      while (current && guard < 100) {
        guard += 1;
        if (this.taskLinkMarkReadingTag(current) === "LI") return current;
        current = current.parentNode || null;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  // A Tasks/Dataview row pass must not stamp nested child list items
  // (DEPENDS ON, LINKS, mixed prose). Those rows have their own owners.
  taskLinkMarkReadingAnchorBelongsToRow(anchor, row) {
    try {
      if (!row) return true;
      const owner = this.taskLinkMarkReadingClosestListItem(anchor);
      return !owner || owner === row;
    } catch (error) {
      return true;
    }
  }

  taskLinkMarkReadingIsLedgerRow(anchor, sourcePath) {
    try {
      if (!sourcePath || !PLAN_DAILY_PATH_RE.test(String(sourcePath))) return false;
      const li = this.taskLinkMarkReadingClosestListItem(anchor);
      if (!li || typeof this.progressMarkReadingContext !== "function") return false;
      const doc = anchor && anchor.ownerDocument ? anchor.ownerDocument : null;
      return Boolean(
        this.progressMarkReadingContext(li, doc, {
          includeClosedEntry: true,
          includeStruck: true,
        }),
      );
    } catch (error) {
      return false;
    }
  }

  taskLinkMarkReadingOwnRowIsEdge(li) {
    try {
      if (typeof dependencyReadingOwnText !== "function") return false;
      const text = dependencyReadingOwnText(li);
      if (typeof mentionIsEdgeLine === "function" && mentionIsEdgeLine(text)) return true;
      // Reading DOM text no longer contains the Markdown bold delimiters
      // that the source-line parsers require. Match only rendered labels
      // at the beginning of a list row, after the optional managed glyph.
      return /^\s*(?:(?:[-*+]|\d+[.)])\s+)?(?:(?:⛓️?|🔗|🪢|🧱|🚧|🧩)\s+)?\*{0,2}(?:DEPENDS\s+ON|DEPENDENCIES|BLOCKS|BLOCKING|LINKS(?:\s+TO)?|LINKED\s+FROM|BACKLINKS|SUB-PROJECTS)\b\*{0,2}\s*:?/iu.test(text);
    } catch (error) {
      return false;
    }
  }

  taskLinkMarkReadingIsExcluded(anchor, sourcePath) {
    try {
      if (this.taskLinkMarkReadingIsLedgerRow(anchor, sourcePath)) return true;
      let current = anchor || null;
      let guard = 0;
      while (current && guard < 100) {
        guard += 1;
        const tag = this.taskLinkMarkReadingTag(current);
        if (tag === "CODE" || tag === "PRE") return true;
        const classes = String(
          typeof current.getAttribute === "function"
            ? current.getAttribute("class") || ""
            : typeof current.className === "string" ? current.className : "",
        ).split(/\s+/).filter(Boolean);
        if (
          classes.includes("metadata-container") ||
          classes.includes("markdown-embed-link") ||
          classes.includes("internal-embed-link") ||
          classes.includes("markdown-embed-title") ||
          classes.includes("internal-embed-title") ||
          classes.includes("embed-title")
        ) return true;
        if (
          tag !== "BODY" &&
          tag !== "HTML" &&
          classes.some((name) => name.startsWith("bob-") && name !== "bob-daily-note-view")
        ) {
          return true;
        }
        if (tag === "LI" && this.taskLinkMarkReadingOwnRowIsEdge(current)) return true;
        current = current.parentNode || null;
      }
      return false;
    } catch (error) {
      return true;
    }
  }

  taskLinkMarkReadingPlacement(anchor) {
    try {
      const parent = anchor && anchor.parentNode;
      const tag = this.taskLinkMarkReadingTag(parent);
      if (!["DEL", "S", "STRIKE"].includes(tag) || parent.parentNode == null) return anchor;
      const children = parent.childNodes || [];
      return children.length === 1 && children[0] === anchor ? parent : anchor;
    } catch (error) {
      return anchor;
    }
  }

  taskLinkMarkReadingPreviousHosts(placement) {
    const hosts = [];
    try {
      let node = placement && placement.previousSibling;
      while (node && this.taskLinkMarkReadingHasClass(node, "bob-task-link-mark")) {
        hosts.push(node);
        node = node.previousSibling;
      }
    } catch (error) {
      // The first adjacent host remains removable.
    }
    return hosts;
  }

  taskLinkMarkReadingRemoveHost(anchor) {
    try {
      const placement = this.taskLinkMarkReadingPlacement(anchor);
      for (const host of this.taskLinkMarkReadingPreviousHosts(placement)) {
        try {
          if (host.parentNode && typeof host.parentNode.removeChild === "function") {
            host.parentNode.removeChild(host);
          } else if (typeof host.remove === "function") {
            host.remove();
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Removing a stale ring is best-effort.
    }
  }

  taskLinkMarkReadingUpdateHost(host, state, tooltip, swap) {
    try {
      if (!host) return;
      this.taskLinkMarkReadingSetAttribute(
        host,
        "class",
        "bob-task-link-mark" + (swap ? " bob-task-link-mark-swap" : ""),
      );
      this.taskLinkMarkReadingSetAttribute(host, "data-state", state);
      this.taskLinkMarkReadingSetAttribute(host, "role", "img");
      this.taskLinkMarkReadingSetAttribute(host, "aria-label", String(tooltip || "").replace(/::/g, ":"));
      this.taskLinkMarkReadingSetAttribute(host, "data-tooltip-position", "top");
      this.taskLinkMarkReadingRemoveAttribute(host, "title");
    } catch (error) {
      // Attribute refresh never removes a valid link.
    }
  }

  taskLinkMarkReadingReconcile(anchor, sourcePath, options = {}) {
    try {
      const placement = this.taskLinkMarkReadingPlacement(anchor);
      const existing = this.taskLinkMarkReadingPreviousHosts(placement)[0] || null;
      const spec = this.taskLinkMarkReadingLinkSpec(anchor);
      if (!this.taskLinkMarkReadingIsCandidate(anchor)) {
        this.taskLinkMarkReadingRemoveAttribute(anchor, "data-bob-task-link-src");
        this.taskLinkMarkReadingRemoveHost(anchor);
        return;
      }
      if (
        !this.taskLinkMarksEnabled ||
        !spec ||
        !sourcePath ||
        this.taskLinkMarkReadingIsExcluded(anchor, sourcePath)
      ) {
        this.taskLinkMarkReadingRemoveHost(anchor);
        return;
      }
      const cache = options && options.resolved instanceof Map ? options.resolved : null;
      const cacheKey = String(sourcePath) + "\u0000" + spec.linkpath + "\u0000" + spec.blockId;
      let hit;
      if (cache && cache.has(cacheKey)) {
        hit = cache.get(cacheKey);
      } else {
        hit = this.taskLinkMarkResolve({
          linkpath: spec.linkpath,
          blockId: spec.blockId,
          sourcePath,
        });
        if (cache) cache.set(cacheKey, hit || null);
      }
      if (!hit) {
        this.taskLinkMarkReadingRemoveHost(anchor);
        return;
      }
      if (!(this.taskLinkMarkReadingState && this.taskLinkMarkReadingState.painted instanceof Map)) {
        this.taskLinkMarkReadingState = taskLinkMarkNewViewState();
      }
      const now = typeof this.taskLinkMarksNow === "function" ? this.taskLinkMarksNow() : Date.now();
      const swap = taskLinkMarkSwapFor(
        this.taskLinkMarkReadingState,
        hit.key,
        hit.state,
        now,
        Boolean(options && options.allowSwap),
      );
      const tooltip = taskLinkMarkTooltip({
        title: hit.title,
        state: hit.state,
        targetPath: hit.targetPath,
        sourcePath,
      });
      if (this.taskLinkMarkTargets instanceof Set) this.taskLinkMarkTargets.add(hit.targetPath);
      let host = existing;
      if (!host) {
        const doc = anchor && anchor.ownerDocument;
        host = buildTaskLinkMarkElement(doc, {
          state: hit.state,
          tooltip,
          swap,
        });
        if (!host || !placement || !placement.parentNode || typeof placement.parentNode.insertBefore !== "function") {
          return;
        }
        placement.parentNode.insertBefore(host, placement);
      }
      this.taskLinkMarkReadingUpdateHost(host, hit.state, tooltip, swap);
      for (const duplicate of this.taskLinkMarkReadingPreviousHosts(placement).slice(1)) {
        try {
          if (duplicate.parentNode) duplicate.parentNode.removeChild(duplicate);
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // A bad link never breaks the note renderer.
    }
  }

  taskLinkMarkReadingAnchors(root, selector) {
    try {
      const anchors = [];
      if (root && this.taskLinkMarkReadingTag(root) === "A" && this.taskLinkMarkReadingHasClass(root, "internal-link")) {
        anchors.push(root);
      }
      if (root && typeof root.querySelectorAll === "function") {
        const found = root.querySelectorAll(selector || "a.internal-link");
        for (const anchor of Array.from(found || [])) {
          if (anchors.indexOf(anchor) === -1) anchors.push(anchor);
        }
        return anchors;
      }
      const stack = [];
      for (const child of Array.from((root && root.childNodes) || [])) stack.push(child);
      let guard = 0;
      while (stack.length && guard < 100000) {
        guard += 1;
        const node = stack.pop();
        if (!node) continue;
        if (this.taskLinkMarkReadingTag(node) === "A" && this.taskLinkMarkReadingHasClass(node, "internal-link")) {
          anchors.push(node);
        }
        for (const child of Array.from(node.childNodes || [])) stack.push(child);
      }
      return anchors;
    } catch (error) {
      return [];
    }
  }

  renderTaskLinkMarksIn(el, ctx, skipQuerySchedule = false) {
    try {
      if (!el || !ctx) return;
      const anchors = this.taskLinkMarkReadingAnchors(el, "a.internal-link");
      const resolved = new Map();
      const doc = el.ownerDocument || (this.taskLinkMarkReadingTag(el) === "#DOCUMENT" ? el : null);
      this.taskLinkMarkReadingBindClicks(doc);
      const renderRow = this.taskLinkMarkReadingTag(el) === "LI" &&
        this.taskLinkMarkReadingIsQueryRow(el, el)
        ? el
        : null;
      for (const anchor of anchors) {
        try {
          if (renderRow && !this.taskLinkMarkReadingAnchorBelongsToRow(anchor, renderRow)) {
            continue;
          }
          if (!this.taskLinkMarkReadingIsCandidate(anchor)) {
            this.taskLinkMarkReadingRemoveAttribute(anchor, "data-bob-task-link-src");
            this.taskLinkMarkReadingRemoveHost(anchor);
            continue;
          }
          const sourcePath = this.taskLinkMarkReadingSourcePathFor(anchor, ctx, el);
          if (!sourcePath) {
            this.taskLinkMarkReadingRemoveAttribute(anchor, "data-bob-task-link-src");
            this.taskLinkMarkReadingRemoveHost(anchor);
            continue;
          }
          this.taskLinkMarkReadingSetAttribute(anchor, "data-bob-task-link-src", sourcePath);
          this.taskLinkMarkReadingReconcile(anchor, sourcePath, { resolved });
        } catch (error) {
          continue;
        }
      }
      if (!skipQuerySchedule) this.scheduleTaskLinkMarkReadingQueryRows(el, ctx);
    } catch (error) {
      // The post-processor is synchronous and never throws.
    }
  }

  taskLinkMarkReadingRequestFrame(callback) {
    try {
      if (typeof callback !== "function") return;
      if (typeof this.taskLinkMarkReadingFrame === "function") {
        this.taskLinkMarkReadingFrame(callback);
        return;
      }
      const scope = typeof window !== "undefined" && window
        ? window
        : typeof globalThis !== "undefined" ? globalThis : null;
      if (scope && typeof scope.requestAnimationFrame === "function") {
        scope.requestAnimationFrame(callback);
      } else {
        setTimeout(callback, 16);
      }
    } catch (error) {
      // A missed query-row frame leaves Obsidian's native links untouched.
    }
  }

  scheduleTaskLinkMarkReadingQueryRows(el, ctx) {
    try {
      if (!this.taskLinkMarksEnabled || !el || typeof el !== "object") return;
      const row = typeof taskThemeClosestRow === "function" ? taskThemeClosestRow(el) : null;
      const query = this.taskLinkMarkReadingIsQueryRow(row, el);
      let detached = false;
      try {
        detached = el.isConnected === false;
      } catch (error) {
        detached = false;
      }
      if (!query && !detached) return;
      if (!Array.isArray(this.taskLinkMarkReadingQueue)) this.taskLinkMarkReadingQueue = [];
      this.taskLinkMarkReadingQueue.push({ el, ctx: ctx || null, frames: 0, waits: 0 });
      if (this.taskLinkMarkReadingPending) return;
      this.taskLinkMarkReadingPending = true;
      this.taskLinkMarkReadingRequestFrame(() => this.runTaskLinkMarkReadingQueryRows());
    } catch (error) {
      // Query-row retries are best-effort.
    }
  }

  cancelTaskLinkMarkReadingQueryRows() {
    try {
      this.taskLinkMarkReadingQueue = [];
      this.taskLinkMarkReadingPending = false;
    } catch (error) {
      // Queue cleanup is best-effort.
    }
  }

  runTaskLinkMarkReadingQueryRows() {
    try {
      this.taskLinkMarkReadingPending = false;
      if (!this.taskLinkMarksEnabled) {
        this.cancelTaskLinkMarkReadingQueryRows();
        return;
      }
      const queued = Array.isArray(this.taskLinkMarkReadingQueue) ? this.taskLinkMarkReadingQueue : [];
      this.taskLinkMarkReadingQueue = [];
      let again = false;
      const done = new Set();
      for (const entry of queued) {
        try {
          if (!entry || !entry.el) continue;
          const row = typeof taskThemeClosestRow === "function" ? taskThemeClosestRow(entry.el) : null;
          if (!row) {
            const frames = (entry.frames || 0) + 1;
            if (frames <= TASK_LINK_MARK_READING_DETACHED_RETRIES) {
              this.taskLinkMarkReadingQueue.push({ ...entry, frames });
              again = true;
            }
            continue;
          }
          if (!this.taskLinkMarkReadingIsQueryRow(row, entry.el)) continue;
          const marker = this.taskLinkMarkReadingAttribute(row, "data-task");
          if (marker === null || marker === undefined) {
            const waits = (entry.waits || 0) + 1;
            if (waits <= TASK_LINK_MARK_READING_PENDING_RETRIES) {
              this.taskLinkMarkReadingQueue.push({ ...entry, waits });
              again = true;
            }
            continue;
          }
          if (done.has(row)) continue;
          done.add(row);
          this.renderTaskLinkMarksIn(row, entry.ctx, true);
        } catch (error) {
          continue;
        }
      }
      if (again && this.taskLinkMarkReadingQueue.length) {
        this.taskLinkMarkReadingPending = true;
        this.taskLinkMarkReadingRequestFrame(() => this.runTaskLinkMarkReadingQueryRows());
      }
    } catch (error) {
      // A failed query frame never affects ordinary Reading links.
    }
  }

  taskLinkMarkReadingQueryRows(root) {
    const rows = [];
    try {
      const add = (node) => {
        try {
          if (
            !node ||
            this.taskLinkMarkReadingTag(node) !== "LI" ||
            !this.taskLinkMarkReadingIsQueryRow(node, node)
          ) {
            return;
          }
          if (rows.indexOf(node) === -1) rows.push(node);
        } catch (error) {
          // One bad node never hides the rest.
        }
      };
      add(root);
      if (root && typeof root.querySelectorAll === "function") {
        for (const node of Array.from(root.querySelectorAll("li") || [])) {
          add(node);
        }
      }
    } catch (error) {
      // Query-row discovery is best-effort.
    }
    return rows;
  }

  sweepTaskLinkMarksReading(options = {}) {
    try {
      const resolved = new Map();
      const allowSwap = Boolean(options && options.allowSwap);
      for (const doc of this.taskLinkMarkReadingDocuments()) {
        this.taskLinkMarkReadingBindClicks(doc);
        for (const anchor of this.taskLinkMarkReadingAnchors(doc, "a[data-bob-task-link-src]")) {
          try {
            const sourcePath = this.taskLinkMarkReadingAttribute(anchor, "data-bob-task-link-src");
            if (!sourcePath) {
              this.taskLinkMarkReadingRemoveHost(anchor);
              continue;
            }
            this.taskLinkMarkReadingReconcile(anchor, sourcePath, { allowSwap, resolved });
          } catch (error) {
            continue;
          }
        }
        // Tasks injects `li.plugin-tasks-list-item` after Markdown
        // post-processing. Stamp unstamped query-row candidates whose
        // origin path is proven (data-task-path / backlink).
        for (const row of this.taskLinkMarkReadingQueryRows(doc)) {
          try {
            const origin = typeof this.taskThemeOriginFor === "function"
              ? this.taskThemeOriginFor(row, row, null)
              : null;
            const ctx = {
              sourcePath: origin && typeof origin.path === "string" ? origin.path : "",
            };
            for (const anchor of this.taskLinkMarkReadingAnchors(row, "a.internal-link")) {
              try {
                if (!this.taskLinkMarkReadingAnchorBelongsToRow(anchor, row)) continue;
                if (this.taskLinkMarkReadingAttribute(anchor, "data-bob-task-link-src")) {
                  continue;
                }
                if (!this.taskLinkMarkReadingIsCandidate(anchor)) continue;
                const sourcePath = this.taskLinkMarkReadingSourcePathFor(anchor, ctx, row);
                if (!sourcePath) continue;
                this.taskLinkMarkReadingSetAttribute(anchor, "data-bob-task-link-src", sourcePath);
                this.taskLinkMarkReadingReconcile(anchor, sourcePath, { allowSwap, resolved });
              } catch (error) {
                continue;
              }
            }
          } catch (error) {
            continue;
          }
        }
      }
    } catch (error) {
      // The cross-window sweep is best-effort.
    }
  }
}
