// Pure command-chip cursor rule: which command chip would ⌘↵ run? It reads
// live buffer lines only, never the metadata cache, never Command Mode, and
// never the vault. Copy chips never count here, and copyChipAt never sees
// command chips: kinds never compete.

function commandChipNone() {
  return copyChipFreeze({ state: "none", count: 0 });
}

function commandChipAmbiguous(count, via) {
  const where = via === "task" ? "in this task" : "on this line";
  return copyChipFreeze({
    state: "ambiguous",
    count,
    via,
    message: count + " command chips " + where + " · move onto one",
  });
}

function commandChipReady(count, via, chip) {
  return copyChipFreeze({ state: "ready", count, via, chip: copyChipFreeze(chip) });
}

function commandChipLineText(lines, index) {
  try {
    const value = lines[index];
    return String(value === undefined || value === null ? "" : value);
  } catch (error) {
    return "";
  }
}

// A block chip for a `bob-run` fence, or null for any other language.
// `line` is the cursor line for a fence result or the opening line for a
// task result, and `[from, to)` covers that source line. `fence` names the
// opening and closing lines (`close` is null for an unclosed fence that runs
// to the end of the note) so callers can find the card. Never throws.
function runChipFenceBlockChip(lines, lineIndex, block) {
  try {
    const body = chipFenceBlockBody(lines, block, runChipParseFenceInfo);
    if (!body) return null;
    return copyChipFreeze({
      form: "block",
      label: body.label,
      text: body.text,
      line: lineIndex,
      from: 0,
      to: commandChipLineText(lines, lineIndex).length,
      fence: copyChipFreeze({
        open: block.openIndex,
        close: block.closeIndex == null ? null : block.closeIndex,
      }),
    });
  } catch (error) {
    return null;
  }
}

function commandChipInline(chip, line) {
  return {
    form: "inline",
    label: chip.label,
    text: chip.text,
    line,
    from: chip.from,
    to: chip.to,
  };
}

// The ⌘↵ rule over zero-based lines and UTF-16 offsets; `from` / `to`
// include the delimiters with `to` exclusive, matching scanLine:
//   1. the cursor is on or inside a `bob-run` fence: that fence (any other
//      fence, and frontmatter, is `none`, so code samples stay inert);
//   2. a command chip under the cursor (`from <= ch < to`): that chip;
//   3. the cursor is on a link (`from <= ch < to` of chipLinkSpans): `none`,
//      so the existing chain opens the link;
//   4. one command chip on the line: that chip; two or more: `ambiguous`;
//   5. the line holds any link: `none`, so the line's own target wins;
//   6. the only command chip in the task scope (`{ kind: "task", lines }`,
//      which must own the cursor line; a touched `bob-run` fence counts
//      once): that chip; two or more: `ambiguous`;
//   7. otherwise `none`.
// What Live Preview hides stays inert: a run chip inside a `%%`, HTML
// comment, or `$$` block that spans lines (chipBlockShieldState) never
// counts in rules 2, 4, or 6, and a `bob-run` fence whose opening line
// starts inside such a block is `none` in rule 1 and skipped in rule 6.
// Results are frozen: `{ state: "none", count: 0 }`,
// `{ state: "ambiguous", count, via: "line" | "task", message }`, or
// `{ state: "ready", count, via: "fence" | "cursor" | "line" | "task", chip }`.
// Never throws.
function commandChipAt(request) {
  try {
    const req = request && typeof request === "object" ? request : {};
    const lines = Array.isArray(req.lines) ? req.lines : null;
    const line = req.line;
    const ch = req.ch;
    if (!lines || !Number.isInteger(line) || line < 0 || line >= lines.length) {
      return commandChipNone();
    }
    if (!Number.isInteger(ch) || ch < 0) return commandChipNone();
    if (copyChipCursorInFrontmatter(lines, line)) return commandChipNone();

    const scopeLines = copyChipNormalizeTaskScope(req.scope, lines, line);
    let shield = null;
    const shieldState = () => {
      if (!shield) {
        const lastScope = scopeLines ? scopeLines[scopeLines.length - 1] : line;
        shield = chipBlockShieldState(lines, Math.max(line, lastScope));
      }
      return shield;
    };

    const block = copyChipFindFenceBlock(lines, line);
    if (block) {
      const chip = runChipFenceBlockChip(lines, line, block);
      if (!chip || chipBlockShieldCarries(shieldState(), block.openIndex)) return commandChipNone();
      return commandChipReady(1, "fence", chip);
    }

    const rawLine = commandChipLineText(lines, line);
    const scanned = runChipScanLine(rawLine, { table: copyChipCursorTableForLine(rawLine) });
    const chips = scanned.length === 0
      ? scanned
      : scanned.filter((chip) => !chipBlockShieldHides(shieldState(), line, chip.from));
    for (const chip of chips) {
      if (ch >= chip.from && ch < chip.to) {
        return commandChipReady(chips.length, "cursor", commandChipInline(chip, line));
      }
    }

    const links = chipLinkSpans(rawLine);
    for (const link of links) {
      if (ch >= link.from && ch < link.to) return commandChipNone();
    }

    if (chips.length === 1) {
      return commandChipReady(1, "line", commandChipInline(chips[0], line));
    }
    if (chips.length > 1) return commandChipAmbiguous(chips.length, "line");
    if (links.length > 0) return commandChipNone();

    if (!scopeLines) return commandChipNone();
    const taskChips = chipScanTaskScope(lines, scopeLines, "run", shieldState());
    if (taskChips.length === 1) return commandChipReady(1, "task", taskChips[0]);
    if (taskChips.length > 1) return commandChipAmbiguous(taskChips.length, "task");
    return commandChipNone();
  } catch (error) {
    return commandChipNone();
  }
}

// `api.commandChips` v1: the pure members. Frozen, and every member is
// total: it never throws. Later phases add editor-bound members (keymap's
// `targetAt` / `runAtCursor`), which callers feature-detect with `typeof`.
function commandChipBuildApi() {
  return copyChipFreeze({
    version: 1,
    parse(content) {
      try {
        return runChipParseContent(content);
      } catch (error) {
        return null;
      }
    },
    scanLine(line, options) {
      try {
        return runChipScanLine(line, options);
      } catch (error) {
        return copyChipFreeze([]);
      }
    },
    parseFenceInfo(info) {
      try {
        return runChipParseFenceInfo(info);
      } catch (error) {
        return null;
      }
    },
    fencePayload(bodyLines) {
      try {
        return copyChipFencePayload(bodyLines);
      } catch (error) {
        return "";
      }
    },
    serialize(input, options) {
      try {
        return runChipSerialize(input, options);
      } catch (error) {
        return copyChipFreeze({ ok: false, reason: "serialize failed" });
      }
    },
    chipAt(request) {
      try {
        return commandChipAt(request);
      } catch (error) {
        return commandChipNone();
      }
    },
  });
}

// The inert namespace used when the real one cannot be built.
function commandChipFallbackApi() {
  return copyChipFreeze({
    version: 1,
    parse: () => null,
    scanLine: () => copyChipFreeze([]),
    parseFenceInfo: () => null,
    fencePayload: () => "",
    serialize: () => copyChipFreeze({ ok: false, reason: "unavailable" }),
    chipAt: () => commandChipNone(),
  });
}
