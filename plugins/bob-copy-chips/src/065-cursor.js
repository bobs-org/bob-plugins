// Pure cursor resolver for the copy-on-cursor-line command.
// Reads live buffer lines only, never the metadata cache. Fence handling
// mirrors bob-navigation-hotkeys 101-copy-card-model without depending on
// that plugin: nested backtick/tilde fences, same-char closing with length
// and indent rules, and an unclosed fence running to the end of the note.
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

// Up to `indent` leading spaces come off a fence body line, matching how a
// list-nested fence dedents under its opening. Lines with less indentation
// keep what they have; tabs are literal content. Never throws.
function copyChipFenceDedentLine(line, indent) {
  try {
    let rest = String(line === undefined || line === null ? "" : line);
    let count = 0;
    const width = Number.isInteger(indent) && indent > 0 ? indent : 0;
    while (count < width && rest.charAt(0) === " ") {
      rest = rest.slice(1);
      count += 1;
    }
    return rest;
  } catch (error) {
    return "";
  }
}

// Forward scan for the closing line of the fence opened at `openIndex`.
// Returns the closing line index, or -1 when the fence runs to the end of
// the note. Never throws.
function copyChipScanFenceClose(lines, openIndex, opening) {
  try {
    if (!Array.isArray(lines) || !Number.isInteger(openIndex) || !opening) return -1;
    for (let index = openIndex + 1; index < lines.length; index += 1) {
      let text = "";
      try {
        text = String(lines[index] === undefined || lines[index] === null ? "" : lines[index]);
      } catch (error) {
        text = "";
      }
      try {
        if (copyChipCursorFenceCloses(text, opening)) return index;
      } catch (error) {
        continue;
      }
    }
    return -1;
  } catch (error) {
    return -1;
  }
}

// The fence block enclosing `lineIndex`: its opening line, its closing line
// (null when unclosed), and the parsed opening. The walk matches
// copyChipCursorLineIsFenced, including nested different-char fences as
// content. Returns null when the line is not on or inside a fence. Never
// throws.
function copyChipFindFenceBlock(lines, lineIndex) {
  try {
    if (!Array.isArray(lines)) return null;
    if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) return null;
    let open = null;
    for (let index = 0; index <= lineIndex; index += 1) {
      let text = "";
      try {
        text = String(lines[index] === undefined || lines[index] === null ? "" : lines[index]);
      } catch (error) {
        text = "";
      }
      if (open) {
        let closes = false;
        try {
          closes = copyChipCursorFenceCloses(text, open.opening);
        } catch (error) {
          closes = false;
        }
        if (closes) {
          if (index === lineIndex) {
            return { openIndex: open.index, opening: open.opening, closeIndex: index };
          }
          open = null;
          continue;
        }
        if (index === lineIndex) {
          const closeAt = copyChipScanFenceClose(lines, open.index, open.opening);
          return {
            openIndex: open.index,
            opening: open.opening,
            closeIndex: closeAt < 0 ? null : closeAt,
          };
        }
        continue;
      }
      let opening = null;
      try {
        opening = copyChipFenceOpeningFromLine(text);
      } catch (error) {
        opening = null;
      }
      if (opening) {
        if (index === lineIndex) {
          const closeAt = copyChipScanFenceClose(lines, index, opening);
          return { openIndex: index, opening, closeIndex: closeAt < 0 ? null : closeAt };
        }
        open = { index, opening };
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

// A ready block chip for a `bob-copy` fence block, or null when the block
// is another language. Body lines dedent under the opening; a final empty
// body line keeps one trailing LF through copyChipFencePayload. `line` is
// the cursor line and [from, to] covers it, so a missing card still flashes
// where the user is. Never throws.
function copyChipFenceBlockChip(lines, lineIndex, block) {
  try {
    if (!block || !block.opening) return null;
    let parsed = null;
    try {
      parsed = copyChipParseFenceInfo(block.opening.info || "");
    } catch (error) {
      return null;
    }
    if (!parsed) return null;
    const end = block.closeIndex == null ? lines.length : block.closeIndex;
    const body = [];
    for (let index = block.openIndex + 1; index < end; index += 1) {
      let raw = "";
      try {
        raw = lines[index] === undefined || lines[index] === null ? "" : lines[index];
      } catch (error) {
        raw = "";
      }
      body.push(copyChipFenceDedentLine(raw, block.opening.indent));
    }
    const text = copyChipFencePayload(body);
    let cursorLine = "";
    try {
      cursorLine = String(lines[lineIndex] === undefined || lines[lineIndex] === null ? "" : lines[lineIndex]);
    } catch (error) {
      cursorLine = "";
    }
    return copyChipFreeze({
      state: "ready",
      count: 1,
      chip: copyChipFreeze({
        form: "block",
        label: parsed.label,
        text,
        line: lineIndex,
        from: 0,
        to: cursorLine.length,
      }),
    });
  } catch (error) {
    return null;
  }
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
    // Fences first: a `bob-copy` opening, body, or closing line resolves
    // the whole fence as a block chip, so example spans inside the body
    // never win as inline chips. Any other fenced line stays none, which
    // keeps code samples inert. Frontmatter never resolves.
    try {
      if (copyChipCursorInFrontmatter(lines, line)) return copyChipNone(0);
    } catch (error) {
      return copyChipNone(0);
    }
    try {
      const block = copyChipFindFenceBlock(lines, line);
      if (block) {
        const blockChip = copyChipFenceBlockChip(lines, line, block);
        if (blockChip) return blockChip;
        return copyChipNone(0);
      }
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
