// Property editor write safety, Esc, and YAML escape (write-safety).
// Outermost modal guards so cancel, close, row clicks, and selection
// changes refuse visibly while a save runs instead of invalidating it;
// Esc routes through the close ladder; the shared lock-wait state paints
// in the status line and Esc stops the wait. Session registration keeps
// the modal's session visible to generation, rename, and delete events.
const PROPERTY_EDITOR_SAVING_TEXT = "Saving… — wait for the property save to finish.";

// Card species a note kind can open with `=`. Day and period notes ride
// the intentions card; ordinary notes have no card editor.
function propertyEditorNoteKindSpecies(noteKind) {
  const kind = String(noteKind || "").trim().toLowerCase();
  if (kind === "record") return "record";
  if (kind === "album") return "album";
  if (kind === "bank") return "bank";
  if (kind === "intentions" || kind === "intention" || kind === "day"
    || kind === "week" || kind === "quarter" || kind === "year" || kind === "all_time") return "intentions";
  return null;
}

function propertyEditorLockWaitOf(modal) {
  try {
    const state = modal && modal.session && typeof modal.session.getState === "function"
      ? modal.session.getState()
      : null;
    return (state && state.lockWait) || null;
  } catch (_) {
    return null;
  }
}

function propertyEditorLockWaitText(lockWait) {
  try {
    if (typeof guardedUpdateLockWaitText === "function") return guardedUpdateLockWaitText(lockWait);
  } catch (_) {}
  return "Waiting for another Bob vault maintenance run… · Esc stops waiting";
}

const propertyEditorBackOutBeforeSafety = PropertyEditorModal.prototype.propertyEditorBackOut;
const propertyEditorSelectBeforeSafety = PropertyEditorModal.prototype.propertyEditorSelect;
const propertyEditorClickBeforeSafety = PropertyEditorModal.prototype.propertyEditorOnClick;

Object.assign(PropertyEditorModal.prototype, {
  propertyEditorRefuseWhileSaving() {
    this.announce = PROPERTY_EDITOR_SAVING_TEXT;
    try { this.paintPropertyEditor(); } catch (_) {}
  },

  // Esc stops a lock wait without retrying the uncertain write; otherwise
  // a pending save refuses the whole ladder with a visible notice.
  propertyEditorStopLockWaitIfWaiting() {
    const lockWait = propertyEditorLockWaitOf(this);
    if (!lockWait) return false;
    try {
      if (this.session && typeof this.session.stopWaiting === "function") this.session.stopWaiting();
    } catch (_) {}
    this.status = { kind: "checking", text: propertyEditorLockWaitText({ ...lockWait, stopping: true }) };
    this.announce = "";
    try { this.paintPropertyEditor(); } catch (_) {}
    return true;
  },

  // The shared controller's lock-waiting state surfaces in the status
  // line; the lock ticker repaints through onChange while it runs.
  propertyEditorSyncLockWait() {
    if (this.closed || !this.session) return false;
    const lockWait = propertyEditorLockWaitOf(this);
    if (!lockWait) return false;
    this.status = { kind: "checking", text: propertyEditorLockWaitText(lockWait) };
    this.announce = "";
    return true;
  },

  propertyEditorBackOut(event) {
    if (this.propertyEditorStopLockWaitIfWaiting()) return;
    if (this.pendingApply === true) {
      this.propertyEditorRefuseWhileSaving();
      return;
    }
    return propertyEditorBackOutBeforeSafety.call(this, event);
  },

  propertyEditorSelect(id) {
    if (this.pendingApply === true) {
      this.propertyEditorRefuseWhileSaving();
      return;
    }
    return propertyEditorSelectBeforeSafety.call(this, id);
  },

  propertyEditorOnClick(event) {
    if (this.pendingApply === true) {
      this.propertyEditorRefuseWhileSaving();
      return;
    }
    return propertyEditorClickBeforeSafety.call(this, event);
  },

  // Obsidian binds this scope's Escape to Modal's onEscapeKey at
  // construction, so a contentEl keydown handler can never preempt the
  // default close. Overriding onEscapeKey routes Esc through the same
  // back-out ladder as q and Ctrl+[, exactly like the record card does.
  onEscapeKey(event) {
    this.propertyEditorBackOut(event);
    return false;
  },
});

// Register the modal session so vault generation bumps, renames, and
// deletes reach it; unregister on close so a stale session never
// outlives its modal.
function propertyEditorRegisterSession(modal) {
  try {
    const plugin = modal && modal.propertyPlugin;
    const session = modal && modal.session;
    const path = modal && modal.filePath;
    if (!plugin || !session || !path) return;
    if (plugin.propertySessions instanceof Map) {
      const current = plugin.propertySessions.get(path);
      if (current && current !== session) {
        try { current.close(); } catch (_) {}
      }
      plugin.propertySessions.set(path, session);
    }
  } catch (_) {}
}

function propertyEditorUnregisterSession(modal) {
  try {
    const plugin = modal && modal.propertyPlugin;
    const session = modal && modal.session;
    const path = modal && modal.filePath;
    if (!plugin || !session || !path) return;
    if (plugin.propertySessions instanceof Map && plugin.propertySessions.get(path) === session) {
      plugin.propertySessions.delete(path);
    }
  } catch (_) {}
}
