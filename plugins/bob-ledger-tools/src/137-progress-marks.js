// --- Task Link In Progress marks: pure mark-core ---------------------------
// Owned by the epic plan `plan:202610/in_progress_task_link_marks.md`
// (bob-cli-56 phase `progress-marks`). Pure helpers only: the dedicated
// Task Link body matcher (D3 rules 2-3), the section-wide link model,
// the tooltip, a listener-free DOM builder, the live-doc status reader
// (P13), and the Live Preview widget. Every helper is synchronous and
// never throws; bad input yields null (or an empty list). Mirrors the
// Today model in `060-today.js` (which it must never change: Today
// still excludes `#` move-only lines) and reuses `planSectionRange`,
// `planFencedLines`, `planParseEntry`, `todayIsSubBulletLine`,
// `todayIndentLen`, `todayBulletBody`, `todayWikilinkTokens`, and
// `planStruckInnerSpans` from the sibling fragments.

// The two-line hover tooltip. It never contains `::`, because
// Dataview's reading-view pass re-scans `innerHTML` for inline fields.
const PROGRESS_MARK_TOOLTIP = "In Progress\nAlt+[ or Alt+] → Next";

// The match behind `progressMarkLinkFromBody`: the bare-link `token`
// plus `prefix`, the number of UTF-16 units stripped from the front
// (leading 🍅 markers), so callers can map the token back to line
// offsets. Never throws.
function progressMarkMatchFromBody(body) {
  try {
    const text = String(body || "");
    if (text === "") {
      return null;
    }
    const stripped = text.replace(/^(?:🍅\s*)+/, "");
    if (stripped === "") {
      return null;
    }
    const prefix = text.length - stripped.length;
    const bare = stripped.replace(/[ \t]*#[ \t]*$/, "");
    if (bare === "") {
      return null;
    }
    const tokens = todayWikilinkTokens(bare);
    if (tokens.length !== 1) {
      return null;
    }
    const token = tokens[0];
    if (token.start !== 0 || token.end !== bare.length) {
      return null;
    }
    if (token.embedded) {
      return null;
    }
    const struck = planStruckInnerSpans(bare);
    for (const span of struck) {
      try {
        if (
          Array.isArray(span) &&
          token.start >= span[0] &&
          token.end <= span[1]
        ) {
          return null;
        }
      } catch (error) {
        continue;
      }
    }
    return { token, prefix };
  } catch (error) {
    return null;
  }
}

// A dedicated plain Task Link body (D3 rules 2-3): the body is exactly
// one `[[target#^id]]` (optional alias), after stripping leading 🍅
// markers. An optional trailing `#` move-only marker (with or without
// a space) is allowed. Excluded: struck `~~[[…]]~~` links, embedded
// `![[…]]` links, and links mixed with other text. `todayLinkFromBody`
// is left untouched, because Today still excludes `#` lines. Returns
// the wikilink token, or null. Never throws.
function progressMarkLinkFromBody(body) {
  try {
    const match = progressMarkMatchFromBody(body);
    return match ? match.token : null;
  } catch (error) {
    return null;
  }
}

// Every markable Task Link under the note's open Pomodoro entries, in
// ledger order: `[{ line, ch, target, blockId }]` with 0-based `line`
// and `ch` the line-relative offset of `[[`. D3 rules 2-3 only (open
// entry, dedicated plain link at the entry's first child indent);
// the file-date gate (today's daily note), the status gate (`/`),
// and resolution live in the mixin. Never throws.
function progressMarkLinks(content) {
  try {
    const lines = String(content || "")
      .replace(/\r\n/g, "\n")
      .split("\n");
    const section = planSectionRange(lines);
    if (!section) {
      return [];
    }
    const fenced = planFencedLines(lines, section.start, section.end);
    const links = [];
    for (let index = section.start; index <= section.end; index += 1) {
      if (fenced.has(index)) {
        continue;
      }
      const line = String(lines[index] || "");
      if (line.startsWith(" ") || line.startsWith("\t")) {
        continue;
      }
      const parsed = planParseEntry(line);
      if (!parsed || parsed.state !== "open") {
        continue;
      }
      // The entry's sub-bullet range: following non-empty indented
      // list lines (a blank line, a column-0 line, or the section end
      // stops it), mirroring `computeTodayLinks`.
      const range = [];
      for (let sub = index + 1; sub <= section.end; sub += 1) {
        if (fenced.has(sub)) {
          continue;
        }
        if (!todayIsSubBulletLine(lines[sub])) {
          break;
        }
        range.push(sub);
      }
      if (range.length === 0) {
        continue;
      }
      const childIndent = todayIndentLen(lines[range[0]]);
      for (const sub of range) {
        try {
          if (todayIndentLen(lines[sub]) !== childIndent) {
            continue;
          }
          const bullet = todayBulletBody(lines[sub]);
          if (!bullet) {
            continue;
          }
          const match = progressMarkMatchFromBody(bullet.body);
          if (!match) {
            continue;
          }
          links.push({
            line: sub,
            ch: bullet.bodyStart + match.prefix + match.token.start,
            target: match.token.pathPart,
            blockId: match.token.blockId,
          });
        } catch (error) {
          continue;
        }
      }
    }
    return links;
  } catch (error) {
    return [];
  }
}

// Escape a block id for the live-doc standalone-id pattern. Never
// throws.
function progressMarkEscapeBlockId(blockId) {
  try {
    return String(blockId || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  } catch (error) {
    return "";
  }
}

// The checkbox character of the live-doc line carrying the standalone
// `^blockId` (P13: the target task lives in the daily note itself and
// was just edited, so the metadata cache is stale), or null when no
// such line exists or it carries no checkbox. Never throws.
function progressMarkLiveStatus(content, blockId) {
  try {
    const id = String(blockId || "");
    if (id === "") {
      return null;
    }
    const pattern = new RegExp(
      "(?:^|\\s)\\^" + progressMarkEscapeBlockId(id) + "(?:\\s|$)",
    );
    const lines = String(content || "")
      .replace(/\r\n/g, "\n")
      .split("\n");
    for (const line of lines) {
      try {
        if (!pattern.test(String(line || ""))) {
          continue;
        }
        const checkbox =
          /^\s*(?:[-*+]|\d+[.)])\s+\[([^\]])\]/.exec(String(line || ""));
        if (checkbox) {
          return checkbox[1];
        }
        return null;
      } catch (error) {
        continue;
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Listener-free mark element, so it survives Dataview's innerHTML
// round-trip. Produces
// `span.bob-progress-mark[role=img][aria-label][data-tooltip-position=top][data-block-id]`.
// `doc` provides `createElement` so tests can pass a fake document.
// Never throws: bad input yields null.
function buildProgressMarkElement(doc, blockId) {
  try {
    if (!doc || typeof doc.createElement !== "function") {
      return null;
    }
    const id = String(blockId || "");
    if (id === "" || !PLAN_BLOCK_ID_RE.test(id)) {
      return null;
    }
    const span = doc.createElement("span");
    span.setAttribute("class", "bob-progress-mark");
    span.setAttribute("role", "img");
    span.setAttribute("aria-label", PROGRESS_MARK_TOOLTIP);
    span.setAttribute("data-tooltip-position", "top");
    span.setAttribute("data-block-id", id);
    return span;
  } catch (error) {
    return null;
  }
}

// Live Preview widget for one In Progress mark. `eq` compares the
// block id, so unchanged marks never flicker. `toDOM` builds the
// listener-free element and adds the place-cursor-on-mousedown
// listener only: the mark never opens the link and never writes.
// Defined only when `WidgetType` exists; otherwise null and the
// extension is not registered.
let ProgressMarkWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  ProgressMarkWidget = class extends WidgetType {
    constructor(blockId) {
      super();
      this.blockId = String(blockId || "");
      this.key = this.blockId;
    }

    eq(other) {
      return (
        Boolean(other) &&
        other instanceof ProgressMarkWidget &&
        other.key === this.key
      );
    }

    toDOM(view) {
      const dom = buildProgressMarkElement(
        typeof document !== "undefined" ? document : null,
        this.blockId,
      );
      // In tests `document` is undefined and the caller passes a fake
      // doc via `buildProgressMarkElement` directly; never throw here.
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
            let anchor = null;
            try {
              anchor =
                view && typeof view.posAtDOM === "function"
                  ? view.posAtDOM(dom)
                  : null;
            } catch (error) {
              anchor = null;
            }
            // The widget sits at `side: -1` on the link start, so the
            // widget position is the link start.
            if (typeof anchor === "number") {
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
