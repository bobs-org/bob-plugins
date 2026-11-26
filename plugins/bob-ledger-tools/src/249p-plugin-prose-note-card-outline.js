// Prose Card outline and measures (bob-cli-qm prose-seam). This code only
// filters Bob's cached values, rounds word counts, and paints text nodes.
const PROSE_NOTE_CARD_OUTLINE_SLOT = "prose-outline";

function proseNoteCardLeafStubIndices(sections) {
  const rows = Array.isArray(sections) ? sections : [];
  const indices = new Set();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row?.stub) continue;
    const depth = Number.isFinite(row.depth) ? row.depth : 0;
    let hasDeeper = false;
    for (let next = index + 1; next < rows.length; next += 1) {
      const nextDepth = Number.isFinite(rows[next]?.depth) ? rows[next].depth : 0;
      if (nextDepth <= depth) break;
      hasDeeper = true;
    }
    if (!hasDeeper) indices.add(index);
  }
  return indices;
}

function proseNoteCardRoundedWords(words) {
  if (typeof words !== "number" || !Number.isFinite(words) || words < 0) return null;
  if (words === 0) return null;
  const unit = words < 1000 ? 10 : 100;
  const rounded = Math.round(words / unit) * unit;
  return rounded > 0 ? rounded : null;
}

function proseNoteCardWordLabel(words) {
  const rounded = proseNoteCardRoundedWords(words);
  if (rounded === null) return "";
  try { return `≈ ${new Intl.NumberFormat("en-US").format(rounded)} words`; }
  catch (_) { return `≈ ${rounded} words`; }
}

function proseNoteCardReadingLabel(words) {
  if (typeof words !== "number" || !Number.isFinite(words) || words < 0) return "";
  const minutes = Math.round(words / 230);
  return minutes === 0 ? "< 1 min read" : `${minutes} min read`;
}

function proseNoteCardHeadingTitle(line) {
  const match = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(String(line || ""));
  if (!match) return "";
  return match[1].replace(/^\d{1,3}(?:\.\d{1,3})*\.?\s+/, "").trim();
}

function proseNoteCardHeadingMatches(line, title) {
  const heading = proseNoteCardHeadingTitle(line).replace(/\s+/g, " ").toLocaleLowerCase();
  const wanted = String(title || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  return Boolean(heading && wanted && heading.includes(wanted));
}

function proseNoteCardSectionLine(section, index, sourceText, headings) {
  const lines = typeof sourceText === "string" ? sourceText.split(/\r?\n/) : [];
  const bobLine = Number.isInteger(section?.line) ? section.line : null;
  if (bobLine !== null && bobLine >= 1 && bobLine <= lines.length
    && proseNoteCardHeadingMatches(lines[bobLine - 1], section.title)) return bobLine - 1;
  const fallback = Array.isArray(headings) ? headings[index] : null;
  const line = fallback?.position?.start?.line;
  return Number.isInteger(line) && line >= 0 && line < lines.length ? line : null;
}

function proseNoteCardFindView(plugin, path) {
  try {
    const leaves = plugin?.app?.workspace?.getLeavesOfType?.("markdown") || [];
    for (const leaf of leaves) {
      const view = leaf?.view;
      if (view?.file?.path === path && view.editor) return view;
    }
    const active = plugin?.articleActiveMarkdownView?.();
    return active?.file?.path === path && active.editor ? active : null;
  } catch (_) {
    return null;
  }
}

function proseNoteCardSetEditorLine(view, line) {
  if (!view?.editor || !Number.isInteger(line) || line < 0) return false;
  try {
    view.editor.setCursor({ line, ch: 0 });
    if (typeof view.editor.scrollIntoView === "function") {
      try { view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true); }
      catch (_) { try { view.editor.scrollIntoView({ line, ch: 0 }); } catch (__) {} }
    }
    return true;
  } catch (_) {
    return false;
  }
}

function proseNoteCardJumpToSection(plugin, path, section, index) {
  const view = proseNoteCardFindView(plugin, proseNoteCardPath(path));
  if (!view) return false;
  let sourceText = "";
  try { sourceText = view.editor.getValue(); } catch (_) {}
  let headings = [];
  try { headings = plugin.app?.metadataCache?.getFileCache?.(view.file)?.headings || []; } catch (_) {}
  const line = proseNoteCardSectionLine(section, index, sourceText, headings);
  return line === null ? false : proseNoteCardSetEditorLine(view, line);
}

function proseNoteCardJumpToLine(plugin, path, line) {
  const view = proseNoteCardFindView(plugin, proseNoteCardPath(path));
  if (!view || !Number.isInteger(line) || line < 1) return false;
  let lines = [];
  try { lines = String(view.editor.getValue()).split(/\r?\n/); } catch (_) { return false; }
  if (line > lines.length) return false;
  return proseNoteCardSetEditorLine(view, line - 1);
}

function proseNoteCardCreateText(doc, parent, tag, className, value) {
  const node = doc.createElement(tag);
  if (className) node.setAttribute("class", className);
  node.appendChild(doc.createTextNode(String(value ?? "")));
  parent.appendChild(node);
  return node;
}

function proseNoteCardAppendFindings(doc, outline, findings, options) {
  if (!Array.isArray(findings) || findings.length === 0) return;
  proseNoteCardCreateText(doc, outline, "h3", "bob-prose-note-card-findings-title", "Findings");
  const list = doc.createElement("div");
  list.setAttribute("class", "bob-prose-note-card-findings");
  list.setAttribute("data-prose-findings", "true");
  for (const finding of findings) {
    if (!finding || typeof finding !== "object") continue;
    const line = Number.isInteger(finding.line) ? finding.line : null;
    const severity = String(finding.severity || "finding");
    const message = String(finding.message || "");
    const row = doc.createElement(line && typeof options.onJumpFinding === "function" ? "button" : "div");
    row.setAttribute("class", `bob-prose-note-card-finding is-${severity}`);
    if (line && typeof options.onJumpFinding === "function") {
      row.setAttribute("type", "button");
      row.setAttribute("aria-label", `${severity}, line ${line}: ${message}`);
      row.addEventListener?.("click", (event) => {
        try { event?.preventDefault?.(); } catch (_) {}
        try { options.onJumpFinding(line); } catch (_) {}
      });
    }
    const label = line === null ? `${severity} · ${message}` : `${severity} · line ${line} · ${message}`;
    row.appendChild(doc.createTextNode(label));
    list.appendChild(row);
  }
  outline.appendChild(list);
}

function proseNoteCardPaintSnapshot(card, snapshot, options = {}) {
  try {
    const row = card?.querySelector?.("[data-prose-measure-row='true']") || null;
    const measures = card?.querySelector?.("[data-prose-measures='true']") || null;
    const outlineNode = card?.querySelector?.("[data-prose-outline='true']") || null;
    if (!row || !measures || !outlineNode || !card.ownerDocument) return false;
    const doc = card.ownerDocument;
    measures.textContent = "";
    outlineNode.textContent = "";
    if (options.expanded === true) outlineNode.removeAttribute?.("hidden");
    else outlineNode.setAttribute("hidden", "");

    if (!snapshot) {
      const state = options.pending === true ? "waiting" : "none";
      row.setAttribute("data-state", state);
      measures.setAttribute("data-state", state);
      outlineNode.setAttribute("data-state", state);
      return true;
    }

    const findings = Array.isArray(snapshot.findings) ? snapshot.findings : [];
    if (snapshot.status === "refused") {
      const message = String(snapshot.refusal?.message || "Bob declined to format this prose note.");
      proseNoteCardCreateText(doc, measures, "span", "bob-prose-note-card-refusal", message);
      row.setAttribute("data-state", "ready");
      measures.setAttribute("data-state", "ready");
      outlineNode.setAttribute("data-state", "ready");
      proseNoteCardAppendFindings(doc, outlineNode, findings, options);
      return true;
    }

    const outline = snapshot.outline && typeof snapshot.outline === "object" ? snapshot.outline : null;
    const sections = Array.isArray(outline?.sections) ? outline.sections : null;
    const words = typeof outline?.words === "number" ? outline.words : null;
    const labels = [];
    const wordLabel = proseNoteCardWordLabel(words);
    const readingLabel = proseNoteCardReadingLabel(words);
    if (wordLabel) labels.push({ text: wordLabel, title: "Approximate; heading text is included." });
    if (readingLabel) labels.push({ text: readingLabel, title: "Estimated from Bob's word count at 230 words per minute." });
    if (sections && sections.length > 0) labels.push({ text: `${sections.length} ${sections.length === 1 ? "section" : "sections"}` });
    const leafStubs = sections ? proseNoteCardLeafStubIndices(sections) : new Set();
    if (leafStubs.size > 0) {
      const tooltip = "Sections whose own body is empty or only TODO/TBD; headings whose subsections hold the writing are not counted";
      labels.push({ text: `${leafStubs.size} to write`, title: tooltip, action: true });
    }
    for (const label of labels) {
      const node = doc.createElement(label.action ? "button" : "span");
      node.setAttribute("class", label.action
        ? "bob-prose-note-card-measure bob-prose-note-card-unwritten"
        : "bob-prose-note-card-measure");
      if (label.title) node.setAttribute("title", label.title);
      if (label.action) {
        node.setAttribute("type", "button");
        node.setAttribute("aria-label", `${leafStubs.size} sections to write. Expand outline.`);
        node.addEventListener?.("click", (event) => {
          try { event?.preventDefault?.(); } catch (_) {}
          try { options.onToggleOutline?.(true); } catch (_) {}
        });
      }
      node.appendChild(doc.createTextNode(label.text));
      measures.appendChild(node);
    }
    const state = labels.length > 0 ? "ready" : "none";
    row.setAttribute("data-state", state);
    measures.setAttribute("data-state", state);
    outlineNode.setAttribute("data-state", state);

    if (sections && options.expanded === true) {
      const stubIndices = leafStubs;
      const numbering = snapshot.numbering === true || (snapshot.numbering == null && outline.numbering === true);
      const list = doc.createElement("div");
      list.setAttribute("class", "bob-prose-note-card-outline-rows");
      list.setAttribute("data-prose-outline-rows", "true");
      sections.forEach((section, index) => {
        if (!section || typeof section !== "object") return;
        const rowNode = doc.createElement("button");
        rowNode.setAttribute("class", "bob-prose-note-card-outline-row");
        rowNode.setAttribute("type", "button");
        rowNode.setAttribute("data-depth", String(Number.isFinite(section.depth) ? section.depth : 0));
        const number = numbering && typeof section.number === "string" ? section.number : "";
        if (number) proseNoteCardCreateText(doc, rowNode, "span", "bob-prose-note-card-outline-number", number);
        proseNoteCardCreateText(doc, rowNode, "span", "bob-prose-note-card-outline-title", section.title || "");
        const measure = stubIndices.has(index)
          ? "to write"
          : proseNoteCardWordLabel(typeof section.words === "number" ? section.words : null);
        if (measure) proseNoteCardCreateText(doc, rowNode, "span", "bob-prose-note-card-outline-measure", measure);
        rowNode.setAttribute("aria-label", `Jump to ${number ? `${number} ` : ""}${String(section.title || "section")}`);
        rowNode.addEventListener?.("click", (event) => {
          try { event?.preventDefault?.(); } catch (_) {}
          try { options.onJumpSection?.(section, index); } catch (_) {}
        });
        list.appendChild(rowNode);
      });
      outlineNode.appendChild(list);
      proseNoteCardAppendFindings(doc, outlineNode, findings, options);
    }
    return true;
  } catch (_) {
    return false;
  }
}
