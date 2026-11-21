// Shared picker wiring for Log Recall (phase picker-stages). The Task Card
// picker owns its inputs, previews, submits, and Esc behavior; these helpers
// only attach the USED BEFORE band below the preview, route keys, and clean
// up on stage changes. All handles use ownKeys:false: the picker keydown
// mixin offers Ctrl+N/P and arrows first, and Esc / Ctrl+[ back out first.
// The reason stages (S7-S10) also opt into the LINK band (links: true), so
// `[[` completes in Cancel, Release, Work, and Schedule Log text.
function pickerLogRecallKindForStage(stage) {
  if (stage === "schedule-work-log" || stage === "lane-release-reason") return "work";
  if (stage === "cancel-reason") return "cancel";
  return null;
}

function isPickerLogRecallStage(stage) {
  return stage === "schedule-review"
    || stage === "schedule-work-log"
    || stage === "lane-release-reason"
    || stage === "cancel-reason";
}

function getPickerLogHistorySnapshot(picker) {
  try {
    const api = getNavigationLogHistoryApi(picker && picker.app);
    return api && typeof api.snapshot === "function" ? api.snapshot() : null;
  } catch (_error) {
    return null;
  }
}

function countPhrasesForKind(snapshot, kind) {
  try {
    const logs = snapshot && Array.isArray(snapshot.logs) ? snapshot.logs : [];
    const log = logs.find((entry) => entry && entry.kind === kind);
    if (!log) return 0;
    const overlay = snapshot && snapshot.overlay ? snapshot.overlay : [];
    return logRecallMergePhrases(log, overlay, kind).length;
  } catch (_error) {
    return 0;
  }
}

function computeScheduleReviewPinnedSlots(picker) {
  const snapshot = getPickerLogHistorySnapshot(picker);
  if (!snapshot) return null;
  const scheduleTotal = countPhrasesForKind(snapshot, "schedule");
  const workTotal = countPhrasesForKind(snapshot, "work");
  if (scheduleTotal <= 0 && workTotal <= 0) return null;
  const cap = 5;
  const scheduleSlots = scheduleTotal > 0 ? Math.min(cap, scheduleTotal) : 0;
  const workSlots = workTotal > 0 ? Math.min(cap, workTotal) : 0;
  const pinned = Math.max(scheduleSlots, workSlots, 1);
  return pinned;
}

function ensurePickerLogRecallHost(picker) {
  if (picker.logRecallBandHost) {
    try {
      if (picker.logRecallBandHost.parent) return picker.logRecallBandHost;
      if (typeof picker.logRecallBandHost.isConnected === "boolean" && picker.logRecallBandHost.isConnected === false) {
        picker.logRecallBandHost = null;
      } else if (picker.contentEl && picker.logRecallBandHost.parent !== null) {
        return picker.logRecallBandHost;
      } else if (!picker.contentEl) {
        return picker.logRecallBandHost;
      }
    } catch (_error) {}
    if (picker.logRecallBandHost) {
      try {
        const parent = picker.logRecallBandHost.parent;
        if (parent && Array.isArray(parent.children) && parent.children.includes(picker.logRecallBandHost)) {
          return picker.logRecallBandHost;
        }
      } catch (_ignored) {}
    }
    picker.logRecallBandHost = null;
  }
  const contentEl = picker.contentEl;
  if (!contentEl || typeof contentEl.createDiv !== "function") return null;
  let host = null;
  try {
    host = contentEl.createDiv({ cls: "bob-log-recall-picker-host" });
  } catch (_error) {
    return null;
  }
  if (!host) return null;
  try {
    const footerEl = picker.footerEl || null;
    if (footerEl && typeof contentEl.insertBefore === "function") {
      contentEl.insertBefore(host, footerEl);
    }
  } catch (_error) {}
  picker.logRecallBandHost = host;
  return host;
}

function removePickerLogRecallHost(picker) {
  const host = picker.logRecallBandHost || null;
  picker.logRecallBandHost = null;
  if (!host) return;
  try {
    if (typeof host.empty === "function") host.empty();
  } catch (_error) {}
  try {
    if (host.parent && Array.isArray(host.parent.children)) {
      const index = host.parent.children.indexOf(host);
      if (index >= 0) host.parent.children.splice(index, 1);
      host.parent = null;
    } else if (typeof host.remove === "function") {
      host.remove();
    } else if (picker.contentEl && typeof picker.contentEl.removeChild === "function") {
      picker.contentEl.removeChild(host);
    }
  } catch (_error) {}
}

function installPickerLogRecallCleanup(picker) {
  if (!picker || picker.logRecallCleanupInstalled) return;
  picker.logRecallCleanupInstalled = true;
  try {
    const originalClose = picker.close;
    if (typeof originalClose === "function" && !originalClose.logRecallWrapped) {
      const wrappedClose = function (...args) {
        try {
          detachPickerLogRecall(this, { removeHost: true });
        } catch (_error) {}
        return originalClose.apply(this, args);
      };
      wrappedClose.logRecallWrapped = true;
      picker.close = wrappedClose;
    }
  } catch (_error) {}
  for (const name of ["returnToTaskCard", "returnHome"]) {
    try {
      const original = picker[name];
      if (typeof original === "function" && !original.logRecallWrapped) {
        const wrapped = function (...args) {
          try {
            detachPickerLogRecall(this, { removeHost: true });
          } catch (_error) {}
          return original.apply(this, args);
        };
        wrapped.logRecallWrapped = true;
        picker[name] = wrapped;
      }
    } catch (_error) {}
  }
}

function ensureScheduleReviewHandleForTarget(picker, target) {
  if (!picker || picker.stage !== "schedule-review") return;
  const reasonEl = picker.scheduleReviewReasonEl || null;
  const summaryEl = picker.scheduleReviewSummaryEl || null;
  if (target && summaryEl && target === summaryEl) {
    const active = picker.logRecallHandle || null;
    const needsSwitch = !active || picker.logRecallKind !== "work";
    if (needsSwitch && typeof picker.switchScheduleReviewLogRecall === "function") {
      try {
        picker.switchScheduleReviewLogRecall("work", summaryEl);
      } catch (_error) {}
      refreshScheduleReviewPinnedSlots(picker);
    }
  } else if (target && reasonEl && target === reasonEl) {
    const active = picker.logRecallHandle || null;
    const needsSwitch = !active || picker.logRecallKind !== "schedule";
    if (needsSwitch && typeof picker.switchScheduleReviewLogRecall === "function") {
      try {
        picker.switchScheduleReviewLogRecall("schedule", reasonEl);
      } catch (_error) {}
      refreshScheduleReviewPinnedSlots(picker);
    }
  }
}

function detachPickerLogRecall(picker, options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const handle = picker.logRecallHandle || null;
  picker.logRecallHandle = null;
  picker.logRecallStage = null;
  picker.logRecallInputEl = null;
  try { picker.logRecallKind = null; } catch (_error) {}
  try { detachPickerScheduledReasonLinks(picker); } catch (_error) {}
  if (handle) {
    try {
      if (typeof handle.detach === "function") handle.detach();
    } catch (_error) {}
  }
  if (opts.removeHost === true) removePickerLogRecallHost(picker);
  try {
    if (picker.logRecallUnsub && typeof picker.logRecallUnsub === "function") picker.logRecallUnsub();
  } catch (_error) {}
  picker.logRecallUnsub = null;
  return true;
}

function attachPickerLogRecall(picker, inputEl, kind, options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  if (!inputEl || !LOG_RECALL_KIND_META[kind]) return null;
  try {
    installPickerLogRecallCleanup(picker);
  } catch (_error) {}
  const host = ensurePickerLogRecallHost(picker);
  if (!host) return null;
  const previous = picker.logRecallHandle || null;
  picker.logRecallHandle = null;
  if (previous) {
    try {
      if (typeof previous.detach === "function") previous.detach();
    } catch (_error) {}
  }
  let recallApi = null;
  try {
    recallApi = getNavigationLogRecallApi(picker.app);
  } catch (_error) {
    recallApi = null;
  }
  if (!recallApi || typeof recallApi.attach !== "function") return null;
  let handle = null;
  try {
    handle = recallApi.attach({
      inputEl,
      kind,
      bandHost: host,
      density: "roomy",
      arrowKeys: true,
      ownKeys: false,
      ...(Number.isInteger(opts.pinnedSlots) ? { pinnedSlots: opts.pinnedSlots } : {}),
      links: true,
      sourcePath: () => pickerProseSourcePath(picker),
      ...(picker.plugin ? { plugin: picker.plugin } : {}),
      app: picker.app,
    });
  } catch (_error) {
    handle = null;
  }
  if (!handle) return null;
  picker.logRecallHandle = handle;
  picker.logRecallStage = picker.stage || null;
  picker.logRecallInputEl = inputEl;
  try { picker.logRecallKind = kind; } catch (_error) {}
  return handle;
}

function getPickerActiveLogRecall(picker) {
  if (!picker || !isPickerLogRecallStage(picker.stage)) return null;
  const handle = picker.logRecallHandle || null;
  if (!handle) return null;
  if (picker.logRecallStage && picker.logRecallStage !== picker.stage) return null;
  return handle;
}

function pickerLogRecallBackOut(picker) {
  const handle = getPickerActiveLogRecall(picker);
  if (!handle || typeof handle.backOut !== "function") return false;
  try {
    return handle.backOut() === true;
  } catch (_error) {
    return false;
  }
}

function offerPickerLogRecallKey(picker, event) {
  try {
    if (picker && picker.stage === "schedule-review" && event && event.target) {
      ensureScheduleReviewHandleForTarget(picker, event.target);
    }
  } catch (_error) {}
  const handle = getPickerActiveLogRecall(picker);
  if (!handle || typeof handle.handleKeydown !== "function") return false;
  let consumed = false;
  try {
    consumed = handle.handleKeydown(event) === true;
  } catch (_error) {
    consumed = false;
  }
  if (!consumed) return false;
  try {
    if (typeof event.preventDefault === "function") event.preventDefault();
    if (typeof event.stopPropagation === "function") event.stopPropagation();
  } catch (_error) {}
  return true;
}

function refreshScheduleReviewPinnedSlots(picker) {
  const handle = picker.logRecallHandle || null;
  if (!handle || picker.stage !== "schedule-review") return;
  const pinned = computeScheduleReviewPinnedSlots(picker);
  if (pinned == null) return;
  try {
    if (typeof handle.setPinnedSlots === "function") handle.setPinnedSlots(pinned);
  } catch (_error) {}
}

function subscribeScheduleReviewPinUpdates(picker) {
  try {
    if (picker.logRecallUnsub && typeof picker.logRecallUnsub === "function") picker.logRecallUnsub();
  } catch (_error) {}
  picker.logRecallUnsub = null;
  let logsApi = null;
  try {
    logsApi = getNavigationLogHistoryApi(picker.app);
  } catch (_error) {
    logsApi = null;
  }
  if (!logsApi || typeof logsApi.onChange !== "function") return;
  try {
    picker.logRecallUnsub = logsApi.onChange(() => refreshScheduleReviewPinnedSlots(picker)) || null;
  } catch (_error) {
    picker.logRecallUnsub = null;
  }
}

function setupScheduleReviewLogRecall(picker) {
  detachPickerLogRecall(picker);
  const reasonEl = picker.scheduleReviewReasonEl || null;
  const summaryEl = picker.scheduleReviewSummaryEl || null;
  const needsWorkLog = Boolean(picker.pendingScheduleReview && picker.pendingScheduleReview.needsWorkLog);
  if (!reasonEl && !(needsWorkLog && summaryEl)) return;
  const pinned = computeScheduleReviewPinnedSlots(picker);
  const focusedIsSummary = Boolean(
    needsWorkLog && summaryEl && picker.pendingScheduleReview
    && picker.pendingScheduleReview.focusField === "summary",
  );
  const initialEl = focusedIsSummary && summaryEl ? summaryEl : reasonEl;
  const initialKind = initialEl === summaryEl ? "work" : "schedule";
  if (!initialEl) return;
  const handle = attachPickerLogRecall(picker, initialEl, initialKind, pinned == null ? {} : { pinnedSlots: pinned });
  if (!handle) return;
  picker.logRecallStage = "schedule-review";
  subscribeScheduleReviewPinUpdates(picker);
  const switchTo = (kind, inputEl) => {
    if (!inputEl) return;
    if (picker.stage !== "schedule-review") return;
    const active = picker.logRecallHandle || null;
    // Refocusing the bound field keeps its handle, so LINK band state
    // (selection, dismissal memory) survives a focus round-trip.
    if (active && picker.logRecallInputEl === inputEl && picker.logRecallKind === kind) return;
    if (active) {
      try {
        if (typeof active.detach === "function") active.detach();
      } catch (_error) {}
      picker.logRecallHandle = null;
    }
    const nextPinned = computeScheduleReviewPinnedSlots(picker);
    const next = attachPickerLogRecall(picker, inputEl, kind, nextPinned == null ? {} : { pinnedSlots: nextPinned });
    if (next) {
      picker.logRecallStage = "schedule-review";
      subscribeScheduleReviewPinUpdates(picker);
    }
  };
  picker.switchScheduleReviewLogRecall = switchTo;
  try {
    if (reasonEl && typeof reasonEl.addEventListener === "function") {
      reasonEl.addEventListener("focus", () => {
        if (picker.stage !== "schedule-review") return;
        switchTo("schedule", reasonEl);
        refreshScheduleReviewPinnedSlots(picker);
      });
    }
  } catch (_error) {}
  try {
    if (summaryEl && typeof summaryEl.addEventListener === "function") {
      summaryEl.addEventListener("focus", () => {
        if (picker.stage !== "schedule-review") return;
        switchTo("work", summaryEl);
        refreshScheduleReviewPinnedSlots(picker);
      });
    }
  } catch (_error) {}
}

function setupSingleFieldPickerLogRecall(picker, kind) {
  detachPickerLogRecall(picker);
  const inputEl = picker.inputEl || null;
  if (!inputEl || !LOG_RECALL_KIND_META[kind]) return null;
  const handle = attachPickerLogRecall(picker, inputEl, kind, {});
  if (handle) picker.logRecallStage = picker.stage || null;
  return handle;
}
