// Prose `[[` link field model (phase bob-cli-om.2 link-engine).
//
// Pure JS port of bob-cli's `capture_links::completion_field_at`: it finds
// the wikilink field open at a collapsed caret, classifies its stage
// (note, heading, block; target, current-note, or vault-wide scope), and
// computes the replacement range plus accept helpers. Offsets are UTF-16
// code units, matching Obsidian editor coordinates; every delimiter the
// scanner looks for is ASCII, so no sliced offset ever splits a surrogate
// pair. The shared fixture vectors pin this port byte-for-byte against
// bob (`tests/fixtures/wikilink_complete/vectors.json`).
//
// No UI and no Obsidian API surface: the LINK band (phase bob-cli-om.3)
// consumes `linkFieldAt` plus `linkReplacementText` / `linkCursorAfter`.

// Context names mirror `CompletionContext`'s serde spelling.
const LINK_CONTEXT_NOTE = "wikilink_note";
const LINK_CONTEXT_HEADING = "wikilink_heading";
const LINK_CONTEXT_BLOCK = "wikilink_block";

function linkFieldAt(raw, cursor, currentNotePath) {
  const text = String(raw == null ? "" : raw);
  const caret = Number(cursor);
  if (!Number.isInteger(caret) || caret < 0 || caret > text.length) {
    return null;
  }
  const codeRanges = linkCodeRanges(text);
  const links = linkScanLinks(text, codeRanges);
  for (const link of links) {
    const field = linkCompletionField(
      link,
      text,
      caret,
      String(currentNotePath == null ? "" : currentNotePath),
    );
    if (field) return field;
  }
  return null;
}

// Append the synthesized closer exactly like bob's `replacement_text`:
// closed links reuse their existing `]]` once, unclosed links gain one
// unless an authored `#` / `|` continuation follows the caret.
function linkReplacementText(field, replacement) {
  const text = String(replacement);
  return field && field.suffixClose ? text + "]]" : text;
}

// Mirror bob's `cursor_after`: closed links shift the existing closer end
// by the replacement delta, unclosed links land after the inserted text.
function linkCursorAfter(field, replacementLength) {
  const length = Number(replacementLength);
  if (field && field.existingCloseEnd != null) {
    const oldLength = field.replacement[1] - field.replacement[0];
    return field.existingCloseEnd + length - oldLength;
  }
  return field.replacement[0] + length;
}

function linkCompletionField(link, raw, cursor, currentNotePath) {
  if (cursor < link.start || cursor > link.end) return null;
  if (cursor < link.innerStart) return null;
  if (link.close && cursor > link.close[0]) return null;
  if (
    link.alias &&
    cursor > link.alias[0] &&
    cursor <= link.alias[1]
  ) {
    return null;
  }
  switch (link.scope) {
    case "vault-heading":
      return linkSubpathField(
        link,
        raw,
        LINK_CONTEXT_HEADING,
        { kind: "heading", scope: "vault" },
        link.heading,
        cursor,
        link.innerStart,
      );
    case "vault-block":
      return linkSubpathField(
        link,
        raw,
        LINK_CONTEXT_BLOCK,
        { kind: "block", scope: "vault" },
        link.block,
        cursor,
        link.innerStart,
      );
    case "current-heading":
      return linkSubpathField(
        link,
        raw,
        LINK_CONTEXT_HEADING,
        { kind: "heading", scope: "current", target: currentNotePath },
        link.heading,
        cursor,
        link.heading[0],
      );
    case "current-block":
      return linkSubpathField(
        link,
        raw,
        LINK_CONTEXT_BLOCK,
        { kind: "block", scope: "current", target: currentNotePath },
        link.block,
        cursor,
        link.block[0],
      );
    case "target-heading":
      if (link.target && cursor <= link.target[1]) {
        return linkNoteField(link, raw, cursor);
      }
      return linkSubpathField(
        link,
        raw,
        LINK_CONTEXT_HEADING,
        {
          kind: "heading",
          scope: "target",
          target: raw.slice(link.target[0], link.target[1]),
        },
        link.heading,
        cursor,
        link.heading[0],
      );
    case "target-block":
      if (link.target && cursor <= link.target[1]) {
        return linkNoteField(link, raw, cursor);
      }
      return linkSubpathField(
        link,
        raw,
        LINK_CONTEXT_BLOCK,
        {
          kind: "block",
          scope: "target",
          target: raw.slice(link.target[0], link.target[1]),
        },
        link.block,
        cursor,
        link.block[0],
      );
    default:
      return linkNoteField(link, raw, cursor);
  }
}

function linkNoteField(link, raw, cursor) {
  const target = link.target || [link.innerStart, link.innerStart];
  if (cursor < target[0] || cursor > target[1]) return null;
  const replacementEnd = link.close ? target[1] : cursor;
  return {
    context: LINK_CONTEXT_NOTE,
    scope: "note",
    targetKind: "note",
    target: null,
    query: linkQueryFromComponent(raw, target, cursor),
    replacement: [target[0], replacementEnd],
    hasAuthoredAlias: Boolean(link.alias),
    hasAuthoredSubpath: Boolean(link.heading || link.block),
    suffixClose:
      !link.close && !linkContinuesComponent(raw, cursor),
    existingCloseEnd: link.close ? link.close[1] : null,
  };
}

function linkSubpathField(
  link,
  raw,
  context,
  target,
  component,
  cursor,
  replacementStart,
) {
  if (!component) return null;
  if (cursor < component[0] || cursor > component[1]) return null;
  const replacementEnd = link.close ? component[1] : cursor;
  return {
    context,
    scope: target.scope,
    targetKind: target.kind,
    target: target.target == null ? null : target.target,
    query: linkQueryFromComponent(raw, component, cursor),
    replacement: [replacementStart, replacementEnd],
    hasAuthoredAlias: Boolean(link.alias),
    hasAuthoredSubpath: false,
    suffixClose:
      !link.close && !linkContinuesComponent(raw, cursor),
    existingCloseEnd: link.close ? link.close[1] : null,
  };
}

function linkQueryFromComponent(raw, component, cursor) {
  const end = Math.min(Math.max(cursor, component[0]), component[1]);
  return raw.slice(component[0], end);
}

function linkContinuesComponent(raw, cursor) {
  const next = raw[cursor];
  return next === "#" || next === "|";
}

// --- Link scanning: mirror of `scan_links` / `scan_line`. ---

function linkScanLinks(raw, codeRanges) {
  const links = [];
  if (raw.length === 0) return links;
  let lineStart = 0;
  const parts = raw.split("\n");
  for (const part of parts) {
    const lineEnd =
      lineStart + part.length - (part.endsWith("\r") ? 1 : 0);
    linkScanLine(raw, lineStart, lineEnd, codeRanges, links);
    lineStart += part.length + 1;
  }
  return links;
}

function linkScanLine(raw, lineStart, lineEnd, codeRanges, links) {
  let cursor = lineStart;
  while (cursor + 1 < lineEnd) {
    const open = linkNextOpen(raw, cursor, lineEnd);
    if (!open) break;
    if (
      linkIsEscaped(raw, open.bracket) ||
      linkCoveredByCode(codeRanges, open.start)
    ) {
      cursor = open.bracket + 1;
      continue;
    }
    const end = linkCloseOrNested(raw, open.end, lineEnd, codeRanges);
    if (end.kind === "close") {
      links.push(
        linkParseLink(raw, open.start, open.end, end.index, [
          end.index,
          end.index + 2,
        ]),
      );
      cursor = end.index + 2;
    } else if (end.kind === "nested") {
      cursor = end.index;
    } else {
      links.push(linkParseLink(raw, open.start, open.end, lineEnd, null));
      break;
    }
  }
}

function linkNextOpen(raw, start, end) {
  let index = start;
  while (index + 1 < end) {
    if (raw[index] === "[" && raw[index + 1] === "[") {
      const openStart =
        index > start && raw[index - 1] === "!" ? index - 1 : index;
      return { start: openStart, bracket: index, end: index + 2 };
    }
    index += 1;
  }
  return null;
}

function linkCloseOrNested(raw, start, end, codeRanges) {
  let index = start;
  while (index + 1 < end) {
    if (linkCoveredByCode(codeRanges, index)) {
      index += 1;
      continue;
    }
    if (
      raw[index] === "[" &&
      raw[index + 1] === "[" &&
      !linkIsEscaped(raw, index)
    ) {
      return { kind: "nested", index };
    }
    if (
      raw[index] === "]" &&
      raw[index + 1] === "]" &&
      !linkIsEscaped(raw, index)
    ) {
      return { kind: "close", index };
    }
    index += 1;
  }
  return { kind: "line-end" };
}

function linkParseLink(raw, start, openEnd, innerEnd, close) {
  const innerStart = openEnd;
  const delimiters = [[start, openEnd]];
  if (close) delimiters.push(close);
  let mainEnd = innerEnd;
  let alias = null;
  const separator = raw.indexOf("|", innerStart);
  if (separator !== -1 && separator < innerEnd) {
    delimiters.push([separator, separator + 1]);
    mainEnd = separator;
    alias = [separator + 1, innerEnd];
  }
  const parsed = linkParseMain(raw, innerStart, mainEnd, delimiters);
  return {
    start,
    end: close ? close[1] : innerEnd,
    innerStart,
    innerEnd,
    close,
    target: parsed.target,
    heading: parsed.heading,
    block: parsed.block,
    alias,
    delimiters,
    scope: parsed.scope,
  };
}

function linkParseMain(raw, start, end, delimiters) {
  const main = raw.slice(start, end);
  if (main.startsWith("^^")) {
    delimiters.push([start, start + 2]);
    return {
      target: null,
      heading: null,
      block: [start + 2, end],
      scope: "vault-block",
    };
  }
  if (main.startsWith("##")) {
    delimiters.push([start, start + 2]);
    return {
      target: null,
      heading: [start + 2, end],
      block: null,
      scope: "vault-heading",
    };
  }
  if (main.startsWith("#^")) {
    delimiters.push([start, start + 2]);
    return {
      target: null,
      heading: null,
      block: [start + 2, end],
      scope: "current-block",
    };
  }
  if (main.startsWith("#")) {
    delimiters.push([start, start + 1]);
    return {
      target: null,
      heading: [start + 1, end],
      block: null,
      scope: "current-heading",
    };
  }
  const blockSeparator = main.indexOf("#^");
  if (blockSeparator !== -1) {
    const separator = start + blockSeparator;
    delimiters.push([separator, separator + 2]);
    return {
      target: [start, separator],
      heading: null,
      block: [separator + 2, end],
      scope: "target-block",
    };
  }
  const headingSeparator = main.indexOf("#");
  if (headingSeparator !== -1) {
    const separator = start + headingSeparator;
    delimiters.push([separator, separator + 1]);
    return {
      target: [start, separator],
      heading: [separator + 1, end],
      block: null,
      scope: "target-heading",
    };
  }
  return {
    target: [start, end],
    heading: null,
    block: null,
    scope: null,
  };
}

// --- Code spans: mirror of `code_ranges` (fenced + inline). ---

function linkCodeRanges(raw) {
  const ranges = [];
  if (raw.length === 0) return ranges;
  let lineStart = 0;
  let fence = null;
  const parts = raw.split("\n");
  for (const part of parts) {
    const content = part.endsWith("\r") ? part.slice(0, -1) : part;
    const lineEnd = lineStart + part.length + 1;
    if (fence) {
      ranges.push([lineStart, lineEnd]);
      if (linkClosesFence(content, fence)) fence = null;
    } else {
      const marker = linkFenceMarker(content);
      if (marker) {
        ranges.push([lineStart, lineEnd]);
        fence = marker;
      } else {
        for (const range of linkInlineCodeRanges(content, lineStart)) {
          ranges.push(range);
        }
      }
    }
    lineStart = lineEnd;
  }
  return ranges;
}

function linkFenceMarker(line) {
  let indentation = 0;
  while (indentation < line.length && line[indentation] === " ") {
    indentation += 1;
  }
  if (indentation > 3) return null;
  const rest = line.slice(indentation);
  const character = rest[0];
  if (character !== "`" && character !== "~") return null;
  let length = 0;
  while (rest[length] === character) length += 1;
  return length >= 3 ? { character, length } : null;
}

function linkClosesFence(line, open) {
  const marker = linkFenceMarker(line);
  if (!marker) return false;
  if (marker.character !== open.character) return false;
  if (marker.length < open.length) return false;
  return line.trimStart().slice(marker.length).trim() === "";
}

function linkInlineCodeRanges(line, offset) {
  const ranges = [];
  let index = 0;
  while (index < line.length) {
    if (line[index] !== "`" || linkIsEscaped(line, index)) {
      index += 1;
      continue;
    }
    let tickCount = 0;
    while (line[index + tickCount] === "`") tickCount += 1;
    const contentStart = index + tickCount;
    let close = contentStart;
    while (close < line.length) {
      if (line[close] === "`") {
        let run = 0;
        while (line[close + run] === "`") run += 1;
        if (run === tickCount) {
          ranges.push([offset + index, offset + close + tickCount]);
          index = close + tickCount;
          break;
        }
        close += run;
        continue;
      }
      close += 1;
    }
    if (close >= line.length) {
      ranges.push([offset + index, offset + line.length]);
      break;
    }
  }
  return ranges;
}

function linkCoveredByCode(ranges, index) {
  return ranges.some(([start, end]) => start <= index && index < end);
}

function linkIsEscaped(raw, index) {
  let cursor = index;
  let count = 0;
  while (cursor > 0 && raw[cursor - 1] === "\\") {
    count += 1;
    cursor -= 1;
  }
  return count % 2 === 1;
}
