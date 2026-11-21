// Prose-field helpers for the LINK band (phase bob-cli-om.3).
//
// Wraps the pure engine from 186/187 with the controller's opening rules,
// field mode, minOffset, alias-stage detection, nearby empty-`[[` rows,
// insert application, and unresolved-complete-link listing. Offsets stay
// UTF-16. Never throws: every entry point returns null / empty on bad input.

const PROSE_LINK_SLOTS_ROOMY = 5;
const PROSE_LINK_SLOTS_DENSE = 3;
const PROSE_HINT_DEBOUNCE_MS = 250;
const PROSE_LINK_WINDOW_CAP = typeof LINK_RESULT_LIMIT === "number" ? LINK_RESULT_LIMIT : 20;

function proseResolveSourcePath(sourcePath) {
  try {
    if (typeof sourcePath === "function") return sourcePath();
    if (sourcePath == null || sourcePath === "") return null;
    return String(sourcePath);
  } catch (_error) {
    return null;
  }
}

function proseResolveMinOffset(minOffset) {
  try {
    const value = typeof minOffset === "function" ? minOffset() : minOffset;
    const number = Number(value);
    // +Infinity means "no opener qualifies" (S11 without a date token).
    if (number === Infinity) return Number.MAX_SAFE_INTEGER;
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.floor(number));
  } catch (_error) {
    return 0;
  }
}

function proseCaretIsCollapsed(inputEl) {
  if (!inputEl) return false;
  try {
    const start = inputEl.selectionStart;
    const end = inputEl.selectionEnd;
    if (start == null || end == null) return true;
    return start === end;
  } catch (_error) {
    return true;
  }
}

function proseReadCaret(inputEl) {
  try {
    const start = inputEl && inputEl.selectionStart;
    if (Number.isInteger(start)) return start;
  } catch (_error) {}
  try {
    const value = inputEl && inputEl.value;
    return String(value == null ? "" : value).length;
  } catch (_error) {
    return 0;
  }
}

function proseInputOpensBand(event) {
  if (!event) return false;
  if (event.isComposing) return false;
  const type = event.inputType;
  if (!type) return false;
  if (type === "insertFromPaste" || type === "insertFromDrop" || type === "insertFromYank") {
    return false;
  }
  return true;
}

function proseContainingLink(text, caret) {
  try {
    const value = String(text == null ? "" : text);
    const links = linkScanLinks(value, linkCodeRanges(value));
    for (const link of links) {
      if (caret >= link.start && caret <= link.end) return link;
    }
  } catch (_error) {}
  return null;
}

function proseStageOf(field) {
  if (!field) return "notes";
  if (field.aliasStage) return "alias";
  if (field.context === LINK_CONTEXT_HEADING) return "headings";
  if (field.context === LINK_CONTEXT_BLOCK) return "blocks";
  if (field.query === "") return "nearby";
  return "notes";
}

function proseAnnotateField(field, link, text) {
  if (!field) return null;
  const linkStart = link ? link.start : Math.max(0, field.replacement[0] - 2);
  return {
    ...field,
    linkStart,
    closed: field.existingCloseEnd != null,
    appendClose: Boolean(field.suffixClose),
    stage: proseStageOf(field),
    aliasStage: false,
  };
}

function proseSyntheticField(text) {
  const value = String(text == null ? "" : text);
  return {
    context: LINK_CONTEXT_NOTE,
    scope: "note",
    targetKind: "note",
    target: null,
    query: value,
    replacement: [0, value.length],
    hasAuthoredAlias: false,
    hasAuthoredSubpath: false,
    suffixClose: false,
    existingCloseEnd: null,
    linkStart: 0,
    closed: false,
    appendClose: false,
    stage: value ? "notes" : "nearby",
    aliasStage: false,
    mode: "field",
  };
}

function proseFieldAt(text, caret, options) {
  try {
    const opts = options && typeof options === "object" ? options : {};
    const value = String(text == null ? "" : text);
    const cursor = Number(caret);
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > value.length) return null;
    const minOffset = proseResolveMinOffset(opts.minOffset);
    const sourcePath = proseResolveSourcePath(opts.sourcePath) || "";
    const mode = opts.mode === "field" ? "field" : "inline";
    if (mode === "field") {
      const trimmed = value.replace(/^\s+/u, "");
      if (!trimmed.startsWith("[[") && !trimmed.startsWith("![[")) {
        if (minOffset > 0) return null;
        return proseSyntheticField(value);
      }
    }
    const field = linkFieldAt(value, cursor, sourcePath);
    if (field) {
      const link = proseContainingLink(value, cursor);
      const annotated = proseAnnotateField(field, link, value);
      if (!annotated || annotated.linkStart < minOffset) return null;
      annotated.mode = mode;
      return annotated;
    }
    return null;
  } catch (_error) {
    return null;
  }
}

function proseAliasAt(text, caret, options) {
  try {
    const value = String(text == null ? "" : text);
    const cursor = Number(caret);
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > value.length) return null;
    const link = proseContainingLink(value, cursor);
    if (!link || !link.alias) return null;
    const minOffset = proseResolveMinOffset(options && options.minOffset);
    if (link.start < minOffset) return null;
    if (cursor < link.alias[0] || cursor > link.alias[1]) return null;
    return {
      aliasStage: true,
      stage: "alias",
      linkStart: link.start,
      aliasStart: link.alias[0],
      aliasEnd: link.alias[1],
      query: value.slice(link.alias[0], cursor),
      closed: Boolean(link.close),
      innerEnd: link.innerEnd,
      closeStart: link.close ? link.close[0] : null,
      closeEnd: link.close ? link.close[1] : null,
      replacement: [link.alias[0], link.alias[1]],
      context: "wikilink_alias",
    };
  } catch (_error) {
    return null;
  }
}

function proseApplyInsert(text, field, replacement) {
  const value = String(text == null ? "" : text);
  if (!field || !Array.isArray(field.replacement)) {
    return { text: value, caret: value.length, start: 0, end: 0, replacement: "" };
  }
  const start = field.replacement[0];
  const end = field.replacement[1];
  const inserted = String(replacement == null ? "" : replacement);
  const next = value.slice(0, start) + inserted + value.slice(end);
  let caret;
  try {
    caret = linkCursorAfter(field, inserted.length);
  } catch (_error) {
    caret = start + inserted.length;
  }
  if (field.mode === "field") caret = start + inserted.length;
  return { text: next, caret, start, end, replacement: inserted };
}

function proseResultLink(text, field, replacement, linkStart) {
  try {
    const applied = proseApplyInsert(text, field, replacement);
    const start = Number.isInteger(linkStart) ? linkStart : (field && field.linkStart) || 0;
    let end = applied.text.indexOf("]]", start);
    if (end < 0) {
      end = applied.caret;
      const slice = applied.text.slice(start, end);
      return slice.endsWith("]]") ? slice : `${slice}]]`;
    }
    return applied.text.slice(start, end + 2);
  } catch (_error) {
    return String(replacement || "");
  }
}

function proseCompleteLinks(text) {
  try {
    const value = String(text == null ? "" : text);
    const links = linkScanLinks(value, linkCodeRanges(value));
    const complete = [];
    for (const link of links) {
      if (!link.close) continue;
      const inner = value.slice(link.innerStart, link.innerEnd);
      const main = inner.split("|")[0];
      let target = main;
      let heading = null;
      let blockId = null;
      let scope = "note";
      if (main.startsWith("^^")) {
        blockId = main.slice(2);
        target = "";
        scope = "vault-block";
      } else if (main.startsWith("##")) {
        heading = main.slice(2);
        target = "";
        scope = "vault-heading";
      } else if (main.startsWith("#^")) {
        blockId = main.slice(2);
        target = "";
        scope = "current-block";
      } else if (main.startsWith("#")) {
        heading = main.slice(1);
        target = "";
        scope = "current-heading";
      } else {
        const blockAt = main.indexOf("#^");
        if (blockAt >= 0) {
          target = main.slice(0, blockAt);
          blockId = main.slice(blockAt + 2);
        } else {
          const headingAt = main.indexOf("#");
          if (headingAt >= 0) {
            target = main.slice(0, headingAt);
            heading = main.slice(headingAt + 1);
          }
        }
      }
      complete.push({
        start: link.start,
        raw: value.slice(link.start, link.close[1]),
        target,
        heading,
        blockId,
        scope,
        embed: value[link.start] === "!",
      });
    }
    return complete;
  } catch (_error) {
    return [];
  }
}

function proseMatchRanges(text, query) {
  const source = String(text == null ? "" : text);
  const q = String(query == null ? "" : query);
  if (!q) return [];
  try {
    const lower = linkAsciiLower(source);
    const needle = linkAsciiLower(q);
    const index = lower.indexOf(needle);
    if (index < 0) return [];
    return [[index, index + q.length]];
  } catch (_error) {
    const index = source.toLowerCase().indexOf(q.toLowerCase());
    if (index < 0) return [];
    return [[index, index + q.length]];
  }
}

function proseFolderOf(path) {
  const rel = String(path || "").replace(/\.md$/i, "");
  const parts = rel.split("/");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

function proseNoteKind(path) {
  const rel = String(path || "").replace(/\.md$/i, "");
  if (rel === "ref" || rel.startsWith("ref/")) return "ref";
  if (/^\d{4}\/\d{4}-\d{2}-\d{2}$/.test(rel)) return "calendar";
  if (/^\d{4}$/.test(rel)) return "calendar";
  if (/^\d{6}$/.test(rel)) return "calendar";
  if (/^\d{4}-W\d{2}$/.test(rel)) return "calendar";
  if (/^\d{4}-Q[1-4]$/.test(rel)) return "calendar";
  return "note";
}

function proseIconForRow(row) {
  if (!row) return "file-text";
  if (row.kind === "heading") return "hash";
  if (row.kind === "block") return "pilcrow";
  if (row.noteKind === "ref" || proseNoteKind(row.path) === "ref") return "book-open";
  if (row.noteKind === "calendar" || proseNoteKind(row.path) === "calendar") return "calendar-days";
  return "file-text";
}

function proseNoteMap(notes) {
  const map = new Map();
  for (const note of notes || []) {
    if (note && note.path) map.set(note.path, note);
  }
  return map;
}

function proseRowFromNoteCandidate(candidate, notesByPath, field, text) {
  const note = notesByPath && typeof notesByPath.get === "function"
    ? notesByPath.get(candidate.path) || {}
    : {};
  const insertTarget = note.insertTarget || candidate.insertTarget || candidate.name || String(candidate.path || "").replace(/\.md$/i, "");
  const insert = candidate.alias && !field.hasAuthoredAlias && !field.hasAuthoredSubpath
    ? `${insertTarget}|${candidate.alias}`
    : String(insertTarget + (candidate.heading ? `#${candidate.heading}` : "") + (candidate.blockId ? `#^${candidate.blockId}` : ""));
  const inner = candidate.alias
    ? `${insertTarget}|${candidate.alias}`
    : insertTarget;
  const kind = candidate.heading ? "heading" : candidate.blockId ? "block" : "note";
  const primary = candidate.alias || candidate.heading || candidate.blockId || candidate.name || note.stem || "";
  return {
    key: candidate.heading
      ? `h:${candidate.path}:${candidate.heading}`
      : candidate.blockId
        ? `b:${candidate.path}:${candidate.blockId}`
        : candidate.alias
          ? `a:${candidate.path}:${candidate.alias}`
          : `n:${candidate.path}`,
    kind,
    path: candidate.path,
    stem: note.stem || candidate.name || "",
    folder: proseFolderOf(candidate.path),
    tier: note.tier || candidate.tier || "living",
    alias: candidate.alias || null,
    heading: candidate.heading || null,
    level: candidate.level || null,
    blockId: candidate.blockId || null,
    matchKind: candidate.matchKind || "",
    matchRanges: proseMatchRanges(primary, field.query),
    insert: kind === "heading"
      ? (field.scope === "vault" ? `${insertTarget}#${candidate.heading}` : candidate.heading)
      : kind === "block"
        ? (field.scope === "vault" ? `${insertTarget}#^${candidate.blockId}` : candidate.blockId)
        : inner,
    replacement: field.mode === "field" ? `[[${inner}]]` : candidate.replacement,
    cursorAfter: field.mode === "field" ? `[[${inner}]]`.length : candidate.cursorAfter,
    reason: null,
    noteKind: proseNoteKind(candidate.path),
    primary,
    resultLink: proseResultLink(text, field, field.mode === "field" ? `[[${inner}]]` : candidate.replacement, field.linkStart),
  };
}

function proseRowFromNearby(entry, notesByPath, field, text) {
  const note = notesByPath.get(entry.path) || {};
  const inner = note.insertTarget || String(entry.path || "").replace(/\.md$/i, "");
  const replacement = field.mode === "field"
    ? `[[${inner}]]`
    : linkReplacementText(field, inner);
  const cursorAfter = field.mode === "field"
    ? replacement.length
    : linkCursorAfter(field, replacement.length);
  return {
    key: `n:${entry.path}:${entry.reason || "nearby"}`,
    kind: "note",
    path: entry.path,
    stem: note.stem || entry.name || "",
    folder: proseFolderOf(entry.path),
    tier: note.tier || "living",
    alias: null,
    heading: null,
    level: null,
    blockId: null,
    matchKind: "nearby",
    matchRanges: [],
    insert: inner,
    replacement,
    cursorAfter,
    reason: entry.reason || "recent",
    noteKind: proseNoteKind(entry.path),
    primary: note.stem || entry.name || "",
    resultLink: proseResultLink(text, field, replacement, field.linkStart),
  };
}

function proseRankRows(field, notes, options) {
  try {
    if (!field || field.aliasStage) return { rows: [], total: 0 };
    const opts = options && typeof options === "object" ? options : {};
    const list = Array.isArray(notes) ? notes : [];
    const text = String(opts.text == null ? "" : opts.text);
    if (field.context === LINK_CONTEXT_NOTE && field.query === "") {
      const nearbySource = opts.nearbyIndex || list;
      const nearby = rankLinkNearbyNotes(nearbySource, {
        sourcePath: opts.sourcePath || null,
        parentPaths: opts.parentPaths || [],
        linkedPaths: opts.linkedPaths || [],
        recentPaths: opts.recentPaths || [],
      });
      const nearbyByPath = nearby.length ? proseNoteMap(nearbySource) : null;
      const rows = nearby.map((entry) => proseRowFromNearby(entry, nearbyByPath, field, text));
      return { rows, total: rows.length };
    }
    let ranked = [];
    if (field.context === LINK_CONTEXT_HEADING) {
      ranked = rankLinkHeadingCandidates(field, list);
    } else if (field.context === LINK_CONTEXT_BLOCK) {
      ranked = rankLinkBlockCandidates(field, list);
    } else {
      ranked = rankLinkNoteCandidates(field, list);
    }
    const rows = ranked.map((candidate) => proseRowFromNoteCandidate(candidate, null, field, text));
    return { rows, total: rows.length };
  } catch (_error) {
    return { rows: [], total: 0 };
  }
}

function proseWindowRows(rows, selectedIndex, slots) {
  const list = Array.isArray(rows) ? rows : [];
  const cap = Math.max(1, Number(slots) || PROSE_LINK_SLOTS_ROOMY);
  if (list.length <= cap) {
    const view = list.slice();
    while (view.length < cap) view.push(null);
    return { start: 0, view };
  }
  const index = Number.isInteger(selectedIndex) ? selectedIndex : 0;
  const maxStart = list.length - cap;
  let start = Math.min(maxStart, Math.max(0, index - Math.floor((cap - 1) / 2)));
  if (index < start) start = index;
  if (index >= start + cap) start = index - cap + 1;
  start = Math.max(0, Math.min(maxStart, start));
  return { start, view: list.slice(start, start + cap) };
}

function proseSelectedIndex(rows, selectedKey) {
  if (!selectedKey) return 0;
  const index = (rows || []).findIndex((row) => row && row.key === selectedKey);
  return index >= 0 ? index : 0;
}

function proseCrumb(field, selected) {
  if (!field) return "notes";
  if (field.aliasStage) return "alias";
  if (field.stage === "nearby" || (field.context === LINK_CONTEXT_NOTE && field.query === "")) {
    return "nearby";
  }
  if (field.context === LINK_CONTEXT_HEADING) {
    const target = field.target || (selected && selected.stem) || "";
    return target ? `${target} › headings` : "headings";
  }
  if (field.context === LINK_CONTEXT_BLOCK) {
    const target = field.target || (selected && selected.stem) || "";
    return target ? `${target} › blocks` : "blocks";
  }
  return "notes";
}

function proseQuietMessage(field, rows, sourcePath) {
  if (!field || field.aliasStage) return null;
  if (field.context === LINK_CONTEXT_HEADING || field.context === LINK_CONTEXT_BLOCK) {
    if (field.scope === "current" && !sourcePath) {
      return "Same-note links need one home note here — type a note name first";
    }
    if (field.scope === "target" && field.target && (!rows || rows.length === 0)) {
      return `No note named “${field.target}”`;
    }
  }
  if ((!rows || rows.length === 0) && field.context === LINK_CONTEXT_NOTE && field.query) {
    return `No note matches “${field.query}” — keep typing, or esc`;
  }
  return null;
}

function proseUnresolvedMessages(links, resolveOne, sourcePath) {
  const messages = [];
  for (const link of links || []) {
    try {
      const result = resolveOne(link, sourcePath);
      if (!result) {
        if (!link.target && (link.heading || link.blockId) && !sourcePath) {
          messages.push(`⚠ ${link.raw} — no such note`);
          continue;
        }
        if (link.heading && link.target) {
          messages.push(`— no heading “${link.heading}” in ${link.target}`);
        } else if (link.blockId && link.target) {
          messages.push(`— no block ^${link.blockId} in ${link.target}`);
        } else {
          messages.push(`⚠ ${link.raw} — no such note`);
        }
      }
    } catch (_error) {}
  }
  if (messages.length === 0) return [];
  if (messages.length === 1) return messages;
  return [messages[0], `+${messages.length - 1} more`];
}

function proseParentPaths(app, sourcePath) {
  if (!app || !sourcePath) return [];
  try {
    const vault = app.vault || {};
    const metadataCache = app.metadataCache || {};
    const file = typeof vault.getAbstractFileByPath === "function"
      ? vault.getAbstractFileByPath(sourcePath)
      : null;
    const cache = typeof metadataCache.getFileCache === "function"
      ? metadataCache.getFileCache(file) || {}
      : {};
    const parent = cache.frontmatter && cache.frontmatter.parent;
    if (parent == null || parent === "") return [];
    const raw = Array.isArray(parent) ? parent[0] : parent;
    const text = String(raw);
    const match = text.match(/\[\[([^\]|#]+)/);
    const linkpath = (match ? match[1] : text).trim();
    if (!linkpath) return [];
    if (typeof metadataCache.getFirstLinkpathDest === "function") {
      const dest = metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
      if (dest && dest.path) return [dest.path];
    }
    const asPath = linkpath.endsWith(".md") ? linkpath : `${linkpath}.md`;
    return [asPath];
  } catch (_error) {
    return [];
  }
}

function proseLinkedPaths(app, sourcePath) {
  if (!app || !sourcePath) return [];
  try {
    const resolved = app.metadataCache && app.metadataCache.resolvedLinks;
    const outbound = resolved && resolved[sourcePath];
    if (!outbound || typeof outbound !== "object") return [];
    return Object.keys(outbound);
  } catch (_error) {
    return [];
  }
}

function proseRecentPaths(app) {
  try {
    const files = app && app.workspace && typeof app.workspace.getLastOpenFiles === "function"
      ? app.workspace.getLastOpenFiles()
      : [];
    return Array.isArray(files) ? files.slice() : [];
  } catch (_error) {
    return [];
  }
}

function proseBlockPreviewText(source, blockId) {
  const text = String(source == null ? "" : source);
  const needle = `^${blockId}`;
  const index = text.indexOf(needle);
  if (index < 0) return "";
  let lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const before = text.slice(lineStart, index).replace(/^\s*[-*+]\s+/, "").trim();
  const clipped = before.slice(0, 80);
  return clipped;
}
