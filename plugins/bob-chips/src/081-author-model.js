// Pure make-or-edit target resolution and replacement planning for both
// chip kinds: copy (`copy:` / `bob-copy`) and run (`run:` / `bob-run`).
// Never throws. Never reads the DOM, clipboard, or editor APIs; Run
// defaults read only the injected, pure `resolveCommand`.
const COPY_CHIP_AUTHOR_ONE_SELECTION = "One selection at a time";
const COPY_CHIP_AUTHOR_STALE = "The note changed — reopen the card";
const COPY_CHIP_AUTHOR_TABLE_BLOCK = "can't put a block card in a table cell";
const COPY_CHIP_AUTHOR_WHITESPACE = "whitespace only — nothing to copy";

function copyChipAuthorAmbiguousReason(count) {
  try {
    return String(Number.isInteger(count) ? count : 0) + " chips on this line · move onto one";
  } catch (error) {
    return "chips on this line · move onto one";
  }
}

function copyChipAuthorKind(kind) {
  return kind === "run" ? "run" : "copy";
}

// "Make copy chip", "Edit command chip", and so on, for aria labels and
// the card's subtitle.
function copyChipAuthorTitle(mode, kind) {
  const noun = copyChipAuthorKind(kind) === "run" ? "command chip" : "copy chip";
  return (mode === "edit" ? "Edit " : "Make ") + noun;
}

function copyChipAuthorRefuse(reason) {
  return copyChipFreeze({ ok: false, reason: String(reason || "unavailable") });
}

function copyChipAuthorSplitLines(source) {
  try {
    return String(source === undefined || source === null ? "" : source).split("\n");
  } catch (error) {
    return [""];
  }
}

function copyChipAuthorLineStart(lines, lineIndex) {
  try {
    let offset = 0;
    const limit = Number.isInteger(lineIndex) ? lineIndex : 0;
    for (let index = 0; index < limit && index < lines.length; index += 1) {
      offset += String(lines[index] || "").length + 1;
    }
    return offset;
  } catch (error) {
    return 0;
  }
}

function copyChipAuthorPosAt(lines, offset) {
  try {
    let remaining = Number(offset);
    if (!Number.isFinite(remaining) || remaining < 0) remaining = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const length = String(lines[index] || "").length;
      if (remaining <= length) return { line: index, ch: remaining };
      remaining -= length + 1;
    }
    const last = Math.max(0, lines.length - 1);
    return { line: last, ch: String(lines[last] || "").length };
  } catch (error) {
    return { line: 0, ch: 0 };
  }
}

function copyChipAuthorNormalizeRange(range) {
  try {
    if (!range || typeof range !== "object") return null;
    const from = Number(range.from);
    const to = Number(range.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    return { from: lo, to: hi, reversed: from > to, empty: lo === hi };
  } catch (error) {
    return null;
  }
}

function copyChipAuthorListMarker(line) {
  try {
    const text = String(line === undefined || line === null ? "" : line);
    const match = /^([ \t]*)(?:[-*+]|\d+[.)])( {1,4}\[[ xX]\])?( +|$)/.exec(text);
    if (!match) return null;
    return {
      leading: match[1],
      prefix: match[0],
      contentColumn: match[0].length,
    };
  } catch (error) {
    return null;
  }
}

// Indent string for a fence nested in the line's list item (content column),
// reusing the line's own leading whitespace characters. Continuation lines
// keep their existing indent. Never throws.
function copyChipAuthorListContentIndent(line) {
  try {
    const marker = copyChipAuthorListMarker(line);
    if (marker) return marker.leading + " ".repeat(Math.max(0, marker.contentColumn - marker.leading.length));
    const cont = /^([ \t]+)/.exec(String(line === undefined || line === null ? "" : line));
    return cont ? cont[1] : "";
  } catch (error) {
    return "";
  }
}

function copyChipAuthorLineIsTable(line) {
  try {
    return String(line === undefined || line === null ? "" : line).indexOf("|") !== -1;
  } catch (error) {
    return false;
  }
}

function copyChipAuthorSpanIsInsideMath(line, from, to) {
  try {
    const text = String(line === undefined || line === null ? "" : line);
    const before = text.slice(0, from);
    const after = text.slice(to);
    const dollars = (before.match(/\$+/g) || []).join("");
    let odd = false;
    let index = 0;
    while (index < dollars.length) {
      if (dollars[index] === "$") {
        odd = !odd;
        index += 1;
      } else {
        index += 1;
      }
    }
    if (!odd) return false;
    return after.indexOf("$") >= 0;
  } catch (error) {
    return false;
  }
}

function copyChipAuthorSpanIsInsideComment(line, from, to) {
  try {
    const text = String(line === undefined || line === null ? "" : line);
    const before = text.slice(0, from);
    const open = before.lastIndexOf("<!--");
    const close = before.lastIndexOf("-->");
    if (open < 0 || open < close) return false;
    return text.slice(to).indexOf("-->") >= 0;
  } catch (error) {
    return false;
  }
}

function copyChipAuthorPlainSpanAt(lines, lineIndex, ch) {
  try {
    if (!Array.isArray(lines) || !Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) {
      return null;
    }
    if (!Number.isInteger(ch) || ch < 0) return null;
    try {
      if (copyChipCursorInFrontmatter(lines, lineIndex)) return null;
    } catch (error) {
      return null;
    }
    try {
      if (copyChipCursorLineIsFenced(lines, lineIndex)) return null;
    } catch (error) {
      return null;
    }
    const line = String(lines[lineIndex] === undefined || lines[lineIndex] === null ? "" : lines[lineIndex]);
    try {
      if (copyChipLiveLineIsIndentedCode(line)) return null;
    } catch (error) {
      return null;
    }
    let spans = [];
    try {
      spans = copyChipFindCodeSpans(line);
    } catch (error) {
      return null;
    }
    for (const span of spans) {
      try {
        if (ch < span.from || ch >= span.to) continue;
        if (copyChipSpanIsInsideWikilink(line, span.from, span.to)) continue;
        if (copyChipSpanIsInsideLinkLabel(line, span.from, span.to)) continue;
        if (copyChipAuthorSpanIsInsideMath(line, span.from, span.to)) continue;
        if (copyChipAuthorSpanIsInsideComment(line, span.from, span.to)) continue;
        const content = copyChipNormalizeSpan(span.raw, { table: copyChipAuthorLineIsTable(line) });
        if (content == null) continue;
        if (copyChipParseContent(content) || runChipParseContent(content)) continue;
        return copyChipFreeze({
          from: span.from,
          to: span.to,
          raw: span.raw,
          text: content,
          table: copyChipAuthorLineIsTable(line),
        });
      } catch (error) {
        continue;
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

function copyChipAuthorFenceRange(source, lines, block) {
  try {
    if (!block || !Number.isInteger(block.openIndex)) return null;
    const from = copyChipAuthorLineStart(lines, block.openIndex);
    if (block.closeIndex == null) {
      return { from, to: String(source).length };
    }
    const closeStart = copyChipAuthorLineStart(lines, block.closeIndex);
    const closeLine = String(lines[block.closeIndex] || "");
    return { from, to: closeStart + closeLine.length };
  } catch (error) {
    return null;
  }
}

function copyChipAuthorSnapshot(fields) {
  try {
    const src = fields && typeof fields === "object" ? fields : {};
    return copyChipFreeze({
      originalSource: String(src.originalSource == null ? "" : src.originalSource),
      from: Number(src.from) || 0,
      to: Number(src.to) || 0,
      sourceSlice: String(src.sourceSlice == null ? "" : src.sourceSlice),
      label: src.label == null ? "" : String(src.label),
      text: src.text == null ? "" : String(src.text),
      title: src.title || "Make copy chip",
      mode: src.mode || "insert",
      form: src.form || null,
      table: Boolean(src.table),
      indent: src.indent == null ? "" : String(src.indent),
      focus: src.focus === "text" ? "text" : "label",
      selectText: Boolean(src.selectText),
      openingIndent: src.openingIndent == null ? "" : String(src.openingIndent),
      kind: copyChipAuthorKind(src.kind),
      addBob: src.addBob === true,
    });
  } catch (error) {
    return copyChipFreeze({
      originalSource: "",
      from: 0,
      to: 0,
      sourceSlice: "",
      label: "",
      text: "",
      title: "Make copy chip",
      mode: "insert",
      form: null,
      table: false,
      indent: "",
      focus: "text",
      selectText: false,
      openingIndent: "",
      kind: "copy",
      addBob: false,
    });
  }
}

function copyChipAuthorReady(snapshot) {
  return copyChipFreeze({ ok: true, snapshot });
}

// The chip either kind the card edits at an empty cursor: a `bob-copy` or
// `bob-run` fence holding the cursor line, else the chip under the cursor,
// else the line's only chip. Two or more chips on the line with the cursor
// on none is ambiguous; the task fallback never applies here. Frozen
// `{ state: "none" }`, `{ state: "ambiguous", count }`, or
// `{ state: "ready", kind, chip, block }` (`block` is the fence walk result).
function copyChipAuthorChipAt(lines, line, ch) {
  const none = copyChipFreeze({ state: "none", count: 0 });
  try {
    if (copyChipCursorInFrontmatter(lines, line)) return none;
    const block = copyChipFindFenceBlock(lines, line);
    if (block) {
      const copyBlock = copyChipFenceBlockChip(lines, line, block);
      if (copyBlock && copyBlock.chip) {
        return copyChipFreeze({ state: "ready", kind: "copy", chip: copyBlock.chip, block });
      }
      const runBlock = runChipFenceBlockChip(lines, line, block);
      if (runBlock) return copyChipFreeze({ state: "ready", kind: "run", chip: runBlock, block });
      return none;
    }
    const rawLine = String(lines[line] === undefined || lines[line] === null ? "" : lines[line]);
    const chips = chipScanLine(rawLine, { table: copyChipCursorTableForLine(rawLine) });
    const inline = (hit) => copyChipFreeze({
      state: "ready",
      kind: hit.kind === "run" ? "run" : "copy",
      chip: copyChipFreeze({ form: "inline", label: hit.label, text: hit.text, line, from: hit.from, to: hit.to }),
      block: null,
    });
    for (const hit of chips) {
      if (ch >= hit.from && ch < hit.to) return inline(hit);
    }
    if (chips.length === 1) return inline(chips[0]);
    if (chips.length > 1) return copyChipFreeze({ state: "ambiguous", count: chips.length });
    return none;
  } catch (error) {
    return none;
  }
}

// The default kind for new text, from the injected resolver. Never throws.
function copyChipAuthorDefaultKind(request, text) {
  try {
    const resolve = request && typeof request.resolveCommand === "function" ? request.resolveCommand : null;
    return runChipAuthorDefaultKind(resolve, text);
  } catch (error) {
    return copyChipFreeze({ kind: "copy", addBob: false });
  }
}

// Resolve the make-or-edit target from source bytes and selections.
// `selections` are document-offset {from, to} ranges, possibly reversed.
// `resolveCommand` (optional) is Command Mode's pure resolver: new text
// that is a bob command line defaults to Run; editing keeps the chip's kind.
function copyChipAuthorResolve(request) {
  try {
    const req = request && typeof request === "object" ? request : {};
    const source = String(req.source == null ? "" : req.source);
    const lines = copyChipAuthorSplitLines(source);
    const rawSelections = Array.isArray(req.selections) ? req.selections : [];
    if (rawSelections.length > 1) return copyChipAuthorRefuse(COPY_CHIP_AUTHOR_ONE_SELECTION);
    const range = copyChipAuthorNormalizeRange(rawSelections[0] || { from: 0, to: 0 });
    if (!range) return copyChipAuthorRefuse(COPY_CHIP_AUTHOR_ONE_SELECTION);
    const from = Math.max(0, Math.min(range.from, source.length));
    const to = Math.max(0, Math.min(range.to, source.length));
    if (!range.empty) {
      const selected = source.slice(from, to);
      const startPos = copyChipAuthorPosAt(lines, from);
      const startLine = String(lines[startPos.line] || "");
      const indent = copyChipAuthorListContentIndent(startLine);
      const kind = copyChipAuthorDefaultKind(req, selected);
      return copyChipAuthorReady(copyChipAuthorSnapshot({
        originalSource: source,
        from,
        to,
        sourceSlice: selected,
        label: "",
        text: selected,
        title: copyChipAuthorTitle("select", kind.kind),
        mode: "select",
        form: selected.indexOf("\n") >= 0 ? "block" : "inline",
        table: copyChipAuthorLineIsTable(startLine) && selected.indexOf("\n") < 0,
        indent,
        focus: "label",
        selectText: false,
        openingIndent: "",
        kind: kind.kind,
        addBob: kind.addBob,
      }));
    }
    const pos = copyChipAuthorPosAt(lines, from);
    const resolved = copyChipAuthorChipAt(lines, pos.line, pos.ch);
    if (resolved.state === "ambiguous") {
      return copyChipAuthorRefuse(copyChipAuthorAmbiguousReason(resolved.count));
    }
    if (resolved.state === "ready" && resolved.chip) {
      const chip = resolved.chip;
      const kind = resolved.kind;
      if (chip.form === "block") {
        const block = resolved.block;
        const fenceRange = copyChipAuthorFenceRange(source, lines, block);
        const openLine = block ? String(lines[block.openIndex] || "") : String(lines[pos.line] || "");
        const opening = copyChipAuthorListMarker(openLine);
        const openingIndent = opening ? opening.leading : (/^([ \t]*)/.exec(openLine) || ["", ""])[1];
        const indent = openingIndent;
        const rangeFrom = fenceRange ? fenceRange.from : copyChipAuthorLineStart(lines, pos.line);
        const rangeTo = fenceRange ? fenceRange.to : rangeFrom + String(lines[pos.line] || "").length;
        return copyChipAuthorReady(copyChipAuthorSnapshot({
          originalSource: source,
          from: rangeFrom,
          to: rangeTo,
          sourceSlice: source.slice(rangeFrom, rangeTo),
          label: chip.label == null ? "" : String(chip.label),
          text: String(chip.text == null ? "" : chip.text),
          title: copyChipAuthorTitle("edit", kind),
          mode: "edit",
          form: "block",
          table: false,
          indent,
          focus: "label",
          selectText: false,
          openingIndent,
          kind,
        }));
      }
      const lineStart = copyChipAuthorLineStart(lines, chip.line);
      const lineText = String(lines[chip.line] || "");
      return copyChipAuthorReady(copyChipAuthorSnapshot({
        originalSource: source,
        from: lineStart + chip.from,
        to: lineStart + chip.to,
        sourceSlice: source.slice(lineStart + chip.from, lineStart + chip.to),
        label: chip.label == null ? "" : String(chip.label),
        text: String(chip.text == null ? "" : chip.text),
        title: copyChipAuthorTitle("edit", kind),
        mode: "edit",
        form: "inline",
        table: copyChipAuthorLineIsTable(lineText),
        indent: copyChipAuthorListContentIndent(lineText),
        focus: "label",
        selectText: false,
        openingIndent: "",
        kind,
      }));
    }
    const span = copyChipAuthorPlainSpanAt(lines, pos.line, pos.ch);
    if (span) {
      const lineStart = copyChipAuthorLineStart(lines, pos.line);
      const lineText = String(lines[pos.line] || "");
      const kind = copyChipAuthorDefaultKind(req, String(span.text));
      return copyChipAuthorReady(copyChipAuthorSnapshot({
        originalSource: source,
        from: lineStart + span.from,
        to: lineStart + span.to,
        sourceSlice: source.slice(lineStart + span.from, lineStart + span.to),
        label: "",
        text: String(span.text),
        title: copyChipAuthorTitle("convert", kind.kind),
        mode: "convert",
        form: "inline",
        table: Boolean(span.table),
        indent: copyChipAuthorListContentIndent(lineText),
        focus: "label",
        selectText: false,
        openingIndent: "",
        kind: kind.kind,
        addBob: kind.addBob,
      }));
    }
    const startLine = String(lines[pos.line] || "");
    const clipboard = req.clipboardText == null ? "" : String(req.clipboardText);
    const kind = copyChipAuthorDefaultKind(req, clipboard);
    return copyChipAuthorReady(copyChipAuthorSnapshot({
      originalSource: source,
      from,
      to,
      sourceSlice: "",
      label: "",
      text: clipboard,
      title: copyChipAuthorTitle("insert", kind.kind),
      mode: "insert",
      form: clipboard.indexOf("\n") >= 0 ? "block" : "inline",
      table: copyChipAuthorLineIsTable(startLine),
      indent: copyChipAuthorListContentIndent(startLine),
      focus: "text",
      selectText: clipboard !== "",
      openingIndent: "",
      kind: kind.kind,
      addBob: kind.addBob,
    }));
  } catch (error) {
    return copyChipAuthorRefuse("unavailable");
  }
}

function copyChipAuthorValidation(label, text, kind) {
  const run = copyChipAuthorKind(kind) === "run";
  const empty = run ? RUN_CHIP_NOTHING_TO_RUN : COPY_CHIP_NOTHING_TO_COPY;
  try {
    const rawLabel = label == null ? "" : String(label);
    const rawText = text == null ? "" : String(text);
    if (rawLabel.indexOf("\n") >= 0 || rawLabel.indexOf("\r") >= 0) {
      return copyChipFreeze({ ok: false, reason: COPY_CHIP_LABELS_ARE_ONE_LINE });
    }
    if (!copyChipHasNonWhitespace(rawText)) {
      if (rawText !== "" && /[ \t\n\r]/.test(rawText)) {
        return copyChipFreeze({ ok: false, reason: run ? RUN_CHIP_AUTHOR_WHITESPACE : COPY_CHIP_AUTHOR_WHITESPACE });
      }
      return copyChipFreeze({ ok: false, reason: empty });
    }
    return copyChipFreeze({ ok: true, reason: null });
  } catch (error) {
    return copyChipFreeze({ ok: false, reason: empty });
  }
}

function copyChipAuthorFenceLineCount(text) {
  try {
    const body = copyChipNormalizeNewlines(String(text == null ? "" : text));
    if (body === "") return 0;
    const parts = body.split("\n");
    return body.charAt(body.length - 1) === "\n" ? parts.length - 1 : parts.length;
  } catch (error) {
    return 0;
  }
}

// Plan the exact replacement bytes for a snapshot plus draft fields.
// `draft.kind` ("copy" | "run") picks the grammar; it defaults to the
// snapshot's kind, so switching kinds keeps Label and Text untouched.
function copyChipAuthorPlan(snapshot, draft) {
  try {
    const snap = snapshot && typeof snapshot === "object" ? snapshot : null;
    if (!snap) return copyChipAuthorRefuse("unavailable");
    const input = draft && typeof draft === "object" ? draft : {};
    const kind = copyChipAuthorKind(input.kind === undefined ? snap.kind : input.kind);
    const run = kind === "run";
    const label = input.label == null ? "" : String(input.label);
    const text = copyChipNormalizeNewlines(input.text == null ? "" : String(input.text));
    const validation = copyChipAuthorValidation(label, text, kind);
    if (!validation.ok) return copyChipAuthorRefuse(validation.reason);
    const table = Boolean(snap.table);
    if (table && text.indexOf("\n") >= 0) {
      return copyChipAuthorRefuse(run ? RUN_CHIP_TABLE_BLOCK : COPY_CHIP_AUTHOR_TABLE_BLOCK);
    }
    let serialized = null;
    try {
      serialized = (run ? runChipSerialize : copyChipSerialize)(
        { label, text },
        { table, indent: text.indexOf("\n") >= 0 ? String(snap.indent || "") : "" },
      );
    } catch (error) {
      return copyChipAuthorRefuse("serialize failed");
    }
    if (!serialized || serialized.ok !== true) {
      return copyChipAuthorRefuse((serialized && serialized.reason) || (run ? RUN_CHIP_NOTHING_TO_RUN : COPY_CHIP_NOTHING_TO_COPY));
    }
    let markdown = String(serialized.markdown || "");
    const source = String(snap.originalSource || "");
    const from = Number(snap.from) || 0;
    const to = Number(snap.to) || 0;
    const lineStartBefore = source.lastIndexOf("\n", Math.max(0, from - 1));
    const startOfLine = lineStartBefore < 0 ? 0 : lineStartBefore + 1;
    const afterNl = source.indexOf("\n", to);
    const endOfLine = afterNl < 0 ? source.length : afterNl;
    const startsMidLine = from > startOfLine;
    const endsMidLine = to < endOfLine;
    if (serialized.form === "block") {
      if (startsMidLine) markdown = "\n" + markdown;
      if (endsMidLine) markdown = markdown + "\n";
    } else if (snap.form === "block" && snap.openingIndent) {
      markdown = String(snap.openingIndent) + markdown;
    }
    const cursorAfter = from + markdown.length;
    const lines = serialized.form === "block" ? copyChipAuthorFenceLineCount(text) : 1;
    let caption = "inline chip";
    if (serialized.form === "block") {
      if (run) {
        const steps = runChipAuthorStepRanges(text).length;
        caption = "sequence card · " + String(steps) + (steps === 1 ? " step" : " steps");
      } else {
        caption = "block card · " + String(lines) + (lines === 1 ? " line" : " lines");
      }
    }
    return copyChipFreeze({
      ok: true,
      kind,
      form: serialized.form,
      markdown,
      serialized: serialized.markdown,
      from,
      to,
      cursorAfter,
      previewKind: serialized.form === "block" ? "block" : "inline",
      previewLines: lines,
      caption,
    });
  } catch (error) {
    return copyChipAuthorRefuse("unavailable");
  }
}

function copyChipAuthorIsStale(snapshot, currentSource) {
  try {
    if (!snapshot || typeof snapshot !== "object") return true;
    return String(snapshot.originalSource == null ? "" : snapshot.originalSource) !==
      String(currentSource == null ? "" : currentSource);
  } catch (error) {
    return true;
  }
}

// The card's whole draft verdict. `options.kind` overrides the snapshot's
// kind; in Run, `options.resolve` (Command Mode's pure resolver, or null)
// adds live per-step validation, and `options.uncheckedReason` explains a
// missing resolver. Invalid Run steps block Save; warnings never do.
function copyChipAuthorDraftState(snapshot, label, text, options) {
  try {
    const opts = options && typeof options === "object" ? options : {};
    const snapKind = snapshot && typeof snapshot === "object" ? snapshot.kind : undefined;
    const kind = copyChipAuthorKind(opts.kind === undefined ? snapKind : opts.kind);
    const plan = copyChipAuthorPlan(snapshot, { label, text, kind });
    const validation = copyChipAuthorValidation(label, text, kind);
    const run = kind === "run"
      ? runChipAuthorValidate(typeof opts.resolve === "function" ? opts.resolve : null, text, {
        uncheckedReason: opts.uncheckedReason,
      })
      : null;
    const planOk = Boolean(plan && plan.ok);
    const runOk = !run || run.canSave;
    let reason = null;
    if (!planOk) reason = (plan && plan.reason) || (validation && validation.reason);
    else if (!runOk) reason = run.reason;
    return copyChipFreeze({
      kind,
      label: label == null ? "" : String(label),
      text: text == null ? "" : String(text),
      valid: planOk && runOk,
      reason,
      warning: planOk && run && run.canSave ? run.warning : null,
      run,
      addBob: run ? run.addBob : null,
      form: planOk ? plan.form : (String(text || "").indexOf("\n") >= 0 ? "block" : "inline"),
      markdown: planOk ? plan.markdown : "",
      serialized: planOk ? plan.serialized : "",
      caption: planOk ? plan.caption : "",
      previewKind: planOk ? plan.previewKind : null,
      previewLines: planOk ? plan.previewLines : 0,
      cursorAfter: planOk ? plan.cursorAfter : null,
    });
  } catch (error) {
    return copyChipFreeze({
      kind: "copy",
      label: "",
      text: "",
      valid: false,
      reason: COPY_CHIP_NOTHING_TO_COPY,
      warning: null,
      run: null,
      addBob: null,
      form: "inline",
      markdown: "",
      serialized: "",
      caption: "",
      previewKind: null,
      previewLines: 0,
      cursorAfter: null,
    });
  }
}

function copyChipAuthorCloseKey(event) {
  try {
    if (!event || event.isComposing === true || event.keyCode === 229) return null;
    const hasCtrl = event.ctrlKey === true;
    const hasAlt = event.altKey === true;
    const hasMeta = event.metaKey === true;
    const hasShift = event.shiftKey === true;
    if (hasCtrl && !hasAlt && !hasMeta && !hasShift &&
        (event.code === "BracketLeft" || event.key === "[")) {
      return "ctrl-bracket";
    }
    if (event.key === "Escape") return "escape";
    if ((event.key === "q" || event.key === "Q") && !hasCtrl && !hasMeta && !hasAlt) return "q";
    return null;
  } catch (error) {
    return null;
  }
}

function copyChipAuthorTargetIsField(target) {
  try {
    if (!target) return false;
    const tag = String((target.tagName || target.nodeName || "")).toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (target.isContentEditable === true) return true;
    try {
      const editable = typeof target.getAttribute === "function"
        ? target.getAttribute("contenteditable")
        : null;
      if (editable && String(editable).toLowerCase() !== "false") return true;
    } catch (error) {
      // Attribute probe is best-effort.
    }
    return false;
  } catch (error) {
    return false;
  }
}

function copyChipAuthorIsSaveHotkey(event) {
  try {
    if (!event || event.isComposing === true || event.keyCode === 229) return false;
    const key = String(event.key || "");
    if (key !== "y" && key !== "Y") return false;
    const mod = event.metaKey === true || event.ctrlKey === true;
    return mod && event.shiftKey === true;
  } catch (error) {
    return false;
  }
}

// Pure key decision for the author card. Never mutates. `options` says
// where focus is: `inField` (a text control), `inText` (the Text/Command
// field), `onKind` (the Kind control: ←/→ switch, Space toggles), and
// `onButton` (the Add bob button: Enter or Space presses it).
function copyChipAuthorKeyAction(event, options) {
  try {
    if (!event) return copyChipFreeze({ type: "ignore" });
    if (event.isComposing === true || event.keyCode === 229) return copyChipFreeze({ type: "ignore" });
    const opts = options && typeof options === "object" ? options : {};
    const inField = opts.inField === true;
    const inText = opts.inText === true;
    const onKind = opts.onKind === true && !inField;
    const onButton = opts.onButton === true && !inField;
    if (copyChipAuthorIsSaveHotkey(event)) return copyChipFreeze({ type: "save" });
    const close = copyChipAuthorCloseKey(event);
    if (close === "escape" || close === "ctrl-bracket") return copyChipFreeze({ type: "cancel", key: close });
    if (close === "q") {
      if (inField) return copyChipFreeze({ type: "type" });
      return copyChipFreeze({ type: "cancel", key: "q" });
    }
    if (event.key === "Tab") {
      return copyChipFreeze({ type: event.shiftKey === true ? "prev-field" : "next-field" });
    }
    const plain = event.ctrlKey !== true && event.metaKey !== true && event.altKey !== true;
    if (onKind && plain && event.shiftKey !== true) {
      if (event.key === "ArrowLeft" || event.key === "Left") return copyChipFreeze({ type: "kind-prev" });
      if (event.key === "ArrowRight" || event.key === "Right") return copyChipFreeze({ type: "kind-next" });
      if (event.key === " " || event.key === "Spacebar") return copyChipFreeze({ type: "kind-toggle" });
    }
    if (onButton && plain && event.shiftKey !== true &&
        (event.key === "Enter" || event.key === " " || event.key === "Spacebar")) {
      return copyChipFreeze({ type: "press" });
    }
    if (event.key === "Enter") {
      if (event.shiftKey === true) {
        if (inText) return copyChipFreeze({ type: "newline" });
        return copyChipFreeze({ type: "ignore" });
      }
      return copyChipFreeze({ type: "save" });
    }
    return copyChipFreeze({ type: inField ? "type" : "ignore" });
  } catch (error) {
    return copyChipFreeze({ type: "ignore" });
  }
}
