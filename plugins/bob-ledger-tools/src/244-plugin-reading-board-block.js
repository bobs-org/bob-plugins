// --- Reading Board block (bob-cli-99.3) -----------------------------------
// The `bob-reading-board` code block: a read-only kanban of the reading
// queue. bob decides every lane and reason (`bob ref list` JSON, see the
// data and model fragments); this mixin only paints it, routes gestures to
// Obsidian's own navigation, and never calls a vault write API.

const READING_BOARD_MOUNT_REVALIDATE_MS = 3000;
const READING_BOARD_PROCESSOR = "bob-reading-board";
const READING_BOARD_PAGE = "dash_references";
const READING_BOARD_NAV_PLUGIN_ID = "bob-navigation-hotkeys";

let ReadingBoardMenu = null;
try {
  ReadingBoardMenu = require("obsidian").Menu || null;
} catch (error) {
  ReadingBoardMenu = null;
}

class BobLedgerToolsReadingBoardBlockMixin {
  readingBoardViewStateFor(sourcePath) {
    if (!(this.readingBoardViewStates instanceof Map)) {
      this.readingBoardViewStates = new Map();
    }
    const key = typeof sourcePath === "string" ? sourcePath : "";
    let state = this.readingBoardViewStates.get(key);
    if (!state) {
      state = { snoozedCollapsed: false };
      this.readingBoardViewStates.set(key, state);
    }
    return state;
  }

  readingBoardPaintGens() {
    if (!(this.readingBoardPaintGenMap instanceof Map)) {
      this.readingBoardPaintGenMap = new Map();
    }
    return this.readingBoardPaintGenMap;
  }

  // Overridable clock, so tests and the preview pin the date.
  readingBoardNowDate() {
    return new Date();
  }

  readingBoardIsMacOS() {
    return Boolean(Platform && Platform.isMacOS === true);
  }

  readingBoardNavApi() {
    try {
      const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
      const nav = plugins ? plugins[READING_BOARD_NAV_PLUGIN_ID] : null;
      return nav && nav.api && typeof nav.api === "object" ? nav.api : null;
    } catch (error) {
      return null;
    }
  }

  // The PDF button exists only where Highlights can open it: macOS plus
  // the navigation plugin's additive `openReferencePdf` member.
  readingBoardCaps() {
    const api = this.readingBoardNavApi();
    return {
      pdf: Boolean(api && typeof api.openReferencePdf === "function" && this.readingBoardIsMacOS()),
    };
  }

  // Today never guesses: without a ready cache no card gets a TODAY pill.
  readingBoardTodayContext(now) {
    let ready = false;
    try {
      ready = this.isTodayCacheReady(now) === true;
    } catch (error) {
      ready = false;
    }
    const rank =
      ready && this.todayCache && this.todayCache.rank instanceof Map
        ? this.todayCache.rank
        : new Map();
    return { today: this.todayLocalDate(now), todayReady: ready, todayRank: rank };
  }

  setupReadingBoardBlock() {
    try {
      if (typeof this.registerMarkdownCodeBlockProcessor === "function") {
        this.registerMarkdownCodeBlockProcessor(READING_BOARD_PROCESSOR, (source, el, ctx) =>
          this.renderReadingBoardBlock(el, ctx, source),
        );
      }
    } catch (error) {
      // Block registration is best-effort.
    }
    try {
      if (typeof this.addCommand === "function") {
        this.addCommand({
          id: "open-reading-board",
          name: "Open Reading Board",
          callback: () => {
            try {
              const workspace = this.app && this.app.workspace;
              if (workspace && typeof workspace.openLinkText === "function") {
                void workspace.openLinkText(READING_BOARD_PAGE, "", false);
                return;
              }
            } catch (error) {
              // Fall through to the Notice below.
            }
            try {
              new Notice("Could not open Reading Board");
            } catch (error) {
              // Notice is best-effort.
            }
          },
        });
      }
    } catch (error) {
      // Command registration is best-effort.
    }
  }

  teardownReadingBoardBlock() {
    if (this.readingBoardPaintGenMap instanceof Map) {
      this.readingBoardPaintGenMap.clear();
    }
    if (this.readingBoardViewStates instanceof Map) {
      this.readingBoardViewStates.clear();
    }
  }

  renderReadingBoardBlock(el, ctx, source) {
    if (!el) {
      return;
    }
    const fence = readingBoardParseFence(source);
    const view = {
      el,
      sourcePath: (ctx && ctx.sourcePath) || "",
      fence: { parent: fence.parent, type: fence.type },
      fenceLints: fence.lints,
      board: null,
      model: null,
      report: null,
      renderKey: null,
      anchor: null,
      anchorNode: null,
      busy: false,
      refreshError: null,
      liveEl: null,
    };
    this.readingBoardViewsStore().add(view);
    const release = () => {
      this.readingBoardViewsStore().delete(view);
      this.readingBoardPaintGens().delete(el);
    };
    if (ctx && typeof ctx.addChild === "function") {
      let child = null;
      try {
        if (typeof MarkdownRenderChild === "function") {
          child = new MarkdownRenderChild(el);
          child.onunload = release;
        }
      } catch (error) {
        child = null;
      }
      if (!child) {
        child = { unload: release };
      }
      try {
        ctx.addChild(child);
      } catch (error) {
        // Older hosts may reject the child; teardown clears the Set.
      }
    }
    const cached = this.readingBoardCacheGet(readingBoardCacheKey(readingBoardBuildArgs(view.fence)));
    this.paintReadingBoardBlock(view);
    if (cached && Date.now() - cached.fetchedAt > READING_BOARD_MOUNT_REVALIDATE_MS) {
      // A cached frame is already on screen; refresh it in the background.
      Promise.resolve(this.apiReadingBoardFetch(view.fence)).catch(() => {});
    }
  }

  // Paint from the cache when it has data (never spawns, so a repaint after
  // a revalidation cannot start another one); otherwise show the skeleton
  // and fetch once.
  paintReadingBoardBlock(view) {
    if (!view || !view.el) {
      return;
    }
    const gens = this.readingBoardPaintGens();
    const paintGen = (gens.get(view.el) || 0) + 1;
    gens.set(view.el, paintGen);
    const cached = this.readingBoardCacheGet(readingBoardCacheKey(readingBoardBuildArgs(view.fence)));
    if (cached) {
      if (view.refreshError && cached.fetchedAt > view.refreshError.at) {
        view.refreshError = null;
      }
      this.readingBoardRenderResult(view, { report: cached.report });
      return;
    }
    this.readingBoardPaintSkeleton(view, false);
    const settle = (result) => {
      if (gens.get(view.el) !== paintGen) {
        return;
      }
      if (result && result.report) {
        this.readingBoardViewDataApplied(view);
      }
      this.readingBoardRenderResult(view, result || { report: null });
    };
    Promise.resolve()
      .then(() => this.apiReadingBoardFetch(view.fence))
      .then(settle, (error) =>
        settle({
          report: null,
          error: {
            code: "failed",
            message: String((error && error.message) || error),
            detail: "",
          },
        }),
      );
  }

  readingBoardClear(view) {
    if (typeof view.el.empty === "function") {
      view.el.empty();
    } else {
      view.el.textContent = "";
    }
  }

  readingBoardPaintSkeleton(view, force) {
    try {
      const doc = statsDocFor(view.el);
      if (!doc) {
        return;
      }
      if (!force && view.el.querySelector && view.el.querySelector(".bob-reading-board")) {
        return;
      }
      this.readingBoardClear(view);
      view.board = null;
      view.renderKey = null;
      view.el.appendChild(readingBoardBuildSkeleton(doc));
    } catch (error) {
      // Skeleton is best-effort.
    }
  }

  readingBoardFindInfo(board, node) {
    let current = node;
    for (let depth = 0; current && depth < 8; depth += 1) {
      const info = board.nodeInfo.get(current);
      if (info) {
        return { node: current, ...info };
      }
      current = current.parentNode || current.parentElement || null;
    }
    return null;
  }

  // Focus and per-lane scroll of the board about to be replaced.
  readingBoardCaptureState(view) {
    const captured = { hadFocus: false, focused: null, scroll: {} };
    const board = view.board;
    if (!board || !board.root) {
      return captured;
    }
    try {
      const doc = statsDocFor(view.el);
      const active = doc && doc.activeElement;
      if (active && board.root.contains && board.root.contains(active)) {
        captured.hadFocus = true;
        const info = this.readingBoardFindInfo(board, active);
        if (info) {
          captured.focused = { laneId: info.laneId, path: info.path };
        }
      }
      for (const laneId of READING_BOARD_LANE_IDS) {
        const body = board.bodies[laneId];
        if (body && body.scrollTop) {
          captured.scroll[laneId] = body.scrollTop;
        }
      }
    } catch (error) {
      // Capturing is best-effort; a lost scroll position is cosmetic.
    }
    return captured;
  }

  // The board is one Tab stop: exactly one node carries tabindex 0.
  readingBoardSetAnchor(view, node) {
    if (!node || !view.board) {
      return;
    }
    if (view.anchorNode && view.anchorNode !== node) {
      view.anchorNode.setAttribute("tabindex", "-1");
    }
    view.board.root.setAttribute("tabindex", "-1");
    node.setAttribute("tabindex", "0");
    view.anchorNode = node;
    view.anchor = { laneId: node.getAttribute("data-lane"), path: node.getAttribute("data-path") };
  }

  readingBoardSyncBusy(view) {
    const board = view.board;
    if (!board || !board.root) {
      return;
    }
    readingBoardToggleClass(board.root, "bob-reading-board-busy", view.busy);
    if (view.busy) {
      board.root.setAttribute("aria-busy", "true");
    } else if (board.root.removeAttribute) {
      board.root.removeAttribute("aria-busy");
    } else {
      board.root.setAttribute("aria-busy", "false");
    }
    if (board.refreshButton) {
      board.refreshButton.setAttribute("aria-busy", view.busy ? "true" : "false");
    }
  }

  readingBoardAnnounce(view, text) {
    if (!view.liveEl) {
      return;
    }
    view.liveEl.textContent = text;
  }

  readingBoardLintsFor(view) {
    const lints = [];
    if (view.refreshError) {
      const at = readingBoardHeaderTime(view.report && view.report.generated_at);
      const detail =
        view.refreshError.error.detail || view.refreshError.error.message || "refresh failed";
      const failure = /^bob ref list /.test(detail) ? detail : `bob ref list failed: ${detail}`;
      lints.push({
        text: `Showing the board from ${at || "earlier"} · ${failure} · `,
        retry: () => this.readingBoardRefresh(view),
      });
    }
    return lints;
  }

  readingBoardRenderResult(view, result) {
    try {
      const doc = statsDocFor(view.el);
      if (!doc) {
        return;
      }
      const report = result && result.report;
      if (!report) {
        this.readingBoardRenderError(view, doc, result && result.error);
        return;
      }
      view.report = report;
      const now = this.readingBoardNowDate();
      const today = this.readingBoardTodayContext(now);
      const model = readingBoardModel(report, { ...today, lints: view.fenceLints });
      const state = this.readingBoardViewStateFor(view.sourcePath);
      const caps = this.readingBoardCaps();
      const lints = [
        ...model.lints.map((text) => ({ text })),
        ...this.readingBoardLintsFor(view),
      ];
      // The data time is excluded from the key: it changes on every fetch,
      // and an unchanged board is updated in place instead of repainted.
      const key = [
        readingBoardSignature({ ...model, generatedAt: null }),
        state.snoozedCollapsed ? "collapsed" : "open",
        caps.pdf ? "pdf" : "nopdf",
        lints.map((lint) => lint.text).join("\n"),
      ].join("|");
      view.model = model;
      if (
        view.board &&
        view.renderKey === key &&
        view.el.querySelector &&
        view.el.querySelector(".bob-reading-board")
      ) {
        if (view.board.timeEl) {
          view.board.timeEl.textContent = readingBoardHeaderTime(model.generatedAt);
        }
        this.readingBoardSyncBusy(view);
        return;
      }
      const prior = this.readingBoardCaptureState(view);
      if (!view.liveEl) {
        view.liveEl = readingBoardEl(doc, "div", {
          class: "bob-reading-board-sr",
          role: "status",
          "aria-live": "polite",
        });
      }
      const board = readingBoardBuildBoard(doc, model, {
        handlers: this.readingBoardHandlers(view),
        caps,
        state,
        busy: view.busy,
        lints,
        live: view.liveEl,
      });
      this.readingBoardClear(view);
      view.el.appendChild(board.root);
      view.board = board;
      view.renderKey = key;
      view.anchorNode = null;
      board.root.addEventListener("keydown", (event) => this.readingBoardKeydown(view, event));
      const lanes = readingBoardNavLanes(board.order, state);
      const anchorNode = readingBoardPickAnchor(lanes, view.anchor || prior.focused);
      if (anchorNode) {
        this.readingBoardSetAnchor(view, anchorNode);
      } else {
        board.root.setAttribute("tabindex", "0");
      }
      for (const laneId of READING_BOARD_LANE_IDS) {
        const body = board.bodies[laneId];
        if (body && prior.scroll[laneId]) {
          body.scrollTop = prior.scroll[laneId];
        }
      }
      if (prior.hadFocus) {
        const target = readingBoardPickAnchor(lanes, prior.focused) || board.root;
        this.readingBoardFocus(view, target);
      }
    } catch (error) {
      // A failed render never leaves an empty block: fall back to text.
      try {
        view.el.textContent = "Reading Board unavailable.";
      } catch (inner) {
        // Last-resort text is best-effort.
      }
    }
  }

  readingBoardRenderError(view, doc, error) {
    view.report = null;
    view.model = null;
    view.board = null;
    view.renderKey = null;
    view.anchorNode = null;
    const tried = error && Array.isArray(error.tried) ? error.tried : statsBobTriedList({});
    const model = readingBoardErrorModel(error || { code: "failed" }, { tried });
    this.readingBoardClear(view);
    const root = readingBoardEl(doc, "div", { class: "bob-reading-board bob-reading-board-failed" });
    const header = readingBoardEl(doc, "div", { class: "bob-reading-board-header" });
    header.appendChild(readingBoardEl(doc, "span", { class: "bob-reading-board-name" }, "🗂️ Reading Board"));
    root.appendChild(header);
    root.appendChild(readingBoardBuildErrorCard(doc, model, () => this.readingBoardRefresh(view)));
    view.el.appendChild(root);
  }

  readingBoardFocus(view, node) {
    try {
      if (!node) {
        return;
      }
      if (node !== view.board.root) {
        this.readingBoardSetAnchor(view, node);
      }
      if (typeof node.focus === "function") {
        node.focus({ preventScroll: true });
      }
      if (typeof node.scrollIntoView === "function") {
        node.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    } catch (error) {
      // Focus management is best-effort.
    }
  }

  // Manual refresh: forced spawn, busy state, and one polite announcement.
  readingBoardRefresh(view) {
    if (!view || view.busy) {
      return Promise.resolve();
    }
    view.busy = true;
    if (view.board) {
      this.readingBoardSyncBusy(view);
    } else {
      this.readingBoardPaintSkeleton(view, true);
    }
    const finish = (result) => {
      view.busy = false;
      let announcement = "";
      if (result && result.report) {
        if (result.error) {
          view.refreshError = { error: result.error, at: Date.now() };
          announcement = "Reading Board refresh failed. Showing the earlier board.";
        } else {
          view.refreshError = null;
          this.readingBoardViewDataApplied(view);
        }
        this.readingBoardRenderResult(view, { report: result.report });
        if (!result.error && view.model) {
          announcement = `Reading Board refreshed: ${view.model.summary.awake} awake, ${view.model.summary.snoozed} snoozed.`;
        }
      } else {
        view.refreshError = null;
        this.readingBoardRenderResult(view, { report: null, error: result && result.error });
        announcement = "Reading Board refresh failed.";
      }
      this.readingBoardAnnounce(view, announcement);
    };
    return Promise.resolve()
      .then(() => this.apiReadingBoardRefresh(view.fence))
      .then(finish, (error) =>
        finish({
          report: null,
          error: { code: "failed", message: String((error && error.message) || error), detail: "" },
        }),
      );
  }

  readingBoardToggleSnoozed(view) {
    const state = this.readingBoardViewStateFor(view.sourcePath);
    state.snoozedCollapsed = !state.snoozedCollapsed;
    if (view.report) {
      this.readingBoardRenderResult(view, { report: view.report });
    }
  }

  readingBoardOpenNote(view, card, newLeaf) {
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.openLinkText === "function") {
        void workspace.openLinkText(card.path, view.sourcePath || "", newLeaf === true);
        return;
      }
    } catch (error) {
      // Fall through to the Notice below.
    }
    try {
      new Notice("Could not open reference");
    } catch (error) {
      // Notice is best-effort.
    }
  }

  readingBoardOpenTask(view, card) {
    const target = readingBoardTaskTarget(card.task);
    if (!target) {
      this.readingBoardOpenNote(view, card, false);
      return;
    }
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.openLinkText === "function") {
        void workspace.openLinkText(target, view.sourcePath || "", false);
        return;
      }
    } catch (error) {
      // Fall through to the Notice below.
    }
    try {
      new Notice("Could not open reading task");
    } catch (error) {
      // Notice is best-effort.
    }
  }

  // Highlights hand-off. Without a PDF, off macOS, or without the
  // navigation plugin's member, the reference opens in a new tab instead.
  readingBoardOpenPdf(view, card) {
    const api = this.readingBoardNavApi();
    if (this.readingBoardCaps().pdf && card.sourcePdf && api) {
      try {
        Promise.resolve(api.openReferencePdf(card.sourcePdf)).catch(() => {});
        return;
      } catch (error) {
        // Fall through to the new-tab fallback.
      }
    }
    this.readingBoardOpenNote(view, card, true);
  }

  readingBoardHandlers(view) {
    return {
      open: (card, event, forceNewLeaf) =>
        this.readingBoardOpenNote(
          view,
          card,
          forceNewLeaf === true || Boolean(event && (event.ctrlKey || event.metaKey)),
        ),
      pdf: (card) => this.readingBoardOpenPdf(view, card),
      task: (card) => this.readingBoardOpenTask(view, card),
      refresh: () => this.readingBoardRefresh(view),
      toggleSnoozed: () => this.readingBoardToggleSnoozed(view),
      focus: (card, node) => this.readingBoardSetAnchor(view, node),
      hover: (card, node, event) => {
        try {
          const workspace = this.app && this.app.workspace;
          if (workspace && typeof workspace.trigger === "function") {
            workspace.trigger("hover-link", {
              event,
              source: "bob-reading-board",
              hoverParent: node,
              targetEl: node,
              linktext: card.path,
              sourcePath: view.sourcePath || "",
            });
          }
        } catch (error) {
          // Hover preview is best-effort only.
        }
      },
      contextmenu: (card, event) => {
        // Obsidian's own file menu for the note; best-effort, and the
        // native menu stays when the file or Menu API is missing.
        try {
          const file = this.app.vault.getAbstractFileByPath(card.path);
          if (!ReadingBoardMenu || !file) {
            return;
          }
          const menu = new ReadingBoardMenu();
          this.app.workspace.trigger("file-menu", menu, file, "bob-reading-board");
          if (event && typeof event.preventDefault === "function") {
            event.preventDefault();
          }
          menu.showAtMouseEvent(event);
        } catch (error) {
          // The file menu is optional.
        }
      },
    };
  }

  // One keydown handler on the board root. Cards and rows are focus
  // targets (roving tabindex); buttons keep their native keys.
  readingBoardKeydown(view, event) {
    const board = view.board;
    if (!board || !event || event.defaultPrevented) {
      return;
    }
    const target = event.target;
    const tag = String((target && (target.tagName || target.tag)) || "").toLowerCase();
    if (tag === "button" || tag === "input" || tag === "textarea" || tag === "select") {
      return;
    }
    const key = event.key;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    const prevent = () => {
      if (typeof event.preventDefault === "function") {
        event.preventDefault();
      }
    };
    if (plain && key === "r") {
      prevent();
      void this.readingBoardRefresh(view);
      return;
    }
    if (plain && key === "c") {
      prevent();
      this.readingBoardToggleSnoozed(view);
      return;
    }
    const info = this.readingBoardFindInfo(board, target);
    if (!info) {
      return;
    }
    const handlers = this.readingBoardHandlers(view);
    if (key === "Enter") {
      prevent();
      if (event.ctrlKey || event.metaKey) {
        handlers.pdf(info.card);
      } else if (event.altKey) {
        handlers.task(info.card);
      } else {
        handlers.open(info.card, event, false);
      }
      return;
    }
    if (!plain || event.shiftKey || !READING_BOARD_MOVE_KEYS[key]) {
      return;
    }
    prevent();
    const state = this.readingBoardViewStateFor(view.sourcePath);
    const lanes = readingBoardNavLanes(board.order, state);
    const lane = lanes.find((entry) => entry.id === info.laneId);
    const index = lane ? lane.nodes.indexOf(info.node) : 0;
    const next = readingBoardMoveTarget(lanes, info.laneId, index, key);
    if (next) {
      this.readingBoardFocus(view, next);
    }
  }
}
