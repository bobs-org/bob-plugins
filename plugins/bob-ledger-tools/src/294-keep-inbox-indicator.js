// Keep inbox indicator (keep-indicator-view): `bob-keep-inbox` status-bar
// item. bob owns the Keep count and check gates; the inbox count is recomputed
// from the Tasks cache. Desktop only, calm by default, never writes.

const KEEP_INBOX_STATUS_TIMEOUT_MS = 15000;
const KEEP_INBOX_TASKS_DEBOUNCE_MS = 150;
const KEEP_INBOX_FOCUS_THROTTLE_MS = 10 * 1000;
const KEEP_INBOX_UNCONFIGURED_FOCUS_THROTTLE_MS = 10 * 60 * 1000;
const KEEP_INBOX_MODIFY_DEBOUNCE_MS = 2000;
const KEEP_INBOX_REPAINT_MS = 60 * 1000;

function keepInboxIsDesktop() {
  try {
    const platform = typeof Platform !== "undefined" ? Platform : null;
    if (platform && platform.isDesktopApp === false) {
      return false;
    }
    if (platform && platform.isMobile === true) {
      return false;
    }
    return true;
  } catch (error) {
    return true;
  }
}

function keepInboxTaskLineNumber(task) {
  try {
    if (!task || typeof task !== "object") {
      return null;
    }
    const candidates = [];
    if (Number.isInteger(task.lineNumber)) {
      candidates.push({ value: task.lineNumber, base: 0 });
    }
    if (Number.isInteger(task.line)) {
      candidates.push({ value: task.line, base: 1 });
    }
    if (task.taskLocation && Number.isInteger(task.taskLocation.lineNumber)) {
      candidates.push({ value: task.taskLocation.lineNumber, base: 0 });
    }
    if (task.location && Number.isInteger(task.location.lineNumber)) {
      candidates.push({ value: task.location.lineNumber, base: 0 });
    }
    if (task.taskLocation && Number.isInteger(task.taskLocation.line)) {
      candidates.push({ value: task.taskLocation.line, base: 1 });
    }
    for (const candidate of candidates) {
      const zero = candidate.base === 1 ? candidate.value - 1 : candidate.value;
      if (Number.isInteger(zero) && zero >= 0) {
        return zero;
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

function keepInboxFirstOpenLineFromTasks(tasks, targetPath) {
  try {
    if (!Array.isArray(tasks) || !targetPath) {
      return null;
    }
    let best = null;
    for (const task of tasks) {
      try {
        if (!keepInboxIsTopLevelTask(task)) {
          continue;
        }
        if (!keepInboxSamePath(keepInboxTaskPath(task), targetPath)) {
          continue;
        }
        const symbol = keepInboxTaskSymbol(task);
        if (!symbol || symbol === "x" || symbol === "X" || symbol === "-") {
          continue;
        }
        const line = keepInboxTaskLineNumber(task);
        if (line === null) {
          continue;
        }
        if (best === null || line < best) {
          best = line;
        }
      } catch (error) {
        // One bad row never blocks the jump.
      }
    }
    return best;
  } catch (error) {
    return null;
  }
}

function keepInboxFirstOpenLineFromText(contents) {
  try {
    if (typeof contents !== "string" || !contents) {
      return null;
    }
    const lines = contents.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      // Top-level only: no indent. Fenced lines are skipped by tracking
      // code fences, mirroring the ledger scan.
      if (/^[ \t]/.test(line)) {
        continue;
      }
      const match = /^([-*+]\s+|\d+[.)]\s+)\[([^\]])\]/.exec(line);
      if (!match) {
        continue;
      }
      const symbol = match[2];
      if (symbol === "x" || symbol === "X" || symbol === "-") {
        continue;
      }
      return index;
    }
    return null;
  } catch (error) {
    return null;
  }
}

class BobLedgerToolsKeepInboxMixin {
  setupStatusBarItems() {
    try {
      this.setupFreshnessStatusBar();
    } catch (error) {
      // The review footer owns its errors; the Keep item still mounts.
    }
    try {
      this.setupKeepInboxIndicator();
    } catch (error) {
      // The Keep item never breaks the review footer.
    }
  }

  setupKeepInboxIndicator() {
    if (!keepInboxIsDesktop()) {
      return;
    }
    if (typeof this.addStatusBarItem !== "function") {
      return;
    }
    if (this.keepInboxEl) {
      return;
    }
    if (typeof this.keepInboxEnabled !== "boolean") {
      this.keepInboxEnabled = true;
    }
    let el = null;
    try {
      el = this.addStatusBarItem();
    } catch (error) {
      return;
    }
    if (!el) {
      return;
    }
    this.keepInboxEl = el;
    this.keepInboxLastStatus = null;
    this.keepInboxLastView = null;
    this.keepInboxPaintKey = "";
    this.keepInboxTasksReady = false;
    this.keepInboxCount = 0;
    this.keepInboxReadInFlight = false;
    this.keepInboxReadQueued = false;
    this.keepInboxLastReadAt = 0;
    this.keepInboxLastFocusReadAt = 0;
    this.keepInboxModifyTimer = null;
    this.keepInboxTasksTimer = null;
    try {
      if (typeof el.addClass === "function") {
        el.addClass("bob-keep-inbox");
      } else if (el.classList && typeof el.classList.add === "function") {
        el.classList.add("bob-keep-inbox");
      }
      if (typeof el.setAttribute === "function") {
        el.setAttribute("aria-hidden", "true");
      }
    } catch (error) {
      // Cosmetic only; the paint below still applies.
    }
    let parts = null;
    try {
      parts = keepInboxEnsureDom(el);
    } catch (error) {
      parts = null;
    }
    this.keepInboxParts = parts;
    // Inbox click only in this release; the Keep pill keeps tooltips.
    try {
      const inboxButton = parts && parts.inboxButton;
      const self = this;
      const onInboxClick = (event) => {
        try {
          if (event && typeof event.preventDefault === "function") {
            event.preventDefault();
          }
        } catch (error) {
          // Best-effort.
        }
        void self.openKeepInboxNote();
      };
      this.keepInboxClickBound = onInboxClick;
      if (inboxButton && typeof inboxButton.addEventListener === "function") {
        inboxButton.addEventListener("click", onInboxClick);
      } else if (typeof el.addEventListener === "function") {
        el.addEventListener("click", (event) => {
          try {
            const target = event && event.target;
            const inInbox =
              target &&
              parts &&
              parts.inboxButton &&
              typeof parts.inboxButton.contains === "function"
                ? parts.inboxButton.contains(target)
                : false;
            if (inInbox || target === parts.inboxButton) {
              onInboxClick(event);
            }
          } catch (error) {
            // Click routing is best-effort.
          }
        });
      }
    } catch (error) {
      // A status bar without a click still shows the counts.
    }
    try {
      this.setupKeepInboxActions();
    } catch (error) {
      // Actions never block the two read-only counts.
    }
    this.keepInboxSubscribe();
    // Initial paint hides until the first read (no flash).
    try {
      this.keepInboxUpdateView();
    } catch (error) {
      // Paint is best-effort.
    }
  }

  keepInboxSubscribe() {
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.onLayoutReady === "function") {
        this.registerEvent(
          workspace.onLayoutReady(() => {
            try {
              this.keepInboxRecountFromTasks("layout-ready");
            } catch (error) {}
            void this.keepInboxRequestRead("layout-ready");
            try {
              this.keepInboxActionScheduleInitialCheck();
            } catch (error) {}
          }),
        );
      }
    } catch (error) {
      // Layout scheduling is best-effort.
    }
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.on === "function" && typeof this.registerEvent === "function") {
        this.registerEvent(
          workspace.on("obsidian-tasks-plugin:cache-update", () => {
            try {
              this.keepInboxRecountFromTasks("cache-update");
            } catch (error) {}
          }),
        );
      }
    } catch (error) {
      // Tasks subscription is best-effort.
    }
    try {
      if (typeof window !== "undefined" && window && typeof this.registerDomEvent === "function") {
        this.registerDomEvent(window, "focus", () => {
          try {
            this.keepInboxOnFocus("window-focus");
          } catch (error) {}
        });
      }
    } catch (error) {
      // Focus handling is best-effort.
    }
    try {
      if (typeof document !== "undefined" && document && typeof this.registerDomEvent === "function") {
        this.registerDomEvent(document, "visibilitychange", () => {
          try {
            if (document.visibilityState === "visible") {
              this.keepInboxOnFocus("visibility");
            }
          } catch (error) {}
        });
      }
    } catch (error) {
      // Visibility handling is best-effort.
    }
    try {
      const vault = this.app && this.app.vault;
      if (vault && typeof vault.on === "function" && typeof this.registerEvent === "function") {
        for (const event of ["modify", "rename"]) {
          this.registerEvent(
            vault.on(event, (file, oldPath) => {
              try {
                this.keepInboxOnVaultEvent(event, file, oldPath);
              } catch (error) {}
            }),
          );
        }
      }
    } catch (error) {
      // Vault events are best-effort (they catch terminal pulls).
    }
    try {
      if (
        typeof this.registerInterval === "function" &&
        typeof window !== "undefined" &&
        typeof window.setInterval === "function"
      ) {
        // One-minute repaint keeps ages and the 24h unknown flip honest;
        // the paint key makes it free.
        this.registerInterval(
          window.setInterval(() => {
            try {
              this.keepInboxUpdateView();
            } catch (error) {
              // Best-effort repaint only.
            }
          }, KEEP_INBOX_REPAINT_MS),
        );
      }
    } catch (error) {
      // The timer is best-effort.
    }
  }

  keepInboxTargetPath() {
    try {
      const report =
        this.keepInboxLastStatus && this.keepInboxLastStatus.report
          ? this.keepInboxLastStatus.report
          : null;
      const docPath =
        report && report.inbox && typeof report.inbox.path === "string"
          ? report.inbox.path.trim()
          : "";
      if (docPath) {
        return docPath;
      }
    } catch (error) {
      // Fall through to the default.
    }
    return KEEP_INBOX_DEFAULT_TARGET;
  }

  keepInboxRecountFromTasks(reason) {
    try {
      if (this.keepInboxTasksTimer !== null && this.keepInboxTasksTimer !== undefined) {
        return;
      }
      const schedule =
        typeof window !== "undefined" && typeof window.setTimeout === "function"
          ? window.setTimeout
          : setTimeout;
      const self = this;
      this.keepInboxTasksTimer = schedule(() => {
        self.keepInboxTasksTimer = null;
        try {
          self.keepInboxRecountNow(reason);
        } catch (error) {
          // Recount is best-effort.
        }
      }, KEEP_INBOX_TASKS_DEBOUNCE_MS);
      if (this.keepInboxTasksTimer && typeof this.keepInboxTasksTimer.unref === "function") {
        try {
          this.keepInboxTasksTimer.unref();
        } catch (error) {}
      }
    } catch (error) {
      try {
        this.keepInboxRecountNow(reason);
      } catch (inner) {
        // Best-effort.
      }
    }
  }

  keepInboxRecountNow(reason) {
    let tasks = null;
    try {
      tasks = typeof planBlockTasks === "function" ? planBlockTasks(this.app) : null;
    } catch (error) {
      tasks = null;
    }
    if (!Array.isArray(tasks)) {
      this.keepInboxTasksReady = false;
      this.keepInboxUpdateView();
      return;
    }
    this.keepInboxTasksReady = true;
    let target = KEEP_INBOX_DEFAULT_TARGET;
    try {
      target = this.keepInboxTargetPath();
    } catch (error) {
      target = KEEP_INBOX_DEFAULT_TARGET;
    }
    let count = 0;
    try {
      count = keepInboxOpenCount(tasks, target);
    } catch (error) {
      count = 0;
    }
    this.keepInboxCount = count;
    this.keepInboxUpdateView();
  }

  keepInboxOnFocus(reason) {
    let now = 0;
    try {
      now = Date.now();
    } catch (error) {
      now = 0;
    }
    const last = Number(this.keepInboxLastFocusReadAt) || 0;
    const report =
      this.keepInboxLastStatus && this.keepInboxLastStatus.report
        ? this.keepInboxLastStatus.report
        : null;
    const unconfigured = report ? report.configured === false : false;
    const throttle = unconfigured
      ? KEEP_INBOX_UNCONFIGURED_FOCUS_THROTTLE_MS
      : KEEP_INBOX_FOCUS_THROTTLE_MS;
    if (now - last < throttle) {
      // Coalesce; the minute repaint still keeps ages honest.
      try {
        this.keepInboxUpdateView();
      } catch (error) {}
      return;
    }
    this.keepInboxLastFocusReadAt = now;
    this.keepInboxRecountFromTasks(reason);
    void this.keepInboxRequestRead(reason);
  }

  keepInboxOnVaultEvent(event, file, oldPath) {
    try {
      const path = file && typeof file.path === "string" ? file.path : "";
      const old = typeof oldPath === "string" ? oldPath : "";
      let target = KEEP_INBOX_DEFAULT_TARGET;
      try {
        target = this.keepInboxTargetPath();
      } catch (error) {
        target = KEEP_INBOX_DEFAULT_TARGET;
      }
      const matches =
        (path && keepInboxSamePath(path, target)) ||
        (old && keepInboxSamePath(old, target));
      if (!matches) {
        return;
      }
      if (this.keepInboxModifyTimer !== null && this.keepInboxModifyTimer !== undefined) {
        try {
          const clear =
            typeof window !== "undefined" && typeof window.clearTimeout === "function"
              ? window.clearTimeout
              : clearTimeout;
          clear(this.keepInboxModifyTimer);
        } catch (error) {}
        this.keepInboxModifyTimer = null;
      }
      const schedule =
        typeof window !== "undefined" && typeof window.setTimeout === "function"
          ? window.setTimeout
          : setTimeout;
      const self = this;
      this.keepInboxModifyTimer = schedule(() => {
        self.keepInboxModifyTimer = null;
        try {
          self.keepInboxRecountFromTasks("vault-" + event);
        } catch (error) {}
        void self.keepInboxRequestRead("vault-" + event);
      }, KEEP_INBOX_MODIFY_DEBOUNCE_MS);
    } catch (error) {
      // Vault handling is best-effort.
    }
  }

  refreshKeepInboxForCommandModeRun() {
    try {
      this.keepInboxRecountFromTasks("command-mode");
    } catch (error) {}
    void this.keepInboxRequestRead("command-mode");
  }

  keepInboxRequestRead(reason) {
    if (this.keepInboxReadInFlight) {
      this.keepInboxReadQueued = true;
      return Promise.resolve(null);
    }
    return this.keepInboxReadNow(reason);
  }

  async keepInboxReadNow(reason) {
    if (!this.keepInboxEl) {
      return null;
    }
    if (this.keepInboxReadInFlight) {
      this.keepInboxReadQueued = true;
      return null;
    }
    this.keepInboxReadInFlight = true;
    try {
      let result = null;
      try {
        const resolveBobPath = () =>
          typeof this.apiStatsBobPath === "function"
            ? this.apiStatsBobPath()
            : { path: "bob", source: "path" };
        const getVaultPath = () =>
          typeof this.statsVaultBasePath === "function"
            ? this.statsVaultBasePath()
            : null;
        result = await bobSpawnJson(["gkeep", "status", "-f", "json"], keepInboxDecodeStatus, {
          commandLabel: "bob gkeep status",
          resolveBobPath,
          getVaultPath,
          timeout: KEEP_INBOX_STATUS_TIMEOUT_MS,
        });
      } catch (error) {
        result = null;
      }
      if (result && typeof result === "object") {
        this.keepInboxLastStatus = result;
        try {
          if (typeof Date.now === "function") {
            this.keepInboxLastReadAt = Date.now();
            if (reason === "window-focus" || reason === "visibility" || reason === "layout-ready") {
              this.keepInboxLastFocusReadAt = this.keepInboxLastReadAt;
            }
          }
        } catch (error) {
          // Timestamps are best-effort.
        }
      }
      try {
        this.keepInboxUpdateView();
      } catch (error) {
        // Paint is best-effort.
      }
      return result;
    } finally {
      this.keepInboxReadInFlight = false;
      if (this.keepInboxReadQueued) {
        this.keepInboxReadQueued = false;
        void this.keepInboxReadNow("queued");
      }
    }
  }

  keepInboxUpdateView() {
    const el = this.keepInboxEl;
    if (!el) {
      return null;
    }
    let report = null;
    try {
      report = this.keepInboxLastStatus;
    } catch (error) {
      report = null;
    }
    let view = null;
    try {
      const inboxDoc =
        report && report.report && report.report.inbox ? report.report.inbox : null;
      view = keepInboxViewModel({
        status: report,
        inboxCount: this.keepInboxCount,
        tasksReady: this.keepInboxTasksReady === true,
        defaultTargetExists: this.keepInboxDefaultTargetExists(inboxDoc),
        enabled: this.keepInboxEnabled !== false,
        now: new Date(),
      });
    } catch (error) {
      view = null;
    }
    if (!view) {
      return null;
    }
    this.keepInboxLastView = view;
    try {
      this.keepInboxParts = keepInboxPaint(el, view);
    } catch (error) {
      // The status bar never throws.
    }
    return view;
  }

  keepInboxDefaultTargetExists(inboxDoc) {
    try {
      if (inboxDoc && typeof inboxDoc.exists === "boolean") {
        return inboxDoc.exists;
      }
      const vault = this.app && this.app.vault;
      if (vault && typeof vault.getAbstractFileByPath === "function") {
        const target = this.keepInboxTargetPath();
        return Boolean(vault.getAbstractFileByPath(target));
      }
    } catch (error) {
      // Existence checks are best-effort.
    }
    // Optimistic when the vault cannot answer: the unsupported row hides
    // only when the default file is known missing.
    return true;
  }

  async openKeepInboxNote() {
    let target = KEEP_INBOX_DEFAULT_TARGET;
    try {
      target = this.keepInboxTargetPath();
    } catch (error) {
      target = KEEP_INBOX_DEFAULT_TARGET;
    }
    let file = null;
    try {
      const vault = this.app && this.app.vault;
      if (vault && typeof vault.getAbstractFileByPath === "function") {
        file = vault.getAbstractFileByPath(target);
      }
    } catch (error) {
      file = null;
    }
    if (!file) {
      try {
        new Notice(target + " not found");
      } catch (error) {}
      return false;
    }
    let leaf = null;
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.getLeaf === "function") {
        leaf = workspace.getLeaf(false);
      }
    } catch (error) {
      leaf = null;
    }
    if (!leaf || typeof leaf.openFile !== "function") {
      return false;
    }
    try {
      await leaf.openFile(file);
    } catch (error) {
      return false;
    }
    let line = null;
    try {
      const tasks =
        typeof planBlockTasks === "function" ? planBlockTasks(this.app) : null;
      if (Array.isArray(tasks)) {
        line = keepInboxFirstOpenLineFromTasks(tasks, target);
      }
    } catch (error) {
      line = null;
    }
    if (line === null || line === undefined) {
      try {
        const vault = this.app && this.app.vault;
        if (vault && typeof vault.read === "function") {
          const contents = await vault.read(file);
          line = keepInboxFirstOpenLineFromText(contents);
        }
      } catch (error) {
        line = null;
      }
    }
    if (line === null || line === undefined) {
      return true;
    }
    try {
      const view = leaf.view;
      const editor = view && view.editor;
      if (editor && typeof editor.setCursor === "function") {
        editor.setCursor({ line, ch: 0 });
        if (typeof editor.focus === "function") {
          editor.focus();
        }
        if (typeof editor.scrollIntoView === "function") {
          editor.scrollIntoView({ line, ch: 0 });
        }
      }
    } catch (error) {
      // Cursor placement is best-effort.
    }
    return true;
  }
}
