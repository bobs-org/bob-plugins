// --- Task type identity for the #task slot (D11) ------------------------
// Owned by the `docs/task-tag-marks.md` display contract in bob-cli.
// Pure helpers only: the explicit `[type::]` / `[theme::]` field on a
// task line, identity state (explicit / inherited / muted /
// unconfigured / repair), tooltip and aria copy, and data-attribute
// application for Live Preview widgets and reading-view `a.tag` hosts.
// Hue lookup stays in the plugin so this file never spawns bob.
// Every helper is synchronous and never throws. Never put `::` in
// tooltip or aria text, because Dataview re-scans rendered text.

const TASK_TYPE_IDENTITY_HINT = "Ctrl+Shift+P t to change";
const TASK_TYPE_IDENTITY_STATES = Object.freeze([
  "explicit",
  "inherited",
  "muted",
  "unconfigured",
  "repair",
]);

function taskTagTypeSafeCopy(text) {
  try {
    return String(text == null ? "" : text).replace(/::/g, ":");
  } catch (error) {
    return "";
  }
}

// The explicit type field on `lineText`, or a none/repair record.
// `type` is the canonical ALL-CAPS name, `"?"` for repair, or null
// when the line has no field. Never throws.
function taskTagTypeFieldOf(lineText) {
  try {
    if (typeof lineText !== "string" || lineText === "") {
      return Object.freeze({
        type: null,
        key: null,
        fieldState: "none",
        repair: null,
      });
    }
    if (typeof pomodoroThemeTaskFieldState !== "function") {
      return Object.freeze({
        type: null,
        key: null,
        fieldState: "none",
        repair: null,
      });
    }
    const state = pomodoroThemeTaskFieldState(lineText);
    if (!state || typeof state !== "object") {
      return Object.freeze({
        type: null,
        key: null,
        fieldState: "none",
        repair: null,
      });
    }
    if (state.state === "repair") {
      return Object.freeze({
        type: "?",
        key: null,
        fieldState: "repair",
        repair: state.repair === "duplicate" ? "duplicate" : "invalid",
      });
    }
    if (state.state === "set") {
      const type =
        typeof state.value === "string" && state.value ? state.value : null;
      const key = typeof state.key === "string" && state.key ? state.key : null;
      if (!type) {
        return Object.freeze({
          type: "?",
          key: null,
          fieldState: "repair",
          repair: "invalid",
        });
      }
      return Object.freeze({
        type,
        key,
        fieldState: "set",
        repair: null,
      });
    }
    return Object.freeze({
      type: null,
      key: null,
      fieldState: "none",
      repair: null,
    });
  } catch (error) {
    return Object.freeze({
      type: null,
      key: null,
      fieldState: "none",
      repair: null,
    });
  }
}

function taskTagTypeHueSourceOf(hueInfo) {
  try {
    if (!hueInfo || typeof hueInfo !== "object") {
      return null;
    }
    if (typeof hueInfo.hue_source === "string" && hueInfo.hue_source) {
      return hueInfo.hue_source;
    }
    if (typeof hueInfo.hueSource === "string" && hueInfo.hueSource) {
      return hueInfo.hueSource;
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Visual identity state for one mark. Repair wins, then unconfigured
// (unknown / unconfigured hue source), then muted (exempt / auto),
// then inherited, then explicit. Never throws.
function taskTagIdentityKind(options) {
  try {
    const opts = options && typeof options === "object" ? options : {};
    if (opts.repair === true || opts.fieldState === "repair") {
      return "repair";
    }
    const hueSource = taskTagTypeHueSourceOf(opts);
    const known = opts.known !== false;
    if (known === false || hueSource === "unconfigured") {
      return "unconfigured";
    }
    if (hueSource === "exempt" || hueSource === "auto") {
      return "muted";
    }
    if (opts.inherited === true) {
      return "inherited";
    }
    return "explicit";
  } catch (error) {
    return "explicit";
  }
}

function taskTagIdentityFromField(field, hueInfo, extra) {
  try {
    const source = field && typeof field === "object" ? field : {};
    const more = extra && typeof extra === "object" ? extra : {};
    if (source.fieldState === "repair") {
      return Object.freeze({
        type: "?",
        key: null,
        hue: null,
        hueSource: null,
        state: "repair",
        inherited: false,
        reason: null,
        suggest: more.suggest || null,
      });
    }
    if (source.fieldState !== "set" || !source.type) {
      return null;
    }
    const hue =
      hueInfo && typeof hueInfo.hue === "string" && hueInfo.hue
        ? hueInfo.hue
        : null;
    const hueSource = taskTagTypeHueSourceOf(hueInfo);
    const known =
      hueInfo && Object.prototype.hasOwnProperty.call(hueInfo, "configured")
        ? hueInfo.configured !== false
        : more.known !== false;
    const state = taskTagIdentityKind({
      fieldState: "set",
      known,
      hue_source: hueSource,
    });
    return Object.freeze({
      type: source.type,
      key: source.key,
      hue: state === "unconfigured" || state === "repair" ? null : hue,
      hueSource,
      state,
      inherited: false,
      reason: more.reason || null,
      suggest: more.suggest || null,
    });
  } catch (error) {
    return null;
  }
}

function taskTagIdentityFromInherited(name, key, hueInfo, extra) {
  try {
    const type = typeof name === "string" && name ? name : null;
    if (!type) {
      return null;
    }
    const more = extra && typeof extra === "object" ? extra : {};
    const hue =
      hueInfo && typeof hueInfo.hue === "string" && hueInfo.hue
        ? hueInfo.hue
        : null;
    const hueSource = taskTagTypeHueSourceOf(hueInfo);
    const known =
      hueInfo && Object.prototype.hasOwnProperty.call(hueInfo, "configured")
        ? hueInfo.configured !== false
        : more.known !== false;
    const state = taskTagIdentityKind({
      inherited: true,
      known,
      hue_source: hueSource,
    });
    return Object.freeze({
      type,
      key: typeof key === "string" && key ? key : null,
      hue: state === "unconfigured" ? null : hue,
      hueSource,
      state: state === "explicit" ? "inherited" : state,
      inherited: true,
      reason: more.reason || null,
      suggest: null,
      from: more.from || null,
    });
  } catch (error) {
    return null;
  }
}

function taskTagInheritedFromPhrase(identity) {
  try {
    if (!identity || typeof identity !== "object") {
      return null;
    }
    if (typeof identity.from === "string" && identity.from) {
      return identity.from;
    }
    const reason = identity.reason;
    if (reason && typeof reason === "object") {
      const from =
        reason.from && typeof reason.from === "object" ? reason.from : null;
      if (from && typeof from.stem === "string" && from.stem) {
        return from.stem;
      }
      if (reason.source === "reading") {
        return "reading";
      }
      if (typeof reason.label === "string" && reason.label) {
        return reason.label;
      }
      if (typeof reason.source === "string" && reason.source) {
        return reason.source;
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

function taskTagSuggestPhrase(identity) {
  try {
    if (!identity || typeof identity !== "object") {
      return null;
    }
    const suggest = identity.suggest;
    if (typeof suggest === "string" && suggest) {
      return suggest;
    }
    if (suggest && typeof suggest === "object") {
      try {
        if (typeof taskThemeReasonFor === "function") {
          const phrase = taskThemeReasonFor(suggest);
          if (typeof phrase === "string" && phrase) {
            return phrase;
          }
        }
      } catch (error) {
        // Fall through to a local phrase.
      }
      const theme =
        suggest.theme && typeof suggest.theme === "object"
          ? suggest.theme
          : null;
      const name =
        theme && typeof theme.name === "string" && theme.name
          ? theme.name
          : typeof suggest.name === "string"
            ? suggest.name
            : null;
      const from =
        suggest.from && typeof suggest.from === "object" ? suggest.from : null;
      const stem =
        from && typeof from.stem === "string" && from.stem ? from.stem : null;
      if (stem && name) {
        return stem + " suggests " + name;
      }
      if (name) {
        return "suggests " + name;
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Hover tooltip. Never contains `::`. Inherited glyphs use
// `BUILD · from dev`. Explicit fields use
// `FIX · set on this task · dev suggests BUILD · Ctrl+Shift+P t to change`.
function taskTagIdentityTooltip(identity) {
  try {
    if (!identity || typeof identity !== "object") {
      return TASK_TAG_MARK_TOOLTIP;
    }
    const name = taskTagTypeSafeCopy(identity.type || "");
    if (identity.state === "repair" || name === "?") {
      return "#? \u00b7 needs repair\n" + TASK_TYPE_IDENTITY_HINT;
    }
    if (!name) {
      return TASK_TAG_MARK_TOOLTIP;
    }
    if (identity.inherited === true || identity.state === "inherited") {
      const from = taskTagTypeSafeCopy(taskTagInheritedFromPhrase(identity) || "");
      return from ? name + " \u00b7 from " + from : name;
    }
    const parts = [name + " \u00b7 set on this task"];
    const suggest = taskTagTypeSafeCopy(taskTagSuggestPhrase(identity) || "");
    if (suggest) {
      parts.push(suggest);
    }
    parts.push(TASK_TYPE_IDENTITY_HINT);
    return parts.join(" \u00b7 ");
  } catch (error) {
    return TASK_TAG_MARK_TOOLTIP;
  }
}

function taskTagIdentityAria(identity) {
  try {
    if (!identity || typeof identity !== "object") {
      return TASK_TAG_MARK_TOOLTIP;
    }
    const name = taskTagTypeSafeCopy(identity.type || "");
    if (!name || identity.inherited === true) {
      return TASK_TAG_MARK_TOOLTIP;
    }
    if (identity.state === "repair" || name === "?") {
      return "#task \u00b7 type ?";
    }
    return "#task \u00b7 type " + name;
  } catch (error) {
    return TASK_TAG_MARK_TOOLTIP;
  }
}

function taskTagIdentityShown(identity, inheritedEnabled) {
  try {
    if (!identity || typeof identity !== "object") {
      return false;
    }
    if (identity.state === "repair" || identity.type === "?") {
      return true;
    }
    if (!identity.type) {
      return false;
    }
    if (identity.inherited === true) {
      return inheritedEnabled === true;
    }
    return true;
  } catch (error) {
    return false;
  }
}

function ledgerTypeDisagreeTooltip(taskType, entryName) {
  try {
    const typeName = taskTagTypeSafeCopy(taskType || "");
    const entry = taskTagTypeSafeCopy(entryName || "");
    if (!typeName) {
      return "";
    }
    const under = entry ? " under " + entry : "";
    return (
      typeName +
      " task" +
      under +
      " \u00b7 Ctrl+Shift+M to move \u00b7 Ctrl+Shift+P t to retype"
    );
  } catch (error) {
    return "";
  }
}

// Apply identity data attributes in place. Reading view uses
// `data-bob-type` plus CSS `::after` so the post-processor creates no
// nodes. When the name is not shown, attributes are stripped so the
// hash (or book, or checklist glyph) stands alone. Never throws.
function applyTaskTagTypeAttrs(el, identity, inheritedEnabled) {
  try {
    if (!el || typeof el !== "object") {
      return false;
    }
    const show = taskTagIdentityShown(identity, inheritedEnabled);
    const name =
      show && identity && typeof identity.type === "string" && identity.type
        ? identity.type
        : "";
    const hue =
      show && identity && typeof identity.hue === "string" && identity.hue
        ? identity.hue
        : "";
    const state =
      show && identity && typeof identity.state === "string" && identity.state
        ? identity.state
        : "";
    const setAttr = (key, value) => {
      if (typeof el.setAttribute === "function") {
        if (value) {
          el.setAttribute(key, value);
        } else if (typeof el.removeAttribute === "function") {
          el.removeAttribute(key);
        }
      } else if (value) {
        el[key] = value;
      } else {
        try {
          delete el[key];
        } catch (error) {
          // Best-effort.
        }
      }
    };
    setAttr("data-bob-type", name);
    setAttr("data-bob-type-hue", hue);
    setAttr("data-bob-type-state", state);
    return true;
  } catch (error) {
    return false;
  }
}

function clearTaskTagTypeAttrs(el) {
  return applyTaskTagTypeAttrs(el, null, false);
}
