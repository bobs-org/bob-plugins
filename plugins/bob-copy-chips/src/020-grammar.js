const COPY_CHIP_NOTHING_TO_COPY = "nothing to copy";
const COPY_CHIP_LABELS_ARE_ONE_LINE = "labels are one line";

function copyChipFreeze(value) {
  return Object.freeze(value);
}

function copyChipIsEscapedAt(text, index) {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    count += 1;
  }
  return count % 2 === 1;
}

function copyChipLastUnescaped(text, needle) {
  const last = needle.length === 0 ? -1 : text.lastIndexOf(needle);
  if (last < 0) return -1;
  if (copyChipIsEscapedAt(text, last)) {
    return copyChipLastUnescaped(text.slice(0, last), needle);
  }
  return last;
}

function copyChipNextUnescaped(text, needle) {
  let from = 0;
  while (from <= text.length - needle.length) {
    const index = text.indexOf(needle, from);
    if (index < 0) return -1;
    if (!copyChipIsEscapedAt(text, index)) return index;
    from = index + 1;
  }
  return -1;
}

function copyChipNormalizeLabel(label) {
  if (label == null) return null;
  const trimmed = String(label).trim();
  return trimmed === "" ? null : trimmed;
}

function copyChipEscapeLabel(label) {
  return String(label).replace(/\\/g, "\\\\").replace(/]/g, "\\]");
}

function copyChipLongestRun(text, character) {
  let longest = 0;
  let run = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === character) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  return longest;
}

function copyChipLeadingRun(line, character) {
  let run = 0;
  while (run < line.length && line[run] === character) run += 1;
  return run;
}

function copyChipHasNonWhitespace(text) {
  return /\S/.test(text);
}

function copyChipNormalizeNewlines(text) {
  return String(text).replace(/\r\n|\r/g, "\n");
}

function copyChipUnescapeTablePipes(text) {
  return text.replace(/\\\|/g, "|");
}

function copyChipEscapeTablePipes(text) {
  return text.replace(/\|/g, "\\|");
}

function copyChipParseContent(content) {
  if (typeof content !== "string") return null;
  if (!content.startsWith("copy")) return null;
  let index = 4;
  let label = null;
  if (content[index] === "[") {
    index += 1;
    let rawLabel = "";
    let closed = false;
    while (index < content.length) {
      const character = content[index];
      if (character === "\n" || character === "\r") return null;
      if (character === "\\" && index + 1 < content.length) {
        const next = content[index + 1];
        if (next === "]" || next === "\\") {
          rawLabel += next;
          index += 2;
          continue;
        }
        rawLabel += "\\";
        index += 1;
        continue;
      }
      if (character === "]") {
        index += 1;
        closed = true;
        break;
      }
      rawLabel += character;
      index += 1;
    }
    if (!closed) return null;
    label = copyChipNormalizeLabel(rawLabel);
  }
  if (content[index] !== ":") return null;
  index += 1;
  if (content[index] === " ") index += 1;
  const text = content.slice(index);
  if (!copyChipHasNonWhitespace(text)) return null;
  return copyChipFreeze({ label, text });
}

function copyChipNormalizeSpan(raw, options = {}) {
  if (typeof raw !== "string" || raw[0] !== "`") return null;
  let delimiter = 0;
  while (raw[delimiter] === "`") delimiter += 1;
  if (delimiter === 0 || raw.length < delimiter * 2) return null;
  for (let offset = 0; offset < delimiter; offset += 1) {
    if (raw[raw.length - delimiter + offset] !== "`") return null;
  }
  let content = raw.slice(delimiter, raw.length - delimiter).replace(/\r\n|\r|\n/g, " ");
  if (
    content.length > 0
    && content[0] === " "
    && content[content.length - 1] === " "
    && content.trim() !== ""
  ) {
    content = content.slice(1, -1);
  }
  if (options && options.table) content = copyChipUnescapeTablePipes(content);
  return content;
}

function copyChipFindCodeSpans(line) {
  const spans = [];
  let index = 0;
  while (index < line.length) {
    if (line[index] !== "`" || copyChipIsEscapedAt(line, index)) {
      index += 1;
      continue;
    }
    let delimiter = 0;
    while (index + delimiter < line.length && line[index + delimiter] === "`") delimiter += 1;
    let cursor = index + delimiter;
    let closer = -1;
    while (cursor < line.length) {
      if (line[cursor] !== "`") {
        cursor += 1;
        continue;
      }
      let run = 0;
      while (cursor + run < line.length && line[cursor + run] === "`") run += 1;
      if (run === delimiter) {
        closer = cursor;
        break;
      }
      cursor += run;
    }
    if (closer < 0) {
      index += delimiter;
      continue;
    }
    const to = closer + delimiter;
    spans.push({
      from: index,
      to,
      raw: line.slice(index, to),
    });
    index = to;
  }
  return spans;
}

function copyChipSpanIsInsideWikilink(line, from, to) {
  const before = line.slice(0, from);
  const after = line.slice(to);
  const open = copyChipLastUnescaped(before, "[[");
  if (open < 0) return false;
  const closeBefore = copyChipLastUnescaped(before, "]]");
  if (closeBefore > open) return false;
  return copyChipNextUnescaped(after, "]]") >= 0;
}

function copyChipSpanIsInsideLinkLabel(line, from, to) {
  const before = line.slice(0, from);
  let open = -1;
  for (let index = 0; index < before.length; index += 1) {
    if (before[index] === "[" && !copyChipIsEscapedAt(before, index)) open = index;
    else if (before[index] === "]" && !copyChipIsEscapedAt(before, index)) open = -1;
  }
  if (open < 0) return false;
  if (open > 0 && before[open - 1] === "[" && !copyChipIsEscapedAt(before, open - 1)) {
    return false;
  }
  const after = line.slice(to);
  const close = copyChipNextUnescaped(after, "]");
  if (close < 0) return false;
  const next = after[close + 1];
  return next === "(" || next === "[";
}

function copyChipScanLine(line, options = {}) {
  if (typeof line !== "string") return copyChipFreeze([]);
  const table = Boolean(options && options.table);
  const chips = [];
  for (const span of copyChipFindCodeSpans(line)) {
    if (copyChipSpanIsInsideWikilink(line, span.from, span.to)) continue;
    if (copyChipSpanIsInsideLinkLabel(line, span.from, span.to)) continue;
    const content = copyChipNormalizeSpan(span.raw, { table });
    if (content == null) continue;
    const parsed = copyChipParseContent(content);
    if (!parsed) continue;
    chips.push(copyChipFreeze({
      from: span.from,
      to: span.to,
      raw: span.raw,
      label: parsed.label,
      text: parsed.text,
    }));
  }
  return copyChipFreeze(chips);
}

function copyChipParseFenceInfo(info) {
  if (typeof info !== "string") return null;
  const trimmed = info.trim();
  if (!trimmed) return null;
  const match = /^(\S+)(?:[ \t]+(.*))?$/.exec(trimmed);
  if (!match || match[1] !== "bob-copy") return null;
  let label = (match[2] || "").trim();
  if (label.startsWith("[") && label.endsWith("]") && label.length >= 2) {
    label = label.slice(1, -1).trim();
  }
  return copyChipFreeze({ label: copyChipNormalizeLabel(label) });
}

function copyChipFencePayload(bodyLines) {
  const lines = Array.isArray(bodyLines) ? bodyLines.map((line) => String(line)) : [];
  return lines.join("\n");
}

function copyChipSerializeFailure(reason) {
  return copyChipFreeze({ ok: false, reason });
}

function copyChipSerialize(input = {}, options = {}) {
  const source = input && typeof input === "object" ? input : {};
  const rawLabel = source.label == null ? "" : String(source.label);
  if (rawLabel.includes("\n") || rawLabel.includes("\r")) {
    return copyChipSerializeFailure(COPY_CHIP_LABELS_ARE_ONE_LINE);
  }
  let text = source.text == null ? "" : copyChipNormalizeNewlines(source.text);
  if (!copyChipHasNonWhitespace(text)) {
    return copyChipSerializeFailure(COPY_CHIP_NOTHING_TO_COPY);
  }
  const label = copyChipNormalizeLabel(rawLabel);
  const table = Boolean(options && options.table);
  const indent = options && options.indent != null ? String(options.indent) : "";

  if (!text.includes("\n")) {
    let inner = label == null
      ? "copy: " + text
      : "copy[" + copyChipEscapeLabel(label) + "]: " + text;
    if (table) inner = copyChipEscapeTablePipes(inner);
    const delimiter = "`".repeat(copyChipLongestRun(inner, "`") + 1);
    const padded = inner.endsWith("`") ? " " + inner + " " : inner;
    return copyChipFreeze({
      ok: true,
      form: "inline",
      markdown: delimiter + padded + delimiter,
    });
  }

  const fenceChar = label && label.includes("`") ? "~" : "`";
  const bodyLines = text.split("\n");
  let longestLeading = 0;
  for (const line of bodyLines) {
    const run = copyChipLeadingRun(line, fenceChar);
    if (run > longestLeading) longestLeading = run;
  }
  const fence = fenceChar.repeat(Math.max(3, longestLeading + 1));
  const info = label == null ? "bob-copy" : "bob-copy " + label;
  const open = indent + fence + info;
  const close = indent + fence;
  const body = bodyLines.map((line) => indent + line).join("\n");
  return copyChipFreeze({
    ok: true,
    form: "block",
    markdown: open + "\n" + body + "\n" + close,
  });
}
