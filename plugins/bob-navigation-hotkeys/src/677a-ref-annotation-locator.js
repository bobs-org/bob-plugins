// Pure annotation locator for Highlights reference notes.
//
// Maps a ref-note line inside the managed `<!-- highlights:begin -->` /
// `<!-- highlights:end -->` region to the `^h-` block that owns it. It mirrors
// bob-cli's generated body contract (`docs/highlights-ref-sync.md` in bob-cli:
// region markers, H3/H4 page caption grammar, `[!quote|Page N]` piece
// metadata, standalone `^h-` ID lines, `Grouped highlight` / `Merged
// emphasis` / `Removed highlight` callouts). Pure functions only: no Obsidian
// API and no plugin state. The resolver phase calls these with plain line
// arrays; nothing calls them yet.

const REF_HIGHLIGHTS_BEGIN_MARKER = "<!-- highlights:begin -->";
const REF_HIGHLIGHTS_END_MARKER = "<!-- highlights:end -->";
const REF_ANNOTATION_ID_RE = /^\^h-[A-Za-z0-9-]+$/;
const REF_ANNOTATION_SECTION_ID_RE = /^\^s-[A-Za-z0-9-]+$/;
const REF_ANNOTATION_ATX_HEADING_RE = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const REF_PAGE_LABEL_RE = /^(pages?|p{1,2}\.)(?:\s+(.+?))?\s*$/i;
const REF_FIRST_INTEGER_RE = /\d+/;
const REF_BOOKMARK_LINK_RE = /\[\[([^\]#\n]*?)#\^(h-[A-Za-z0-9-]+)\|🔖\]\]/;
const REF_STUB_TARGET_RE = /\[\[[^\]\n]*?#\^(h-[A-Za-z0-9-]+)(?:\|[^\]\n]*)?\]\]/;
const REF_SNIPPET_MAX_LENGTH = 72;

function stripRefBlockquoteLevels(line) {
  let rest = String(line || "").replace(/^\s+/, "");
  let depth = 0;
  while (rest.startsWith(">")) {
    depth += 1;
    rest = rest.startsWith("> ") ? rest.slice(2) : rest.slice(1);
  }
  return depth > 0 ? { depth, content: rest } : null;
}

function splitRefCalloutHeader(content) {
  const text = String(content || "");
  if (!text.startsWith("[!")) {
    return null;
  }
  const end = text.indexOf("]");
  if (end === -1) {
    return null;
  }
  const header = text.slice(2, end);
  if (!header) {
    return null;
  }
  const pipe = header.indexOf("|");
  const name = pipe === -1 ? header : header.slice(0, pipe);
  if (!name) {
    return null;
  }
  let rest = text.slice(end + 1);
  if (rest.startsWith(" ")) {
    rest = rest.slice(1);
  }
  return {
    name,
    metadata: pipe === -1 ? null : header.slice(pipe + 1),
    rest,
  };
}

function refAnnotationIdKind(line) {
  const trimmed = String(line || "").trim();
  if (REF_ANNOTATION_ID_RE.test(trimmed)) {
    return "h";
  }
  if (REF_ANNOTATION_SECTION_ID_RE.test(trimmed)) {
    return "s";
  }
  return null;
}

function refAnnotationHeadingTitle(line) {
  const text = String(line || "");
  if (!REF_ANNOTATION_ATX_HEADING_RE.test(text)) {
    return null;
  }
  return text.replace(/^ {0,3}#{1,6}(?:[ \t]|$)/, "").trim();
}

function refAnnotationRegionRange(lines) {
  let begin = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (String(lines[index] || "").trim() === REF_HIGHLIGHTS_BEGIN_MARKER) {
      begin = index;
      break;
    }
  }
  if (begin === -1) {
    return null;
  }
  for (let index = begin + 1; index < lines.length; index += 1) {
    if (String(lines[index] || "").trim() === REF_HIGHLIGHTS_END_MARKER) {
      return { begin, end: index };
    }
  }
  return null;
}

function refAnnotationFencedLines(lines) {
  const fenced = new Set();
  let opening = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || "");
    if (opening) {
      fenced.add(index);
      if (isClosingFence(line, opening)) {
        opening = null;
      }
      continue;
    }
    const next = getFenceOpening(line);
    if (next) {
      opening = next;
      fenced.add(index);
    }
  }
  return fenced;
}

function parseRefPageLabel(text) {
  const label = String(text || "").trim();
  if (!label) {
    return null;
  }
  const match = REF_PAGE_LABEL_RE.exec(label);
  if (!match || match[2] === undefined) {
    return null;
  }
  const remainder = match[2].trim();
  if (!remainder) {
    return null;
  }
  const digits = REF_FIRST_INTEGER_RE.exec(remainder);
  return {
    label,
    page: digits ? Number.parseInt(digits[0], 10) : null,
  };
}

function parseRefBookmarkLink(lineText) {
  const match = REF_BOOKMARK_LINK_RE.exec(String(lineText || ""));
  if (!match) {
    return null;
  }
  return Object.freeze({ target: match[1].trim(), blockId: match[2] });
}

function parseRefArchivePdfLink(value) {
  let text = String(value || "").trim();
  if (!text) {
    return null;
  }
  if (
    text.length >= 2 &&
    ((text.startsWith("'") && text.endsWith("'")) ||
      (text.startsWith('"') && text.endsWith('"')))
  ) {
    text = text.slice(1, -1).trim();
  }
  const match = /^!?\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]$/.exec(text);
  if (!match) {
    return null;
  }
  const linkpath = match[1].trim();
  return linkpath || null;
}

function findRefAnnotationBlockLine(lines, blockId) {
  const list = Array.isArray(lines) ? lines : [];
  const want = `^${String(blockId || "")}`;
  const range = refAnnotationRegionRange(list);
  if (!range) {
    return -1;
  }
  const fenced = refAnnotationFencedLines(list);
  for (let index = range.begin + 1; index < range.end; index += 1) {
    if (fenced.has(index)) {
      continue;
    }
    if (String(list[index] || "").trim() === want) {
      return index;
    }
  }
  return -1;
}

function refAnnotationPageFromMetadata(metadata) {
  if (metadata === null || metadata === undefined) {
    return null;
  }
  const parsed = parseRefPageLabel(metadata);
  return parsed ? parsed.page : null;
}

function refAnnotationLabelFromMetadata(metadata) {
  if (metadata === null || metadata === undefined) {
    return null;
  }
  const parsed = parseRefPageLabel(metadata);
  return parsed ? parsed.label : null;
}

function truncateRefSnippet(text) {
  const clean = String(text || "");
  if (clean.length <= REF_SNIPPET_MAX_LENGTH) {
    return clean;
  }
  const cut = clean.slice(0, REF_SNIPPET_MAX_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

function collectRefQuoteSnippet(lines, from, to, depth, firstRest, fenced) {
  const parts = [];
  for (let index = from; index <= to; index += 1) {
    if (fenced.has(index)) {
      continue;
    }
    const stripped = stripRefBlockquoteLevels(lines[index]);
    if (!stripped || stripped.depth !== depth) {
      continue;
    }
    const content = index === from ? firstRest : stripped.content;
    if (/^\s*!\[\[/.test(content)) {
      continue;
    }
    if (!content.trim()) {
      continue;
    }
    parts.push(content);
  }
  const joined = parts.join("\n");
  const withoutEmbeds = joined.replace(/!\[\[[^\]]*\]\]/g, "");
  const withoutEmphasis = withoutEmbeds.split("**").join("");
  return truncateRefSnippet(withoutEmphasis.replace(/\s+/g, " ").trim());
}

function refAnnotationPieceEnd(lines, pieceStart, nextPieceStart, idLine) {
  if (nextPieceStart !== null) {
    return nextPieceStart - 1;
  }
  let end = idLine - 1;
  while (end > pieceStart && String(lines[end] || "").trim() === "") {
    end -= 1;
  }
  return end;
}

function locateRefAnnotation(lines, lineIndex) {
  const list = Array.isArray(lines) ? lines : [];
  if (
    !Number.isInteger(lineIndex) ||
    lineIndex < 0 ||
    lineIndex >= list.length
  ) {
    return null;
  }
  const range = refAnnotationRegionRange(list);
  if (!range) {
    return null;
  }
  if (lineIndex <= range.begin || lineIndex >= range.end) {
    return null;
  }
  const fenced = refAnnotationFencedLines(list);
  if (fenced.has(lineIndex)) {
    return null;
  }

  const cursorTitle = refAnnotationHeadingTitle(list[lineIndex]);
  if (cursorTitle !== null) {
    const caption = parseRefPageLabel(cursorTitle);
    if (!caption) {
      return null;
    }
    let count = 0;
    for (let index = lineIndex + 1; index < range.end; index += 1) {
      if (fenced.has(index)) {
        continue;
      }
      if (refAnnotationHeadingTitle(list[index]) !== null) {
        break;
      }
      if (refAnnotationIdKind(list[index]) === "h") {
        count += 1;
      }
    }
    return Object.freeze({
      kind: "caption",
      blockId: null,
      page: caption.page,
      pageLabel: caption.label,
      snippet: null,
      annotationKind: null,
      stubTarget: null,
      rail: Object.freeze({ from: lineIndex, to: lineIndex }),
      count,
    });
  }

  const cursorText = String(list[lineIndex] || "");
  const cursorIdKind = refAnnotationIdKind(cursorText);
  if (cursorIdKind === "s") {
    return null;
  }
  if (
    cursorIdKind === null &&
    cursorText.trim() !== "" &&
    stripRefBlockquoteLevels(cursorText) === null
  ) {
    return null;
  }

  let idLine = -1;
  if (cursorIdKind === "h") {
    idLine = lineIndex;
  } else {
    for (let index = lineIndex + 1; index < range.end; index += 1) {
      if (fenced.has(index)) {
        continue;
      }
      const text = String(list[index] || "");
      if (refAnnotationHeadingTitle(text) !== null) {
        return null;
      }
      const idKind = refAnnotationIdKind(text);
      if (idKind === "h") {
        idLine = index;
        break;
      }
      if (idKind === "s") {
        return null;
      }
    }
    if (idLine === -1) {
      return null;
    }
  }

  let start = range.begin + 1;
  for (let index = idLine - 1; index > range.begin; index -= 1) {
    if (fenced.has(index)) {
      continue;
    }
    const text = String(list[index] || "");
    if (refAnnotationHeadingTitle(text) !== null) {
      start = index + 1;
      break;
    }
    const idKind = refAnnotationIdKind(text);
    if (idKind === "h" || idKind === "s") {
      start = index + 1;
      break;
    }
  }
  while (
    start < idLine &&
    (String(list[start] || "").trim() === "" || fenced.has(start))
  ) {
    start += 1;
  }
  if (lineIndex < start || lineIndex > idLine) {
    return null;
  }

  const headStripped = stripRefBlockquoteLevels(list[start]);
  if (!headStripped || headStripped.depth !== 1) {
    return null;
  }
  const head = splitRefCalloutHeader(headStripped.content);
  if (!head) {
    return null;
  }
  const calloutName = head.name.toLowerCase();

  if (calloutName === "summary") {
    return null;
  }

  const wholeRail = Object.freeze({ from: start, to: idLine });

  if (calloutName === "warning" && head.rest.startsWith("Removed highlight")) {
    return Object.freeze({
      kind: "tombstone",
      blockId: String(list[idLine] || "").trim().slice(1),
      page: null,
      pageLabel: null,
      snippet: null,
      annotationKind: null,
      stubTarget: null,
      rail: wholeRail,
      count: null,
    });
  }

  if (
    calloutName === "info" &&
    (head.rest.startsWith("Grouped highlight") ||
      head.rest.startsWith("Merged emphasis"))
  ) {
    const blockText = list.slice(start, idLine + 1).join("\n");
    const stubMatch = REF_STUB_TARGET_RE.exec(blockText);
    return Object.freeze({
      kind: "stub",
      blockId: String(list[idLine] || "").trim().slice(1),
      page: null,
      pageLabel: null,
      snippet: null,
      annotationKind: null,
      stubTarget: stubMatch ? stubMatch[1] : null,
      rail: wholeRail,
      count: null,
    });
  }

  let annotationKind = null;
  if (calloutName === "quote") {
    annotationKind =
      head.rest === "Image" || head.rest.startsWith("Image ")
        ? "image"
        : "quote";
  } else if (calloutName === "note") {
    annotationKind = "note";
  } else {
    return null;
  }

  const blockId = String(list[idLine] || "").trim().slice(1);

  let captionPage = null;
  let captionLabel = null;
  for (let index = lineIndex - 1; index > range.begin; index -= 1) {
    if (fenced.has(index)) {
      continue;
    }
    const title = refAnnotationHeadingTitle(list[index]);
    if (title === null) {
      continue;
    }
    const caption = parseRefPageLabel(title);
    if (caption) {
      captionPage = caption.page;
      captionLabel = caption.label;
    }
    break;
  }

  if (annotationKind === "image") {
    return Object.freeze({
      kind: "annotation",
      blockId,
      page: captionPage,
      pageLabel: captionLabel,
      snippet: null,
      annotationKind,
      stubTarget: null,
      rail: wholeRail,
      count: null,
    });
  }

  const pieces = [{ line: start, metadata: head.metadata, rest: head.rest }];
  if (annotationKind === "quote") {
    for (let index = start + 1; index < idLine; index += 1) {
      if (fenced.has(index)) {
        continue;
      }
      const stripped = stripRefBlockquoteLevels(list[index]);
      if (!stripped || stripped.depth !== 2) {
        continue;
      }
      const header = splitRefCalloutHeader(stripped.content);
      if (header && header.name.toLowerCase() === "quote") {
        pieces.push({ line: index, metadata: header.metadata, rest: header.rest });
      }
    }
  }

  if (pieces.length <= 1) {
    let textEnd = idLine - 1;
    while (textEnd > start && String(list[textEnd] || "").trim() === "") {
      textEnd -= 1;
    }
    return Object.freeze({
      kind: "annotation",
      blockId,
      page: captionPage,
      pageLabel: captionLabel,
      snippet: collectRefQuoteSnippet(list, start, textEnd, 1, head.rest, fenced),
      annotationKind,
      stubTarget: null,
      rail: wholeRail,
      count: null,
    });
  }

  const onIdOrPreBlank =
    lineIndex === idLine ||
    (lineIndex === idLine - 1 && String(list[lineIndex] || "").trim() === "");
  if (onIdOrPreBlank) {
    const headPage = refAnnotationPageFromMetadata(pieces[0].metadata);
    const headLabel = refAnnotationLabelFromMetadata(pieces[0].metadata);
    let textEnd = idLine - 1;
    while (textEnd > start && String(list[textEnd] || "").trim() === "") {
      textEnd -= 1;
    }
    return Object.freeze({
      kind: "annotation",
      blockId,
      page: headPage === null ? captionPage : headPage,
      pageLabel: headLabel === null ? captionLabel : headLabel,
      snippet: collectRefQuoteSnippet(list, start, textEnd, 1, head.rest, fenced),
      annotationKind,
      stubTarget: null,
      rail: wholeRail,
      count: null,
    });
  }

  let pieceIndex = 0;
  for (let index = 0; index < pieces.length; index += 1) {
    if (pieces[index].line <= lineIndex) {
      pieceIndex = index;
    }
  }
  const piece = pieces[pieceIndex];
  const pieceDepth = pieceIndex === 0 ? 1 : 2;
  const nextStart =
    pieceIndex + 1 < pieces.length ? pieces[pieceIndex + 1].line : null;
  const pieceEnd = refAnnotationPieceEnd(list, piece.line, nextStart, idLine);
  const piecePage = refAnnotationPageFromMetadata(piece.metadata);
  const pieceLabel = refAnnotationLabelFromMetadata(piece.metadata);
  return Object.freeze({
    kind: "annotation",
    blockId,
    page: piecePage === null ? captionPage : piecePage,
    pageLabel: pieceLabel === null ? captionLabel : pieceLabel,
    snippet: collectRefQuoteSnippet(
      list,
      piece.line,
      pieceEnd,
      pieceDepth,
      piece.rest,
      fenced,
    ),
    annotationKind,
    stubTarget: null,
    rail: Object.freeze({ from: piece.line, to: pieceEnd }),
    count: null,
  });
}
