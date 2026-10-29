// Pure parent: frontmatter reader and line planner. Never uses
// processFrontMatter: that re-serializes the whole YAML block and would
// rewrite unquoted [[wikilinks]] in other keys. Every byte outside the
// edited parent span is preserved, including comments and CRLF.

const PARENT_KEY_RE = /^parent[ \t]*:(.*)$/;
const TRAILING_YAML_COMMENT_RE = /([ \t]+#.*)$/;
const QUOTED_TRAILING_COMMENT_RE = /^([ \t]+#.*)$/;

function findParentFrontmatterClose(lines) {
  if (!startsWithFrontmatter(lines)) {
    return { state: "no-frontmatter", close: -1 };
  }
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    if (FRONTMATTER_DELIMITER_RE.test(lines[lineIndex])) {
      return { state: "closed", close: lineIndex };
    }
  }
  return { state: "unclosed", close: -1 };
}

function collectColumn0ParentKeys(lines, close) {
  const found = [];
  const end = close < 0 ? lines.length : close;
  for (let lineIndex = 1; lineIndex < end; lineIndex += 1) {
    const match = PARENT_KEY_RE.exec(String(lines[lineIndex] || ""));
    if (match) {
      found.push({ lineIndex, remainder: match[1] });
    }
  }
  return found;
}

function parseParentWikiTarget(inner) {
  const text = String(inner || "");
  let end = text.length;
  const pipe = text.indexOf("|");
  const hash = text.indexOf("#");
  if (pipe !== -1) {
    end = Math.min(end, pipe);
  }
  if (hash !== -1) {
    end = Math.min(end, hash);
  }
  return text.slice(0, end).trim();
}

function parseParentScalarTarget(value) {
  const text = String(value || "").trim();
  const wiki = /^\[\[([\s\S]*?)\]\]$/.exec(text);
  if (wiki) {
    return parseParentWikiTarget(wiki[1]);
  }
  return text;
}

function isParentContinuationLine(line) {
  return /^[ \t]/.test(String(line || ""));
}

function collectParentContinuation(lines, start, close) {
  const collected = [];
  let index = start;
  const end = close < 0 ? lines.length : close;
  while (index < end) {
    const line = String(lines[index] || "");
    if (FRONTMATTER_DELIMITER_RE.test(line)) {
      break;
    }
    if (isParentContinuationLine(line)) {
      collected.push(line);
      index += 1;
      continue;
    }
    if (line.trim() === "") {
      let look = index + 1;
      let hasIndented = false;
      while (look < end) {
        const next = String(lines[look] || "");
        if (FRONTMATTER_DELIMITER_RE.test(next)) {
          break;
        }
        if (isParentContinuationLine(next)) {
          hasIndented = true;
          break;
        }
        if (next.trim() !== "") {
          break;
        }
        look += 1;
      }
      if (!hasIndented) {
        break;
      }
      collected.push(line);
      index += 1;
      continue;
    }
    break;
  }
  return {
    lines: collected,
    endLine: collected.length === 0 ? start - 1 : start + collected.length - 1,
  };
}

function splitParentValueAndComment(remainder, innerEnd) {
  const after = remainder.slice(innerEnd);
  const commentMatch = QUOTED_TRAILING_COMMENT_RE.exec(after);
  if (commentMatch) {
    return {
      raw: remainder.slice(0, innerEnd),
      comment: commentMatch[1],
    };
  }
  return { raw: remainder, comment: "" };
}

function parseParentValueSpan(lines, lineIndex, remainder, close, lineEnding) {
  const rest = remainder == null ? "" : String(remainder);
  const trimmed = rest.trimStart();
  if (trimmed === "") {
    const continuation = collectParentContinuation(lines, lineIndex + 1, close);
    if (continuation.lines.length > 0) {
      const raw = rest + lineEnding + continuation.lines.join(lineEnding);
      return {
        kind: "list",
        raw,
        comment: "",
        endLine: continuation.endLine,
        target: null,
      };
    }
    return {
      kind: "scalar",
      raw: rest,
      comment: "",
      endLine: lineIndex,
      target: "",
    };
  }

  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    const quoteAt = rest.indexOf(quote);
    const afterQuote = rest.slice(quoteAt + 1);
    const closeAt = afterQuote.indexOf(quote);
    if (closeAt === -1) {
      return {
        kind: "scalar",
        raw: rest,
        comment: "",
        endLine: lineIndex,
        target: parseParentScalarTarget(getYamlScalarText(rest)),
      };
    }
    const inner = afterQuote.slice(0, closeAt);
    const innerEnd = quoteAt + 1 + closeAt + 1;
    const split = splitParentValueAndComment(rest, innerEnd);
    return {
      kind: "scalar",
      raw: split.raw,
      comment: split.comment,
      endLine: lineIndex,
      target: parseParentScalarTarget(inner),
    };
  }

  const wikiStart = rest.indexOf("[[");
  const wikiEnd = wikiStart === -1 ? -1 : rest.indexOf("]]", wikiStart + 2);
  if (wikiStart !== -1 && wikiEnd !== -1) {
    const inner = rest.slice(wikiStart + 2, wikiEnd);
    const innerEnd = wikiEnd + 2;
    const split = splitParentValueAndComment(rest, innerEnd);
    return {
      kind: "scalar",
      raw: split.raw,
      comment: split.comment,
      endLine: lineIndex,
      target: parseParentWikiTarget(inner),
    };
  }

  const commentMatch = TRAILING_YAML_COMMENT_RE.exec(rest);
  const comment = commentMatch ? commentMatch[1] : "";
  const raw = comment ? rest.slice(0, rest.length - comment.length) : rest;
  return {
    kind: "scalar",
    raw,
    comment,
    endLine: lineIndex,
    target: parseParentScalarTarget(getYamlScalarText(rest)),
  };
}

function readParentFrontmatterField(content) {
  const { lines, lineEnding } = splitMarkdownContent(content);
  const fence = findParentFrontmatterClose(lines);
  if (fence.state === "no-frontmatter") {
    return Object.freeze({
      state: "no-frontmatter",
      raw: null,
      target: null,
      lineIndex: -1,
      endLine: -1,
      comment: "",
      count: 0,
    });
  }
  if (fence.state === "unclosed") {
    return Object.freeze({
      state: "unclosed",
      raw: null,
      target: null,
      lineIndex: -1,
      endLine: -1,
      comment: "",
      count: 0,
    });
  }
  const keys = collectColumn0ParentKeys(lines, fence.close);
  if (keys.length === 0) {
    return Object.freeze({
      state: "absent",
      raw: null,
      target: null,
      lineIndex: -1,
      endLine: -1,
      comment: "",
      count: 0,
    });
  }
  if (keys.length > 1) {
    return Object.freeze({
      state: "duplicate",
      raw: null,
      target: null,
      lineIndex: keys[0].lineIndex,
      endLine: keys[0].lineIndex,
      comment: "",
      count: keys.length,
    });
  }
  const key = keys[0];
  const span = parseParentValueSpan(
    lines,
    key.lineIndex,
    key.remainder,
    fence.close,
    lineEnding,
  );
  return Object.freeze({
    state: span.kind === "list" ? "list" : "scalar",
    raw: span.raw,
    target: span.target,
    lineIndex: key.lineIndex,
    endLine: span.endLine,
    comment: span.comment,
    count: 1,
  });
}

function parentLinkIsUnquotable(linkText) {
  return /["\\\r\n]/.test(String(linkText || ""));
}

function formatParentFrontmatterLine(linkText, comment) {
  return `parent: "${linkText}"${comment || ""}`;
}

function joinParentFrontmatterLines(lines, lineEnding) {
  return lines.join(lineEnding);
}

function planParentFrontmatterEdit(content, linkText, options = {}) {
  const text = String(content || "");
  const link = String(linkText || "");
  if (parentLinkIsUnquotable(link)) {
    return Object.freeze({ ok: false, reason: "unquotable-link" });
  }
  const { lines, lineEnding } = splitMarkdownContent(text);
  const field = readParentFrontmatterField(text);
  if (field.state === "unclosed") {
    return Object.freeze({ ok: false, reason: "unclosed-frontmatter" });
  }
  if (field.state === "duplicate") {
    return Object.freeze({
      ok: false,
      reason: "duplicate-parent-keys",
      count: field.count,
    });
  }
  const expectedProvided = Object.prototype.hasOwnProperty.call(
    options || {},
    "expectedRaw",
  );
  if (expectedProvided && options.expectedRaw !== field.raw) {
    return Object.freeze({ ok: false, reason: "stale" });
  }

  const parentLine = formatParentFrontmatterLine(link, field.comment || "");
  const previousRaw = field.raw;
  const previousTarget = field.target;

  if (field.state === "no-frontmatter") {
    const created = ["---", parentLine, "---"].concat(lines);
    return Object.freeze({
      ok: true,
      content: joinParentFrontmatterLines(created, lineEnding),
      changed: true,
      action: "create-frontmatter",
      previousRaw,
      previousTarget,
    });
  }

  if (field.state === "absent") {
    const next = lines.slice();
    next.splice(1, 0, parentLine);
    return Object.freeze({
      ok: true,
      content: joinParentFrontmatterLines(next, lineEnding),
      changed: true,
      action: "insert-key",
      previousRaw,
      previousTarget,
    });
  }

  const start = field.lineIndex;
  const end = field.endLine < start ? start : field.endLine;
  const currentLine = String(lines[start] || "");
  if (start === end && currentLine === parentLine) {
    return Object.freeze({
      ok: true,
      content: text,
      changed: false,
      action: "replace",
      previousRaw,
      previousTarget,
    });
  }
  const next = lines.slice();
  next.splice(start, end - start + 1, parentLine);
  return Object.freeze({
    ok: true,
    content: joinParentFrontmatterLines(next, lineEnding),
    changed: true,
    action: "replace",
    previousRaw,
    previousTarget,
  });
}
