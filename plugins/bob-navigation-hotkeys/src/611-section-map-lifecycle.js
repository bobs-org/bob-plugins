// Pure Section Map lifetime machine. Inject a clock and timers so tests can
// step Holding → Lingering → Fading → Hidden without wall time. No DOM.
const SECTION_MAP_LINGER_MS = 2000;
const SECTION_MAP_HOLD_CAP_MS = 6000;
const SECTION_MAP_FADE_MS = 180;
const SECTION_MAP_DISMISS_MS = 90;
const SECTION_MAP_ARIA_SETTLE_MS = 400;

function createSectionMapLifecycle(options = {}) {
  const now =
    typeof options.now === "function" ? options.now : () => Date.now();
  const schedule =
    typeof options.setTimeout === "function"
      ? options.setTimeout
      : (fn, ms) => setTimeout(fn, ms);
  const cancel =
    typeof options.clearTimeout === "function"
      ? options.clearTimeout
      : (id) => clearTimeout(id);
  const onChange = typeof options.onChange === "function" ? options.onChange : null;

  let state = "hidden";
  let generation = 0;
  let source = null;
  let fadeKind = null;
  let replayEntrance = false;
  const timers = [];

  function snapshot() {
    const fadeMs =
      state === "fading"
        ? fadeKind === "dismiss"
          ? SECTION_MAP_DISMISS_MS
          : SECTION_MAP_FADE_MS
        : 0;
    return Object.freeze({
      state,
      generation,
      source,
      fadeKind,
      fadeMs,
      replayEntrance,
      visible: state !== "hidden",
      now: now(),
    });
  }

  function emit() {
    if (onChange) {
      try {
        onChange(snapshot());
      } catch (_error) {
        // A listener failure never changes the machine.
      }
    }
  }

  function clearTimers() {
    while (timers.length > 0) {
      const id = timers.pop();
      try {
        cancel(id);
      } catch (_error) {
        // Broken clocks still rely on the generation guard.
      }
    }
  }

  function arm(ms, gen, fn) {
    const id = schedule(() => {
      if (gen !== generation) return;
      fn();
    }, ms);
    timers.push(id);
    return id;
  }

  function startFade(kind) {
    clearTimers();
    const gen = generation;
    fadeKind = kind === "dismiss" ? "dismiss" : "exit";
    replayEntrance = false;
    state = "fading";
    const ms = fadeKind === "dismiss" ? SECTION_MAP_DISMISS_MS : SECTION_MAP_FADE_MS;
    arm(ms, gen, () => {
      state = "hidden";
      source = null;
      fadeKind = null;
      replayEntrance = false;
      emit();
    });
    emit();
  }

  function enterLingering() {
    clearTimers();
    const gen = generation;
    fadeKind = null;
    state = "lingering";
    arm(SECTION_MAP_LINGER_MS, gen, () => startFade("exit"));
    emit();
  }

  function enterVisible(nextState, nextSource) {
    generation += 1;
    const gen = generation;
    const wasHidden = state === "hidden";
    clearTimers();
    replayEntrance = wasHidden;
    fadeKind = null;
    source = nextSource;
    state = nextState;
    if (nextState === "holding") {
      arm(SECTION_MAP_HOLD_CAP_MS, gen, () => enterLingering());
    } else if (nextState === "lingering") {
      arm(SECTION_MAP_LINGER_MS, gen, () => startFade("exit"));
    }
    emit();
    return gen;
  }

  return {
    getState() {
      return state;
    },
    getGeneration() {
      return generation;
    },
    snapshot,
    isVisible() {
      return state !== "hidden";
    },
    showJump(input = {}) {
      const ctrlDown = Boolean(input.ctrlDown);
      return enterVisible(ctrlDown ? "holding" : "lingering", "jump");
    },
    showPeek() {
      return enterVisible("pinned", "peek");
    },
    ctrlReleased() {
      if (state === "holding") enterLingering();
    },
    windowBlur() {
      if (state === "holding") enterLingering();
    },
    dismiss() {
      if (state === "hidden") return;
      startFade("dismiss");
    },
    destroy() {
      generation += 1;
      clearTimers();
      state = "hidden";
      source = null;
      fadeKind = null;
      replayEntrance = false;
      emit();
    },
  };
}
