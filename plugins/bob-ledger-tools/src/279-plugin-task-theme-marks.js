// --- Task theme marks: pure explicit-field mark model ---------------------
// Owned by the PT13 task-theme contract in bob-cli `docs/pomodoro-themes.md`.
// Pure helpers only: the canonical explicit-field source on a Live Preview
// task line, the render model (pill / unknown / repair), lazy tooltip copy,
// and the listener-free DOM builder plus the Live Preview widget. Every
// helper is synchronous and never throws; bad input yields null.
//
// A line gets a mark only for an explicit `[theme:: NAME]` / `(theme:: NAME)`
// field parsed by `pomodoroThemeTaskFieldState` in
// `279-plugin-task-theme-model.js`. A note, reading, or review default never
// produces a ghost pill: no field means no mark even when a suggestion
// exists. A stored field on a closed task still displays its historical
// value. Repair (duplicate or invalid fields) is visible as repair, never
// as a trustworthy pill, and malformed unmatched text is never hidden.
//
// Styling reuses the PT6 ledger pill: `span.bob-pomo-theme` with
// `data-theme-key` and `data-theme-hue`, normal text, 4px radius,
// ~0.3em padding, and the existing 16% light / 24% dark tints gated on
// `body.bob-pomo-theme-colors`. Unknown values stay neutral with a dotted
// underline (`Unknown theme`); repair uses the dashed repair treatment
// (`Needs repair`). A configured explicit hue still wins under the current
// hue contract. There is no glyph and no `theme` label: the pill text is
// the canonical component spelling.
//
// Tooltips resolve lazily on hover/focus, never while building decorations:
// `taskThemeTooltipText(value, kind, reason)` formats the shared copy and
// `taskThemeReasonFor(inherited)` derives the reason from the inherited
// suggestion (the default that would apply without the field). Never put
// `::` into tooltip/aria attributes that Dataview rescans. DOM construction
// uses text content and ownerDocument so the same model survives Dataview
// DOM cloning in the Reading-view phase.

const TASK_THEME_MARK_HINT = "Ctrl+Shift+P t to change";

// A Live Preview task line's explicit theme-field source, or null when the
// line gets no mark. `fieldStart`/`fieldEnd` are UTF-16 offsets of the field
// text, excluding the folded space; `foldSpace` covers one preceding U+0020.
// Closed tasks (`[x]`, `[X]`, `[-]`) still return their field: history stays
// visible. Non-task lines, prose, and lines without an explicit field yield
// null, so inherited defaults never ghost a pill. Never throws.
function taskThemeMarkSource(lineText) {
  try {
    if (typeof lineText !== "string" || lineText === "") {
      return null;
    }
    if (typeof freshnessTaskStatus === "function") {
      if (freshnessTaskStatus(lineText) === null) {
        return null;
      }
    } else if (typeof pomodoroThemeTaskMark === "function") {
      if (pomodoroThemeTaskMark(lineText) === null) {
        return null;
      }
    }
    const state =
      typeof pomodoroThemeTaskFieldState === "function"
        ? pomodoroThemeTaskFieldState(lineText)
        : null;
    if (!state || typeof state !== "object") {
      return null;
    }
    if (state.state !== "set" && state.state !== "repair") {
      return null;
    }
    const fields = Array.isArray(state.fields) ? state.fields : [];
    if (fields.length === 0) {
      return null;
    }
    const first = fields[0];
    const fieldStart =
      first && Number.isFinite(Number(first.start))
        ? Number(first.start)
        : null;
    const fieldEnd =
      first && Number.isFinite(Number(first.end)) ? Number(first.end) : null;
    if (
      fieldStart === null ||
      fieldEnd === null ||
      !(fieldEnd > fieldStart)
    ) {
      return null;
    }
    return {
      state: state.state,
      repair: state.state === "repair" ? state.repair || "invalid" : null,
      value:
        state.state === "set" && typeof state.value === "string"
          ? state.value
          : null,
      key:
        state.state === "set" && typeof state.key === "string"
          ? state.key
          : null,
      rawValue:
        first && typeof first.value === "string" ? first.value : null,
      fieldStart,
      fieldEnd,
      foldSpace: fieldStart > 0 && lineText[fieldStart - 1] === " ",
    };
  } catch (error) {
    return null;
  }
}

// A rendered-view text node's explicit theme-field source (`foldSpace`
// never applies, so it is omitted). Skips the task-line check because
// Tasks may have split off the suffix. Same frozen shape as
// `taskThemeMarkSource` minus folding. Never throws.
function taskThemeMarkSourceInText(text) {
  try {
    if (typeof text !== "string" || text === "") {
      return null;
    }
    const state =
      typeof pomodoroThemeTaskFieldState === "function"
        ? pomodoroThemeTaskFieldState(text)
        : null;
    if (!state || typeof state !== "object") {
      return null;
    }
    if (state.state !== "set" && state.state !== "repair") {
      return null;
    }
    const fields = Array.isArray(state.fields) ? state.fields : [];
    if (fields.length === 0) {
      return null;
    }
    const first = fields[0];
    const fieldStart =
      first && Number.isFinite(Number(first.start))
        ? Number(first.start)
        : null;
    const fieldEnd =
      first && Number.isFinite(Number(first.end)) ? Number(first.end) : null;
    if (
      fieldStart === null ||
      fieldEnd === null ||
      !(fieldEnd > fieldStart)
    ) {
      return null;
    }
    return {
      state: state.state,
      repair: state.state === "repair" ? state.repair || "invalid" : null,
      value:
        state.state === "set" && typeof state.value === "string"
          ? state.value
          : null,
      key:
        state.state === "set" && typeof state.key === "string"
          ? state.key
          : null,
      rawValue:
        first && typeof first.value === "string" ? first.value : null,
      fieldStart,
      fieldEnd,
    };
  } catch (error) {
    return null;
  }
}

// The render model for one explicit field: `{ value, key, kind, hue,
// hueSource, label, id }` where kind is `pill`, `unknown`, or `repair`.
// `key` is the theme key for `data-theme-key`; `id` is the stable widget
// identity (the model key the widget `eq` compares).
// `fieldState` is the `pomodoroThemeTaskFieldState` result (`none` yields
// null); `resolution` carries the read-time catalog answer
// (`{ known, hue, hueSource }`, every member optional). Unknown catalog
// names become `unknown`; duplicate/invalid fields become `repair`.
// Known fields keep the configured/explicit hue so the pill tints under
// the colors gate; unknown and repair carry no hue and render neutral.
// Never throws: bad input yields null.
function taskThemeMarkModel(fieldState, resolution) {
  try {
    if (!fieldState || typeof fieldState !== "object") {
      return null;
    }
    const resolved =
      resolution && typeof resolution === "object" ? resolution : {};
    if (fieldState.state === "repair") {
      const repair =
        fieldState.repair === "duplicate" ? "duplicate" : "invalid";
      const raw = taskThemeMarkRawValue(fieldState);
      const model = {
        value: raw,
        key: null,
        kind: "repair",
        repair,
        hue: null,
        hueSource: null,
        label: raw || "theme",
        id: null,
      };
      try {
        model.id = JSON.stringify([
          "repair",
          repair,
          raw,
        ]);
      } catch (error) {
        model.id = "repair|" + String(repair);
      }
      return Object.freeze(model);
    }
    if (fieldState.state !== "set") {
      return null;
    }
    const value =
      typeof fieldState.value === "string" ? fieldState.value : null;
    const key = typeof fieldState.key === "string" ? fieldState.key : null;
    if (!value || !key) {
      return null;
    }
    const known = resolved.known !== false;
    if (!known) {
      const model = {
        value,
        key,
        kind: "unknown",
        repair: null,
        hue: null,
        hueSource: null,
        label: value,
        id: null,
      };
      try {
        model.id = JSON.stringify(["unknown", key, value]);
      } catch (error) {
        model.id = "unknown|" + String(key);
      }
      return Object.freeze(model);
    }
    const hue =
      typeof resolved.hue === "string" && resolved.hue ? resolved.hue : null;
    const hueSource =
      typeof resolved.hueSource === "string" && resolved.hueSource
        ? resolved.hueSource
        : typeof resolved.hue_source === "string" && resolved.hue_source
          ? resolved.hue_source
          : null;
    const model = {
      value,
      key,
      kind: "pill",
      repair: null,
      hue,
      hueSource,
      label: value,
      id: null,
    };
    try {
      model.id = JSON.stringify(["pill", key, value, hue, hueSource]);
    } catch (error) {
      model.id = "pill|" + String(key);
    }
    return Object.freeze(model);
  } catch (error) {
    return null;
  }
}

// The raw display text for a repair model: the first field's trimmed value
// when present, else the literal `theme`. Never throws.
function taskThemeMarkRawValue(fieldState) {
  try {
    const fields =
      fieldState && Array.isArray(fieldState.fields)
        ? fieldState.fields
        : [];
    const first = fields[0];
    if (first && typeof first.value === "string" && first.value.trim()) {
      const canonical =
        typeof pomodoroThemeCanonicalName === "function"
          ? pomodoroThemeCanonicalName(first.value)
          : null;
      return canonical || first.value.trim() || "theme";
    }
    return "theme";
  } catch (error) {
    return "theme";
  }
}

// The shared inherited-reason phrase for a tooltip: the default that would
// apply without the explicit field. `inherited` is the suggestion's
// `inherited` member (or a standalone suggestion when the pill line has no
// field, which never happens in Live Preview but keeps the helper total).
// Returns `null` when there is no usable reason. Reading and
// no-default use these shared phrases. Never throws and never emits `::`.
function taskThemeReasonFor(inherited) {
  try {
    if (!inherited || typeof inherited !== "object") {
      return null;
    }
    const theme =
      inherited.theme && typeof inherited.theme === "object"
        ? inherited.theme
        : null;
    const name =
      theme && typeof theme.name === "string" && theme.name
        ? theme.name
        : null;
    if (inherited.source === "note") {
      const from =
        inherited.from && typeof inherited.from === "object"
          ? inherited.from
          : null;
      const stem =
        from && typeof from.stem === "string" && from.stem
          ? from.stem
          : null;
      if (stem && name) {
        return stem + " suggests " + name;
      }
      if (name) {
        return "note suggests " + name;
      }
      return null;
    }
    if (inherited.source === "reading") {
      return name ? "reading tasks suggest " + name : "reading default";
    }
    if (inherited.source === "task") {
      if (inherited.inherited && typeof inherited.inherited === "object") {
        return taskThemeReasonFor(inherited.inherited);
      }
      return null;
    }
    if (name) {
      const label =
        typeof inherited.label === "string" && inherited.label
          ? inherited.label
          : null;
      return label ? label + " " + name : name;
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Lazy tooltip copy for one mark. `value` is the pill text, `kind` is the
// model kind, and `reason` is the `taskThemeReasonFor` phrase (or null for
// no default). Unknown pills read `Unknown theme`; repair reads
// `Needs repair`; otherwise the reason (or `no default`) names the default.
// The hint is always last and no copy ever contains `::`, so Dataview never
// rescans it. Never throws.
function taskThemeSafeTooltipCopy(text) {
  try {
    return String(text == null ? "" : text).replace(/::/g, ":");
  } catch (error) {
    return "";
  }
}

function taskThemeTooltipText(value, kind, reason) {
  try {
    const name = taskThemeSafeTooltipCopy(
      typeof value === "string" && value ? value : "theme",
    );
    const hint = TASK_THEME_MARK_HINT;
    if (kind === "repair") {
      return "Task theme " + name + " \u00b7 Needs repair \u00b7 " + hint;
    }
    if (kind === "unknown") {
      return "Task theme " + name + " \u00b7 Unknown theme \u00b7 " + hint;
    }
    if (reason === undefined) {
      return "Task theme " + name + " \u00b7 " + hint;
    }
    const middle = taskThemeSafeTooltipCopy(
      typeof reason === "string" && reason ? reason : "no default here",
    );
    return "Task theme " + name + " \u00b7 " + middle + " \u00b7 " + hint;
  } catch (error) {
    return "Task theme \u00b7 " + TASK_THEME_MARK_HINT;
  }
}

// Listener-free mark element, so it survives Dataview's innerHTML
// round-trip. Produces `span.bob-pomo-theme[data-theme-key]`
// (`data-theme-hue` only on known pills) containing the plain pill text.
// Unknown adds `bob-pomo-theme-unknown` (dotted underline); repair adds
// `bob-pomo-theme-repair` (dashed repair treatment). `decorative` renders
// `aria-hidden` with no label. `doc` provides `createElement` and
// `createTextNode` so tests can pass a fake document. The initial
// `aria-label` is the status copy without an inherited reason; hover/focus
// listeners enrich it lazily via `taskThemeTooltipText`. Never throws:
// bad input yields null.
function buildTaskThemeMarkElement(doc, model, options) {
  try {
    if (!doc || !model || typeof model !== "object") {
      return null;
    }
    if (
      model.kind !== "pill" &&
      model.kind !== "unknown" &&
      model.kind !== "repair"
    ) {
      return null;
    }
    if (typeof model.label !== "string" || !model.label) {
      return null;
    }
    if (typeof doc.createElement !== "function") {
      return null;
    }
    if (typeof doc.createTextNode !== "function") {
      return null;
    }
    const settings =
      options && typeof options === "object" ? options : {};
    const foldSpace = Boolean(settings.foldSpace);
    const decorative = Boolean(settings.decorative);
    const span = doc.createElement("span");
    let classes = "bob-pomo-theme";
    if (model.kind === "unknown") {
      classes += " bob-pomo-theme-unknown";
    } else if (model.kind === "repair") {
      classes += " bob-pomo-theme-repair";
    } else if (model.kind === "pill") {
      if (
        model.hueSource === "exempt" ||
        model.hueSource === "unconfigured"
      ) {
        classes += " bob-pomo-theme-muted";
      }
      if (model.hueSource === "unconfigured") {
        classes += " bob-pomo-theme-unconfigured";
      }
    }
    span.setAttribute("class", classes);
    if (typeof model.key === "string" && model.key) {
      span.setAttribute("data-theme-key", String(model.key));
    } else if (typeof model.value === "string" && model.value) {
      span.setAttribute("data-theme-key", String(model.value));
    }
    if (model.kind === "pill" && typeof model.hue === "string" && model.hue) {
      span.setAttribute("data-theme-hue", String(model.hue));
    }
    span.setAttribute("data-task-theme-kind", String(model.kind));
    span.setAttribute("data-fold-space", foldSpace ? "true" : "false");
    if (model.kind === "repair" && model.repair) {
      span.setAttribute("data-theme-repair", String(model.repair));
    }
    if (decorative) {
      span.setAttribute("aria-hidden", "true");
    } else {
      const initial =
        model.kind === "repair"
          ? taskThemeTooltipText(model.label, "repair", null)
          : model.kind === "unknown"
            ? taskThemeTooltipText(model.label, "unknown", null)
            : taskThemeTooltipText(model.label, "pill", undefined);
      span.setAttribute("role", "img");
      span.setAttribute("aria-label", String(initial || ""));
      span.setAttribute("data-tooltip-position", "top");
    }
    span.appendChild(doc.createTextNode(String(model.label)));
    return span;
  } catch (error) {
    return null;
  }
}

// Live Preview widget for one task-theme mark. `eq` compares the model id,
// `foldLength`, and refresh generation, so a catalog/default refresh does
// not keep a stale inherited tooltip. `toDOM` builds the
// listener-free element and adds the reveal-on-click listener only; hover
// enrichment is delegated (see the editor mixin) so it survives Dataview
// DOM cloning. Defined only when `WidgetType` exists; otherwise null and
// the extension is not registered.
let TaskThemeMarkWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  TaskThemeMarkWidget = class extends WidgetType {
    constructor(model, foldLength, generation) {
      super();
      this.model = model;
      let folds = 0;
      try {
        folds = Number(foldLength) || 0;
        if (!Number.isFinite(folds) || folds < 0) {
          folds = 0;
        }
        folds = Math.floor(folds);
      } catch (error) {
        folds = 0;
      }
      this.foldLength = folds;
      let gen = 0;
      try {
        gen = Number(generation) || 0;
        if (!Number.isFinite(gen) || gen < 0) {
          gen = 0;
        }
        gen = Math.floor(gen);
      } catch (error) {
        gen = 0;
      }
      this.generation = gen;
      let key = "";
      try {
        key =
          String((model && model.id) || (model && model.key) || JSON.stringify(model)) +
          "|" +
          String(this.foldLength) +
          "|" +
          String(this.generation);
      } catch (error) {
        key =
          String((model && model.value) || "") +
          "|" +
          String(this.foldLength) +
          "|" +
          String(this.generation);
      }
      this.key = key;
    }

    eq(other) {
      return (
        Boolean(other) &&
        other instanceof TaskThemeMarkWidget &&
        other.key === this.key
      );
    }

    toDOM(view) {
      const dom = buildTaskThemeMarkElement(
        typeof document !== "undefined" ? document : null,
        this.model,
        { foldSpace: this.foldLength > 0 },
      );
      // In tests `document` is undefined and the caller passes a fake
      // doc via `buildTaskThemeMarkElement` directly; never throw here.
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
            // The decoration range starts at the first folded space,
            // so the field starts `foldLength` after the widget.
            if (typeof anchor === "number") {
              view.dispatch({
                selection: { anchor: anchor + self.foldLength },
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
