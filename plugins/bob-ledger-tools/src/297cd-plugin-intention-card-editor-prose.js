// Intention card editor prose completion (S14): the intention input, the
// summary input, and the reflection textarea attach nav's `proseField` LINK
// band, so `[[` completes notes, headings, and blocks and `((` completes tasks. The band
// host sits inside the stage directly under the field. Repaints rebuild the
// stage, so every paint rebinds the same handle to the new input and host;
// the band, its selection, the caret, and Esc dismissal memory survive. The
// handle is the first rung of the card's back-out ladder and sees the
// stage's keys before the card does. No nav, an old nav, or a thrown call
// means the stage types exactly as before. Completion only inserts text.

// nav's proseField, or null when nav is missing, old, or unloaded.
function intentionCardEditorProseApi(modal) {
  try {
    const app = modal && (modal.app || (modal.intentionPlugin && modal.intentionPlugin.app));
    const plugins = app && app.plugins && app.plugins.plugins;
    const nav = plugins ? plugins["bob-navigation-hotkeys"] : null;
    const api = nav && nav.api;
    const prose = api && api.proseField;
    if (!prose || Number(prose.version) < 1 || typeof prose.attach !== "function") return null;
    return prose;
  } catch (_) {
    return null;
  }
}

function intentionCardEditorProseHandle(modal) {
  const state = modal && modal.intentionProse;
  return state && state.handle ? state.handle : null;
}

function intentionCardEditorProseIsNaming(modal) {
  const handle = intentionCardEditorProseHandle(modal);
  try { return Boolean(handle && typeof handle.isNaming === "function" && handle.isNaming()); } catch (_) { return false; }
}

function intentionCardEditorProseDetach(modal) {
  const state = modal && modal.intentionProse;
  if (!state) return false;
  modal.intentionProse = null;
  try { state.handle?.detach?.(); } catch (_) {}
  return true;
}

// A repaint removes the focused stage input; Chromium blurs it on removal,
// which would close an open band before the rebind. That blur is the card's
// own repaint, not the user leaving the field, so it never reaches the band.
function intentionCardEditorProseGuardBlur(modal, input) {
  try {
    if (!input || typeof input.addEventListener !== "function" || input.bobIntentionProseBlurGuard) return;
    const guard = (event) => {
      if (modal.intentionProsePainting !== true) return;
      try { event?.stopImmediatePropagation?.(); } catch (_) {}
    };
    input.addEventListener("blur", guard, true);
    input.bobIntentionProseBlurGuard = guard;
  } catch (_) {}
}

// After every paint: attach on stage open, rebind the same handle while the
// stage kind holds, detach when the stage closes. Returns the live handle.
function intentionCardEditorSyncProse(modal) {
  if (!modal) return null;
  let input = null;
  let band = null;
  try {
    const card = modal.contentEl?.querySelector?.(".bob-intention-card-editor");
    input = card?.querySelector?.("[data-intention-input]") || null;
    band = card?.querySelector?.("[data-intention-band]") || null;
  } catch (_) {}
  const stage = modal.stage;
  if (!stage || modal.closed || !input || !band) {
    intentionCardEditorProseDetach(modal);
    return null;
  }
  const current = modal.intentionProse;
  if (current && current.handle && current.kind === stage.kind) {
    if (current.input === input && current.band === band) return current.handle;
    intentionCardEditorProseGuardBlur(modal, input);
    try { current.handle.rebind({ inputEl: input, bandHost: band }); } catch (_) {}
    current.input = input;
    current.band = band;
    // The fresh host has no hint line yet; re-check it for a closed band.
    try {
      if (!current.handle.isLinkOpen?.()) current.handle.setSourcePath?.(current.sourcePath);
    } catch (_) {}
    return current.handle;
  }
  intentionCardEditorProseDetach(modal);
  const prose = intentionCardEditorProseApi(modal);
  if (!prose) return null;
  intentionCardEditorProseGuardBlur(modal, input);
  // A getter: the band always resolves `[[#` and the nearby list against the
  // note the card is on now, including after [ / ] travel.
  const sourcePath = () => (modal.subjectPath ? String(modal.subjectPath) : null);
  let handle = null;
  try {
    handle = prose.attach({
      inputEl: input,
      bandHost: band,
      sourcePath,
      recall: null,
      links: true,
      tasks: true,
      mode: "inline",
      density: "roomy",
      ownKeys: false,
      arrowKeys: true,
    });
  } catch (_) {
    handle = null;
  }
  if (!handle) return null;
  modal.intentionProse = { handle, kind: stage.kind, input, band, sourcePath };
  return handle;
}

// Offer a stage key to the band before the card's own Enter handling.
// Consumed keys (row moves, accepts, drills, the held-Enter swallow) never
// reach the card, so Enter or Ctrl+Enter with the band open never saves.
function intentionCardEditorProseKey(modal, event) {
  const handle = intentionCardEditorProseHandle(modal);
  if (!handle || !modal.stage || !event) return false;
  try {
    const target = event.target;
    if (target && typeof target.hasAttribute === "function" && !target.hasAttribute("data-intention-input")) return false;
  } catch (_) {}
  let consumed = false;
  try { consumed = handle.handleKeydown(event) === true; } catch (_) { consumed = false; }
  if (!consumed) return false;
  try { event.preventDefault?.(); } catch (_) {}
  try { event.stopPropagation?.(); } catch (_) {}
  return true;
}

// First rung of the back-out ladder: an open band closes alone, one layer
// per Esc / Ctrl+[ press, before the stage cancels.
function intentionCardEditorProseBackOut(modal) {
  const handle = intentionCardEditorProseHandle(modal);
  if (!handle || !modal.stage) return false;
  try { return handle.backOut() === true; } catch (_) { return false; }
}
