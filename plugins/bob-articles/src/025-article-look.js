const ARTICLE_STALE_HINT_MS = 400;
const ARTICLE_SECTION_NUMBER = /^(\d{1,3}\.|\d{1,3}(?:\.\d{1,3})+\.?)(?:[ \t]+|$)/;

function articleStripSectionNumber(title) {
  const source = String(title || "");
  const match = source.match(ARTICLE_SECTION_NUMBER);
  if (!match) return { token: null, rest: source };
  return { token: match[1], rest: source.slice(match[0].length) };
}

function articleLineStartOffsets(text) {
  const split = articleSplitText(text);
  const starts = [];
  let offset = 0;
  for (let index = 0; index < split.lines.length; index += 1) {
    starts.push(offset);
    offset += split.lines[index].length;
    if (index < split.separators.length) offset += split.separators[index].length;
  }
  return { lines: split.lines, starts };
}

function articleSecnoRangeOnLine(lineText, lineStart, written) {
  const source = String(lineText || "");
  const atx = source.match(/^( {0,3}#{1,6}[ \t]+)(.*)$/);
  const title = atx ? atx[2] : source.replace(/^[ \t]+/, "");
  const titleStart = atx ? atx[1].length : source.length - title.length;
  const stripped = articleStripSectionNumber(title);
  if (!stripped.token) return null;
  if (written != null && stripped.token !== written) return null;
  const from = lineStart + titleStart;
  return { from, to: from + stripped.token.length, token: stripped.token };
}

function articleStaleNumberTitle(section) {
  if (!section || !section.stale || section.number == null || section.number === "") return "";
  return `Becomes ${section.number} on save`;
}

function articleSecnoDecorationRanges(text, outline) {
  if (!outline || !Array.isArray(outline.sections)) return [];
  const { lines, starts } = articleLineStartOffsets(text);
  const ranges = [];
  for (const section of outline.sections) {
    if (!section || !Number.isInteger(section.line) || !section.written) continue;
    const index = section.line - 1;
    if (index < 0 || index >= lines.length) continue;
    const range = articleSecnoRangeOnLine(lines[index], starts[index], section.written);
    if (!range) continue;
    ranges.push({
      from: range.from,
      to: range.to,
      token: range.token,
      stale: Boolean(section.stale),
      number: section.number || null,
      title: section.title || "",
      titleAttr: articleStaleNumberTitle(section),
      line: section.line,
    });
  }
  return ranges;
}

function articleMapDecorationRanges(ranges, changes) {
  if (!Array.isArray(ranges)) return [];
  if (!changes || typeof changes.mapPos !== "function") return ranges.slice();
  const mapped = [];
  for (const range of ranges) {
    let from;
    let to;
    try {
      from = changes.mapPos(range.from, 1);
      to = changes.mapPos(range.to, -1);
    } catch (error) {
      continue;
    }
    if (from < to) mapped.push({ ...range, from, to });
  }
  return mapped;
}

function articleSectionAtLine(outline, line) {
  if (!outline || !Array.isArray(outline.sections) || !Number.isInteger(line)) return null;
  let match = null;
  for (const section of outline.sections) {
    if (!section || !Number.isInteger(section.line)) continue;
    const end = Number.isInteger(section.end_line) ? section.end_line : Number.POSITIVE_INFINITY;
    if (line >= section.line && line <= end) match = section;
  }
  return match;
}

function articleStatusBarModel(outline, line) {
  if (!outline || outline.numbering === false) return null;
  const section = articleSectionAtLine(outline, line);
  if (!section || section.number == null || section.number === "") return null;
  return {
    text: `§ ${String(section.number).replace(/\.$/, "")}`,
    title: section.title || "",
  };
}

function articleHeadingWrapSpec(headingText, section) {
  if (!section || !section.written) return null;
  const source = String(headingText || "");
  const leading = source.match(/^[ \t]*/)[0];
  const rest = source.slice(leading.length);
  const stripped = articleStripSectionNumber(rest);
  if (stripped.token !== section.written) return null;
  return {
    from: leading.length,
    to: leading.length + stripped.token.length,
    className: section.stale ? "bob-secno is-stale" : "bob-secno",
    title: articleStaleNumberTitle(section),
  };
}

function articleWrappedHeadingChildren(headingText, section) {
  const source = String(headingText || "");
  const spec = articleHeadingWrapSpec(source, section);
  if (!spec) return [{ type: "text", value: source }];
  const children = [];
  if (spec.from > 0) children.push({ type: "text", value: source.slice(0, spec.from) });
  children.push({
    type: "span",
    className: spec.className,
    title: spec.title,
    value: source.slice(spec.from, spec.to),
  });
  if (spec.to < source.length) children.push({ type: "text", value: source.slice(spec.to) });
  return children;
}

function articleFirstTextNode(node) {
  if (!node) return null;
  if (node.nodeType === 3 || node.nodeName === "#text") {
    return typeof node.nodeValue === "string" && node.nodeValue.length ? node : null;
  }
  const tag = String(node.tagName || node.nodeName || "").toLowerCase();
  if (tag === "code" || tag === "pre") return null;
  const children = node.childNodes || [];
  for (let index = 0; index < children.length; index += 1) {
    const found = articleFirstTextNode(children[index]);
    if (found) return found;
  }
  return null;
}

function articleCreateTextNode(documentRef, value) {
  if (documentRef && typeof documentRef.createTextNode === "function") {
    return documentRef.createTextNode(value);
  }
  return { nodeType: 3, nodeName: "#text", nodeValue: value };
}

function articleWrapHeadingElement(heading, section, documentRef) {
  if (!heading || !section) return false;
  try {
    if (typeof heading.querySelector === "function" && heading.querySelector(".bob-secno")) {
      return false;
    }
  } catch (error) {
    // Keep wrapping when querySelector is unavailable.
  }
  const textNode = articleFirstTextNode(heading);
  if (!textNode) return false;
  const value = String(textNode.nodeValue || "");
  const spec = articleHeadingWrapSpec(value, section);
  if (!spec) return false;
  const doc = documentRef
    || heading.ownerDocument
    || (typeof document !== "undefined" ? document : null);
  if (!doc || typeof doc.createElement !== "function") return false;
  const parent = textNode.parentNode || heading;
  if (!parent || typeof parent.insertBefore !== "function" || typeof parent.removeChild !== "function") {
    return false;
  }
  const span = doc.createElement("span");
  span.className = spec.className;
  if (spec.title) {
    if (typeof span.setAttribute === "function") span.setAttribute("title", spec.title);
    else span.title = spec.title;
  }
  if (typeof span.appendChild === "function") {
    span.appendChild(articleCreateTextNode(doc, value.slice(spec.from, spec.to)));
  } else {
    span.textContent = value.slice(spec.from, spec.to);
  }
  const parts = [];
  if (spec.from > 0) parts.push(articleCreateTextNode(doc, value.slice(0, spec.from)));
  parts.push(span);
  if (spec.to < value.length) parts.push(articleCreateTextNode(doc, value.slice(spec.to)));
  for (const part of parts) parent.insertBefore(part, textNode);
  parent.removeChild(textNode);
  return true;
}

function articleOutlineForCurrentBuffer(outline, applied) {
  if (!outline || typeof outline !== "object") return outline || null;
  if (!applied) return outline;
  const sections = Array.isArray(outline.sections)
    ? outline.sections.map((section) => ({
      ...section,
      line: Number.isInteger(section.output_line) && section.output_line > 0
        ? section.output_line
        : section.line,
      written: section.number != null ? section.number : section.written,
      stale: false,
    }))
    : [];
  return { ...outline, sections };
}

function articleCreateLookState() {
  return {
    versions: new Map(),
    inFlight: new Map(),
    pending: new Map(),
    composing: new Set(),
  };
}

function articleNoteStaleHintEdit(state, path) {
  const version = (state.versions.get(path) || 0) + 1;
  state.versions.set(path, version);
  state.pending.set(path, true);
  return { action: "schedule", delay: ARTICLE_STALE_HINT_MS, version };
}

function articleNoteStaleHintTimer(state, path, options = {}) {
  const desktop = options.desktop !== false;
  const enabled = options.enabled !== false;
  if (!desktop || !enabled) {
    state.pending.delete(path);
    return { action: "idle" };
  }
  if (state.composing.has(path) || options.composing) {
    return { action: "schedule", delay: ARTICLE_STALE_HINT_MS, version: state.versions.get(path) || 0 };
  }
  if (state.inFlight.has(path)) return { action: "wait" };
  if (!state.pending.get(path)) return { action: "idle" };
  const version = state.versions.get(path) || 0;
  state.inFlight.set(path, version);
  state.pending.delete(path);
  return { action: "spawn", version };
}

function articleNoteStaleHintResult(state, path, version) {
  const inFlight = state.inFlight.get(path);
  if (inFlight === version) state.inFlight.delete(path);
  const current = state.versions.get(path);
  const accept = inFlight === version && current === version;
  const reschedule = Boolean(state.pending.get(path)) || current !== version;
  return { accept, reschedule, version: current };
}

function articleIsDesktopApp() {
  try {
    return !Platform || Platform.isDesktopApp !== false;
  } catch (error) {
    return true;
  }
}
