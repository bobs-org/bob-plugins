// --- Today marks: pure mark-core ---------------------------------------
// Owned by the `docs/today-marks.md` display contract in bob-cli
// (bob-cli-9r phase `mark_core`). Pure helpers only: the line
// candidate (open status, exact `#task` tag, trailing `^id`), the
// insert offset in original-line coordinates, the duplicate-id guard,
// the session text and tooltip, the entrance-window check, the
// modifier check, a listener-free DOM builder, and the Live Preview
// widget. Every helper is synchronous and never throws; bad input
// yields null (or an empty list). The mark is truthful, never
// guessing: only exact `#task` tags on open task lines get a mark,
// and the Today membership itself comes from the ledger Today cache
// (`todayCache.rank`), never from this file. Reuses
// `freshnessTaskStatus`, `freshnessStripBlockquotePrefix`, and
// `freshnessAfterListMarker` for the task-line parse,
// `taskTagMarkRanges` for the exact-tag rule (including the
// `#task #ref` pair span), `PLAN_BLOCK_ID_RE` for the trailing id,
// and `freshnessMarkPosInCode` (code exclusion) at the call site.

// The open checkbox statuses that may carry a Today mark. Completing
// a task removes its mark on the same frame.
const TODAY_MARK_OPEN_STATUSES = Object.freeze([" ", "*", "/", "?"]);

// The id of a standalone trailing `^id` block link, or null: it is
// preceded by whitespace, matches `PLAN_BLOCK_ID_RE`, and may be
// followed only by trailing whitespace. Never throws.
function todayMarkTrailingBlockId(lineText) {
  try {
    if (typeof lineText !== "string" || lineText === "") {
      return null;
    }
    const trimmed = lineText.replace(/[ \t]+$/, "");
    if (trimmed === "") {
      return null;
    }
    const last = Math.max(trimmed.lastIndexOf(" "), trimmed.lastIndexOf("\t"));
    if (last === -1) {
      return null;
    }
    const token = trimmed.slice(last + 1);
    if (!token.startsWith("^")) {
      return null;
    }
    const id = token.slice(1);
    if (id === "") {
      return null;
    }
    try {
      if (!PLAN_BLOCK_ID_RE.test(id)) {
        return null;
      }
    } catch (error) {
      return null;
    }
    return id;
  } catch (error) {
    return null;
  }
}

// The task-body start in original-line coordinates: after the indent,
// the blockquote prefix (`> `), the list marker (`-`, `*`, `+`,
// `1.`, `1)`), the `[s]` checkbox, and its whitespace. Quote markers
// are detection-only: the offset maps back across the stripped
// prefix. Returns 0 when the line has no task body. Never throws.
function todayMarkBodyStart(lineText) {
  try {
    const text = String(lineText || "");
    if (text === "") {
      return 0;
    }
    let stripped = text;
    try {
      stripped = freshnessStripBlockquotePrefix(text);
    } catch (error) {
      stripped = text;
    }
    const base = text.length - stripped.length;
    let index = 0;
    while (stripped[index] === " " || stripped[index] === "\t") {
      index += 1;
    }
    let after = null;
    try {
      after = freshnessAfterListMarker(stripped, index);
    } catch (error) {
      after = null;
    }
    if (after === null) {
      return base + index;
    }
    index = after;
    while (stripped[index] !== undefined && /\s/.test(stripped[index])) {
      index += 1;
    }
    if (stripped[index] === "[") {
      const close = stripped.indexOf("]", index + 1);
      if (close !== -1) {
        index = close + 1;
        while (stripped[index] === " " || stripped[index] === "\t") {
          index += 1;
        }
      }
    }
    return base + index;
  } catch (error) {
    return 0;
  }
}

// The Live Preview widget offset in UTF-16 original-line
// coordinates: when the first exact `#task` token starts at the body
// start, the end of that token (it already spans a `#task #ref`
// pair) plus the following whitespace run; otherwise the body start
// (the mark goes at the body start when `#task` sits mid-body).
// Never throws.
function todayMarkInsertOffset(lineText) {
  try {
    if (typeof lineText !== "string" || lineText === "") {
      return 0;
    }
    const bodyStart = todayMarkBodyStart(lineText);
    let ranges = [];
    try {
      ranges = taskTagMarkRanges(lineText);
    } catch (error) {
      ranges = [];
    }
    const first =
      Array.isArray(ranges) && ranges.length > 0 ? ranges[0] : null;
    if (
      first &&
      typeof first.from === "number" &&
      typeof first.to === "number" &&
      first.from === bodyStart
    ) {
      let offset = first.to;
      while (lineText[offset] === " " || lineText[offset] === "\t") {
        offset += 1;
      }
      return offset;
    }
    return bodyStart;
  } catch (error) {
    return 0;
  }
}

// The mark candidate for one live line, or null: an open status, at
// least one exact `#task` range, and a trailing id. `tagFrom` is the
// first `#task` range start, so callers can check for code via
// `freshnessMarkPosInCode`. Code exclusion is NOT applied here.
// Never throws.
function todayMarkLineCandidate(lineText) {
  try {
    if (typeof lineText !== "string" || lineText === "") {
      return null;
    }
    let status = null;
    try {
      status = freshnessTaskStatus(lineText);
    } catch (error) {
      return null;
    }
    if (
      status === null ||
      TODAY_MARK_OPEN_STATUSES.indexOf(status) === -1
    ) {
      return null;
    }
    let ranges = [];
    try {
      ranges = taskTagMarkRanges(lineText);
    } catch (error) {
      return null;
    }
    if (!Array.isArray(ranges) || ranges.length === 0) {
      return null;
    }
    const first = ranges[0];
    if (!first || typeof first.from !== "number") {
      return null;
    }
    const blockId = todayMarkTrailingBlockId(lineText);
    if (!blockId) {
      return null;
    }
    return Object.freeze({
      blockId,
      status,
      insertCh: todayMarkInsertOffset(lineText),
      tagFrom: first.from,
    });
  } catch (error) {
    return null;
  }
}

// The subset of `ids` that end more than one line: with a duplicate
// id the link target is ambiguous, so every such line stays neutral.
// `lines` may be an array or an iterable of strings. Never throws.
function todayMarkDuplicateIds(lines, ids) {
  try {
    let list = null;
    try {
      if (Array.isArray(lines)) {
        list = lines;
      } else if (
        lines &&
        typeof lines[Symbol.iterator] === "function"
      ) {
        list = Array.from(lines);
      }
    } catch (error) {
      list = null;
    }
    if (!Array.isArray(list)) {
      return Object.freeze([]);
    }
    const wanted = Array.isArray(ids) ? ids : [];
    const counts = new Map();
    for (const line of list) {
      try {
        if (typeof line !== "string") {
          continue;
        }
        const id = todayMarkTrailingBlockId(line);
        if (!id) {
          continue;
        }
        counts.set(id, (counts.get(id) || 0) + 1);
      } catch (error) {
        continue;
      }
    }
    const out = [];
    for (const id of wanted) {
      try {
        if (typeof id === "string" && (counts.get(id) || 0) > 1) {
          out.push(id);
        }
      } catch (error) {
        continue;
      }
    }
    return Object.freeze(out);
  } catch (error) {
    return Object.freeze([]);
  }
}

// Whether UTF-16 offset `pos` falls inside a CommonMark inline code
// span of `lineText`, backticks included. A backtick run of length n
// opens a span that closes at the next run of exactly n backticks;
// an unmatched opener is literal text. Never throws.
function todayMarkPosInInlineCode(lineText, pos) {
  try {
    if (typeof lineText !== "string" || lineText === "") {
      return false;
    }
    if (typeof pos !== "number" || !Number.isInteger(pos)) {
      return false;
    }
    if (pos < 0 || pos >= lineText.length) {
      return false;
    }
    const runs = [];
    let index = 0;
    while (index < lineText.length) {
      if (lineText[index] !== "`") {
        index += 1;
        continue;
      }
      let end = index + 1;
      while (lineText[end] === "`") {
        end += 1;
      }
      runs.push({ start: index, end, length: end - index });
      index = end;
    }
    if (runs.length === 0) {
      return false;
    }
    let opener = null;
    for (const run of runs) {
      if (opener === null) {
        opener = run;
        continue;
      }
      if (run.length === opener.length) {
        if (pos >= opener.start && pos < run.end) {
          return true;
        }
        opener = null;
        continue;
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

// The `<session>` half of the tooltip for one Today detail
// (`{ name, range, label }` from `todayLinkDetails`): the entry name
// plus its range when timed, else the derived Pomodoro home label
// plus its range when timed, else the range alone, else `unnamed
// Pomodoro`. Ranges use an en dash. Runs of `:` collapse to one,
// so the result never contains `::`. Never throws.
function todayMarkSessionText(detail) {
  try {
    let name = null;
    let label = null;
    let range = null;
    try {
      if (detail && typeof detail === "object") {
        if (
          typeof detail.name === "string" &&
          detail.name.trim() !== ""
        ) {
          name = detail.name.trim();
        }
        if (
          typeof detail.label === "string" &&
          detail.label.trim() !== ""
        ) {
          label = detail.label.trim();
        }
        if (typeof detail.range === "string" && detail.range !== "") {
          range = detail.range;
        }
      }
    } catch (error) {
      name = null;
      label = null;
      range = null;
    }
    const collapse = (value) => String(value).replace(/:{2,}/g, ":");
    const base = name || label;
    const rangeText = range ? String(range).replace("-", "\u2013") : null;
    if (base) {
      return collapse(rangeText ? base + " " + rangeText : base);
    }
    if (rangeText) {
      return collapse(rangeText);
    }
    return "unnamed Pomodoro";
  } catch (error) {
    return "unnamed Pomodoro";
  }
}

// The mark tooltip for one key's Today details (ledger order, the
// running entry first): `Today · running in <session>` for the
// unique open timed entry, else `Today · queued in <session>`, with
// a ` +N more` suffix when more than one open entry links the task,
// plus the open-in-today's-note hint (`mac`, `other`; omitted on
// `mobile`). Two lines joined with `\n`, never containing `::`.
// Empty or invalid input yields `Today`. Never throws.
function todayMarkTooltip(details, options) {
  try {
    const list = Array.isArray(details)
      ? details.filter(
          (detail) => detail && typeof detail === "object",
        )
      : [];
    if (list.length === 0) {
      return "Today";
    }
    let platform = "other";
    try {
      const raw =
        options && typeof options.platform === "string"
          ? options.platform.toLowerCase()
          : "";
      if (raw === "mac" || raw === "macos") {
        platform = "mac";
      } else if (raw === "mobile") {
        platform = "mobile";
      }
    } catch (error) {
      platform = "other";
    }
    let primary = null;
    for (const detail of list) {
      try {
        if (detail && detail.running === true) {
          primary = detail;
          break;
        }
      } catch (error) {
        continue;
      }
    }
    if (!primary) {
      primary = list[0];
    }
    const state =
      primary && primary.running === true ? "running in" : "queued in";
    let first = "Today \u00b7 " + state + " " + todayMarkSessionText(primary);
    if (list.length > 1) {
      first += " +" + (list.length - 1) + " more";
    }
    if (platform === "mobile") {
      return String(first).replace(/:{2,}/g, ":");
    }
    const second =
      platform === "mac"
        ? "\u2318-click to open in today's note"
        : "Ctrl-click to open in today's note";
    return String(first + "\n" + second).replace(/:{2,}/g, ":");
  } catch (error) {
    return "Today";
  }
}

// Whether the entrance pop plays: the key joined Today less than
// 600 ms ago, so it never plays on startup, on scroll, on rerender,
// or at midnight. Never throws.
function todayMarkEntering(enteredAt, nowMs) {
  try {
    if (
      typeof enteredAt !== "number" ||
      typeof nowMs !== "number" ||
      !Number.isFinite(enteredAt) ||
      !Number.isFinite(nowMs)
    ) {
      return false;
    }
    const age = nowMs - enteredAt;
    return age >= 0 && age < 600;
  } catch (error) {
    return false;
  }
}

// Whether the mousedown used the jump modifier on the primary
// button: `metaKey` on macOS, `ctrlKey` elsewhere. Never throws.
function todayMarkModifierPressed(event, isMac) {
  try {
    if (!event || typeof event !== "object") {
      return false;
    }
    if (
      event.button !== undefined &&
      event.button !== null &&
      event.button !== 0
    ) {
      return false;
    }
    return isMac
      ? Boolean(event.metaKey)
      : Boolean(event.ctrlKey);
  } catch (error) {
    return false;
  }
}

// Listener-free mark element, so it survives Dataview's `innerHTML`
// round trip. Produces an empty
// `span.bob-today-mark[role=img][aria-label][data-tooltip-position=top][data-bob-today-key]`
// (plus `is-entering` while the pop plays). It has no text, no
// `title` (the `aria-label` is the tooltip, shown once), and no
// listeners. `doc` provides `createElement` so tests can pass a fake
// document. Never throws: bad input yields null.
function buildTodayMarkElement(doc, options) {
  try {
    if (!doc || typeof doc.createElement !== "function") {
      return null;
    }
    const opts =
      options && typeof options === "object" ? options : {};
    const key = typeof opts.key === "string" ? opts.key : "";
    if (key === "") {
      return null;
    }
    const rawTooltip =
      typeof opts.tooltip === "string" ? opts.tooltip : "";
    const tooltip =
      rawTooltip.trim() !== "" ? rawTooltip : "Today";
    const span = doc.createElement("span");
    span.setAttribute(
      "class",
      "bob-today-mark" + (opts.entering === true ? " is-entering" : ""),
    );
    span.setAttribute("role", "img");
    span.setAttribute("aria-label", tooltip);
    span.setAttribute("data-tooltip-position", "top");
    span.setAttribute("data-bob-today-key", key);
    try {
      span.textContent = "";
    } catch (error) {
      // An empty host still renders.
    }
    return span;
  } catch (error) {
    return null;
  }
}

// Live Preview widget for one Today mark. `eq` compares the class,
// `key`, and `tooltip` only: entering and the callback are
// deliberately excluded, so a later rebuild never swaps the DOM and
// never replays the pop, while a tooltip change (queued → running)
// swaps it quietly. `toDOM` builds the element and adds one
// `mousedown` listener: it always calls `preventDefault`; with the
// modifier pressed it calls `onJump(key)`, otherwise it moves the
// cursor to the title start and focuses. Defined only when
// `WidgetType` exists; otherwise null and the extension is not
// registered.
let TodayMarkWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  TodayMarkWidget = class extends WidgetType {
    constructor(key, tooltip, entering, onJump) {
      super();
      this.key = typeof key === "string" ? key : String(key || "");
      const rawTooltip =
        typeof tooltip === "string" ? tooltip : "";
      this.tooltip =
        rawTooltip.trim() !== "" ? rawTooltip : "Today";
      this.entering = entering === true;
      this.onJump = typeof onJump === "function" ? onJump : null;
    }

    eq(other) {
      return (
        Boolean(other) &&
        other instanceof TodayMarkWidget &&
        other.key === this.key &&
        other.tooltip === this.tooltip
      );
    }

    toDOM(view) {
      const dom = buildTodayMarkElement(
        typeof document !== "undefined" ? document : null,
        { key: this.key, tooltip: this.tooltip, entering: this.entering },
      );
      // In tests `document` is undefined and the caller passes a fake
      // doc via `buildTodayMarkElement` directly; never throw here.
      if (!dom) {
        const fallback =
          typeof document !== "undefined" && document
            ? document.createElement("span")
            : null;
        return fallback;
      }
      try {
        dom.addEventListener("mousedown", (event) => {
          try {
            if (event && typeof event.preventDefault === "function") {
              event.preventDefault();
            }
            let isMac = false;
            try {
              isMac = Boolean(Platform && Platform.isMacOS);
            } catch (error) {
              isMac = false;
            }
            if (todayMarkModifierPressed(event, isMac)) {
              if (this.onJump) {
                try {
                  this.onJump(this.key);
                } catch (error) {
                  // A jump failure never breaks the editor.
                }
              }
              return;
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
            if (
              typeof anchor === "number" &&
              view &&
              typeof view.dispatch === "function"
            ) {
              view.dispatch({ selection: { anchor } });
            }
            if (view && typeof view.focus === "function") {
              view.focus();
            }
          } catch (error) {
            // Placing the cursor is best-effort; the mark renders.
          }
        });
      } catch (error) {
        // A listener-free mark still renders.
      }
      return dom;
    }
  };
}
