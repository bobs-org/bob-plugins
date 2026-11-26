// Compose active Snoozed-row removal into deferred Pomodoro link cleanup
// (navigation-cleanup). `planDeferredPomodoroLinkCleanup` removes Snoozed
// rows for the same `{ path, blockId }` targets even when the Pomodoros
// section is missing, every entry is closed, or no ledger link matches, and
// reports those removals distinctly so offset-based callers and notices stay
// correct. Offsets from both passes share the daily snapshot base; never
// apply one pass's offsets to the other's postimage.

function emptySnoozedRowRemoval(content) {
  return Object.freeze({
    postimage: String(content || ""),
    edits: Object.freeze([]),
    removedSnoozedIdentities: Object.freeze([]),
    removedSnoozedLineRanges: Object.freeze([]),
    snoozedSectionRemoved: false,
  });
}

// Canonical `path#^blockId` identities for explicit-removal matching.
function snoozedRowRemovalWantedIdentities(targetList) {
  const wanted = new Set();
  for (const target of Array.isArray(targetList) ? targetList : []) {
    if (!target || !target.path || !target.blockId) {
      continue;
    }
    const identity = snoozeIdentityKey(
      normalizeVaultRelativePath(target.path),
      target.blockId,
    );
    if (identity) {
      wanted.add(identity);
    }
  }
  return wanted;
}

// Resolve one active Snoozed row to a canonical identity for explicit
// removal. Prefers the vault note index (same resolver the Pomodoro pass
// uses); without an index, falls back to a basename comparison so pure
// planner tests without a vault still exercise removal. Unresolvable rows
// never match: a stale prompt or changed target must not cause a partial
// row removal.
function resolveSnoozedRowIdentityForTargets(row, targetList, dailyPath, noteIndex) {
  if (!row || row.kind !== "active" || !row.blockId) {
    return null;
  }
  const blockId = row.blockId;
  if (noteIndex && typeof resolveScheduledRecoveryNote === "function") {
    let resolved = null;
    try {
      resolved = resolveScheduledRecoveryNote(
        noteIndex,
        dailyPath,
        row.target,
      );
    } catch (_) {
      resolved = null;
    }
    if (!resolved) {
      return null;
    }
    return snoozeIdentityKey(resolved, blockId);
  }
  const rowTarget = String(row.target || "").trim();
  for (const target of Array.isArray(targetList) ? targetList : []) {
    if (!target || !target.blockId || target.blockId !== blockId) {
      continue;
    }
    if (rowTarget === "") {
      const identity = snoozeIdentityKey(
        normalizeVaultRelativePath(target.path),
        blockId,
      );
      if (
        identity &&
        normalizeVaultRelativePath(target.path) ===
          normalizeVaultRelativePath(dailyPath)
      ) {
        return identity;
      }
      continue;
    }
    const targetBase = String(
      normalizeVaultRelativePath(target.path).split("/").pop() || "",
    ).replace(/\.md$/i, "").toLowerCase();
    const rowBase = rowTarget.split("/").pop().replace(/\.md$/i, "").toLowerCase();
    if (rowBase !== "" && rowBase === targetBase) {
      return snoozeIdentityKey(
        normalizeVaultRelativePath(target.path),
        blockId,
      );
    }
  }
  return null;
}

// Pure explicit-removal pass over today's Snoozed section for the given
// targets. Never depends on the task still being Next after a release, and
// never prunes by state: release/cancel/roll/schedule callers name the exact
// identities to drop. Ordinary target rewrites (move/rename) do not call
// this path; their whole-note link repair rewrites Snoozed links in place.
function planSnoozedRowRemovalForTargets(dailyContent, targetList, options = {}) {
  const snapshot = String(dailyContent || "");
  const list = Array.from(targetList || []).filter(
    (target) => target && target.path && target.blockId,
  );
  if (list.length === 0) {
    return emptySnoozedRowRemoval(snapshot);
  }
  let section = null;
  try {
    section = snoozeParseSection(snapshot);
  } catch (_) {
    section = null;
  }
  if (!section) {
    return emptySnoozedRowRemoval(snapshot);
  }
  const config = options && typeof options === "object" ? options : {};
  const dailyPath = normalizeVaultRelativePath(config.dailyPath);
  const noteIndex = config.noteIndex || null;
  const wanted = snoozedRowRemovalWantedIdentities(list);
  if (wanted.size === 0) {
    return emptySnoozedRowRemoval(snapshot);
  }
  const removals = [];
  for (const row of section.rows) {
    if (!row || row.kind !== "active") {
      continue;
    }
    const identity = resolveSnoozedRowIdentityForTargets(
      row,
      list,
      dailyPath,
      noteIndex,
    );
    if (!identity || !wanted.has(identity)) {
      continue;
    }
    removals.push({
      identity,
      row,
      edit: snoozeLineRemovalEdit(section, row),
    });
  }
  if (removals.length === 0) {
    return emptySnoozedRowRemoval(snapshot);
  }
  const final = snoozeFinalizeRemoval(snapshot, removals);
  const identities = Array.from(
    new Set(removals.map((item) => item.identity).filter(Boolean)),
  ).sort();
  return Object.freeze({
    postimage: final.postimage,
    edits: Object.freeze(final.edits.slice()),
    removedSnoozedIdentities: Object.freeze(identities),
    removedSnoozedLineRanges: Object.freeze(
      final.edits.map((edit) =>
        Object.freeze({
          startLine: edit.lineStart,
          endLineExclusive: edit.lineEnd,
        }),
      ),
    ),
    snoozedSectionRemoved: final.sectionRemoved === true,
  });
}

// Merge two edit lists that share one snapshot base. The Pomodoro and
// Snoozed passes touch disjoint H2 sections by construction; the only shared
// bytes are the blank separator the Pomodoro entry-removal seam rule and the
// Snoozed empty-section deletion both consume. A Snoozed edit reaching into
// an already-deleted Pomodoro range is shrunk past the overlap — the skipped
// prefix must be blank, otherwise the edit is dropped so one pass can never
// corrupt the other's bytes.
function mergeDeferredCleanupEditsSameBase(pomodoroEdits, snoozedEdits, snapshot) {
  const first = Array.isArray(pomodoroEdits) ? pomodoroEdits : [];
  const second = Array.isArray(snoozedEdits) ? snoozedEdits : [];
  const source = String(snapshot || "");
  const merged = first.map((edit) => ({ ...edit }));
  for (const edit of second) {
    const current = { ...edit };
    let dropped = false;
    for (const existing of merged) {
      if (current.start >= existing.end || existing.start >= current.end) {
        continue;
      }
      // Sections are disjoint, so a Pomodoro edit can only overlap the head
      // of a Snoozed edit (its trailing blank seam). Shrink past it.
      const skipped = source.slice(current.start, Math.min(current.end, existing.end));
      if (/^[ \t\r\n]*$/.test(skipped) && existing.end > current.start) {
        current.start = existing.end;
        continue;
      }
      dropped = true;
      break;
    }
    if (!dropped && current.start < current.end) {
      merged.push(current);
    }
  }
  merged.sort((left, right) => right.start - left.start);
  return merged;
}

function applyDeferredCleanupEdits(snapshot, edits) {
  let next = String(snapshot || "");
  const ordered = (Array.isArray(edits) ? edits : []).slice().sort(
    (left, right) => right.start - left.start,
  );
  for (const edit of ordered) {
    next = next.slice(0, edit.start) + edit.replacement + next.slice(edit.end);
  }
  return next;
}

// Empty-Pomodoro result with a live Snoozed pass folded in: used when the
// Pomodoros section is missing, every entry is closed, or no ledger link
// matches. `changed` covers both passes so callers gating on it fold both
// writes; ledger counters stay Pomodoro-only so notices remain correct.
function composeEmptyDeferredCleanupWithSnoozed(
  snapshot,
  targetList,
  options,
  unresolvedCount = 0,
) {
  const base = emptyDeferredPomodoroLinkCleanup(snapshot, unresolvedCount);
  const snoozed = planSnoozedRowRemovalForTargets(
    snapshot,
    targetList,
    options,
  );
  if (!snoozed || snoozed.edits.length === 0) {
    return Object.freeze({
      ...base,
      snoozedChanged: false,
      removedSnoozedIdentities: Object.freeze([]),
      removedSnoozedLineRanges: Object.freeze([]),
      snoozedSectionRemoved: false,
    });
  }
  return Object.freeze({
    ...base,
    content: snoozed.postimage,
    changed: true,
    snoozedChanged: true,
    removedSnoozedIdentities: snoozed.removedSnoozedIdentities,
    removedSnoozedLineRanges: snoozed.removedSnoozedLineRanges,
    snoozedSectionRemoved: snoozed.snoozedSectionRemoved,
  });
}

// Assemble the final deferred-cleanup plan from the Pomodoro pass's parts
// plus the active Snoozed-row pass, merged on the shared snapshot base and
// applied once. Entry mapping runs against the merged postimage; ledger
// counters and identity metadata keep their Pomodoro-only meaning while row
// removals report distinctly.
function finishDeferredCleanupWithSnoozed(snapshot, targetList, parts) {
  const config = parts && typeof parts === "object" ? parts : {};
  const subtreeEdits = Array.isArray(config.subtreeEdits)
    ? config.subtreeEdits
    : [];
  const lineEdits = Array.isArray(config.lineEdits) ? config.lineEdits : [];
  const touchedEntryOffsets = Array.isArray(config.touchedEntryOffsets)
    ? config.touchedEntryOffsets
    : [];
  const matches = Array.isArray(config.matches) ? config.matches : [];
  const removedTargetKeys = config.removedTargetKeys instanceof Set
    ? config.removedTargetKeys
    : new Set();
  const list = Array.from(targetList || []).filter(
    (target) => target && target.path && target.blockId,
  );
  const snoozed = planSnoozedRowRemovalForTargets(snapshot, list, {
    dailyPath: config.dailyPath,
    noteIndex: config.noteIndex,
  });
  const edits = mergeDeferredCleanupEditsSameBase(
    [...subtreeEdits, ...lineEdits],
    snoozed.edits,
    snapshot,
  );
  const nextContent = applyDeferredCleanupEdits(snapshot, edits);
  const touchedEntryLines = deferredPomodoroCleanupTouchedEntryLines(
    touchedEntryOffsets,
    edits,
    nextContent,
  );
  return Object.freeze({
    content: nextContent,
    changed: nextContent !== String(snapshot || ""),
    // Counts removed dedicated bullets, not text-splice operations — adjacent
    // bullets can merge into one contiguous edit above.
    removedBulletCount: Math.max(
      0,
      Math.floor(Number(config.removedBulletCount) || 0),
    ),
    removedLinkCount: matches.length,
    removedTargets: Object.freeze(
      list.filter((target) =>
        removedTargetKeys.has(
          `${normalizeVaultRelativePath(target.path)}\x00${target.blockId}`,
        ),
      ),
    ),
    removedLineRanges: Object.freeze(
      subtreeEdits.map((edit) =>
        Object.freeze({
          startLine: edit.startLine,
          endLineExclusive: edit.endLineExclusive,
        }),
      ),
    ),
    removedEntryCount: Math.max(
      0,
      Math.floor(Number(config.removedEntryCount) || 0),
    ),
    touchedEntryLines: Object.freeze(touchedEntryLines),
    unresolvedCount: Math.max(
      0,
      Math.floor(Number(config.unresolvedCount) || 0),
    ),
    snoozedChanged: snoozed.edits.length > 0,
    removedSnoozedIdentities: snoozed.removedSnoozedIdentities,
    removedSnoozedLineRanges: snoozed.removedSnoozedLineRanges,
    snoozedSectionRemoved: snoozed.snoozedSectionRemoved,
  });
}

// Combined removed-line ranges across both passes, sorted by start line for
// cursor mapping that stops at the first range past the cursor.
function deferredCleanupAllRemovedRanges(plan) {
  const combined = [];
  if (!plan || typeof plan !== "object") {
    return combined;
  }
  for (const key of ["removedLineRanges", "removedSnoozedLineRanges"]) {
    const ranges = plan[key];
    if (!Array.isArray(ranges)) {
      continue;
    }
    for (const range of ranges) {
      if (range && Number.isInteger(range.startLine)) {
        combined.push(range);
      }
    }
  }
  combined.sort(
    (left, right) =>
      left.startLine - right.startLine ||
      (Number.isInteger(left.endLineExclusive) ? left.endLineExclusive : left.startLine) -
        (Number.isInteger(right.endLineExclusive) ? right.endLineExclusive : right.startLine),
  );
  return combined;
}

// Find the parsed active Snoozed row covering a zero-based cursor line,
// including its child subtree lines. Returns null outside an active row, so
// history and malformed rows never enter the Alt+N lane transaction.
function discoverSnoozedRowLaneTarget(content, line) {
  const text = String(content || "");
  const targetLine = Math.floor(Number(line));
  if (!Number.isInteger(targetLine) || targetLine < 0) {
    return null;
  }
  let section = null;
  try {
    section = snoozeParseSection(text);
  } catch (_) {
    section = null;
  }
  if (!section || !Array.isArray(section.rows)) {
    return null;
  }
  const row = section.rows.find(
    (entry) =>
      entry &&
      entry.kind === "active" &&
      entry.blockId &&
      targetLine >= entry.lineIndex &&
      targetLine < entry.childrenEnd,
  );
  if (!row) {
    return null;
  }
  const source = splitMarkdownContent(text);
  const rawLine = String(source.lines[targetLine] || "");
  return Object.freeze({
    row,
    discovery: Object.freeze({
      valid: true,
      error: null,
      notLink: false,
      explicit: false,
      kind: "task-link",
      startLine: targetLine,
      requestedAdditionalCount: 0,
      requestedCount: 1,
      actualCount: 1,
      clamped: false,
      targets: Object.freeze([
        Object.freeze({
          line: targetLine,
          rawLine,
          link: Object.freeze({
            target: String(row.target || ""),
            blockId: row.blockId,
            embedded: row.embedded === true,
            struck: false,
          }),
        }),
      ]),
    }),
  });
}

// Alt+N entry for a parsed active Snoozed row: resolve the row's task
// through the existing link release transaction, removing the row and its
// subtree through the composed daily cleanup. Like Task Link mode this never
// matches a landing: settle without advancing before going there. Returns
// `{ handled: false }` outside an active row so the caller falls through to
// its own not-on-a-task notice.
async function toggleTaskLaneOnSnoozedRow(
  plugin,
  cm,
  cursor,
  content,
  options,
  settleLaneReview,
) {
  const unhandled = Object.freeze({ handled: false, ok: false });
  const found = discoverSnoozedRowLaneTarget(content, cursor.line);
  if (!found) {
    return unhandled;
  }
  if (!plugin || typeof plugin.toggleTaskLaneOnLinks !== "function") {
    return unhandled;
  }
  if (typeof settleLaneReview === "function") {
    settleLaneReview(null);
  }
  const source = options && typeof options === "object" ? options : {};
  const ok = await plugin.toggleTaskLaneOnLinks(cm, cursor, content, {
    countExplicit: false,
    additionalTaskCount: 0,
    linkDiscovery: found.discovery,
    snoozedRowBlockId: found.row.blockId,
    summary: source.summary,
    dateText: source.dateText,
    stampText: source.stampText,
    now: source.now,
    skipReleasePrompt: source.skipReleasePrompt,
  });
  return Object.freeze({ handled: true, ok: ok === true });
}

// Lines removed at or before a zero-based cursor line across both passes.
// Offset-based callers (same-file cursor repair, agreement mapping) must use
// this instead of `removedLineRanges` alone once Snoozed rows compose into
// the plan.
function deferredCleanupRemovedLinesBefore(plan, line) {
  if (!plan || !Number.isInteger(line)) {
    return 0;
  }
  let total = 0;
  for (const key of ["removedLineRanges", "removedSnoozedLineRanges"]) {
    const ranges = plan[key];
    if (!Array.isArray(ranges)) {
      continue;
    }
    for (const range of ranges) {
      if (!range || !Number.isInteger(range.startLine)) {
        continue;
      }
      const endExclusive = Number.isInteger(range.endLineExclusive)
        ? range.endLineExclusive
        : range.startLine;
      if (endExclusive <= line) {
        total += Math.max(0, endExclusive - range.startLine);
      }
    }
  }
  return total;
}
