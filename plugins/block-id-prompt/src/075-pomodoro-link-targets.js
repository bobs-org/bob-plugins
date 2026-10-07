// Pomodoro link targets: pure block-id-prompt helpers for the
// Ctrl+Shift+Enter "Link to today" picker (capture-parity names, today's
// open-entry model, ranked rows, the create intent, and the explicit-target
// link planner). No Obsidian APIs; no behavior change on its own.
const POMODORO_NAME_USAGE =
  "Pomodoro name must contain only A-Z, 0-9 or " +
  "`& ' ( ) + , . / -` and must start with a letter or digit";
const POMODORO_LINK_NAME_TAIL_RE = /^—/;
const POMODORO_LINK_PLACEHOLDER_RE = /\(\s*\)/;
const POMODORO_LINK_STRIKE_SPAN_RE = /~~[^~\n]*?~~/g;

function asciiUppercasePomodoroText(value) {
  return String(value || "").replace(/[a-z]/g, (letter) => letter.toUpperCase());
}

function asciiLowercasePomodoroText(value) {
  return String(value || "").replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function collapsePomodoroWhitespace(value) {
  const collapsed = String(value || "")
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .join(" ");
  return collapsed;
}

// Capture parity (`bob capture`'s `canonicalize_pomodoro_name`: collapse
// whitespace runs to one space, trim, ASCII-uppercase, then the Pomodoro
// name grammar). Returns `{ valid, name, error }`.
function canonicalizePomodoroLinkName(raw) {
  const collapsed = collapsePomodoroWhitespace(raw);
  if (!collapsed) {
    return { valid: false, name: "", error: POMODORO_NAME_USAGE };
  }

  const name = asciiUppercasePomodoroText(collapsed);
  if (!isPomodoroLinkName(name)) {
    return { valid: false, name: "", error: POMODORO_NAME_USAGE };
  }

  return { valid: true, name, error: null };
}

// Capture parity (`is_pomodoro_name` over task-section titles plus `+` in
// the non-leading position): first char A-Z/0-9, the rest A-Z 0-9 space tab
// `& ' ( ) + , . / -`, and at least one ASCII letter present.
function isPomodoroLinkName(name) {
  const text = String(name || "");
  if (!text) {
    return false;
  }

  const first = text[0];
  if (!/[A-Z0-9]/.test(first)) {
    return false;
  }

  let hasLetter = /[A-Z]/.test(first);
  for (let index = 1; index < text.length; index += 1) {
    const character = text[index];
    if (!/[A-Z0-9 \t&'()+,\-./]/.test(character)) {
      return false;
    }
    if (/[A-Z]/.test(character)) {
      hasLetter = true;
    }
  }

  return hasLetter;
}

// Capture parity (`selector_slug`): trim, collapse internal whitespace to
// one space, ASCII-lowercase, then join words with `-`.
function pomodoroLinkSelectorSlug(text) {
  const words = String(text || "")
    .split(/\s+/)
    .filter((word) => word.length > 0);
  return words.map(asciiLowercasePomodoroText).join("-");
}

function padPomodoroMinutes(value) {
  return String(value).padStart(2, "0");
}

function formatPomodoroRangeText(startMinutes, endMinutes) {
  const startHours = Math.floor(startMinutes / 60);
  const startRemainder = startMinutes % 60;
  const endHours = Math.floor(endMinutes / 60);
  const endRemainder = endMinutes % 60;
  return (
    `${padPomodoroMinutes(startHours)}:${padPomodoroMinutes(startRemainder)}` +
    `–${padPomodoroMinutes(endHours)}:${padPomodoroMinutes(endRemainder)}`
  );
}

function compactPomodoroRangeText(startMinutes, endMinutes) {
  const startHours = Math.floor(startMinutes / 60);
  const startRemainder = startMinutes % 60;
  const endHours = Math.floor(endMinutes / 60);
  const endRemainder = endMinutes % 60;
  return (
    `${padPomodoroMinutes(startHours)}${padPomodoroMinutes(startRemainder)}` +
    `-${padPomodoroMinutes(endHours)}${padPomodoroMinutes(endRemainder)}`
  );
}

// Split an entry line into its em-dash name tail (`— NAME` after the
// placeholder/time-range parenthetical), its legacy label (whatever text
// precedes that parenthetical), and its time range. `name` is the em-dash
// tail trimmed (or null); `label` is the legacy leftover with the
// list/checkbox prefix, the parenthetical, and any tail removed
// (`- [ ] Current (10:00-10:25)` → `Current`; `- [ ] Later ()` → `Later`);
// `range` is `{ startMinutes, endMinutes, text: "09:20–09:50" }` or null.
function parsePomodoroEntryParts(lineText) {
  const raw = normalizeMarkdownLine(lineText);
  const prefix = LEDGER_LINE_RE.exec(raw);
  if (!prefix) {
    const fallback = raw.trim();
    return { name: null, label: fallback || null, range: null };
  }

  const body = raw.slice(prefix[0].length);
  const placeholderMatch = POMODORO_LINK_PLACEHOLDER_RE.exec(body);
  const colonMatch = COLON_TIME_RANGE_RE.exec(body);
  const compactMatch = COMPACT_TIME_RANGE_RE.exec(body);

  const candidates = [];
  if (placeholderMatch) {
    candidates.push({
      kind: "placeholder",
      start: placeholderMatch.index,
      end: placeholderMatch.index + placeholderMatch[0].length,
      match: placeholderMatch,
    });
  }
  if (colonMatch) {
    candidates.push({
      kind: "range",
      start: colonMatch.index,
      end: colonMatch.index + colonMatch[0].length,
      match: colonMatch,
    });
  }
  if (compactMatch) {
    candidates.push({
      kind: "range",
      start: compactMatch.index,
      end: compactMatch.index + compactMatch[0].length,
      match: compactMatch,
    });
  }
  candidates.sort((left, right) => left.start - right.start);
  const paren = candidates[0] || null;

  if (!paren) {
    const fallbackLabel = body.trim();
    return { name: null, label: fallbackLabel || null, range: null };
  }

  let range = null;
  if (paren.kind === "range") {
    const minutes = timeRangeFromMatch(paren.match);
    if (minutes) {
      range = {
        startMinutes: minutes.startMinutes,
        endMinutes: minutes.endMinutes,
        text: formatPomodoroRangeText(minutes.startMinutes, minutes.endMinutes),
      };
    }
  }

  let name = null;
  const remainder = body.slice(paren.end).replace(/^[ \t]+/, "");
  if (POMODORO_LINK_NAME_TAIL_RE.test(remainder)) {
    const tail = remainder.slice(1).replace(/^[ \t]+/, "").trim();
    name = tail || null;
  }

  const labelText = body.slice(0, paren.start).trim();
  return { name, label: labelText || null, range };
}

// Whether the `[[…]]` token at `[startCh, endCh)` on `lineText` sits inside
// a `~~…~~` strike span (a struck reference never counts toward link
// totals and never satisfies idempotence).
function isStruckPomodoroLinkToken(lineText, startCh, endCh) {
  const masked = String(lineText || "").replace(
    POMODORO_LINK_STRIKE_SPAN_RE,
    (span) => " ".repeat(span.length),
  );
  return masked.slice(startCh, endCh).trim().length === 0;
}

// Non-struck wiki block references in one entry block, in document order:
// `{ blockId, targetText }`.
function collectPomodoroEntryBlockLinks(lines, entryLine, entryEndLine) {
  const links = [];
  for (let line = entryLine; line <= entryEndLine; line += 1) {
    const lineText = normalizeMarkdownLine(lines[line] || "");
    let match = null;
    WIKI_LINK_RE.lastIndex = 0;
    while ((match = WIKI_LINK_RE.exec(lineText)) !== null) {
      const raw = match[0];
      const endCh = match.index + raw.length;
      const { destination } = splitWikiLinkBody(match[1]);
      const parsed = parseBlockReferenceDestination(destination, {
        allowPathBareBlock: true,
      });
      if (!parsed) {
        continue;
      }
      if (isStruckPomodoroLinkToken(lineText, match.index, endCh)) {
        continue;
      }
      links.push({ blockId: parsed.oldId, targetText: parsed.targetText });
    }
  }
  return links;
}

function pomodoroLinkEntryTitle(parts, range, position) {
  if (parts.name) {
    return parts.name;
  }
  if (parts.label) {
    return parts.label;
  }
  if (range) {
    return range.text;
  }
  return `Pomodoro #${position}`;
}

// Every recognized unfenced top-level entry in document order:
// `entryLine`, `entryText` (CR stripped), `position` (1-based among all
// recognized entries), `status`, `open`, `timed`, `placeholder`, `name`,
// `label`, `slug`, `range`, `links`, `linkCount`, `running`, `nextUp`,
// `title`. Title = name, else label, else range text when timed, else
// `Pomodoro #N`. With several open timed entries nothing claims Running or
// Next up (the model flags the ambiguity instead).
function collectPomodoroLinkEntries(content) {
  const snapshot = String(content || "");
  const lines = snapshot.split("\n");
  const section = findPomodorosSectionRange(lines);
  if (!section) {
    return { hasSection: false, section: null, entries: [] };
  }

  const fenced = computeFencedLineFlags(lines);
  const entries = [];
  for (let line = section.startLine; line <= section.endLine; line += 1) {
    if (fenced[line] || !isPomodoroEntryLine(lines[line])) {
      continue;
    }
    const endLine = pomodoroEntryEndLine(lines, line, section.endLine);
    const entryText = normalizeMarkdownLine(lines[line]);
    const status = pomodoroEntryStatus(lines[line]);
    const open = isOpenPomodoroStatus(status);
    const parts = parsePomodoroEntryParts(lines[line]);
    const timed = parts.range !== null;
    const placeholder = POMODORO_LINK_PLACEHOLDER_RE.test(entryText);
    const position = entries.length + 1;
    const slug = parts.name ? pomodoroLinkSelectorSlug(parts.name) : "";
    const links = collectPomodoroEntryBlockLinks(lines, line, endLine);
    entries.push({
      entryLine: line,
      entryText,
      position,
      status,
      open,
      timed,
      placeholder,
      name: parts.name,
      label: parts.label,
      slug,
      range: parts.range,
      links,
      linkCount: links.length,
      running: false,
      nextUp: false,
      title: pomodoroLinkEntryTitle(parts, parts.range, position),
    });
    line = endLine;
  }

  const timedOpen = entries.filter((entry) => entry.open && entry.timed);
  if (timedOpen.length === 1) {
    timedOpen[0].running = true;
  }
  if (timedOpen.length <= 1) {
    const next = entries.find(
      (entry) => entry.open && entry.placeholder && !entry.timed,
    );
    if (next) {
      next.nextUp = true;
    }
  }

  return { hasSection: true, section, entries };
}

// Elapsed progress of a timed entry from local minutes: `{ fraction,
// minutesLeft }` (`fraction` clamped to 0–1; `minutesLeft` negative when
// over; an end before start wraps past midnight). Null when untimed.
function pomodoroRunProgress(entry, now) {
  const range = entry && entry.range;
  if (
    !range ||
    !Number.isInteger(range.startMinutes) ||
    !Number.isInteger(range.endMinutes)
  ) {
    return null;
  }

  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const start = range.startMinutes;
  let end = range.endMinutes;
  let current = date.getHours() * 60 + date.getMinutes();
  if (end < start) {
    end += 24 * 60;
    if (current < start) {
      current += 24 * 60;
    }
  }

  const duration = end - start;
  if (duration <= 0) {
    return { fraction: current >= start ? 1 : 0, minutesLeft: end - current };
  }

  return {
    fraction: Math.min(1, Math.max(0, (current - start) / duration)),
    minutesLeft: end - current,
  };
}

// Capture parity for the create anchor (`insert_named_pomodoro_child_block`):
// after the running entry's block; else after the last completed (`[x]`/`[X]`,
// never `[-]`) entry's block; else before the first open entry; else at the
// top of the section. Several open timed entries leave the anchor ambiguous,
// so creation is refused (`allowed: false`).
function planPomodoroCreationAnchor(lines, section, allEntries, openEntries) {
  const timedOpen = openEntries.filter((entry) => entry.timed);
  if (timedOpen.length >= 1) {
    return { kind: "running", entry: timedOpen[0] };
  }
  const completed = allEntries.filter(
    (entry) => entry.status === "x" || entry.status === "X",
  );
  if (completed.length > 0) {
    return { kind: "completed", entry: completed[completed.length - 1] };
  }
  if (openEntries.length > 0) {
    return { kind: "first-open", entry: openEntries[0] };
  }
  return { kind: "section-top", entry: null };
}

// The 0-based insertion line for a creation anchor. "After a block" means
// after its last nonblank descendant line, before trailing blank separators.
function pomodoroCreationInsertLine(lines, section, anchor) {
  if (anchor.kind === "first-open" && anchor.entry) {
    return anchor.entry.entryLine;
  }
  if (anchor.kind === "section-top" || !anchor.entry) {
    return section.startLine;
  }
  const endLine = pomodoroEntryEndLine(lines, anchor.entry.entryLine, section.endLine);
  let insertAfterLine = endLine;
  while (
    insertAfterLine > anchor.entry.entryLine &&
    !normalizeMarkdownLine(lines[insertAfterLine]).trim()
  ) {
    insertAfterLine -= 1;
  }
  return insertAfterLine + 1;
}

// Whether a created entry at `insertLine` would become the next-up entry:
// the first open placeholder untimed entry in the resulting order.
function pomodoroCreationBecomesNextUp(openEntries, insertLine) {
  return !openEntries.some(
    (entry) => entry.placeholder && !entry.timed && entry.entryLine < insertLine,
  );
}

// Today's open-entry model for the picker: `{ ok: true, entries (open
// only), allEntries, defaultIndex (−1 when none), defaultReason ("running" |
// "next" | "ambiguous" | null), multipleRunning, creation: { allowed,
// blockedReason, anchor: { kind, title }, becomesNextUp } }`. The default
// mirrors `selectPomodoroInsertionTarget`: the single open timed entry,
// else the first open entry; with several open timed entries the first of
// them stays highlighted but flagged ambiguous.
function buildPomodoroLinkPickerModel(content, options = {}) {
  const collected = collectPomodoroLinkEntries(content);
  if (!collected.hasSection) {
    return { ok: false, error: "no-section" };
  }

  const allEntries = collected.entries;
  const openEntries = allEntries.filter((entry) => entry.open);
  const timedOpen = openEntries.filter((entry) => entry.timed);
  const multipleRunning = timedOpen.length > 1;

  let defaultIndex = -1;
  let defaultReason = null;
  if (timedOpen.length === 1) {
    defaultIndex = openEntries.indexOf(timedOpen[0]);
    defaultReason = "running";
  } else if (multipleRunning) {
    defaultIndex = openEntries.indexOf(timedOpen[0]);
    defaultReason = "ambiguous";
  } else if (openEntries.length > 0) {
    defaultIndex = 0;
    defaultReason = "next";
  }

  const lines = String(content || "").split("\n");
  const anchor = planPomodoroCreationAnchor(
    lines,
    collected.section,
    allEntries,
    openEntries,
  );
  const insertLine = pomodoroCreationInsertLine(lines, collected.section, anchor);

  return {
    ok: true,
    entries: openEntries,
    allEntries,
    defaultIndex,
    defaultReason,
    multipleRunning,
    creation: {
      allowed: !multipleRunning,
      blockedReason: multipleRunning ? "multiple-open-timed" : null,
      anchor: {
        kind: anchor.kind,
        title: anchor.entry ? anchor.entry.title : null,
      },
      becomesNextUp: pomodoroCreationBecomesNextUp(openEntries, insertLine),
    },
  };
}

// Rank one open entry against a non-empty query: exact name slug (what
// capture's `#name` would select) > name slug prefix > title/label
// substring > other substring (time in `0920-0950` and `09:20–09:50` forms,
// `#N`, child link block IDs). Null when the entry does not match.
function rankPomodoroLinkEntry(entry, needle, query) {
  if (needle && entry.slug === needle) {
    return { tier: 0, field: "name", text: entry.name };
  }
  if (needle && entry.slug && entry.slug.startsWith(needle)) {
    return { tier: 1, field: "name", text: entry.name };
  }

  const titleLower = asciiLowercasePomodoroText(entry.title || "");
  const labelLower = entry.label ? asciiLowercasePomodoroText(entry.label) : "";
  if (
    (titleLower && titleLower.includes(query)) ||
    (labelLower && labelLower.includes(query))
  ) {
    return { tier: 2, field: "title", text: entry.title };
  }

  if (entry.range) {
    const compact = compactPomodoroRangeText(
      entry.range.startMinutes,
      entry.range.endMinutes,
    ).toLowerCase();
    if (
      compact.includes(query) ||
      entry.range.text.toLowerCase().includes(query)
    ) {
      return { tier: 3, field: "time", text: entry.range.text };
    }
  }
  if (query.includes(`#${entry.position}`)) {
    return { tier: 3, field: "position", text: `#${entry.position}` };
  }
  const blockHit = (entry.links || []).find((link) =>
    asciiLowercasePomodoroText(link.blockId || "").includes(query),
  );
  if (blockHit) {
    return { tier: 3, field: "block", text: blockHit.blockId };
  }

  return null;
}

// Picker rows for a model and raw query: row kinds `existing` (`entry`,
// `isDefault`, `match`), `new` (`name`, `againOf`, `anchorTitle`,
// `becomesNextUp`), `invalid` (`message`; only when nothing matches), and
// `blocked` (`message`). Every row has a stable `key` and `selectable`.
// Empty query → open entries in order with `selectedIndex = defaultIndex`;
// otherwise ranked rows with `selectedIndex` = first selectable row (−1 when
// none). The create row is appended when the canonical name is valid and no
// open entry has that exact canonical name.
function buildPomodoroLinkPickerRows(model, rawQuery) {
  if (!model || model.ok !== true) {
    return { rows: [], selectedIndex: -1 };
  }

  const query = String(rawQuery === null || rawQuery === undefined ? "" : rawQuery);
  if (!query.trim()) {
    const rows = model.entries.map((entry, index) => ({
      kind: "existing",
      key: `existing-${entry.entryLine}`,
      selectable: true,
      entry,
      isDefault: index === model.defaultIndex,
      match: null,
    }));
    return { rows, selectedIndex: model.defaultIndex };
  }

  const needle = pomodoroLinkSelectorSlug(query);
  const normalized = asciiLowercasePomodoroText(
    query.trim().replace(/\s+/g, " "),
  );
  const ranked = [];
  model.entries.forEach((entry, index) => {
    const match = rankPomodoroLinkEntry(entry, needle, normalized);
    if (match) {
      ranked.push({ entry, index, match });
    }
  });
  ranked.sort(
    (left, right) =>
      left.match.tier - right.match.tier || left.entry.entryLine - right.entry.entryLine,
  );

  const rows = ranked.map(({ entry, index, match }) => ({
    kind: "existing",
    key: `existing-${entry.entryLine}`,
    selectable: true,
    entry,
    isDefault: index === model.defaultIndex,
    match,
  }));

  const canonical = canonicalizePomodoroLinkName(query);
  if (canonical.valid) {
    const exactOpen = model.entries.some((entry) => entry.name === canonical.name);
    if (!exactOpen) {
      if (model.creation && model.creation.allowed) {
        const againEntry = (model.allEntries || []).find(
          (entry) => !entry.open && entry.name === canonical.name,
        );
        rows.push({
          kind: "new",
          key: `new-${pomodoroLinkSelectorSlug(canonical.name)}`,
          selectable: true,
          name: canonical.name,
          againOf: againEntry ? againEntry.title : null,
          anchorTitle:
            model.creation && model.creation.anchor
              ? model.creation.anchor.title
              : null,
          becomesNextUp: Boolean(model.creation && model.creation.becomesNextUp),
        });
      } else {
        const runningCount = model.entries.filter((entry) => entry.timed).length;
        rows.push({
          kind: "blocked",
          key: "blocked-create",
          selectable: false,
          message: `Can't add a Pomodoro while ${runningCount} are running`,
        });
      }
    }
  } else if (rows.length === 0) {
    rows.push({
      kind: "invalid",
      key: "invalid-name",
      selectable: false,
      message: POMODORO_NAME_USAGE,
    });
  }

  return { rows, selectedIndex: rows.findIndex((row) => row.selectable) };
}

// The ⇧↵ behavior: create from the typed text even when other rows match;
// an exact open name links there instead (never a duplicate open name).
function resolvePomodoroLinkCreateIntent(model, rawQuery) {
  if (!model || model.ok !== true) {
    return { kind: "none", reason: "no-model" };
  }

  const query = String(rawQuery === null || rawQuery === undefined ? "" : rawQuery);
  if (!query.trim()) {
    return { kind: "none", reason: "empty" };
  }

  const canonical = canonicalizePomodoroLinkName(query);
  if (!canonical.valid) {
    return { kind: "none", reason: "invalid-name" };
  }

  const exact = (model.entries || []).find((entry) => entry.name === canonical.name);
  if (exact) {
    return { kind: "existing", entry: exact };
  }

  if (model.creation && model.creation.allowed) {
    return { kind: "new", name: canonical.name };
  }

  return { kind: "none", reason: "multiple-open-timed" };
}

// Stale-safe re-resolution of an existing choice in a fresh daily snapshot:
// `(entryLine, entryText)` first, else a unique identical entry line
// elsewhere. Returns the 0-based line, or null when missing or ambiguous.
function resolvePomodoroLinkTargetLine(lines, section, target) {
  if (
    Number.isInteger(target.entryLine) &&
    target.entryLine >= 0 &&
    target.entryLine < lines.length &&
    normalizeMarkdownLine(lines[target.entryLine]) === target.entryText &&
    isPomodoroEntryLine(lines[target.entryLine])
  ) {
    const fenced = computeFencedLineFlags(lines);
    if (!fenced[target.entryLine]) {
      return target.entryLine;
    }
  }

  const fenced = computeFencedLineFlags(lines);
  const matches = [];
  for (let line = section.startLine; line <= section.endLine; line += 1) {
    if (fenced[line] || !isPomodoroEntryLine(lines[line])) {
      continue;
    }
    if (normalizeMarkdownLine(lines[line]) === target.entryText) {
      matches.push(line);
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

// Plan the link insertion under one resolved open entry: skip insertion
// when a matching link is already present there (idempotence), and always
// plan removal of matching duplicates from every *other* open Pomodoro
// (so "linked under exactly the chosen open Pomodoro" holds under races).
function planExistingPomodoroLinkInsertion(
  snapshot,
  lines,
  section,
  entryLine,
  linkOptions,
  matchedExisting,
) {
  const { blockId, targetPath, sourcePath, resolveTarget, linkText } = linkOptions;
  const entryEndLine = pomodoroEntryEndLine(lines, entryLine, section.endLine);
  const alreadyLinked = rangeContainsMatchingLink(
    snapshot,
    entryLine + 1,
    entryEndLine,
    targetPath,
    blockId,
    resolveTarget,
    sourcePath,
  );

  const otherRanges = collectAllOpenPomodoroRanges(lines, section).filter(
    (range) => range.entryLine !== entryLine,
  );
  const cleanup = planPomodoroLinkCleanupForRanges(snapshot, otherRanges, {
    sourcePath,
    targetPath,
    targetBlockId: blockId,
    resolveTarget,
  });

  const insertionEdits = [];
  if (!alreadyLinked) {
    const indentation = findPomodoroChildIndentation(lines, entryLine, entryEndLine, section);
    const entryLineText = `${indentation}- ${linkText}`;
    // The new child belongs immediately after the last nonblank descendant
    // so trailing separators stay after it.
    let insertAfterLine = entryEndLine;
    while (
      insertAfterLine > entryLine &&
      !normalizeMarkdownLine(lines[insertAfterLine]).trim()
    ) {
      insertAfterLine -= 1;
    }
    const insertLine = insertAfterLine + 1;
    insertionEdits.push(
      insertionEditAtLine(
        snapshot,
        lines,
        insertLine,
        [entryLineText],
        lineEndingForInsertion(snapshot, lines, insertAfterLine),
      ),
    );
  }

  const edits = [...insertionEdits, ...cleanup.edits];
  if (!validateNonOverlappingEdits(edits)) {
    return { error: "overlap" };
  }

  const parts = parsePomodoroEntryParts(lines[entryLine]);
  const fencedForPosition = computeFencedLineFlags(lines);
  let position = 0;
  for (let line = section.startLine; line <= entryLine; line += 1) {
    if (!fencedForPosition[line] && isPomodoroEntryLine(lines[line])) {
      position += 1;
    }
  }
  return {
    section,
    entryLine,
    entryEndLine,
    alreadyLinked,
    edits,
    content: edits.length > 0 ? applyTextEdits(snapshot, edits) : snapshot,
    removedCount: cleanup.removedCount,
    hasChanges: edits.length > 0,
    destination: {
      kind: "existing",
      entryLine,
      title: pomodoroLinkEntryTitle(parts, parts.range, position),
      name: parts.name,
      matchedExisting,
    },
  };
}

// Plan the link insertion for a new named entry: a name that became open
// meanwhile links into that entry instead (capture parity, no duplicate);
// otherwise create `- [ ] () — NAME` with the Task Link as its only child
// at the creation anchor, then verify the created entry re-parses at the
// expected line as an open placeholder with exactly the canonical name
// that owns the inserted link line.
function planNewPomodoroLinkInsertion(
  snapshot,
  lines,
  section,
  name,
  linkOptions,
) {
  const { blockId, targetPath, sourcePath, resolveTarget, linkText } = linkOptions;
  const collected = collectPomodoroLinkEntries(snapshot);
  const race = collected.entries.find((entry) => entry.open && entry.name === name);
  if (race) {
    return planExistingPomodoroLinkInsertion(
      snapshot,
      lines,
      section,
      race.entryLine,
      linkOptions,
      true,
    );
  }

  const timedOpen = collected.entries.filter((entry) => entry.open && entry.timed);
  if (timedOpen.length > 1) {
    return { error: "multiple-open-timed" };
  }

  const openEntries = collected.entries.filter((entry) => entry.open);
  const anchor = planPomodoroCreationAnchor(lines, section, collected.entries, openEntries);
  const insertLine = pomodoroCreationInsertLine(lines, section, anchor);

  let indentation = null;
  if (anchor.entry) {
    const anchorEnd = pomodoroEntryEndLine(lines, anchor.entry.entryLine, section.endLine);
    indentation = findPomodoroChildIndentation(lines, anchor.entry.entryLine, anchorEnd, section);
  } else {
    for (let line = section.startLine; line <= section.endLine; line += 1) {
      const candidate = unorderedChildIndentation(lines[line]);
      if (candidate !== null) {
        indentation = candidate;
        break;
      }
    }
    if (indentation === null) {
      indentation = CANONICAL_CHILD_INDENT_UNIT;
    }
  }

  const entryLineText = `- [ ] () — ${name}`;
  const childLineText = `${indentation}- ${linkText}`;
  const referenceLine =
    anchor.entry && anchor.kind !== "first-open" && anchor.kind !== "section-top"
      ? (() => {
        const anchorEnd = pomodoroEntryEndLine(lines, anchor.entry.entryLine, section.endLine);
        let insertAfterLine = anchorEnd;
        while (
          insertAfterLine > anchor.entry.entryLine &&
          !normalizeMarkdownLine(lines[insertAfterLine]).trim()
        ) {
          insertAfterLine -= 1;
        }
        return insertAfterLine;
      })()
      : insertLine;
  const lineEnding = lineEndingForInsertion(snapshot, lines, referenceLine);

  const otherRanges = collectAllOpenPomodoroRanges(lines, section);
  const cleanup = planPomodoroLinkCleanupForRanges(snapshot, otherRanges, {
    sourcePath,
    targetPath,
    targetBlockId: blockId,
    resolveTarget,
  });

  const edits = [
    insertionEditAtLine(snapshot, lines, insertLine, [entryLineText, childLineText], lineEnding),
    ...cleanup.edits,
  ];
  if (!validateNonOverlappingEdits(edits)) {
    return { error: "overlap" };
  }

  const nextContent = applyTextEdits(snapshot, edits);
  const nextLines = nextContent.split("\n");
  const nextSection = findPomodorosSectionRange(nextLines);
  let verified = false;
  if (nextSection && insertLine >= 0 && insertLine < nextLines.length) {
    const createdText = normalizeMarkdownLine(nextLines[insertLine]);
    if (
      isPomodoroEntryLine(nextLines[insertLine]) &&
      isOpenPomodoroStatus(pomodoroEntryStatus(nextLines[insertLine]))
    ) {
      const parts = parsePomodoroEntryParts(nextLines[insertLine]);
      const placeholder = POMODORO_LINK_PLACEHOLDER_RE.test(createdText);
      if (placeholder && parts.name === name) {
        const createdEnd = pomodoroEntryEndLine(nextLines, insertLine, nextSection.endLine);
        verified = rangeContainsMatchingLink(
          nextContent,
          insertLine + 1,
          createdEnd,
          targetPath,
          blockId,
          resolveTarget,
          sourcePath,
        );
      }
    }
  }
  if (!verified) {
    return { error: "verify-failed" };
  }

  return {
    section,
    entryLine: insertLine,
    entryEndLine: pomodoroEntryEndLine(nextLines, insertLine, nextSection.endLine),
    alreadyLinked: false,
    edits,
    content: nextContent,
    removedCount: cleanup.removedCount,
    hasChanges: true,
    destination: {
      kind: "created",
      entryLine: insertLine,
      title: name,
      name,
      matchedExisting: false,
    },
  };
}

// Explicit-target variant of `planPomodoroLinkInsertion`: `options.target`
// is a picker choice (`{ kind: "existing", entryLine, entryText, title }` or
// `{ kind: "new", name }`). Returns today's result shape plus `destination:
// { kind: "existing" | "created", entryLine, title, name, matchedExisting }`,
// or `{ error }` among `no-section`, `invalid-options`, `invalid-name`,
// `target-missing`, `target-closed`, `multiple-open-timed` (new target
// only), `overlap`, `verify-failed`. Every refusal happens before any
// write, so nothing is written — not even a new block ID.
function planExplicitPomodoroLinkInsertion(content, options = {}) {
  const blockId = normalizeText(options.blockId);
  const targetPath = resolvedFilePath(options.targetPath);
  const sourcePath = options.sourcePath;
  const resolveTarget = options.resolveTarget;
  const linkText = options.linkText;
  const target = options.target;

  if (!blockId || !targetPath || typeof resolveTarget !== "function" || !linkText) {
    return { error: "invalid-options" };
  }
  if (!target || (target.kind !== "existing" && target.kind !== "new")) {
    return { error: "invalid-options" };
  }

  const snapshot = String(content || "");
  const lines = snapshot.split("\n");
  const section = findPomodorosSectionRange(lines);
  if (!section) {
    return { error: "no-section" };
  }

  const linkOptions = { blockId, targetPath, sourcePath, resolveTarget, linkText };

  if (target.kind === "new") {
    const canonical = canonicalizePomodoroLinkName(target.name);
    if (!canonical.valid) {
      return { error: "invalid-name" };
    }
    return planNewPomodoroLinkInsertion(snapshot, lines, section, canonical.name, linkOptions);
  }

  if (!Number.isInteger(target.entryLine) || typeof target.entryText !== "string") {
    return { error: "invalid-options" };
  }
  const resolved = resolvePomodoroLinkTargetLine(lines, section, target);
  if (resolved === null) {
    return { error: "target-missing" };
  }
  if (!isOpenPomodoroStatus(pomodoroEntryStatus(lines[resolved]))) {
    return { error: "target-closed" };
  }
  return planExistingPomodoroLinkInsertion(snapshot, lines, section, resolved, linkOptions, false);
}

// The default entry's choice, or null when the model has no default.
function defaultPomodoroLinkChoice(model) {
  if (
    !model ||
    model.ok !== true ||
    !Number.isInteger(model.defaultIndex) ||
    model.defaultIndex < 0 ||
    !model.entries ||
    !model.entries[model.defaultIndex]
  ) {
    return null;
  }

  const entry = model.entries[model.defaultIndex];
  return {
    kind: "existing",
    entryLine: entry.entryLine,
    entryText: entry.entryText,
    title: entry.title,
  };
}
