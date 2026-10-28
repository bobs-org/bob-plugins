// `]]` / `[[` repeat the last bracket-walk family command used in this vault.
const BRACKET_REPEAT_STORAGE_KEY = "bob-navigation-hotkeys-bracket-repeat";
const BRACKET_REPEAT_EMPTY_NOTICE =
  "Nothing to repeat yet — press ]s, ]w, or ]n first";

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

function planBracketRepeat(type, direction) {
  const normalized = normalizeBracketRepeatType(type);
  if (normalized === null) {
    return null;
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

  repeatBracketWalk(direction) {
    const plan = planBracketRepeat(this.readBracketRepeatType(), direction);
    if (!plan) {
      new Notice(BRACKET_REPEAT_EMPTY_NOTICE);
      return false;
    }
    return this[plan.method](...plan.args);
  }
}
