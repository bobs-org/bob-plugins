// --- Task date marks: pure mark-core --------------------------------------
// Owned by the `docs/date-marks.md` display contract in bob-cli. Pure
// helpers only: canonical-field source detection for the four task
// dates, the calendar label grammar, tooltips, a listener-free DOM
// builder, and the Live Preview widget. Every helper is synchronous
// and never throws; bad input yields null. Mirrors the priority-mark
// code paths in `135-priority-marks.js` and reuses `parseFreshDateStrict`,
// `freshDateDiffDays`, `freshDateToUtc`, `freshnessShortDate`,
// `freshnessStripBlockquotePrefix`, `freshnessAfterListMarker`,
// `freshnessMarkPosInCode`, `freshnessNormalizeDateText`, `formatLocalDate`,
// and the weekday/month constants from the sibling fragments. There is
// deliberately no task-line gate: any canonical field outside code gets
// a mark (task lines, plain bullets, quotes, paragraphs).

// The four stored task dates, in display order, with tooltip verbs.
const DATE_MARK_FIELDS = Object.freeze([
  Object.freeze({ key: "created", verb: "Created" }),
  Object.freeze({ key: "scheduled", verb: "Scheduled" }),
  Object.freeze({ key: "completion", verb: "Done" }),
  Object.freeze({ key: "cancelled", verb: "Cancelled" }),
]);

// The canonical fields on `text`, one entry per eligible key. For each
// key the occurrence gate counts `(^|[^A-Za-z0-9_-])k\s*::`
// (case-insensitive) and requires exactly one; the boundary keeps
// `[rescheduled:: …]` from counting. The canonical form is
// `\[ *k:: *YYYY-MM-DD *\]` or `\( *k:: *YYYY-MM-DD *\)`: matching
// brackets, a lowercase key touching `::`, padding spaces only, and a
// value passing `parseFreshDateStrict`. Each key is judged on its own,
// so one broken key never suppresses the others. Returns a frozen
// array, sorted by `fieldStart`, of frozen
// `{ field, date, fieldStart, fieldEnd }` (UTF-16 offsets). Never
// throws.
function dateMarkCanonicalFields(text) {
  try {
    const input = String(text || "");
    if (input === "") {
      return Object.freeze([]);
    }
    const found = [];
    for (const entry of DATE_MARK_FIELDS) {
      try {
        const key = entry.key;
        const gate = new RegExp("(^|[^A-Za-z0-9_-])" + key + "\\s*::", "gi");
        let occurrences = 0;
        let gateMatch = gate.exec(input);
        while (gateMatch !== null) {
          occurrences += 1;
          if (occurrences > 1) {
            break;
          }
          gateMatch = gate.exec(input);
        }
        if (occurrences !== 1) {
          continue;
        }
        const pattern = new RegExp(
          "\\[ *" +
            key +
            ":: *(\\d{4}-\\d{2}-\\d{2}) *\\]" +
            "|\\( *" +
            key +
            ":: *(\\d{4}-\\d{2}-\\d{2}) *\\)",
          "g",
        );
        const first = pattern.exec(input);
        if (!first) {
          continue;
        }
        // Defensive: the single-occurrence gate already rules out a
        // second field, but never mark when two match.
        if (pattern.exec(input) !== null) {
          continue;
        }
        const date =
          first[1] !== undefined ? first[1] : first[2];
        if (parseFreshDateStrict(date) === null) {
          continue;
        }
        found.push(
          Object.freeze({
            field: key,
            date,
            fieldStart: first.index,
            fieldEnd: first.index + first[0].length,
          }),
        );
      } catch (error) {
        continue;
      }
    }
    found.sort((a, b) => a.fieldStart - b.fieldStart);
    return Object.freeze(found);
  } catch (error) {
    return Object.freeze([]);
  }
}

// The offset where the line's content begins: after the blockquote
// markers, indentation, list marker plus whitespace, and a one-char
// `[c]` checkbox plus whitespace. Returns 0 for non-list lines (plain
// paragraphs still get marks; they simply never fold). Never throws.
function dateMarkContentStart(line) {
  try {
    const text = String(line || "");
    if (text === "") {
      return 0;
    }
    const stripped = freshnessStripBlockquotePrefix(text);
    const offset = text.length - stripped.length;
    let index = 0;
    while (stripped[index] === " " || stripped[index] === "\t") {
      index += 1;
    }
    const after = freshnessAfterListMarker(stripped, index);
    if (after === null) {
      return 0;
    }
    index = after;
    while (stripped[index] !== undefined && /\s/.test(stripped[index])) {
      index += 1;
    }
    if (stripped[index] === "[") {
      try {
        const close = stripped.indexOf("]", index + 1);
        if (close !== -1) {
          const inner = stripped.slice(index + 1, close);
          if ([...inner].length === 1) {
            const trailing = stripped.slice(close + 1);
            if (trailing === "" || /^\s/.test(trailing)) {
              index = close + 1;
              while (
                stripped[index] !== undefined &&
                /\s/.test(stripped[index])
              ) {
                index += 1;
              }
            }
          }
        }
      } catch (error) {
        // A bad checkbox never moves the content start.
      }
    }
    return offset + index;
  } catch (error) {
    return 0;
  }
}

// The folded space run before `fieldStart`: the U+0020 characters
// directly before the field, clamped to `contentStart`, so a field
// that begins the line's content never folds. Never throws.
function dateMarkFoldLength(lineText, fieldStart, contentStart) {
  try {
    if (typeof lineText !== "string") {
      return 0;
    }
    if (fieldStart <= contentStart) {
      return 0;
    }
    let run = 0;
    let index = fieldStart - 1;
    while (index >= contentStart && lineText[index] === " ") {
      run += 1;
      index -= 1;
    }
    return run;
  } catch (error) {
    return 0;
  }
}

// The fold a field keeps for `selectionRanges` (absolute document
// offsets): null reveals the raw field, 0 keeps the mark but folds
// no spaces. The interior of a `Decoration.replace` range cannot
// hold a caret: an endpoint strictly inside the folded run sits at
// a hidden offset, so the browser inserts after the widget while
// the selection stays behind it and each keystroke lands in front
// of the previous one. Unfolding while an endpoint rests in the
// run keeps the cursor in real text; the fold returns once it
// leaves. Never throws: bad input yields 0, because no fold may
// ever hide a cursor.
function dateMarkSelectionFold(
  fieldStart,
  fieldEnd,
  foldLength,
  selectionRanges,
) {
  try {
    const start = Number(fieldStart);
    const end = Number(fieldEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return 0;
    }
    let folds = Number(foldLength) || 0;
    if (!Number.isFinite(folds) || folds < 0) {
      folds = 0;
    }
    folds = Math.floor(folds);
    const ranges = Array.isArray(selectionRanges) ? selectionRanges : [];
    for (const selection of ranges) {
      try {
        if (
          !selection ||
          typeof selection.from !== "number" ||
          typeof selection.to !== "number"
        ) {
          continue;
        }
        if (selection.from <= end && selection.to >= start) {
          return null;
        }
      } catch (error) {
        continue;
      }
    }
    const runStart = start - folds;
    for (const selection of ranges) {
      try {
        if (
          !selection ||
          typeof selection.from !== "number" ||
          typeof selection.to !== "number"
        ) {
          continue;
        }
        if (
          (selection.from > runStart && selection.from < start) ||
          (selection.to > runStart && selection.to < start)
        ) {
          return 0;
        }
      } catch (error) {
        continue;
      }
    }
    return folds;
  } catch (error) {
    return 0;
  }
}

// A Live Preview line's date-mark sources, in line order: canonical
// fields plus `foldLength` per the folding rule. The space in front of
// a field stays outside any neighbouring mark's range, because only
// the spaces strictly before the field fold. A replace range never
// keeps a selection endpoint strictly inside it: while a cursor or
// selection end rests in the folded run, that field's mark is
// emitted with fold 0 (see `dateMarkSelectionFold`). Returns a
// frozen array of frozen
// `{ field, date, fieldStart, fieldEnd, foldLength }`. Never
// throws.
function dateMarkSources(lineText) {
  try {
    if (typeof lineText !== "string" || lineText === "") {
      return Object.freeze([]);
    }
    const start = dateMarkContentStart(lineText);
    const fields = dateMarkCanonicalFields(lineText);
    const sources = [];
    for (const field of fields) {
      try {
        sources.push(
          Object.freeze({
            field: field.field,
            date: field.date,
            fieldStart: field.fieldStart,
            fieldEnd: field.fieldEnd,
            foldLength: dateMarkFoldLength(
              lineText,
              field.fieldStart,
              start,
            ),
          }),
        );
      } catch (error) {
        continue;
      }
    }
    return Object.freeze(sources);
  } catch (error) {
    return Object.freeze([]);
  }
}

// A rendered-view text node's date-mark sources, in node order. Never
// folds (`foldLength` is always 0: the surrounding spaces stay as text
// nodes around the mark). Same frozen shape as `dateMarkSources`.
// Never throws.
function dateMarkSourcesInText(text) {
  try {
    if (typeof text !== "string" || text === "") {
      return Object.freeze([]);
    }
    const fields = dateMarkCanonicalFields(text);
    const sources = [];
    for (const field of fields) {
      try {
        sources.push(
          Object.freeze({
            field: field.field,
            date: field.date,
            fieldStart: field.fieldStart,
            fieldEnd: field.fieldEnd,
            foldLength: 0,
          }),
        );
      } catch (error) {
        continue;
      }
    }
    return Object.freeze(sources);
  } catch (error) {
    return Object.freeze([]);
  }
}

// The exact-day relative phrase for `delta` whole days from today:
// `today`, `tomorrow`, `yesterday`, `in N days`, `N days ago`.
// Matches nav's `formatRelativeDayOffset`. Never throws.
function dateMarkRelativePhrase(delta) {
  try {
    const days = Number(delta);
    if (!Number.isFinite(days)) {
      return "today";
    }
    if (days === 0) {
      return "today";
    }
    if (days === 1) {
      return "tomorrow";
    }
    if (days === -1) {
      return "yesterday";
    }
    if (days > 1) {
      return "in " + days + " days";
    }
    return String(-days) + " days ago";
  } catch (error) {
    return "today";
  }
}

// The calendar label for `dateText` against `todayText`: `today`,
// `tomorrow`, `yesterday`, the short weekday for the coming six days
// (+2 … +6), else `Mon D` (`Mon D, YYYY` across years). Weekday names
// are never used for past dates (a past `Mon` would read ambiguous),
// and the weekday rule wins over the year rule. Fixed English names
// matching the freshness mark. Bad input yields null. Never throws.
function dateMarkLabel(dateText, todayText) {
  try {
    const date = parseFreshDateStrict(String(dateText || ""));
    const today = parseFreshDateStrict(String(todayText || ""));
    if (date === null || today === null) {
      return null;
    }
    const delta = freshDateDiffDays(today, date);
    if (delta === 0) {
      return "today";
    }
    if (delta === 1) {
      return "tomorrow";
    }
    if (delta === -1) {
      return "yesterday";
    }
    if (delta >= 2 && delta <= 6) {
      const day = new Date(freshDateToUtc(date));
      if (Number.isNaN(day.getTime())) {
        return null;
      }
      return FRESHNESS_MARK_WEEKDAYS[day.getUTCDay()];
    }
    const month = FRESHNESS_MARK_MONTHS[Number(date.slice(5, 7)) - 1];
    const dayOfMonth = String(Number(date.slice(8, 10)));
    if (!month) {
      return null;
    }
    if (date.slice(0, 4) === today.slice(0, 4)) {
      return month + " " + dayOfMonth;
    }
    return month + " " + dayOfMonth + ", " + date.slice(0, 4);
  } catch (error) {
    return null;
  }
}

// The render model for one mark: a frozen
// `{ field, date, delta, when, label, tooltip, key }`, or null for an
// unknown field or a non-canonical date. `when` is `past` | `today` |
// `future`. The tooltip never contains `::`, because Dataview's
// reading-view pass re-scans `innerHTML` for inline fields. A bad
// `todayText` falls back through `freshnessNormalizeDateText`. Never
// throws.
function dateMarkModel(field, dateText, todayText) {
  try {
    let verb = null;
    for (const entry of DATE_MARK_FIELDS) {
      if (entry.key === field) {
        verb = entry.verb;
        break;
      }
    }
    if (verb === null) {
      return null;
    }
    const date = parseFreshDateStrict(String(dateText || ""));
    if (date === null) {
      return null;
    }
    let today = null;
    try {
      today =
        parseFreshDateStrict(String(todayText || "")) ||
        freshnessNormalizeDateText(todayText);
    } catch (error) {
      today = null;
    }
    if (today === null) {
      return null;
    }
    const delta = freshDateDiffDays(today, date);
    const when = delta < 0 ? "past" : delta === 0 ? "today" : "future";
    const label = dateMarkLabel(date, today);
    if (label === null) {
      return null;
    }
    const short = freshnessShortDate(date, today) || date;
    const tooltip =
      verb +
      " " +
      short +
      " \u00b7 " +
      dateMarkRelativePhrase(delta) +
      (field === "scheduled" ? "\nCtrl+Shift+P to reschedule" : "");
    let key = "";
    try {
      key = JSON.stringify([field, date, label, when, tooltip]);
    } catch (error) {
      key = String(field) + "|" + String(date);
    }
    return Object.freeze({
      field,
      date,
      delta,
      when,
      label,
      tooltip,
      key,
    });
  } catch (error) {
    return null;
  }
}

// Listener-free mark element, so it survives Dataview's innerHTML
// round-trip. Produces `span.bob-date-mark[data-field][data-date]`
// `[data-when][data-fold-space]` containing
// `span.bob-date-mark-glyph` (the mask, drawn by the single CSS-mask
// definition in `styles.css`) and `span.bob-date-mark-label` (the
// calendar text). `rendered` sets `data-rendered="true"` for the
// reading-view post-processor's midnight relabel. `decorative`
// renders `aria-hidden` with no label; `inheritColor` sets
// `data-inherit-color="true"` so the ink becomes `currentColor`.
// `doc` provides `createElement` and `createTextNode` so tests can
// pass a fake document. Never throws: bad input yields null.
function buildDateMarkElement(doc, model, options) {
  try {
    if (!doc || !model || typeof model !== "object") {
      return null;
    }
    let known = false;
    for (const entry of DATE_MARK_FIELDS) {
      if (entry.key === model.field) {
        known = true;
        break;
      }
    }
    if (!known) {
      return null;
    }
    if (parseFreshDateStrict(String(model.date || "")) === null) {
      return null;
    }
    if (typeof model.label !== "string" || model.label === "") {
      return null;
    }
    if (model.when !== "past" && model.when !== "today" && model.when !== "future") {
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
    const inheritColor = Boolean(settings.inheritColor);
    const rendered = Boolean(settings.rendered);
    const span = doc.createElement("span");
    span.setAttribute("class", "bob-date-mark");
    span.setAttribute("data-field", String(model.field));
    span.setAttribute("data-date", String(model.date));
    span.setAttribute("data-when", String(model.when));
    span.setAttribute("data-fold-space", foldSpace ? "true" : "false");
    if (rendered) {
      span.setAttribute("data-rendered", "true");
    }
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
    glyph.setAttribute("class", "bob-date-mark-glyph");
    glyph.setAttribute("aria-hidden", "true");
    span.appendChild(glyph);
    const label = doc.createElement("span");
    label.setAttribute("class", "bob-date-mark-label");
    label.setAttribute("aria-hidden", "true");
    label.appendChild(doc.createTextNode(String(model.label)));
    span.appendChild(label);
    return span;
  } catch (error) {
    return null;
  }
}

// Live Preview widget for one date mark. `eq` compares a model key
// plus `foldLength`, so unchanged marks never flicker and a new day
// always re-renders. `foldLength` is the fold actually emitted: 0
// while a selection endpoint rests in the folded run, so the range
// never hides a caret. `toDOM` builds the listener-free element and
// adds the reveal-on-mousedown listener only. Defined only when
// `WidgetType` exists; otherwise null and the extension is not
// registered.
let DateMarkWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  DateMarkWidget = class extends WidgetType {
    constructor(model, foldLength) {
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
      let key = "";
      try {
        key =
          String((model && model.key) || JSON.stringify(model)) +
          "|" +
          String(this.foldLength);
      } catch (error) {
        key =
          String((model && model.field) || "") +
          "|" +
          String((model && model.date) || "") +
          "|" +
          String(this.foldLength);
      }
      this.key = key;
    }

    eq(other) {
      return (
        Boolean(other) &&
        other instanceof DateMarkWidget &&
        other.key === this.key
      );
    }

    toDOM(view) {
      const dom = buildDateMarkElement(
        typeof document !== "undefined" ? document : null,
        this.model,
        { foldSpace: this.foldLength > 0 },
      );
      // In tests `document` is undefined and the caller passes a fake
      // doc via `buildDateMarkElement` directly; never throw here.
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
