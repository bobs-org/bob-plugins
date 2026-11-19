// Pure cursor resolver for the copy-on-cursor-line command.
// Reads live buffer lines only, never the metadata cache. Fence handling
// mirrors bob-navigation-hotkeys 101-copy-card-model without depending on
// that plugin. At this phase boundary every fenced position returns none;
// phase ni.3 adds the block fallback after the inline rule.
const COPY_CHIP_CURSOR_FENCE_OPEN_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const COPY_CHIP_CURSOR_FENCE_CLOSE_RE = /^(\s*)(`{3,}|~{3,})\s*$/;

function copyChipCursorFenceOpening(line) {
  try {
    const match = String(line).match(COPY_CHIP_CURSOR_FENCE_OPEN_RE);
    if (!match) return null;
    const marker = match[2];
    const info = match[3] || "";
    if (marker.charAt(0) === "`" && info.indexOf("`") !== -1) return null;
    return {
      indent: match[1].length,
      markerChar: marker.charAt(0),
      markerLength: marker.length,
    };
  } catch (error) {
    return null;
  }
}

function copyChipCursorFenceCloses(line, opening) {
  try {
    const match = String(line).match(COPY_CHIP_CURSOR_FENCE_CLOSE_RE);
    if (!match || !opening) return false;
    if (match[2].charAt(0) !== opening.markerChar) return false;
    if (match[2].length < opening.markerLength) return false;
    return match[1].length <= opening.indent + 3;
  } catch (error) {
    return false;
  }
}

// True when the line is a fence delimiter or inside a fenced block,
// including nested backtick/tilde fences. Never throws.
function copyChipCursorLineIsFenced(lines, lineIndex) {
  try {
    const sourceLines = Array.isArray(lines) ? lines : String(lines || "").split(/\r?\n/);
    if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= sourceLines.length) {
      return false;
    }
    let inFence = null;
    for (let index = 0; index <= lineIndex; index += 1) {
      const line = String(sourceLines[index] || "");
      if (inFence) {
        const atTarget = index === lineIndex;
        if (copyChipCursorFenceCloses(line, inFence)) {
          inFence = null;
        }
        if (atTarget) return true;
        continue;
      }
      const opening = copyChipCursorFenceOpening(line);
      if (opening) {
        inFence = opening;
        if (index === lineIndex) return true;
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

function copyChipCursorInFrontmatter(lines, lineIndex) {
  try {
    if (!Array.isArray(lines) || !Number.isInteger(lineIndex)) return false;
    if (lines.length === 0 || String(lines[0]).trim() !== "---") return false;
    for (let index = 1; index < lines.length; index += 1) {
      if (String(lines[index]).trim() === "---" || String(lines[index]).trim() === "...") {
        return lineIndex <= index;
      }
    }
    return true;
  } catch (error) {
    return false;
  }
}

function copyChipCursorTableForLine(line) {
  try {
    return String(line || "").indexOf("|") !== -1;
  } catch (error) {
    return false;
  }
}

function copyChipNone(count) {
  return copyChipFreeze({ state: "none", count: Number.isInteger(count) ? count : 0 });
}

// Zero-based lines and UTF-16 offsets. `from`/`to` include the delimiters
// with `to` exclusive, matching scanLine. A cursor in [from, to) wins;
// otherwise the only eligible chip on the line wins. Never throws.
function copyChipAt(request) {
  try {
    const req = request && typeof request === "object" ? request : {};
    const lines = Array.isArray(req.lines) ? req.lines : null;
    const line = req.line;
    const ch = req.ch;
    if (!lines || !Number.isInteger(line) || line < 0 || line >= lines.length) {
      return copyChipNone(0);
    }
    if (!Number.isInteger(ch) || ch < 0) {
      return copyChipNone(0);
    }
    // Phase ni.3 extension point: fenced positions currently return none so
    // the later block fallback can own them without changing inline rules.
    try {
      if (copyChipCursorLineIsFenced(lines, line)) return copyChipNone(0);
      if (copyChipCursorInFrontmatter(lines, line)) return copyChipNone(0);
    } catch (error) {
      return copyChipNone(0);
    }
    const rawLine = String(lines[line] === undefined || lines[line] === null ? "" : lines[line]);
    let chips = null;
    try {
      chips = copyChipScanLine(rawLine, { table: copyChipCursorTableForLine(rawLine) });
    } catch (error) {
      return copyChipNone(0);
    }
    if (!chips || chips.length === 0) return copyChipNone(0);
    const count = chips.length;
    let contained = null;
    for (const chip of chips) {
      try {
        if (ch >= chip.from && ch < chip.to) {
          contained = chip;
          break;
        }
      } catch (error) {
        continue;
      }
    }
    if (contained) {
      return copyChipFreeze({
        state: "ready",
        count,
        chip: copyChipFreeze({
          form: "inline",
          label: contained.label,
          text: contained.text,
          line,
          from: contained.from,
          to: contained.to,
        }),
      });
    }
    if (count === 1) {
      const only = chips[0];
      return copyChipFreeze({
        state: "ready",
        count,
        chip: copyChipFreeze({
          form: "inline",
          label: only.label,
          text: only.text,
          line,
          from: only.from,
          to: only.to,
        }),
      });
    }
    return copyChipFreeze({ state: "ambiguous", count });
  } catch (error) {
    return copyChipFreeze({ state: "none", count: 0 });
  }
}
