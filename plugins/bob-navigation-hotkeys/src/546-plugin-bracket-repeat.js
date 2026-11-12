// `]]` / `[[` repeat the last bracket-walk family command used in this vault.
// `]}` / `[{` repeat that family's uppercase jump (`]S` / `[S` review groups,
// `]W` / `[W` lanes); links (`n`) have no uppercase walk.
const BRACKET_REPEAT_STORAGE_KEY = "bob-navigation-hotkeys-bracket-repeat";
const BRACKET_REPEAT_EMPTY_NOTICE =
  "Nothing to repeat yet — press ]s, ]w, or ]n first";
const BRACKET_REPEAT_NO_UPPERCASE_NOTICE =
  "No uppercase link walk — ]} / [{ repeat ]S / [S or ]W / [W";

function normalizeBracketRepeatType(value) {
  return value === "s" || value === "w" || value === "n" ? value : null;
}

const BRACKET_REPEAT_PLANS = Object.freeze({
  s: Object.freeze({
    forward: Object.freeze({ method: "jumpToDueTask", args: Object.freeze([1]) }),
    backward: Object.freeze({ method: "jumpToDueTask", args: Object.freeze([-1]) }),
  }),
  w: Object.freeze({
    forward: Object.freeze({ method: "jumpToLaneTask", args: Object.freeze([1]) }),
    backward: Object.freeze({ method: "jumpToLaneTask", args: Object.freeze([-1]) }),
  }),
  n: Object.freeze({
    forward: Object.freeze({ method: "openLabeledBodyLink", args: Object.freeze(["next"]) }),
    backward: Object.freeze({ method: "openLabeledBodyLink", args: Object.freeze(["prev"]) }),
  }),
});

const BRACKET_REPEAT_UPPERCASE_PLANS = Object.freeze({
  s: Object.freeze({
    forward: Object.freeze({
      method: "jumpToDueTask",
      args: Object.freeze([1, Object.freeze({ groupJump: true })]),
    }),
    backward: Object.freeze({
      method: "jumpToDueTask",
      args: Object.freeze([-1, Object.freeze({ groupJump: true })]),
    }),
  }),
  w: Object.freeze({
    forward: Object.freeze({
      method: "jumpToLaneTask",
      args: Object.freeze([1, Object.freeze({ laneJump: true })]),
    }),
    backward: Object.freeze({
      method: "jumpToLaneTask",
      args: Object.freeze([-1, Object.freeze({ laneJump: true })]),
    }),
  }),
  n: null,
});

function planBracketRepeat(type, direction, options = {}) {
  const normalized = normalizeBracketRepeatType(type);
  if (normalized === null) {
    return null;
  }
  if (options && options.uppercase === true) {
    const entry = BRACKET_REPEAT_UPPERCASE_PLANS[normalized];
    if (entry === null || entry === undefined) {
      return null;
    }
    return entry[direction < 0 ? "backward" : "forward"];
  }
  return BRACKET_REPEAT_PLANS[normalized][direction < 0 ? "backward" : "forward"];
}

class BobNavigationHotkeysBracketRepeatMixin {
  rememberBracketRepeatType(type) {
    const normalized = normalizeBracketRepeatType(type);
    if (normalized === null) {
      return null;
    }
    if (this.bracketRepeatType !== normalized) {
      this.bracketRepeatType = normalized;
      try {
        if (this.app && typeof this.app.saveLocalStorage === "function") {
          this.app.saveLocalStorage(BRACKET_REPEAT_STORAGE_KEY, normalized);
        }
      } catch (error) {
        // Local storage is device-local convenience; memory remains authoritative.
      }
      try {
        if (typeof this.refreshBracketModeIndicator === "function") {
          this.refreshBracketModeIndicator();
        }
      } catch (error) {
        // The indicator never breaks the walk.
      }
      try {
        if (typeof fireWalkModeDoorbell === "function") {
          fireWalkModeDoorbell(this);
        }
      } catch (error) {
        // The doorbell never breaks the walk.
      }
    }
    return normalized;
  }

  readBracketRepeatType() {
    if (this.bracketRepeatType !== undefined) {
      return normalizeBracketRepeatType(this.bracketRepeatType);
    }
    let stored = null;
    try {
      if (this.app && typeof this.app.loadLocalStorage === "function") {
        stored = this.app.loadLocalStorage(BRACKET_REPEAT_STORAGE_KEY);
      }
    } catch (error) {
      // Fall back to in-memory state without surfacing storage errors.
    }
    this.bracketRepeatType = normalizeBracketRepeatType(stored);
    return this.bracketRepeatType;
  }

  repeatBracketWalk(direction, options = {}) {
    const uppercase = Boolean(options && options.uppercase === true);
    const type = this.readBracketRepeatType();
    const plan = planBracketRepeat(
      type,
      direction,
      uppercase ? { uppercase: true } : {},
    );
    if (!plan) {
      const message =
        uppercase && type !== null
          ? BRACKET_REPEAT_NO_UPPERCASE_NOTICE
          : BRACKET_REPEAT_EMPTY_NOTICE;
      new Notice(message);
      try {
        if (typeof this.flashBracketModeIndicator === "function") {
          this.flashBracketModeIndicator("empty");
        }
      } catch (error) {
        // The indicator never breaks the walk.
      }
      return false;
    }
    const args = plan.args.map((arg) =>
      arg !== null &&
      typeof arg === "object" &&
      Array.isArray(arg) === false
        ? { ...arg }
        : arg,
    );
    const result = this[plan.method](...args);
    try {
      if (typeof this.flashBracketModeIndicator === "function") {
        this.flashBracketModeIndicator(direction < 0 ? "backward" : "forward");
      }
    } catch (error) {
      // The indicator never breaks the walk.
    }
    return result;
  }
}
