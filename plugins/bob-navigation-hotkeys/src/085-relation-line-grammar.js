// LINKS / LINKED FROM recognisers. This is the navigation plugin's pure
// mirror of bob-cli's docs/task-relations.md LK contract; writers and the
// live relation API arrive in nav-writer. Keep these parsers independent of
// the dependency grammar so each managed-line family rejects the others.
const TASK_RELATION_EMOJI = "🪢";
const TASK_RELATION_LINE_NOTICE =
  "🪢 LINKS entries are relations, not Task Links · edit them with Ctrl+Shift+L";
const TASK_LINKED_FROM_LINE_NOTICE =
  "🪢 LINKED FROM is generated from other tasks' LINKS lines · change it with Ctrl+Shift+Alt+L";
const TASK_RELATION_LINK_RE = /(?:~~)?!?\[\[([^\]\n]*)\]\](?:~~)?/g;
const TASK_RELATION_LABEL_FORBIDDEN_RE = /[\[\]()"\\|•*~\u0000-\u001f\u007f-\u009f]/u;
const TASK_RELATION_BULLET_RE =
  /^(?<indent>[ \t]*)(?<marker>(?:[-*+]|\d+[.)]))[ \t]+(?:(?<emoji>🪢|🔗)[ \t]+)?\*\*(?<label>LINKS|LINKS TO|LINKED FROM|BACKLINKS):\*\*[ \t]*(?<body>.*)$/u;

function normalizeRelationLabel(value) {
  const label = String(value || "")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/:$/, "")
    .trim();
  const length = Array.from(label).length;
  if (
    length < 1 ||
    length > 40 ||
    TASK_RELATION_LABEL_FORBIDDEN_RE.test(label) ||
    /^[·,]/u.test(label)
  ) {
    return null;
  }
  return label;
}

function normalizeRelationReaderLabel(value) {
  const label = String(value || "")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/:$/, "")
    .trim();
  if (
    !label ||
    TASK_RELATION_LABEL_FORBIDDEN_RE.test(label) ||
    /^[·,]/u.test(label)
  ) {
    return null;
  }
  return label;
}

function parseRelationLinkBody(body) {
  const pipe = body.indexOf("|");
  const target = pipe === -1 ? body : body.slice(0, pipe);
  const alias = pipe === -1 ? "" : body.slice(pipe + 1);
  const match = /^(?<note>[^#|\n]*?)#\^(?<blockId>[A-Za-z0-9-]+)$/u.exec(target);
  if (!match) {
    return null;
  }
  return Object.freeze({
    note: String(match.groups.note || ""),
    blockId: match.groups.blockId,
    alias,
  });
}

function relationLinkText(link) {
  return link.note
    ? `[[${link.note}#^${link.blockId}]]`
    : `[[#^${link.blockId}]]`;
}

function relationLineMatch(lineText, acceptedLabels, options = {}) {
  const text = String(lineText || "");
  if (
    /^[ \t]*>/.test(text) ||
    options.inFence === true ||
    options.isDirectChildOfTask === false
  ) {
    return null;
  }
  const match = TASK_RELATION_BULLET_RE.exec(text);
  return match && acceptedLabels.has(match.groups.label) ? match : null;
}

function parseLinksEntryLabel(gap, first, alias) {
  let raw = String(gap || "");
  if (!first) {
    const separator = /^[ \t]*(?:[•·,][ \t]*|[ \t]+)/u.exec(raw);
    if (!separator) {
      return { ok: false, label: null };
    }
    raw = raw.slice(separator[0].length);
  }
  raw = raw.trim();
  if (!raw) {
    if (!alias) return { ok: true, label: null };
    const fallback = normalizeRelationReaderLabel(alias);
    return fallback ? { ok: true, label: fallback } : { ok: false, label: null };
  }
  const label = normalizeRelationReaderLabel(raw);
  return label ? { ok: true, label } : { ok: false, label: null };
}

function parseLinkedFromEntryGap(gap, hasFollowingLink, alias) {
  const text = String(gap || "");
  const leading = /^[ \t]*/u.exec(text)[0].length;
  const rest = text.slice(leading);
  let raw = "";
  let afterLabel = rest;
  if (rest.startsWith("(")) {
    const close = rest.indexOf(")");
    if (close < 0) return { ok: false, label: null };
    raw = rest.slice(1, close);
    afterLabel = rest.slice(close + 1);
  }
  if (hasFollowingLink) {
    if (!/^(?:[ \t]*[•·,][ \t]*|[ \t]+)$/u.test(afterLabel)) {
      return { ok: false, label: null };
    }
  } else if (afterLabel.trim() !== "") {
    return { ok: false, label: null };
  }
  if (!raw) {
    if (!alias) return { ok: true, label: null };
    const fallback = normalizeRelationReaderLabel(alias);
    return fallback ? { ok: true, label: fallback } : { ok: false, label: null };
  }
  const label = normalizeRelationReaderLabel(raw);
  return label ? { ok: true, label } : { ok: false, label: null };
}

function parseTaskRelationLine(lineText, direction, options = {}) {
  const labels = direction === "outgoing"
    ? new Set(["LINKS", "LINKS TO"])
    : new Set(["LINKED FROM", "BACKLINKS"]);
  const match = relationLineMatch(lineText, labels, options);
  if (!match) {
    return Object.freeze({ verdict: "not-a-line", entries: Object.freeze([]), links: Object.freeze([]) });
  }
  const { indent, marker, emoji, label, body } = match.groups;
  const base = { indent, marker, label, hasEmoji: Boolean(emoji) };
  TASK_RELATION_LINK_RE.lastIndex = 0;
  const tokens = [];
  let token = null;
  while ((token = TASK_RELATION_LINK_RE.exec(body)) !== null) {
    const parsed = parseRelationLinkBody(token[1]);
    if (!parsed) {
      return Object.freeze({ ...base, verdict: "malformed", entries: Object.freeze([]), links: Object.freeze([]), canonical: false });
    }
    tokens.push({
      start: token.index,
      end: token.index + token[0].length,
      text: token[0],
      ...parsed,
    });
  }
  TASK_RELATION_LINK_RE.lastIndex = 0;
  if (tokens.length === 0) {
    const verdict = body.trim() === "" ? "empty" : "malformed";
    return Object.freeze({ ...base, verdict, entries: Object.freeze([]), links: Object.freeze([]), canonical: false });
  }

  const entries = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    const previousEnd = index === 0 ? 0 : tokens[index - 1].end;
    const nextStart = index + 1 < tokens.length ? tokens[index + 1].start : body.length;
    if (direction === "outgoing") {
      const parsedLabel = parseLinksEntryLabel(
        body.slice(previousEnd, current.start),
        index === 0,
        current.alias,
      );
      if (!parsedLabel.ok) {
        return Object.freeze({ ...base, verdict: "malformed", entries: Object.freeze([]), links: Object.freeze([]), canonical: false });
      }
      entries.push(Object.freeze({ note: current.note, blockId: current.blockId, label: parsedLabel.label }));
      if (index === tokens.length - 1 && body.slice(current.end).trim() !== "") {
        return Object.freeze({ ...base, verdict: "malformed", entries: Object.freeze([]), links: Object.freeze([]), canonical: false });
      }
    } else {
      if (index === 0 && body.slice(0, current.start).trim() !== "") {
        return Object.freeze({ ...base, verdict: "malformed", entries: Object.freeze([]), links: Object.freeze([]), canonical: false });
      }
      const parsedLabel = parseLinkedFromEntryGap(
        body.slice(current.end, nextStart),
        index + 1 < tokens.length,
        current.alias,
      );
      if (!parsedLabel.ok) {
        return Object.freeze({ ...base, verdict: "malformed", entries: Object.freeze([]), links: Object.freeze([]), canonical: false });
      }
      entries.push(Object.freeze({ note: current.note, blockId: current.blockId, label: parsedLabel.label }));
    }
  }

  const unique = [];
  const seen = new Set();
  for (const entry of entries) {
    const key = `${entry.note}\u0000${entry.blockId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  const canonicalLabel = direction === "outgoing" ? "LINKS" : "LINKED FROM";
  const canonicalBody = unique.map((entry) => {
    const link = relationLinkText(entry);
    return direction === "outgoing"
      ? `${entry.label ? `${entry.label} ` : ""}${link}`
      : `${link}${entry.label ? ` (${entry.label})` : ""}`;
  }).join(" • ");
  const canonical =
    emoji === TASK_RELATION_EMOJI &&
    label === canonicalLabel &&
    body === canonicalBody &&
    entries.length === unique.length;
  return Object.freeze({
    ...base,
    verdict: "accept",
    entries: Object.freeze(unique),
    links: Object.freeze(unique),
    canonical,
  });
}

function parseLinksLine(lineText, options = {}) {
  return parseTaskRelationLine(lineText, "outgoing", options);
}

function parseLinkedFromLine(lineText, options = {}) {
  return parseTaskRelationLine(lineText, "incoming", options);
}

function isTaskRelationLine(lineText, options = {}) {
  return (
    parseLinksLine(lineText, options).verdict !== "not-a-line" ||
    parseLinkedFromLine(lineText, options).verdict !== "not-a-line"
  );
}

function isTaskLinkedFromLine(lineText, options = {}) {
  return parseLinkedFromLine(lineText, options).verdict !== "not-a-line";
}

function taskRelationLineSnapshot(content) {
  const text = String(content || "");
  const lines = text.split(/\r?\n/u);
  const all = [];
  const linkedFrom = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isTaskRelationLine(line)) continue;
    const parent = findNearestParentListItem(lines, index);
    const owner = Number.isInteger(parent) && isObsidianTaskAtLine(text, parent)
      ? String(lines[parent] || "")
      : "";
    const signature = `${owner}\u0000${line}`;
    all.push(signature);
    if (isTaskLinkedFromLine(line)) linkedFrom.push(signature);
  }
  return { all: all.sort(), linkedFrom: linkedFrom.sort() };
}

function taskRelationLinesChanged(before, after) {
  const oldLines = taskRelationLineSnapshot(before);
  const newLines = taskRelationLineSnapshot(after);
  return Object.freeze({
    changed: JSON.stringify(oldLines.all) !== JSON.stringify(newLines.all),
    linkedFromChanged:
      JSON.stringify(oldLines.linkedFrom) !== JSON.stringify(newLines.linkedFrom),
  });
}

function taskDependencyHandEditState(content, lineHint) {
  const text = String(content || "");
  const lines = text.split(/\r?\n/u);
  const hint = Math.floor(Number(lineHint));
  const owner = findOwningTaskLine(lines, hint) ?? hint;
  if (!Number.isInteger(owner) || owner < 0 || owner >= lines.length) {
    return null;
  }
  const collection = collectDependencyNavigationBullets(text, owner);
  const field = findBulletPropertyField(lines[owner], "dependsOn");
  return JSON.stringify({
    field: field ? field.value : null,
    lines: collection.lineIndices.map((index) => String(lines[index] || "")),
    blockIds: collection.blockIds,
  });
}

function taskRelationOnlyHandEdit(before, after, baselineLine, currentOwnerLine) {
  const relationChange = taskRelationLinesChanged(before, after);
  if (!relationChange.changed) return false;
  return (
    taskDependencyHandEditState(before, baselineLine) ===
    taskDependencyHandEditState(after, currentOwnerLine)
  );
}
