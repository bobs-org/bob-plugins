// Keep inbox actions (keep-indicator-actions): attention-gated automatic
// checks, explicit review actions, and the session-only visibility toggle.
// bob remains the only component that decides whether a check may contact
// Google Keep. This fragment extends the Keep inbox mixin before installation.

const KEEP_INBOX_ACTION_COALESCE_MS = 15 * 1000;
const KEEP_INBOX_ACTION_ATTENTION_MS = 10 * 60 * 1000;
const KEEP_INBOX_ACTION_INITIAL_DELAY_MS = 15 * 1000;
const KEEP_INBOX_ACTION_MIN_TIMER_MS = 60 * 1000;
const KEEP_INBOX_ACTION_MAX_TIMER_MS = 2 * 60 * 60 * 1000;
const KEEP_INBOX_ACTION_REFRESH_TIMEOUT_MS = 60 * 1000;
const KEEP_INBOX_ACTION_REREAD_DELAY_MS = 10 * 1000;

let KeepInboxActionMenu = null;
try {
  KeepInboxActionMenu = require("obsidian").Menu || null;
} catch (error) {
  KeepInboxActionMenu = null;
}

function keepInboxActionPriority(mode) {
  if (mode === "forced") return 2;
  if (mode === "automatic") return 1;
  return 0;
}

function keepInboxActionReport(result) {
  return result && result.report && typeof result.report === "object"
    ? result.report
    : null;
}

function keepInboxActionTotal(result) {
  const report = keepInboxActionReport(result);
  const total = report && report.keep && report.keep.pull
    ? Number(report.keep.pull.total)
    : NaN;
  return Number.isFinite(total) ? total : null;
}

function keepInboxActionStatusArgs(mode) {
  const args = ["gkeep", "status"];
  if (mode === "automatic") {
    args.push("-r");
  } else if (mode === "forced") {
    args.push("-r", "-m", "0");
  }
  args.push("-f", "json");
  return args;
}

function keepInboxActionKeep(report) {
  return report && report.keep && typeof report.keep === "object"
    ? report.keep
    : null;
}

function keepInboxActionFormatClock(value) {
  try {
    const date = new Date(String(value || ""));
    if (!Number.isFinite(date.getTime())) return "";
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch (error) {
    return "";
  }
}

BobLedgerToolsKeepInboxMixin.prototype.keepInboxActionNow = function () {
  return Date.now();
};

BobLedgerToolsKeepInboxMixin.prototype.keepInboxActionSetTimeout = function (fn, delay) {
  const schedule =
    typeof window !== "undefined" && window && typeof window.setTimeout === "function"
      ? window.setTimeout.bind(window)
      : setTimeout;
  const timer = schedule(fn, delay);
  if (typeof this.register === "function") {
    try {
      this.register(() => this.keepInboxActionClearTimeout(timer));
    } catch (error) {
      // Obsidian cleanup is best-effort; every timer is also replaced or fired.
    }
  }
  return timer;
};

BobLedgerToolsKeepInboxMixin.prototype.keepInboxActionClearTimeout = function (timer) {
  if (timer === null || timer === undefined) return;
  try {
    const clear =
      typeof window !== "undefined" && window && typeof window.clearTimeout === "function"
        ? window.clearTimeout.bind(window)
        : clearTimeout;
    clear(timer);
  } catch (error) {
    // Best-effort timer cancellation.
  }
};

BobLedgerToolsKeepInboxMixin.prototype.keepInboxActionCanRefresh = function () {
  if (this.keepInboxEnabled === false) return false;
  const report = keepInboxActionReport(this.keepInboxLastStatus);
  return Boolean(report && report.configured === true);
};

BobLedgerToolsKeepInboxMixin.prototype.keepInboxActionAttended = function () {
  try {
    if (typeof document === "undefined" || !document) return false;
    if (document.visibilityState !== "visible") return false;
    if (typeof document.hasFocus !== "function" || !document.hasFocus()) return false;
    const last = Number(this.keepInboxLastInputAt);
    const age = this.keepInboxActionNow() - last;
    return Number.isFinite(last) && age >= 0 && age <= KEEP_INBOX_ACTION_ATTENTION_MS;
  } catch (error) {
    return false;
  }
};

BobLedgerToolsKeepInboxMixin.prototype.setupKeepInboxActions = function () {
  if (this.keepInboxActionsReady) return;
  this.keepInboxActionsReady = true;
  this.keepInboxLastInputAt = 0;
  this.keepInboxLastAutoTriggerAt = null;
  this.keepInboxAutoDue = false;
  this.keepInboxNextCheckTimer = null;
  this.keepInboxInitialCheckTimer = null;
  this.keepInboxInFlightRereadTimer = null;
  this.keepInboxStatusRequestInFlight = false;
  this.keepInboxQueuedStatusRequest = null;
  this.keepInboxForcedCheckPromise = null;
  this.keepInboxCheckingUser = false;
  this.keepInboxAuthNoticeShown = false;

  const parts = this.keepInboxParts;
  const self = this;
  const keepButton = parts && parts.keepButton;
  if (keepButton && typeof keepButton.addEventListener === "function") {
    keepButton.addEventListener("click", (event) => {
      try {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
        if (event && typeof event.stopPropagation === "function") event.stopPropagation();
      } catch (error) {}
      const view = self.keepInboxLastView;
      const tone = view && view.keep ? view.keep.tone : "unknown";
      if (tone === "fresh") {
        void self.keepInboxActionPreview(["gkeep", "pull"], "bob gkeep pull -d");
      } else if (tone === "signin") {
        void self.keepInboxActionPreview(["gkeep", "doctor"], "Run bob gkeep doctor in a terminal");
      } else {
        void self.keepInboxCheckNow();
      }
    });
  }
  for (const button of [keepButton, parts && parts.inboxButton]) {
    if (!button || typeof button.addEventListener !== "function") continue;
    button.addEventListener("contextmenu", (event) => {
      try {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
      } catch (error) {}
      self.keepInboxActionShowMenu(event);
    });
  }

  if (typeof this.addCommand === "function") {
    try {
      this.addCommand({
        id: "check-google-keep-now",
        name: "Check Google Keep now",
        callback: () => void this.keepInboxCheckNow(),
      });
    } catch (error) {}
    try {
      this.addCommand({
        id: "toggle-keep-inbox-indicator",
        name: "Toggle Keep inbox indicator",
        callback: () => this.keepInboxToggleEnabled(),
      });
    } catch (error) {}
  }

  try {
    if (typeof document !== "undefined" && document && typeof this.registerDomEvent === "function") {
      for (const eventName of ["keydown", "pointerdown", "wheel"]) {
        this.registerDomEvent(document, eventName, () => this.keepInboxActionOnInput());
      }
    }
  } catch (error) {
    // Input tracking is best-effort; without it no timer can pass the attention gate.
  }
  try {
    if (typeof window !== "undefined" && window && typeof this.registerDomEvent === "function") {
      this.registerDomEvent(window, "online", () => this.keepInboxOnFocus("online"));
    }
  } catch (error) {
    // Network availability is a best-effort refresh trigger.
  }
};

BobLedgerToolsKeepInboxMixin.prototype.keepInboxActionOnInput = function () {
  this.keepInboxLastInputAt = this.keepInboxActionNow();
  if (this.keepInboxAutoDue) this.keepInboxActionTryAutomatic("input");
};

BobLedgerToolsKeepInboxMixin.prototype.keepInboxActionScheduleInitialCheck = function () {
  if (this.keepInboxEnabled === false) return;
  if (this.keepInboxInitialCheckTimer !== null) {
    this.keepInboxActionClearTimeout(this.keepInboxInitialCheckTimer);
  }
  this.keepInboxInitialCheckTimer = this.keepInboxActionSetTimeout(() => {
    this.keepInboxInitialCheckTimer = null;
    this.keepInboxAutoDue = true;
    if (this.keepInboxActionAttended()) this.keepInboxActionTryAutomatic("layout-ready");
  }, KEEP_INBOX_ACTION_INITIAL_DELAY_MS);
};

const keepInboxViewOnFocus = BobLedgerToolsKeepInboxMixin.prototype.keepInboxOnFocus;
BobLedgerToolsKeepInboxMixin.prototype.keepInboxOnFocus = function (reason) {
  if (this.keepInboxActionCanRefresh() && this.keepInboxActionAttended()) {
    return this.keepInboxActionTryAutomatic(reason || "focus");
  }
  keepInboxViewOnFocus.call(this, reason);
  return Promise.resolve(null);
};

BobLedgerToolsKeepInboxMixin.prototype.keepInboxActionTryAutomatic = function (reason) {
  if (!this.keepInboxActionCanRefresh() || !this.keepInboxActionAttended()) return Promise.resolve(null);
  const now = this.keepInboxActionNow();
  const last = this.keepInboxLastAutoTriggerAt;
  if (Number.isFinite(last) && now - last < KEEP_INBOX_ACTION_COALESCE_MS) {
    return Promise.resolve(null);
  }
  this.keepInboxLastAutoTriggerAt = now;
  this.keepInboxAutoDue = false;
  return this.keepInboxEnqueueStatusRequest("automatic", reason || "automatic");
};

BobLedgerToolsKeepInboxMixin.prototype.keepInboxActionScheduleNextCheck = function (value) {
  if (this.keepInboxNextCheckTimer !== null) {
    this.keepInboxActionClearTimeout(this.keepInboxNextCheckTimer);
    this.keepInboxNextCheckTimer = null;
  }
  if (!this.keepInboxActionCanRefresh() || !value) return;
  const dueAt = new Date(String(value)).getTime();
  if (!Number.isFinite(dueAt)) return;
  const delay = Math.max(
    KEEP_INBOX_ACTION_MIN_TIMER_MS,
    Math.min(KEEP_INBOX_ACTION_MAX_TIMER_MS, dueAt - this.keepInboxActionNow()),
  );
  this.keepInboxNextCheckTimer = this.keepInboxActionSetTimeout(() => {
    this.keepInboxNextCheckTimer = null;
    this.keepInboxAutoDue = true;
    if (this.keepInboxActionAttended()) this.keepInboxActionTryAutomatic("next-check");
  }, delay);
};

BobLedgerToolsKeepInboxMixin.prototype.keepInboxActionApplyStatus = function (result) {
  if (!result || typeof result !== "object") return;
  const previous = keepInboxActionKeep(keepInboxActionReport(this.keepInboxLastStatus));
  const report = keepInboxActionReport(result);
  const current = keepInboxActionKeep(report);
  this.keepInboxLastStatus = result;
  this.keepInboxLastReadAt = this.keepInboxActionNow();
  if (
    previous && previous.verified === true && previous.state !== "auth" &&
    current && current.verified === true && current.state === "auth" &&
    !this.keepInboxAuthNoticeShown
  ) {
    this.keepInboxAuthNoticeShown = true;
    try {
      new Notice("Google Keep sign-in expired · run bob gkeep login in a terminal");
    } catch (error) {}
  }
  try {
    this.keepInboxUpdateView();
  } catch (error) {}
  this.keepInboxActionScheduleNextCheck(current && current.next_check_at);
};

BobLedgerToolsKeepInboxMixin.prototype.keepInboxEnqueueStatusRequest = function (mode, reason) {
  const requestMode = mode === "forced" || mode === "automatic" ? mode : "cache";
  if (requestMode !== "cache" && !this.keepInboxActionCanRefresh()) {
    return Promise.resolve({ ok: false, code: "skipped", skipped: "disabled" });
  }
  return new Promise((resolve) => {
    const request = { mode: requestMode, reason: reason || requestMode, waiters: [resolve] };
    if (this.keepInboxStatusRequestInFlight) {
      const queued = this.keepInboxQueuedStatusRequest;
      if (!queued) {
        this.keepInboxQueuedStatusRequest = request;
      } else {
        if (keepInboxActionPriority(request.mode) > keepInboxActionPriority(queued.mode)) {
          queued.mode = request.mode;
          queued.reason = request.reason;
        }
        queued.waiters.push(resolve);
      }
      return;
    }
    void this.keepInboxRunStatusRequest(request);
  });
};

BobLedgerToolsKeepInboxMixin.prototype.keepInboxRunStatusRequest = async function (request) {
  if (!request || (request.mode !== "cache" && !this.keepInboxActionCanRefresh())) {
    const skipped = { ok: false, code: "skipped", skipped: "disabled" };
    for (const resolve of (request && request.waiters) || []) resolve(skipped);
    return skipped;
  }
  this.keepInboxStatusRequestInFlight = true;
  this.keepInboxReadInFlight = true;
  let result = null;
  try {
    const resolveBobPath = () =>
      typeof this.apiStatsBobPath === "function"
        ? this.apiStatsBobPath()
        : { path: "bob", source: "path" };
    const getVaultPath = () =>
      typeof this.statsVaultBasePath === "function" ? this.statsVaultBasePath() : null;
    const timeout = request.mode === "cache"
      ? KEEP_INBOX_STATUS_TIMEOUT_MS
      : KEEP_INBOX_ACTION_REFRESH_TIMEOUT_MS;
    result = await bobSpawnJson(
      keepInboxActionStatusArgs(request.mode),
      keepInboxDecodeStatus,
      {
        commandLabel: "bob gkeep status",
        resolveBobPath,
        getVaultPath,
        timeout,
        execFile: this.keepInboxExecFile,
      },
    );
    this.keepInboxActionApplyStatus(result);
  } catch (error) {
    result = null;
  } finally {
    this.keepInboxStatusRequestInFlight = false;
    this.keepInboxReadInFlight = false;
    for (const resolve of request.waiters) resolve(result);
    const queued = this.keepInboxQueuedStatusRequest;
    this.keepInboxQueuedStatusRequest = null;
    if (queued) void this.keepInboxRunStatusRequest(queued);
  }
  return result;
};

// Existing view triggers keep their simple API; this override routes every
// cache read through the same single-flight queue as remote checks.
BobLedgerToolsKeepInboxMixin.prototype.keepInboxRequestRead = function (reason) {
  return this.keepInboxEnqueueStatusRequest("cache", reason || "cache");
};

BobLedgerToolsKeepInboxMixin.prototype.keepInboxCurrentTotal = function () {
  return keepInboxActionTotal(this.keepInboxLastStatus);
};

BobLedgerToolsKeepInboxMixin.prototype.keepInboxSetChecking = function (on) {
  try {
    if (this.keepInboxEl && typeof this.keepInboxEl.setAttribute === "function") {
      if (on) this.keepInboxEl.setAttribute("data-checking", "true");
      else this.keepInboxEl.removeAttribute("data-checking");
    }
  } catch (error) {}
};

BobLedgerToolsKeepInboxMixin.prototype.keepInboxAnimateCountChange = function () {
  const count = this.keepInboxParts && this.keepInboxParts.keepCount;
  if (!count) return;
  keepInboxToggleClass(count, "bob-keep-pill-count-enter", true);
  this.keepInboxActionSetTimeout(() => {
    keepInboxToggleClass(count, "bob-keep-pill-count-enter", false);
  }, 240);
};

BobLedgerToolsKeepInboxMixin.prototype.keepInboxCheckNow = function () {
  if (this.keepInboxEnabled === false || !this.keepInboxActionCanRefresh()) {
    return Promise.resolve(null);
  }
  if (this.keepInboxForcedCheckPromise) return this.keepInboxForcedCheckPromise;
  const previousTotal = this.keepInboxCurrentTotal();
  this.keepInboxCheckingUser = true;
  this.keepInboxSetChecking(true);
  const pending = this.keepInboxEnqueueStatusRequest("forced", "check-now")
    .then((result) => {
      const report = keepInboxActionReport(result);
      const keep = keepInboxActionKeep(report);
      const refresh = keep && keep.refresh && typeof keep.refresh === "object"
        ? keep.refresh
        : null;
      if (!refresh) return result;
      if (refresh.ran === true) {
        if (keep.state === "ok") {
          if (previousTotal !== keepInboxActionTotal(result)) this.keepInboxAnimateCountChange();
        } else {
          const reason = keep.error && typeof keep.error.message === "string"
            ? keep.error.message
            : keep.state || "unknown error";
          try {
            new Notice("Couldn't check Google Keep: " + reason);
          } catch (error) {}
        }
        return result;
      }
      if (refresh.skipped === "floor") {
        const checked = keepInboxNowMs(keep.checked_at);
        const age = checked ? this.keepInboxActionNow() - checked : null;
        const message = age !== null && age >= 0 && age <= 60 * 1000
          ? "Google Keep was checked " + Math.floor(age / 1000) + " s ago"
          : "Google Keep was checked less than a minute ago";
        try { new Notice(message); } catch (error) {}
      } else if (refresh.skipped === "backoff" && keep.state === "rate_limited") {
        const after = keepInboxActionFormatClock(keep.next_check_at);
        try {
          new Notice("Google asked Bob to slow down · try after " + (after || "the next check"));
        } catch (error) {}
      } else if (refresh.skipped === "in_flight") {
        try { new Notice("A Keep check is already running"); } catch (error) {}
        this.keepInboxActionScheduleInFlightReread();
      } else if (refresh.skipped === "busy") {
        try { new Notice("A Keep pull is running"); } catch (error) {}
      } else if (refresh.skipped === "auth") {
        try { new Notice("Google Keep sign-in expired · run bob gkeep login in a terminal"); } catch (error) {}
      }
      return result;
    })
    .finally(() => {
      this.keepInboxCheckingUser = false;
      this.keepInboxSetChecking(false);
      this.keepInboxForcedCheckPromise = null;
    });
  this.keepInboxForcedCheckPromise = pending;
  return pending;
};

BobLedgerToolsKeepInboxMixin.prototype.keepInboxActionScheduleInFlightReread = function () {
  if (this.keepInboxInFlightRereadTimer !== null) return;
  this.keepInboxInFlightRereadTimer = this.keepInboxActionSetTimeout(() => {
    this.keepInboxInFlightRereadTimer = null;
    void this.keepInboxRequestRead("check-now-in-flight");
  }, KEEP_INBOX_ACTION_REREAD_DELAY_MS);
};

BobLedgerToolsKeepInboxMixin.prototype.keepInboxActionCommandMode = function () {
  try {
    const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
    const commandMode = plugins && plugins["bob-command-mode"];
    const preview = commandMode && commandMode.api && commandMode.api.commandMode
      ? commandMode.api.commandMode.preview
      : null;
    return typeof preview === "function" ? { owner: commandMode.api.commandMode, preview } : null;
  } catch (error) {
    return null;
  }
};

BobLedgerToolsKeepInboxMixin.prototype.keepInboxActionPreview = async function (argv, fallback) {
  const commandMode = this.keepInboxActionCommandMode();
  if (!commandMode) {
    try { new Notice("Preview with: " + fallback); } catch (error) {}
    return false;
  }
  try {
    const result = await commandMode.preview.call(commandMode.owner, argv);
    if (result && result.ok === true) return true;
  } catch (error) {}
  try { new Notice("Preview with: " + fallback); } catch (error) {}
  return false;
};

BobLedgerToolsKeepInboxMixin.prototype.keepInboxToggleEnabled = function () {
  this.keepInboxEnabled = this.keepInboxEnabled === false;
  if (!this.keepInboxEnabled) {
    this.keepInboxAutoDue = false;
    for (const field of ["keepInboxNextCheckTimer", "keepInboxInitialCheckTimer"]) {
      if (this[field] !== null && this[field] !== undefined) {
        this.keepInboxActionClearTimeout(this[field]);
        this[field] = null;
      }
    }
    const queued = this.keepInboxQueuedStatusRequest;
    if (queued && queued.mode !== "cache") queued.mode = "cache";
  } else {
    void this.keepInboxRequestRead("toggle-on");
  }
  this.keepInboxUpdateView();
  return this.keepInboxEnabled;
};

BobLedgerToolsKeepInboxMixin.prototype.keepInboxActionAddMenuItem = function (menu, title, icon, callback) {
  try {
    menu.addItem((item) => {
      item.setTitle(title);
      if (icon && typeof item.setIcon === "function") item.setIcon(icon);
      item.onClick(callback);
    });
  } catch (error) {
    // One unavailable menu item must not suppress the others.
  }
};

BobLedgerToolsKeepInboxMixin.prototype.keepInboxActionShowMenu = function (event) {
  if (!KeepInboxActionMenu) return false;
  let menu = null;
  try { menu = new KeepInboxActionMenu(); } catch (error) { return false; }
  const commandMode = this.keepInboxActionCommandMode();
  const report = keepInboxActionReport(this.keepInboxLastStatus);
  const configured = Boolean(report && report.configured === true);
  if (configured && this.keepInboxEnabled !== false) {
    this.keepInboxActionAddMenuItem(menu, "Check Google Keep now", "refresh-cw", () => {
      void this.keepInboxCheckNow();
    });
  }
  if (commandMode) {
    this.keepInboxActionAddMenuItem(menu, "Preview Keep pull…", "lightbulb", () => {
      void this.keepInboxActionPreview(["gkeep", "pull"], "bob gkeep pull -d");
    });
  }
  if (this.keepInboxDefaultTargetExists(report && report.inbox)) {
    this.keepInboxActionAddMenuItem(menu, "Open gkeep_inbox.md", "inbox", () => {
      void this.openKeepInboxNote();
    });
  }
  if (commandMode) {
    this.keepInboxActionAddMenuItem(menu, "Keep setup check", "stethoscope", () => {
      void this.keepInboxActionPreview(["gkeep", "doctor"], "Run bob gkeep doctor in a terminal");
    });
  }
  this.keepInboxActionAddMenuItem(menu, "Hide until restart", "eye-off", () => {
    if (this.keepInboxEnabled !== false) this.keepInboxToggleEnabled();
  });
  try {
    if (typeof menu.showAtMouseEvent === "function") menu.showAtMouseEvent(event);
    return true;
  } catch (error) {
    return false;
  }
};

