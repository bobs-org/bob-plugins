// Command-chip grammar: `run:` spans and `bob-run` fences. Pure code with
// no Obsidian imports and no Command Mode calls; whether the payload is a
// legal bob command line is Command Mode's `resolve`, never this file's.
const RUN_CHIP_NOTHING_TO_RUN = "nothing to run";
const RUN_CHIP_TABLE_BLOCK = "can't put a bob-run fence in a table cell";

const RUN_CHIP_SERIALIZE_SPEC = copyChipFreeze({
  prefix: "run",
  language: "bob-run",
  emptyReason: RUN_CHIP_NOTHING_TO_RUN,
  tableBlockReason: RUN_CHIP_TABLE_BLOCK,
  closerAware: true,
});

// `run [ "[" LABEL "]" ] ":" [ " " ] TEXT`, exactly the copy grammar with
// the lowercase `run` prefix. Returns frozen `{ label, text }` or null.
function runChipParseContent(content) {
  return chipParsePrefixedContent(content, "run");
}

// The run-kind filter of chipScanLine, in the same shape as copy's
// `scanLine`: frozen `{ from, to, raw, label, text }` per command chip.
function runChipScanLine(line, options = {}) {
  if (typeof line !== "string") return copyChipFreeze([]);
  const chips = [];
  for (const chip of chipScanLine(line, options)) {
    if (chip.kind !== "run") continue;
    chips.push(copyChipFreeze({
      from: chip.from,
      to: chip.to,
      raw: chip.raw,
      label: chip.label,
      text: chip.text,
    }));
  }
  return copyChipFreeze(chips);
}

// `bob-run` plus an optional label, mirroring `bob-copy`.
function runChipParseFenceInfo(info) {
  return chipParseFenceInfoFor(info, "bob-run");
}

// Text with a line break becomes a `bob-run` fence whose marker outruns
// every body line's fence-character run, even an indented one; otherwise an
// inline span with the shortest safe backtick run, label escapes, and `\|`
// in tables. A block in a table cell is refused.
function runChipSerialize(input = {}, options = {}) {
  return chipSerializeWith(input, options, RUN_CHIP_SERIALIZE_SPEC);
}

function chipIsWhitespace(character) {
  return character === undefined || /\s/.test(character);
}

// A cursor over sorted code spans that answers "which span covers index?"
// in amortized constant time for a left-to-right walk.
function chipCodeSpanCursor(spans) {
  const sorted = Array.isArray(spans)
    ? spans.slice().sort((left, right) => left.from - right.from)
    : [];
  let at = 0;
  return (index) => {
    while (at < sorted.length && sorted[at].to <= index) at += 1;
    if (at < sorted.length && index >= sorted[at].from && index < sorted[at].to) {
      return sorted[at];
    }
    return null;
  };
}

// The first `needle` at or after `from` that sits outside every code span
// (and, when `unescaped`, is not backslash-escaped), or -1.
function chipFindOutsideCode(line, needle, from, spans, unescaped) {
  const covering = chipCodeSpanCursor(spans);
  let index = from;
  while (index <= line.length - needle.length) {
    const span = covering(index);
    if (span) {
      index = span.to;
      continue;
    }
    if (line.startsWith(needle, index) && !(unescaped && copyChipIsEscapedAt(line, index))) {
      return index;
    }
    index += 1;
  }
  return -1;
}

// An inline-math closer: an unescaped `$` outside code, preceded by a
// non-space, not doubled, and not followed by a digit (so "$5-$10" stays
// prose). Returns its index or -1.
function chipFindInlineMathClose(line, from, spans) {
  const covering = chipCodeSpanCursor(spans);
  let index = from;
  while (index < line.length) {
    const span = covering(index);
    if (span) {
      index = span.to;
      continue;
    }
    if (
      line[index] === "$" &&
      !copyChipIsEscapedAt(line, index) &&
      line[index + 1] !== "$" &&
      !chipIsWhitespace(line[index - 1]) &&
      !/[0-9]/.test(line[index + 1] || "")
    ) {
      return index;
    }
    index += 1;
  }
  return -1;
}

// `[from, to)` ranges of inline math (`$…$`, `$$…$$`), Obsidian comments
// (`%%…%%`), and HTML comments (`<!-- … -->`) whose delimiters sit outside
// code spans. An unclosed comment opener runs to the end of the line, since
// it opens a comment that continues on later lines. Never throws.
function chipShieldedRanges(line, codeSpans) {
  try {
    const text = typeof line === "string" ? line : "";
    const spans = Array.isArray(codeSpans) ? codeSpans : copyChipFindCodeSpans(text);
    const covering = chipCodeSpanCursor(spans);
    const ranges = [];
    let index = 0;
    while (index < text.length) {
      const span = covering(index);
      if (span) {
        index = span.to;
        continue;
      }
      if (text.startsWith("%%", index)) {
        const close = chipFindOutsideCode(text, "%%", index + 2, spans, false);
        const to = close < 0 ? text.length : close + 2;
        ranges.push(copyChipFreeze({ from: index, to }));
        index = to;
        continue;
      }
      if (text.startsWith("<!--", index)) {
        const close = chipFindOutsideCode(text, "-->", index + 4, spans, false);
        const to = close < 0 ? text.length : close + 3;
        ranges.push(copyChipFreeze({ from: index, to }));
        index = to;
        continue;
      }
      if (text[index] === "$" && !copyChipIsEscapedAt(text, index)) {
        if (text[index + 1] === "$") {
          const close = chipFindOutsideCode(text, "$$", index + 2, spans, true);
          if (close >= 0) {
            ranges.push(copyChipFreeze({ from: index, to: close + 2 }));
            index = close + 2;
            continue;
          }
          index += 2;
          continue;
        }
        if (!chipIsWhitespace(text[index + 1])) {
          const close = chipFindInlineMathClose(text, index + 1, spans);
          if (close >= 0) {
            ranges.push(copyChipFreeze({ from: index, to: close + 1 }));
            index = close + 1;
            continue;
          }
        }
      }
      index += 1;
    }
    return copyChipFreeze(ranges);
  } catch (error) {
    return copyChipFreeze([]);
  }
}

// The blocks that can stay open across lines, keyed by opener: Obsidian
// `%%` comments, HTML comments, and `$$` display math. `unescaped` matches
// chipShieldedRanges' closer search for each.
const CHIP_BLOCK_PERCENT = copyChipFreeze({ close: "%%", unescaped: false });
const CHIP_BLOCK_HTML = copyChipFreeze({ close: "-->", unescaped: false });
const CHIP_BLOCK_MATH = copyChipFreeze({ close: "$$", unescaped: true });
const CHIP_BLOCK_NONE = copyChipFreeze([]);

// Scan one line from `from`, outside any block, with chipShieldedRanges'
// opener rules: skip code spans, skip comments and math that close on the
// line, and stop at the first `%%`, `<!--`, or `$$` left unclosed. Returns
// `{ block, at }` for that opener, or null.
function chipLineOpensBlock(text, from, spans) {
  const covering = chipCodeSpanCursor(spans);
  let index = from;
  while (index < text.length) {
    const span = covering(index);
    if (span) {
      index = span.to;
      continue;
    }
    if (text.startsWith("%%", index)) {
      const close = chipFindOutsideCode(text, "%%", index + 2, spans, false);
      if (close < 0) return { block: CHIP_BLOCK_PERCENT, at: index };
      index = close + 2;
      continue;
    }
    if (text.startsWith("<!--", index)) {
      const close = chipFindOutsideCode(text, "-->", index + 4, spans, false);
      if (close < 0) return { block: CHIP_BLOCK_HTML, at: index };
      index = close + 3;
      continue;
    }
    if (text[index] === "$" && !copyChipIsEscapedAt(text, index)) {
      if (text[index + 1] === "$") {
        const close = chipFindOutsideCode(text, "$$", index + 2, spans, true);
        if (close < 0) return { block: CHIP_BLOCK_MATH, at: index };
        index = close + 2;
        continue;
      }
      if (!chipIsWhitespace(text[index + 1])) {
        const close = chipFindInlineMathClose(text, index + 1, spans);
        if (close >= 0) {
          index = close + 1;
          continue;
        }
      }
    }
    index += 1;
  }
  return null;
}

function chipLineMayOpenBlock(text) {
  return text.indexOf("%%") !== -1 || text.indexOf("<!--") !== -1 || text.indexOf("$$") !== -1;
}

// The multi-line half of chipShieldedRanges. It walks lines 0..uptoLine
// from the top of the note, skipping frontmatter and fenced code the way
// chipScanTaskScope does, and tracks an open `%%` comment, `<!-- … -->`
// comment, or `$$` display-math block. Delimiters count only outside code
// spans and fences; a fence line inside an open block is block text. An
// unclosed block runs to the end of the note. Returns frozen
// `{ ranges, carried }`: `ranges[i]` lists line i's `[from, to)` ranges
// hidden by a block carried in from an earlier line or opened there and
// left unclosed (blocks that open and close on one line stay
// chipShieldedRanges' job), and `carried[i]` is true when line i starts
// inside an open block. Never throws.
function chipBlockShieldState(lines, uptoLine) {
  try {
    const source = Array.isArray(lines) ? lines : [];
    const last = Number.isInteger(uptoLine) ? Math.min(uptoLine, source.length - 1) : source.length - 1;
    const ranges = [];
    const carried = [];
    const lineText = (index) => {
      try {
        const value = source[index];
        return String(value === undefined || value === null ? "" : value);
      } catch (error) {
        return "";
      }
    };
    let inFrontmatter = source.length > 0 && lineText(0).trim() === "---";
    let fence = null;
    let block = null;
    for (let index = 0; index <= last; index += 1) {
      const text = lineText(index);
      carried.push(Boolean(block));
      if (block) {
        if (text.indexOf(block.close) === -1) {
          ranges.push(copyChipFreeze([copyChipFreeze({ from: 0, to: text.length })]));
          continue;
        }
        const spans = copyChipFindCodeSpans(text);
        const close = chipFindOutsideCode(text, block.close, 0, spans, block.unescaped);
        if (close < 0) {
          ranges.push(copyChipFreeze([copyChipFreeze({ from: 0, to: text.length })]));
          continue;
        }
        const end = close + block.close.length;
        const hidden = [copyChipFreeze({ from: 0, to: end })];
        block = null;
        const opened = chipLineOpensBlock(text, end, spans);
        if (opened) {
          block = opened.block;
          hidden.push(copyChipFreeze({ from: opened.at, to: text.length }));
        }
        ranges.push(copyChipFreeze(hidden));
        continue;
      }
      if (inFrontmatter) {
        if (index > 0 && (text.trim() === "---" || text.trim() === "...")) inFrontmatter = false;
        ranges.push(CHIP_BLOCK_NONE);
        continue;
      }
      if (fence) {
        if (copyChipCursorFenceCloses(text, fence)) fence = null;
        ranges.push(CHIP_BLOCK_NONE);
        continue;
      }
      const opening = copyChipFenceOpeningFromLine(text);
      if (opening) {
        fence = opening;
        ranges.push(CHIP_BLOCK_NONE);
        continue;
      }
      const opened = chipLineMayOpenBlock(text)
        ? chipLineOpensBlock(text, 0, copyChipFindCodeSpans(text))
        : null;
      if (!opened) {
        ranges.push(CHIP_BLOCK_NONE);
        continue;
      }
      block = opened.block;
      ranges.push(copyChipFreeze([copyChipFreeze({ from: opened.at, to: text.length })]));
    }
    return copyChipFreeze({ ranges: copyChipFreeze(ranges), carried: copyChipFreeze(carried) });
  } catch (error) {
    return copyChipFreeze({ ranges: CHIP_BLOCK_NONE, carried: CHIP_BLOCK_NONE });
  }
}

// True when `shield` (from chipBlockShieldState) hides offset `ch` of
// `line`. Never throws.
function chipBlockShieldHides(shield, line, ch) {
  try {
    if (!shield || !Array.isArray(shield.ranges)) return false;
    return chipRangesCover(shield.ranges[line], ch);
  } catch (error) {
    return false;
  }
}

// True when `line` starts inside a block `shield` carries in, as when a
// fence's opening line sits in a comment. Never throws.
function chipBlockShieldCarries(shield, line) {
  try {
    return Boolean(shield && Array.isArray(shield.carried) && shield.carried[line]);
  } catch (error) {
    return false;
  }
}

// The matching close of a bracket pair opened at `open`, counting nesting,
// skipping code spans and escapes, on this line. Returns its index or -1.
function chipMatchBracket(line, open, opener, closer, spans) {
  const covering = chipCodeSpanCursor(spans);
  let depth = 0;
  let index = open;
  while (index < line.length) {
    const span = covering(index);
    if (span) {
      index = span.to;
      continue;
    }
    const character = line[index];
    if (!copyChipIsEscapedAt(line, index)) {
      if (character === opener) depth += 1;
      else if (character === closer) {
        depth -= 1;
        if (depth === 0) return index;
      }
    }
    index += 1;
  }
  return -1;
}

// The `)` that ends an inline link destination starting at `open` (the
// `(`), allowing a `<…>` destination and balanced parentheses. -1 if none.
function chipMatchLinkDestination(line, open) {
  let index = open + 1;
  while (line[index] === " " || line[index] === "\t") index += 1;
  if (line[index] === "<") {
    let close = index + 1;
    while (close < line.length && (line[close] !== ">" || copyChipIsEscapedAt(line, close))) {
      if (line[close] === "<" && !copyChipIsEscapedAt(line, close)) return -1;
      close += 1;
    }
    if (close >= line.length) return -1;
    index = close + 1;
  }
  let depth = 1;
  while (index < line.length) {
    const character = line[index];
    if (!copyChipIsEscapedAt(line, index)) {
      if (character === "(") depth += 1;
      else if (character === ")") {
        depth -= 1;
        if (depth === 0) return index;
      }
    }
    index += 1;
  }
  return -1;
}

function chipRangesOverlap(ranges, from, to) {
  for (const range of ranges) {
    if (from < range.to && to > range.from) return true;
  }
  return false;
}

const CHIP_AUTOLINK_RE = /^<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/;
const CHIP_BARE_URL_RE = /https?:\/\/[^\s<>`]+/g;

// Trim GFM-style trailing punctuation and unbalanced `)` from a bare URL.
function chipTrimBareUrl(url) {
  let end = url.length;
  for (;;) {
    const last = url[end - 1];
    if (/[?!.,:;*_~'"]/.test(last || "")) {
      end -= 1;
      continue;
    }
    if (last === ")") {
      const body = url.slice(0, end);
      const opens = (body.match(/\(/g) || []).length;
      const closes = (body.match(/\)/g) || []).length;
      if (closes > opens) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  return url.slice(0, end);
}

// `[from, to)` ranges of the links on one line, outside code spans:
// wikilinks and embeds (`[[…]]`, `![[…]]`), inline Markdown links and
// images (`[…](…)`, `![…](…)`), autolinks (`<scheme:…>`, `<a@b.c>`), and
// bare `http(s)://` URLs. Reference-style links are not counted, because
// task rows' `[field:: value]` brackets would otherwise read as links.
// Returns a frozen, sorted array of frozen `{ kind, from, to }`. Never throws.
function chipLinkSpans(line) {
  try {
    if (typeof line !== "string" || line === "") return copyChipFreeze([]);
    const spans = copyChipFindCodeSpans(line);
    const links = [];
    const take = (kind, from, to) => {
      links.push(copyChipFreeze({ kind, from, to }));
    };

    let covering = chipCodeSpanCursor(spans);
    for (let index = 0; index < line.length; index += 1) {
      const span = covering(index);
      if (span) {
        index = span.to - 1;
        continue;
      }
      if (line[index] !== "[" || line[index + 1] !== "[" || copyChipIsEscapedAt(line, index)) continue;
      const close = line.indexOf("]]", index + 2);
      if (close < 0) break;
      const embed = index > 0 && line[index - 1] === "!" && !copyChipIsEscapedAt(line, index - 1);
      take(embed ? "embed" : "wikilink", embed ? index - 1 : index, close + 2);
      index = close + 1;
    }

    covering = chipCodeSpanCursor(spans);
    for (let index = 0; index < line.length; index += 1) {
      const span = covering(index);
      if (span) {
        index = span.to - 1;
        continue;
      }
      if (line[index] !== "[" || copyChipIsEscapedAt(line, index)) continue;
      if (chipRangesOverlap(links, index, index + 1)) continue;
      const labelClose = chipMatchBracket(line, index, "[", "]", spans);
      if (labelClose < 0 || line[labelClose + 1] !== "(") continue;
      const destinationClose = chipMatchLinkDestination(line, labelClose + 1);
      if (destinationClose < 0) continue;
      const image = index > 0 && line[index - 1] === "!" && !copyChipIsEscapedAt(line, index - 1);
      const from = image ? index - 1 : index;
      if (chipRangesOverlap(links, from, destinationClose + 1)) continue;
      take(image ? "image" : "link", from, destinationClose + 1);
      index = destinationClose;
    }

    covering = chipCodeSpanCursor(spans);
    for (let index = 0; index < line.length; index += 1) {
      const span = covering(index);
      if (span) {
        index = span.to - 1;
        continue;
      }
      if (line[index] !== "<" || copyChipIsEscapedAt(line, index)) continue;
      const match = CHIP_AUTOLINK_RE.exec(line.slice(index));
      if (!match) continue;
      const to = index + match[0].length;
      if (chipRangesOverlap(links, index, to)) continue;
      take("autolink", index, to);
      index = to - 1;
    }

    CHIP_BARE_URL_RE.lastIndex = 0;
    let match = null;
    while ((match = CHIP_BARE_URL_RE.exec(line)) !== null) {
      const from = match.index;
      const url = chipTrimBareUrl(match[0]);
      const to = from + url.length;
      if (!/^https?:\/\/[^/]/.test(url)) continue;
      if (chipRangesOverlap(links, from, to)) continue;
      if (chipRangesOverlap(spans, from, to)) continue;
      take("url", from, to);
    }

    links.sort((left, right) => left.from - right.from || left.to - right.to);
    return copyChipFreeze(links);
  } catch (error) {
    return copyChipFreeze([]);
  }
}
