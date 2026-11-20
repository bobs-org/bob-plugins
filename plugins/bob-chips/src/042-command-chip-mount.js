// Mounting one command-chip face: paint from the shared store, subscribe to
// its run key and to catalog changes, repaint in place, and route deliberate
// gestures to commandChipActivate. Live Preview widgets and Reading buttons
// share this; unmounting one face never cancels a run or another face's ink.
const commandChipMounts = new WeakMap();
const COMMAND_CHIP_KEY_CLICK_MS = 1000;

function commandChipMountOf(host) {
  try {
    const mount = host ? commandChipMounts.get(host) : null;
    return mount && !mount.destroyed ? mount : null;
  } catch (error) {
    return null;
  }
}

// The activation context a renderer supplies, made fresh per call, plus the
// plugin and element this mount owns.
function commandChipMountContext(mount, extra) {
  let base = {};
  try {
    const made = typeof mount.context === "function" ? mount.context() : null;
    base = made && typeof made === "object" ? made : {};
  } catch (error) {
    base = {};
  }
  return { ...base, ...(extra || {}), plugin: mount.plugin, element: mount.host };
}

// Recompute the paint model and repaint. A changed run key (loading to
// ready, a rekey, a catalog swap) moves the store subscription with it.
// `announce` is true only for store transitions, never for a first paint.
function commandChipMountRepaint(mount, announce) {
  try {
    if (!mount || mount.destroyed) return null;
    const paint = commandChipPaintModel(mount.plugin, mount.chip, commandChipMountContext(mount));
    if (paint.key !== mount.key) {
      if (mount.unsubscribeKey) mount.unsubscribeKey();
      mount.unsubscribeKey = null;
      mount.key = paint.key;
      const store = commandChipStoreOf(mount.plugin);
      if (store) mount.unsubscribeKey = store.subscribe(paint.key, () => commandChipMountRepaint(mount, true));
    }
    mount.paint = paint;
    mount.painter(mount.host, paint, { plugin: mount.plugin, chip: mount.chip });
    if (announce) commandChipAnnounceTransition(mount.plugin, paint, mount.chip, mount.host.ownerDocument || null);
    return paint;
  } catch (error) {
    return null;
  }
}

// Mount `host` (from commandChipBuildInline) for `chip` (`{ form, label,
// text, line, from, to }` in chipAt coordinates). `options.context()`
// returns the renderer's fresh activation context without plugin/element.
// `options.paint(host, paint, { plugin, chip })` replaces commandChipPaint
// for other faces (the `bob-run` card), and `options.gestureHost` takes the
// gestures instead of `host` (the card's Run button). Returns the mount;
// commandChipUnmount(host) is idempotent.
function commandChipMount(plugin, host, chip, options) {
  try {
    if (!host || !chip) return null;
    const previous = commandChipMountOf(host);
    if (previous) commandChipUnmount(host);
    const opts = options && typeof options === "object" ? options : {};
    const mount = {
      plugin: plugin || null,
      host,
      chip: copyChipFreeze({ ...chip }),
      context: typeof opts.context === "function" ? opts.context : null,
      painter: typeof opts.paint === "function" ? opts.paint : commandChipPaint,
      key: null,
      paint: null,
      unsubscribeKey: null,
      unsubscribeCatalog: null,
      detachGestures: null,
      destroyed: false,
    };
    commandChipMounts.set(host, mount);
    mount.unsubscribeCatalog = commandChipOnCatalogChanged(mount.plugin, () => commandChipMountRepaint(mount, false));
    if (opts.gestures !== false) {
      const target = opts.gestureHost || host;
      mount.detachGestures = commandChipAttachGestures(target, (gesture) => commandChipMountActivate(mount, gesture));
    }
    commandChipMountRepaint(mount, false);
    return mount;
  } catch (error) {
    return null;
  }
}

// Point a kept face at its chip's new place (a widget reused after an edit
// moved its span). Identity, stale evidence, and armed ink follow.
function commandChipMountRetarget(host, chip) {
  const mount = commandChipMountOf(host);
  if (!mount || !chip) return false;
  mount.chip = copyChipFreeze({ ...chip });
  commandChipMountRepaint(mount, false);
  return true;
}

function commandChipUnmount(host) {
  try {
    const mount = host ? commandChipMounts.get(host) : null;
    if (!mount || mount.destroyed) return false;
    mount.destroyed = true;
    commandChipMounts.delete(host);
    for (const name of ["unsubscribeKey", "unsubscribeCatalog", "detachGestures"]) {
      try {
        if (typeof mount[name] === "function") mount[name]();
      } catch (error) {
        // Cleanup is best-effort.
      }
      mount[name] = null;
    }
    copyChipClearFeedback(host);
    return true;
  } catch (error) {
    return false;
  }
}

// One deliberate gesture. The store drives every repaint while a run lives;
// the settled repaint picks up policy changes (a renamed note, an engine).
function commandChipMountActivate(mount, gesture) {
  try {
    if (!mount || mount.destroyed) return Promise.resolve(null);
    const g = gesture && typeof gesture === "object" ? gesture : {};
    const ctx = commandChipMountContext(mount, { shift: g.shift === true, alt: g.alt === true });
    return Promise.resolve(commandChipActivate(mount.chip, ctx)).then((result) => {
      commandChipMountRepaint(mount, false);
      return result;
    }, () => {
      commandChipMountRepaint(mount, false);
      return null;
    });
  } catch (error) {
    return Promise.resolve(null);
  }
}

function commandChipEventPoint(event) {
  try {
    const touch = (event && event.changedTouches && event.changedTouches[0]) ||
      (event && event.touches && event.touches[0]) || null;
    if (touch) return { x: touch.clientX, y: touch.clientY };
    return { x: event.clientX, y: event.clientY };
  } catch (error) {
    return { x: NaN, y: NaN };
  }
}

function commandChipPrevent(event) {
  try {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
  } catch (error) {
    // Default suppression is best-effort.
  }
}

// Gestures shared by span and button faces. A primary click or tap that
// stays under the copy chips' 4 px threshold activates; Shift opens. Enter
// and Space activate (Shift+Enter opens). Secondary buttons, drags,
// cancelled touches, and releases outside never activate, mousedown never
// moves the editor caret, and the native click a button fires after a key
// or mouse activation is swallowed; a bare synthetic click (assistive
// technology) still activates once. Returns a detach function.
function commandChipAttachGestures(host, onActivate) {
  if (!host || typeof host.addEventListener !== "function" || typeof onActivate !== "function") return () => {};
  const state = { start: null, keyAt: -Infinity };
  const fire = (gesture) => {
    try {
      const pending = onActivate(gesture);
      if (pending && typeof pending.catch === "function") pending.catch(() => {});
    } catch (error) {
      // A failed activation never breaks the next gesture.
    }
  };
  const release = (event, pointerType) => {
    const start = state.start;
    state.start = null;
    if (!start) return;
    const ok = copyChipLiveGestureShouldCopy(start, commandChipEventPoint(event), {
      button: pointerType === "touch" ? 0 : event && event.button,
      releasedInside: true,
      pointerType,
    });
    if (!ok) return;
    commandChipPrevent(event);
    fire({ shift: start.shift || Boolean(event && event.shiftKey), alt: start.alt || Boolean(event && event.altKey), via: pointerType });
  };
  const handlers = {
    mousedown(event) {
      if (!event || event.button !== 0) {
        state.start = null;
        return;
      }
      commandChipPrevent(event);
      state.start = { ...commandChipEventPoint(event), shift: Boolean(event.shiftKey), alt: Boolean(event.altKey) };
    },
    mouseup(event) {
      release(event, "mouse");
    },
    mouseleave() {
      state.start = null;
    },
    touchstart(event) {
      state.start = { ...commandChipEventPoint(event), shift: false, alt: false };
    },
    touchcancel() {
      state.start = null;
    },
    touchend(event) {
      release(event, "touch");
    },
    keydown(event) {
      if (!event || (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar")) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      commandChipPrevent(event);
      state.keyAt = Date.now();
      if (event.repeat) return;
      fire({ shift: Boolean(event.shiftKey), alt: false, via: "keyboard" });
    },
    keyup(event) {
      if (event && (event.key === " " || event.key === "Spacebar")) commandChipPrevent(event);
    },
    click(event) {
      commandChipPrevent(event);
      if (event && Number(event.detail) > 0) return;
      if (Date.now() - state.keyAt < COMMAND_CHIP_KEY_CLICK_MS) return;
      fire({ shift: Boolean(event && event.shiftKey), alt: false, via: "click" });
    },
  };
  const options = { touchstart: { passive: true } };
  for (const [type, handler] of Object.entries(handlers)) {
    try {
      host.addEventListener(type, handler, options[type]);
    } catch (error) {
      // Listener wiring is best-effort.
    }
  }
  return () => {
    for (const [type, handler] of Object.entries(handlers)) {
      try {
        if (typeof host.removeEventListener === "function") host.removeEventListener(type, handler, options[type]);
      } catch (error) {
        // Listener cleanup is best-effort.
      }
    }
  };
}
