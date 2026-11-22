// Task Card prose links (phase bob-cli-om.5).
//
// S7-S10 (cancel, release, Work summary, schedule review) attach the LINK
// band through attachPickerLogRecall with links: true. S11 is the scheduled
// stage's inline reason tail: `3 waiting on [[api`. That stage's input is
// a date filter, so its band opens only on an opener after a recognized
// date token plus whitespace (minOffset). The date token and plain preset
// filters never complete. Fail-open: without nav's proseField the stage is
// unchanged. Completion only inserts text; it never writes the vault.

// Reason text is written under the task, so same-note `[[#…` resolves
// against the task's own note: the one note every Task Link target shares
// in a link session (null when targets span notes), else the picker's note.
function pickerProseSourcePath(picker) {
  try {
    if (!picker) return null;
    if (typeof picker.isLinkSession === "function" && picker.isLinkSession()) {
      const resolved = Array.isArray(picker.linkSession.resolved)
        ? picker.linkSession.resolved
        : [];
      const paths = new Set();
      for (const target of resolved) {
        const path = target && typeof target.path === "string" ? target.path : "";
        if (path) paths.add(path);
      }
      return paths.size === 1 ? Array.from(paths)[0] : null;
    }
    const path = typeof picker.filePath === "string" ? picker.filePath : "";
    return path || null;
  } catch (_error) {
    return null;
  }
}

// The Task Card's target task(s) are every prose stage's subjects (S7-S11,
// T10/T11): `((` shows them disabled. They come from the same live target list
// the stage's own write plan uses, so a prompt never offers to link (or name)
// the task it is about to change. Never throws; a picker without targets
// declares none.
function pickerProseSubjects(picker) {
  try {
    if (!picker || typeof picker.getSchedulingWorkLogTargets !== "function") return [];
    return proseTaskSubjects(picker.getSchedulingWorkLogTargets());
  } catch (_error) {
    return [];
  }
}

// First offset where a `[[` may open in the scheduled stage: the end of the
// typed date token plus the whitespace after it. +Infinity when the query
// has no recognized date token (a preset filter, or an attached `3x`).
function scheduledReasonLinkMinOffset(text) {
  try {
    const value = String(text == null ? "" : text);
    const trimmed = value.replace(/^\s+/u, "");
    const lead = value.length - trimmed.length;
    const prefix = matchTypedSchedulePrefix(trimmed);
    if (!prefix || prefix.kind === "attached" || !prefix.token) return Infinity;
    const tokenEnd = lead + prefix.token.length;
    const gap = /^\s*/u.exec(value.slice(tokenEnd));
    return tokenEnd + (gap ? gap[0].length : 0);
  } catch (_error) {
    return Infinity;
  }
}

function getPickerProseFieldApi(picker) {
  try {
    const plugins = picker && picker.app && picker.app.plugins && picker.app.plugins.plugins;
    const holder = plugins && plugins["bob-navigation-hotkeys"];
    const api = holder && holder.api && holder.api.proseField;
    return api && Number(api.version) >= 1 && typeof api.attach === "function" ? api : null;
  } catch (_error) {
    return null;
  }
}

function detachPickerScheduledReasonLinks(picker) {
  if (!picker) return false;
  const handle = picker.scheduledReasonLinkHandle || null;
  picker.scheduledReasonLinkHandle = null;
  picker.scheduledReasonLinkInputEl = null;
  if (!handle) return false;
  try {
    if (typeof handle.detach === "function") handle.detach();
  } catch (_error) {}
  return true;
}

function attachPickerScheduledReasonLinks(picker) {
  if (!picker) return null;
  detachPickerScheduledReasonLinks(picker);
  try {
    if (typeof picker.isScheduledValueStage !== "function" || !picker.isScheduledValueStage()) return null;
  } catch (_error) {
    return null;
  }
  const inputEl = picker.inputEl || null;
  if (!inputEl) return null;
  const api = getPickerProseFieldApi(picker);
  if (!api) return null;
  try {
    installPickerLogRecallCleanup(picker);
  } catch (_error) {}
  const host = ensurePickerLogRecallHost(picker);
  if (!host) return null;
  let handle = null;
  try {
    handle = api.attach({
      inputEl,
      bandHost: host,
      recall: null,
      links: true,
      mode: "inline",
      density: "roomy",
      arrowKeys: true,
      ownKeys: false,
      subjects: () => pickerProseSubjects(picker),
      sourcePath: () => pickerProseSourcePath(picker),
      minOffset: () => scheduledReasonLinkMinOffset(inputEl.value),
      app: picker.app,
    });
  } catch (_error) {
    handle = null;
  }
  if (!handle) return null;
  picker.scheduledReasonLinkHandle = handle;
  picker.scheduledReasonLinkInputEl = inputEl;
  return handle;
}

// The value stage calls this after every render: attach on the scheduled
// stage, detach on any other value stage.
function syncPickerScheduledReasonLinks(picker) {
  try {
    if (picker && typeof picker.isScheduledValueStage === "function" && picker.isScheduledValueStage()) {
      return attachPickerScheduledReasonLinks(picker);
    }
    detachPickerScheduledReasonLinks(picker);
  } catch (_error) {}
  return null;
}

function getPickerScheduledReasonLinks(picker) {
  const handle = picker && picker.scheduledReasonLinkHandle;
  if (!handle) return null;
  let current = false;
  try {
    current = typeof picker.isScheduledValueStage === "function"
      && picker.isScheduledValueStage()
      && picker.scheduledReasonLinkInputEl === picker.inputEl;
  } catch (_error) {
    current = false;
  }
  if (!current) {
    detachPickerScheduledReasonLinks(picker);
    return null;
  }
  return handle;
}

// The value-stage keydown offers every key here first. Esc and Ctrl+[ close
// only the band (one layer per press); other keys reach the band before
// date-row navigation, Enter, Shift+Enter, Ctrl+Enter, and Ctrl+R. With the
// band closed nothing is consumed (beyond a held Enter that just accepted a
// row), so the typed-row behaviour is unchanged.
function offerPickerScheduledReasonLinkKey(picker, event) {
  const handle = getPickerScheduledReasonLinks(picker);
  if (!handle || !event) return false;
  if (event.isComposing === true || event.keyCode === 229) return false;
  let consumed = false;
  try {
    const plainEscape = event.key === "Escape"
      && event.ctrlKey !== true
      && event.metaKey !== true
      && event.altKey !== true;
    consumed = plainEscape || isCtrlLeftBracketKeydown(event)
      ? handle.backOut() === true
      : handle.handleKeydown(event) === true;
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

// Real Escape reaches the Task Card through Modal's onEscapeKey before any
// input listener runs. The focused prose field's band backs out first: the
// scheduled reason's LINK band, then the review/reason stage handle (LINK,
// then USED BEFORE). IME composition never backs out.
function pickerProseEscapeBackOut(picker, event) {
  if (!picker) return false;
  if (event && (event.isComposing === true || event.keyCode === 229)) return false;
  try {
    const doc = picker.inputEl && picker.inputEl.ownerDocument;
    const active = doc && doc.activeElement;
    if (active && picker.modalEl && typeof picker.modalEl.contains === "function" && !picker.modalEl.contains(active)) return false;
  } catch (_error) {}
  const links = getPickerScheduledReasonLinks(picker);
  try {
    if (links && typeof links.backOut === "function" && links.backOut() === true) return true;
  } catch (_error) {}
  return typeof pickerLogRecallBackOut === "function" && pickerLogRecallBackOut(picker);
}
