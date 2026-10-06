// --- Task priority marks: pure mark-core ----------------------------------
// Owned by the `### Priority marks` display contract in bob-cli
// `docs/projects.md`. Pure helpers only: canonical-field source
// detection, the lenient ladder-config reader, the mark model and
// tooltip, a listener-free DOM builder, and the Live Preview widget.
// Every helper is synchronous and never throws; bad input yields
// null. Mirrors the freshness-mark code paths in
// `130-freshness-marks.js` and reuses `freshnessTaskStatus` and
// `freshnessMarkPosInCode` (code exclusion) from the sibling
// fragments. The glyph is chosen by stored Tasks value, never by
// ladder position, so marks stay truthful without config.

// The five stored Tasks priority values. Anything else (including
// `P2`, `urgent`, and uppercase spellings) is non-canonical and gets
// no mark.
const PRIORITY_MARK_VALUES = ["highest", "high", "medium", "low", "lowest"];

// Bars filled per stored value on the 4-bar signal staircase.
const PRIORITY_MARK_FILLED = {
  high: 4,
  medium: 3,
  low: 2,
  lowest: 1,
  highest: 0,
};

// Capitalize a stored value for tooltip text (`high` -> `High`).
// Never throws.
function priorityMarkCapitalized(value) {
  try {
    const text = String(value || "");
    if (text === "") {
      return "";
    }
    return text.slice(0, 1).toUpperCase() + text.slice(1).toLowerCase();
  } catch (error) {
    return "";
  }
}

// The single canonical `[priority:: value]` / `(priority:: value)`
// field on `line`, or null. Canonical means: exactly one
// `/priority\s*::/gi` occurrence on the line, the key exactly
// `priority`, a matching bracket pair, padding spaces only, and a
// lowercase stored value. (A dedicated matcher, not
// `freshnessInlineFields`, because the canonical form allows padding
// spaces inside the brackets.) Returns `{ value, fieldStart,
// fieldEnd }` with UTF-16 offsets, or null. Never throws.
function priorityMarkCanonicalField(line) {
  try {
    const text = String(line || "");
    if (text === "") {
      return null;
    }
    const occurrences = text.match(/priority\s*::/gi) || [];
    if (occurrences.length !== 1) {
      return null;
    }
    const pattern = new RegExp(
      "\\[ *priority:: *(highest|high|medium|low|lowest) *\\]" +
        "|\\( *priority:: *(highest|high|medium|low|lowest) *\\)",
      "g",
    );
    const match = pattern.exec(text);
    if (!match) {
      return null;
    }
    // Defensive: the single-occurrence gate above already rules out
    // a second field, but never fold when two match.
    if (pattern.exec(text) !== null) {
      return null;
    }
    const value =
      match[1] !== undefined ? match[1] : match[2];
    return {
      value,
      fieldStart: match.index,
      fieldEnd: match.index + match[0].length,
    };
  } catch (error) {
    return null;
  }
}

// A Live Preview task line's priority-mark source, or null when the
// line gets no mark. `fieldStart`/`fieldEnd` are UTF-16 offsets of
// the field text, excluding the folded space. Never throws.
function priorityMarkSource(lineText) {
  try {
    if (typeof lineText !== "string") {
      return null;
    }
    if (freshnessTaskStatus(lineText) === null) {
      return null;
    }
    const found = priorityMarkCanonicalField(lineText);
    if (found === null) {
      return null;
    }
    return {
      value: found.value,
      fieldStart: found.fieldStart,
      fieldEnd: found.fieldEnd,
      foldSpace:
        found.fieldStart > 0 && lineText[found.fieldStart - 1] === " ",
    };
  } catch (error) {
    return null;
  }
}

// A rendered-view text node's priority-mark source (`foldSpace`
// never applies, so it is omitted). Skips the task-line check
// because Tasks may have split off the suffix. Never throws.
function priorityMarkSourceInText(text) {
  try {
    if (typeof text !== "string") {
      return null;
    }
    const found = priorityMarkCanonicalField(text);
    if (found === null) {
      return null;
    }
    return {
      value: found.value,
      fieldStart: found.fieldStart,
      fieldEnd: found.fieldEnd,
    };
  } catch (error) {
    return null;
  }
}

// Lenient ladder-config reader: the first `properties[]` entry with
// `name === "priority"` and `values === "priority"`. Keeps levels
// with a non-empty string label, a scalar value, and integer
// `0 <= min_days <= max_days`; skips bad levels and never shows
// Notices (nav owns config validation). Returns a frozen list of
// frozen `{ label, value, minDays, maxDays }`, or null when the
// ladder is unknown (missing, unreadable, or invalid config, no
// matching entry, no valid levels, or mobile). Never throws.
function coercePriorityLadder(parsedYaml) {
  try {
    if (
      !parsedYaml ||
      typeof parsedYaml !== "object" ||
      Array.isArray(parsedYaml)
    ) {
      return null;
    }
    const properties = parsedYaml.properties;
    if (!Array.isArray(properties)) {
      return null;
    }
    let entry = null;
    for (const candidate of properties) {
      try {
        if (
          candidate &&
          typeof candidate === "object" &&
          !Array.isArray(candidate) &&
          candidate.name === "priority" &&
          candidate.values === "priority"
        ) {
          entry = candidate;
          break;
        }
      } catch (error) {
        continue;
      }
    }
    if (entry === null) {
      return null;
    }
    const rawLevels = entry.levels;
    if (!Array.isArray(rawLevels)) {
      return null;
    }
    const kept = [];
    for (const raw of rawLevels) {
      try {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          continue;
        }
        const label = raw.label;
        if (typeof label !== "string" || label.trim() === "") {
          continue;
        }
        const rawValue = raw.value;
        if (
          rawValue === null ||
          rawValue === undefined ||
          typeof rawValue === "object"
        ) {
          continue;
        }
        const value = String(rawValue);
        if (value === "") {
          continue;
        }
        const minRaw =
          raw.min_days !== undefined ? raw.min_days : raw.minDays;
        const maxRaw =
          raw.max_days !== undefined ? raw.max_days : raw.maxDays;
        if (
          typeof minRaw !== "number" ||
          typeof maxRaw !== "number" ||
          !Number.isInteger(minRaw) ||
          !Number.isInteger(maxRaw) ||
          minRaw < 0 ||
          maxRaw < 0 ||
          minRaw > maxRaw
        ) {
          continue;
        }
        kept.push(
          Object.freeze({
            label: label.trim(),
            value,
            minDays: minRaw,
            maxDays: maxRaw,
          }),
        );
      } catch (error) {
        continue;
      }
    }
    if (kept.length === 0) {
      return null;
    }
    return Object.freeze(kept);
  } catch (error) {
    return null;
  }
}

// The `Rolls …` tooltip line for a ladder level: equal bounds read
// `Rolls 5 days ahead`, 1-1 reads `Rolls 1 day ahead`. Never throws.
function priorityMarkRollsLine(minDays, maxDays) {
  try {
    if (minDays === maxDays) {
      return minDays === 1
        ? "Rolls 1 day ahead"
        : "Rolls " + minDays + " days ahead";
    }
    return "Rolls " + minDays + "\u2013" + maxDays + " days ahead";
  } catch (error) {
    return "Rolls ahead";
  }
}

// The render model for one mark: `{ value, glyph ("bars" |
// "urgent"), filled, label, tooltip, key }`. The glyph is chosen by
// stored Tasks value, never by ladder position; labels and windows
// come from the ladder. `label` is null when the value is off the
// ladder or the ladder is unknown. The tooltip never contains `::`,
// because Dataview's reading-view pass re-scans `innerHTML` for
// inline fields. Bad values yield null. Never throws.
function priorityMarkModel(value, ladder) {
  try {
    if (PRIORITY_MARK_VALUES.indexOf(value) === -1) {
      return null;
    }
    const glyph = value === "highest" ? "urgent" : "bars";
    const filled = PRIORITY_MARK_FILLED[value];
    const levels = Array.isArray(ladder) ? ladder : null;
    let entry = null;
    if (levels !== null) {
      for (const level of levels) {
        try {
          if (level && level.value === value) {
            entry = level;
            break;
          }
        } catch (error) {
          continue;
        }
      }
    }
    const capitalized = priorityMarkCapitalized(value);
    const hint = "Ctrl+Shift+P to change";
    let label = null;
    let tooltip;
    if (entry !== null) {
      label = entry.label;
      tooltip =
        label +
        " \u00b7 " +
        capitalized +
        " priority\n" +
        priorityMarkRollsLine(entry.minDays, entry.maxDays) +
        "\n" +
        hint;
    } else if (levels !== null && levels.length > 0) {
      const first = levels[0] && levels[0].label;
      const last = levels[levels.length - 1] && levels[levels.length - 1].label;
      const range =
        levels.length === 1 || first === last
          ? String(first)
          : String(first) + "\u2013" + String(last);
      tooltip =
        capitalized + " priority\nNot on the " + range + " ladder\n" + hint;
    } else {
      tooltip = capitalized + " priority\n" + hint;
    }
    const model = {
      value,
      glyph,
      filled,
      label,
      tooltip,
      key: "",
    };
    try {
      model.key = JSON.stringify([value, glyph, filled, label, tooltip]);
    } catch (error) {
      model.key = String(value) + "|" + String(label);
    }
    return Object.freeze(model);
  } catch (error) {
    return null;
  }
}

// Listener-free mark element, so it survives Dataview's innerHTML
// round-trip. Produces
// `span.bob-priority-mark[data-priority][data-fold-space]`
// containing `span.bob-priority-mark-glyph` (the glyph itself is
// drawn by the single CSS-mask definition). `decorative` means
// `aria-hidden="true"` with no label (for surfaces that already
// show a P-label). `inheritColor` sets
// `data-inherit-color="true"`, so the ink becomes `currentColor`.
// `doc` provides `createElement` and `createTextNode` so tests can
// pass a fake document. Never throws: bad input yields null.
function buildPriorityMarkElement(doc, model, options) {
  try {
    if (!doc || !model || typeof model !== "object") {
      return null;
    }
    if (PRIORITY_MARK_VALUES.indexOf(model.value) === -1) {
      return null;
    }
    if (model.glyph !== "bars" && model.glyph !== "urgent") {
      return null;
    }
    if (typeof doc.createElement !== "function") {
      return null;
    }
    const settings =
      options && typeof options === "object" ? options : {};
    const foldSpace = Boolean(settings.foldSpace);
    const decorative = Boolean(settings.decorative);
    const inheritColor = Boolean(settings.inheritColor);
    const span = doc.createElement("span");
    span.setAttribute("class", "bob-priority-mark");
    span.setAttribute("data-priority", String(model.value));
    span.setAttribute("data-fold-space", foldSpace ? "true" : "false");
    if (inheritColor) {
      span.setAttribute("data-inherit-color", "true");
    }
    if (decorative) {
      span.setAttribute("aria-hidden", "true");
    } else {
      span.setAttribute("role", "img");
      span.setAttribute("aria-label", String(model.tooltip || ""));
      span.setAttribute("data-tooltip-position", "top");
    }
    const glyph = doc.createElement("span");
    glyph.setAttribute("class", "bob-priority-mark-glyph");
    glyph.setAttribute("aria-hidden", "true");
    span.appendChild(glyph);
    return span;
  } catch (error) {
    return null;
  }
}

// Live Preview widget for one priority mark. `eq` compares a model
// key, so unchanged marks never flicker. `toDOM` builds the
// listener-free element and adds the reveal-on-click listener only.
// Defined only when `WidgetType` exists; otherwise null and the
// extension is not registered.
let PriorityMarkWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  PriorityMarkWidget = class extends WidgetType {
    constructor(model, foldSpace) {
      super();
      this.model = model;
      this.foldSpace = Boolean(foldSpace);
      let key = "";
      try {
        key =
          String((model && model.key) || JSON.stringify(model)) +
          "|" +
          (this.foldSpace ? "1" : "0");
      } catch (error) {
        key =
          String((model && model.value) || "") +
          "|" +
          (this.foldSpace ? "1" : "0");
      }
      this.key = key;
    }

    eq(other) {
      return (
        Boolean(other) &&
        other instanceof PriorityMarkWidget &&
        other.key === this.key
      );
    }

    toDOM(view) {
      const dom = buildPriorityMarkElement(
        typeof document !== "undefined" ? document : null,
        this.model,
        { foldSpace: this.foldSpace },
      );
      // In tests `document` is undefined and the caller passes a fake
      // doc via `buildPriorityMarkElement` directly; never throw here.
      if (!dom) {
        const fallback =
          typeof document !== "undefined" && document
            ? document.createElement("span")
            : null;
        return fallback;
      }
      try {
        const self = this;
        dom.addEventListener("mousedown", (event) => {
          try {
            if (event && typeof event.preventDefault === "function") {
              event.preventDefault();
            }
            let anchor = null;
            try {
              anchor =
                view && typeof view.posAtDOM === "function"
                  ? view.posAtDOM(dom)
                  : null;
            } catch (error) {
              anchor = null;
            }
            if (typeof anchor === "number") {
              view.dispatch({
                selection: { anchor: anchor + (self.foldSpace ? 1 : 0) },
              });
            }
            if (view && typeof view.focus === "function") {
              view.focus();
            }
          } catch (error) {
            // Reveal is best-effort; the mark itself still renders.
          }
        });
      } catch (error) {
        // A listener-free mark still renders.
      }
      return dom;
    }
  };
}
