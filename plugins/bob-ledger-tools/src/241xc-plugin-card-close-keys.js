// Shared close-key helpers for Bob panels: every panel Esc closes or backs
// out of also does so with bare `q` and `Ctrl+[`, through Esc's own dispatch.
// DOM-free: no top-level document access; all DOM reads go through the
// event and panel arguments the card passes in.
function bobCardCloseKey(event) {
  try {
    if (!event || event.isComposing || event.keyCode === 229) return null;
    const hasCtrl = event.ctrlKey === true;
    const hasAlt = event.altKey === true;
    const hasMeta = event.metaKey === true;
    const hasShift = event.shiftKey === true;
    if (hasCtrl && !hasAlt && !hasMeta && !hasShift &&
        (event.code === "BracketLeft" || event.key === "[")) {
      return "ctrl-bracket";
    }
    if (event.key === "Escape") return "escape";
    if ((event.key === "q" || event.key === "Q") && !hasCtrl && !hasMeta && !hasAlt) return "q";
    return null;
  } catch (_) {
    return null;
  }
}

function bobCardCloseCandidate(event, panelEl) {
  try {
    const target = event && event.target && typeof event.target.closest === "function" ? event.target : null;
    if (target) return target;
    const doc = panelEl && panelEl.ownerDocument ? panelEl.ownerDocument : null;
    const active = doc ? doc.activeElement : null;
    if (active && typeof active.closest === "function") return active;
    return null;
  } catch (_) {
    return null;
  }
}

function bobCardTypesText(event, panelEl) {
  try {
    const candidate = bobCardCloseCandidate(event, panelEl);
    if (!candidate) return false;
    try {
      if (panelEl && typeof panelEl.contains === "function" && !panelEl.contains(candidate)) return false;
    } catch (_) {}
    const inField = Boolean(candidate.closest?.("input,select,textarea"));
    if (inField) return true;
    try {
      const editable = candidate.closest?.("[contenteditable]");
      if (editable) {
        const value = typeof editable.getAttribute === "function"
          ? editable.getAttribute("contenteditable")
          : editable.contentEditable;
        if (String(value).toLowerCase() !== "false") return true;
      }
    } catch (_) {}
    try {
      if (candidate.closest?.("[data-emoji-well]")) return true;
    } catch (_) {}
    try {
      if (candidate.closest?.(".bob-emoji-slot-search")) return true;
    } catch (_) {}
    return false;
  } catch (_) {
    return false;
  }
}

function bobCardConsume(event) {
  try { event?.preventDefault?.(); } catch (_) {}
  try { event?.stopPropagation?.(); } catch (_) {}
}

function bobCardWireCloseKeys(modal, options = {}) {
  try {
    if (!modal || !modal.scope || typeof modal.scope.register !== "function") return null;
    const backOut = typeof options.backOut === "function" ? options.backOut : null;
    const hintActive = typeof options.hintActive === "function" ? options.hintActive : null;
    if (!backOut) return null;
    const handler = (event) => {
      try {
        if (event && (event.defaultPrevented || event.__schemaEscapeHandled)) return true;
        const kind = bobCardCloseKey(event);
        if (kind !== "q" && kind !== "ctrl-bracket") return true;
        if (kind === "q") {
          let hinted = false;
          try { hinted = hintActive ? hintActive() === true : false; } catch (_) { hinted = false; }
          if (!hinted) {
            let panel = null;
            try { panel = modal.modalEl || modal.containerEl || modal.contentEl || null; } catch (_) { panel = null; }
            if (bobCardTypesText(event, panel)) return true;
          }
        }
        bobCardConsume(event);
        try { backOut(event); } catch (_) {}
        return false;
      } catch (_) {
        return true;
      }
    };
    let ref = null;
    try { ref = modal.scope.register(null, null, handler); } catch (_) { ref = null; }
    try {
      modal.bobCardCloseKeyRef = ref;
      modal.bobCardCloseKeyHandler = handler;
    } catch (_) {}
    return ref;
  } catch (_) {
    return null;
  }
}

function bobCardUnwireCloseKeys(modal) {
  try {
    if (!modal) return;
    const ref = modal.bobCardCloseKeyRef || null;
    try {
      if (ref && modal.scope && typeof modal.scope.unregister === "function") {
        modal.scope.unregister(ref);
      }
    } catch (_) {}
    try {
      modal.bobCardCloseKeyRef = null;
      modal.bobCardCloseKeyHandler = null;
    } catch (_) {}
  } catch (_) {}
}
