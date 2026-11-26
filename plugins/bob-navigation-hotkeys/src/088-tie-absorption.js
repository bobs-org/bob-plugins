// Tie absorption for the dependency writers (`docs/task-relations.md` §22).
// `tieAbsorptionLinkDeltas` plans the LINKS drops plus LINKED FROM courtesy
// drops for dependency adds; `absorbTieSideFromContent` /
// `absorbTiePairsFromContents` fold them (same-note transaction), and
// `applyTieLinksFollowUps` writes cross-note follow-ups after the commit
// through the existing follow-up machinery shape. Notice helpers name what
// was replaced and what reconcile must fold.

// LINKS drops plus LINKED FROM courtesy drops for dependency adds. Pure:
// returns per-note deltas the writers fold (same-note) or follow up
// (cross-note). Malformed lines are reported per note, never thrown.
function tieAbsorptionLinkDeltas(args = {}) {
  const pairs = Array.isArray(args.pairs) ? args.pairs : [];
  const notes = tieNotesMap(args.notes);
  const resolveLinkpath =
    typeof args.resolveLinkpath === "function" ? args.resolveLinkpath : null;
  const deltas = [];
  const mirrors = [];
  const byNote = new Map();
  const deltaFor = (path, blockId, line) => {
    const key = `${path}\x00${blockId}`;
    if (!byNote.has(key)) {
      const delta = { path, blockId, line, drops: [], adds: [] };
      byNote.set(key, delta);
      deltas.push(delta);
    }
    return byNote.get(key);
  };
  for (const pair of pairs) {
    const owner = tieNormalizeRef(pair && pair.owner);
    const other = tieNormalizeRef(pair && pair.other);
    if (!owner || !other) {
      continue;
    }
    const ownerFound = tieFindTaskLine(notes, owner.path, owner.blockId);
    const otherFound = tieFindTaskLine(notes, other.path, other.blockId);
    if (!ownerFound.reason) {
      const ownerDrops = tiePlainDropsForCounterpart(
        ownerFound.lines,
        ownerFound.line,
        owner.path,
        other,
        resolveLinkpath,
      );
      if (ownerDrops.drops.length > 0 || ownerDrops.malformed) {
        const delta = deltaFor(owner.path, owner.blockId, ownerFound.line);
        for (const drop of ownerDrops.drops) {
          delta.drops.push(drop);
        }
        if (ownerDrops.malformed && !delta.malformed) {
          delta.malformed = ownerDrops.malformed;
        }
      }
      const ownerMirrors = tieMirrorDropsForCounterpart(
        ownerFound.lines,
        ownerFound.line,
        owner.path,
        other,
        resolveLinkpath,
      );
      if (ownerMirrors.drops.length > 0 || ownerMirrors.malformed) {
        mirrors.push(Object.freeze({
          path: owner.path,
          blockId: owner.blockId,
          line: ownerFound.line,
          remove: Object.freeze(ownerMirrors.drops.slice()),
          malformed: ownerMirrors.malformed || null,
        }));
      }
    }
    if (!otherFound.reason) {
      const otherDrops = tiePlainDropsForCounterpart(
        otherFound.lines,
        otherFound.line,
        other.path,
        owner,
        resolveLinkpath,
      );
      if (otherDrops.drops.length > 0 || otherDrops.malformed) {
        const delta = deltaFor(other.path, other.blockId, otherFound.line);
        for (const drop of otherDrops.drops) {
          delta.drops.push(drop);
        }
        if (otherDrops.malformed && !delta.malformed) {
          delta.malformed = otherDrops.malformed;
        }
      }
      const otherMirrors = tieMirrorDropsForCounterpart(
        otherFound.lines,
        otherFound.line,
        other.path,
        owner,
        resolveLinkpath,
      );
      if (otherMirrors.drops.length > 0 || otherMirrors.malformed) {
        mirrors.push(Object.freeze({
          path: other.path,
          blockId: other.blockId,
          line: otherFound.line,
          remove: Object.freeze(otherMirrors.drops.slice()),
          malformed: otherMirrors.malformed || null,
        }));
      }
    }
  }
  return Object.freeze({
    deltas: Object.freeze(
      deltas.map((delta) => Object.freeze({
        path: delta.path,
        blockId: delta.blockId,
        line: delta.line,
        drops: Object.freeze(delta.drops.slice()),
        adds: Object.freeze([]),
        malformed: delta.malformed || null,
      })),
    ),
    mirrors: Object.freeze(mirrors),
  });
}

// Plain entries on the task's LINKS lines resolving to the counterpart.
function tiePlainDropsForCounterpart(lines, taskLine, ownerPath, counterpart, resolveLinkpath) {
  const drops = [];
  try {
    const children = findLinksChildren(lines, taskLine);
    const parsed = children.map((index) =>
      parseLinksLine(String(lines[index] || ""), { isDirectChildOfTask: true }),
    );
    if (parsed.some((entry) => entry && entry.verdict === "malformed")) {
      return { drops, malformed: "malformed-links-line" };
    }
    for (const entry of parsed) {
      if (!entry || entry.verdict !== "accept") {
        continue;
      }
      for (const link of entry.entries || []) {
        if (link.label) {
          continue;
        }
        const targetPath = dependencyPathForLinkNote(link.note, ownerPath, resolveLinkpath);
        if (!targetPath) {
          continue;
        }
        if (
          normalizeVaultRelativePath(targetPath) === counterpart.path &&
          normalizeBulletPropertyValue(link.blockId) === counterpart.blockId
        ) {
          drops.push(Object.freeze({ note: link.note, blockId: link.blockId }));
        }
      }
    }
  } catch (_error) {
    return { drops, malformed: "plan-failed" };
  }
  return { drops, malformed: null };
}

// Shared writability for tie absorption across the dependency writers:
// done/ archives and the previous daily note never take machine writes
// (contract §22 protected history), matching the follow-up machinery.
function tieNavNoteIsWritable(plugin, today) {
  let previousDaily = null;
  try {
    const vaultFiles =
      plugin && typeof plugin.readDependencyVaultFileList === "function"
        ? plugin.readDependencyVaultFileList()
        : [];
    const paths = (Array.isArray(vaultFiles) ? vaultFiles : []).map((entry) =>
      entry && typeof entry === "object" ? entry.path : entry,
    );
    const daily = scheduledRecoveryDailyPaths(
      paths.map((path) => ({ path })),
      today instanceof Date ? today : new Date(),
    );
    previousDaily = daily && daily.previous;
  } catch (_error) {
    previousDaily = null;
  }
  return (path) => relationPathIsWritable(path, previousDaily);
}

// Writer-side absorption: apply one task side to note content. Drops the
// task's plain LINKS entries for the counterpart (byte-exact) plus the
// unlabelled LINKED FROM mirror entries, deleting lines left with no
// entries. Never throws: malformed lines skip that part and are reported.
function absorbTieSideFromContent(content, taskLine, counterpart, ctx = {}) {
  const ownerPath = normalizeVaultRelativePath((ctx && ctx.ownerPath) || "");
  const resolveLinkpath =
    ctx && typeof ctx.resolveLinkpath === "function" ? ctx.resolveLinkpath : null;
  const text = String(content || "");
  const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
  let lines = text.split(/\r?\n/);
  let dropped = 0;
  let mirrorDropped = 0;
  const skipped = [];
  const counterpartIdentity = blocksIdentity(counterpart.path, counterpart.blockId);
  const isCounterpart = (note, blockId) => {
    let targetPath = null;
    try {
      targetPath = dependencyPathForLinkNote(note, ownerPath, resolveLinkpath);
    } catch (_error) {
      return false;
    }
    if (!targetPath) {
      return false;
    }
    return (
      normalizeVaultRelativePath(targetPath) === counterpart.path &&
      normalizeBulletPropertyValue(blockId) === counterpart.blockId
    );
  };
  if (
    !Number.isInteger(taskLine) ||
    taskLine < 0 ||
    taskLine >= lines.length ||
    !isObsidianTaskAtLine(lines.join(lineEnding), taskLine)
  ) {
    return { nextContent: text, dropped, mirrorDropped, skipped: ["not-a-task"] };
  }
  const linkChildren = findLinksChildren(lines, taskLine);
  const linkParsed = linkChildren.map((index) =>
    parseLinksLine(String(lines[index] || ""), { isDirectChildOfTask: true }),
  );
  if (linkParsed.some((entry) => entry && entry.verdict === "malformed")) {
    skipped.push("malformed-links-line");
  } else {
    const replacements = [];
    const deletions = [];
    for (let cursor = 0; cursor < linkChildren.length; cursor += 1) {
      const lineIndex = linkChildren[cursor];
      const outcome = dropPlainLinkEntries(
        String(lines[lineIndex] || ""),
        (entry) => isCounterpart(entry.target, entry.blockId),
      );
      if (outcome.outcome === "malformed") {
        skipped.push("malformed-links-line");
        break;
      }
      if (outcome.outcome === "rewritten") {
        replacements.push({ lineIndex, text: outcome.line });
        dropped += outcome.removed.length;
      } else if (outcome.outcome === "delete-line") {
        deletions.push(lineIndex);
        dropped += outcome.removed.length;
      }
    }
    if (skipped.length === 0) {
      for (const deletion of deletions) {
        lines[deletion] = null;
      }
      lines = lines.filter((line) => line !== null);
      for (const replacement of replacements) {
        const shift = deletions.filter((at) => at < replacement.lineIndex).length;
        lines[replacement.lineIndex - shift] = replacement.text;
      }
    }
  }
  if (skipped.length === 0) {
    const working = lines.join(lineEnding);
    const workingLines = working.split(/\r?\n/);
    const mirrorChildren = findLinkedFromChildren(workingLines, taskLine);
    const mirrorParsed = mirrorChildren.map((index) =>
      parseLinkedFromLine(String(workingLines[index] || ""), { isDirectChildOfTask: true }),
    );
    if (mirrorParsed.some((entry) => entry && entry.verdict === "malformed")) {
      skipped.push("malformed-linked-from-line");
    } else {
      const desired = [];
      let excluded = 0;
      for (const entry of mirrorParsed) {
        if (!entry || entry.verdict !== "accept") {
          continue;
        }
        for (const link of entry.entries || []) {
          if (
            !link.label &&
            isCounterpart(link.note, link.blockId) &&
            blocksIdentity(
              dependencyPathForLinkNote(link.note, ownerPath, resolveLinkpath) || "",
              link.blockId,
            ) === counterpartIdentity
          ) {
            excluded += 1;
            continue;
          }
          desired.push({
            link: relationLinkText({ note: link.note, blockId: link.blockId }),
            label: link.label || null,
          });
        }
      }
      if (excluded > 0) {
        const planned = planLinkedFromLine(working, taskLine, desired);
        if (!planned.ok) {
          skipped.push("mirror-plan-failed");
        } else {
          lines = String(planned.nextContent).split(/\r?\n/);
          mirrorDropped = excluded;
        }
      }
    }
  }
  return {
    nextContent: lines.join(lineEnding),
    dropped,
    mirrorDropped,
    skipped,
  };
}

// Unlabelled LINKED FROM mirror entries for the counterpart (generated
// mirrors of the plain links being absorbed; labelled mirrors stay).
function tieMirrorDropsForCounterpart(lines, taskLine, ownerPath, counterpart, resolveLinkpath) {
  const drops = [];
  try {
    const children = findLinkedFromChildren(lines, taskLine);
    const parsed = children.map((index) =>
      parseLinkedFromLine(String(lines[index] || ""), { isDirectChildOfTask: true }),
    );
    if (parsed.some((entry) => entry && entry.verdict === "malformed")) {
      return { drops, malformed: "malformed-linked-from-line" };
    }
    for (const entry of parsed) {
      if (!entry || entry.verdict !== "accept") {
        continue;
      }
      for (const link of entry.entries || []) {
        if (link.label) {
          continue;
        }
        const targetPath = dependencyPathForLinkNote(link.note, ownerPath, resolveLinkpath);
        if (!targetPath) {
          continue;
        }
        if (
          normalizeVaultRelativePath(targetPath) === counterpart.path &&
          normalizeBulletPropertyValue(link.blockId) === counterpart.blockId
        ) {
          drops.push(blocksIdentity(targetPath, link.blockId));
        }
      }
    }
  } catch (_error) {
    return { drops, malformed: "plan-failed" };
  }
  return { drops, malformed: null };
}

// Apply dependency-add absorption pairs to a contents map. Each pair's two
// sides (owner task drops plain-for-other, other task drops plain-for-owner,
// plus LINKED FROM courtesy) fold into that note's next content. Sides on
// unwritable notes, closed tasks, or missing/duplicate/malformed lines skip
// with a reason; reconcile folds leftovers. Returns the changed notes plus
// counts. Never throws.
function absorbTiePairsFromContents(args = {}) {
  const contents = tieNotesMap(args.contents);
  const pairs = Array.isArray(args.pairs) ? args.pairs : [];
  const resolveLinkpath =
    typeof args.resolveLinkpath === "function" ? args.resolveLinkpath : null;
  const isWritable =
    typeof args.isWritable === "function"
      ? args.isWritable
      : (path) => !isDoneArchivePath(path);
  const next = new Map(contents);
  let dropped = 0;
  let mirrorDropped = 0;
  const skipped = [];
  // Follow-ups carry whole pairs but write one note: `paths` scopes the
  // sides to the notes being written, skipping other sides silently.
  const scoped =
    args.paths instanceof Set
      ? args.paths
      : Array.isArray(args.paths)
        ? new Set(args.paths.map((path) => normalizeVaultRelativePath(path)))
        : null;
  const sides = [];
  const sideRef = (ref) => {
    if (!ref || typeof ref !== "object") {
      return null;
    }
    const path = normalizeVaultRelativePath(ref.path);
    const blockId = normalizeBulletPropertyValue(ref.blockId);
    const line = Number.isInteger(ref.line) ? ref.line : null;
    if (!path || (!blockId && line === null)) {
      return null;
    }
    return Object.freeze({ path, blockId: blockId || "", line });
  };
  for (const pair of pairs) {
    const owner = sideRef(pair && pair.owner);
    const other = sideRef(pair && pair.other);
    if (!owner || !other || !other.blockId) {
      continue;
    }
    if (!scoped || scoped.has(owner.path)) {
      sides.push({
        path: owner.path,
        blockId: owner.blockId,
        line: owner.line,
        counterpart: other,
      });
    }
    if (!scoped || scoped.has(other.path)) {
      sides.push({
        path: other.path,
        blockId: other.blockId,
        line: other.line,
        counterpart: owner,
      });
    }
  }
  for (const side of sides) {
    const current = next.get(side.path);
    if (typeof current !== "string") {
      skipped.push(
        Object.freeze({ path: side.path, reason: "note-unavailable" }),
      );
      continue;
    }
    let writable = false;
    try {
      writable = isWritable(side.path) === true;
    } catch (_error) {
      writable = false;
    }
    if (!writable) {
      skipped.push(Object.freeze({ path: side.path, reason: "note-not-writable" }));
      continue;
    }
    let taskLine = side.line;
    if (!Number.isInteger(taskLine)) {
      const found = tieFindTaskLine(next, side.path, side.blockId);
      if (found.reason) {
        skipped.push(Object.freeze({ path: side.path, reason: found.reason }));
        continue;
      }
      taskLine = found.line;
    }
    const status = tieTaskStatus(String(current).split(/\r?\n/), taskLine);
    if (status !== null && !OPEN_OBSIDIAN_TASK_STATUSES.has(status)) {
      skipped.push(Object.freeze({ path: side.path, reason: "task-closed" }));
      continue;
    }
    let applied = null;
    try {
      applied = absorbTieSideFromContent(current, taskLine, side.counterpart, {
        ownerPath: side.path,
        resolveLinkpath,
      });
    } catch (_error) {
      skipped.push(Object.freeze({ path: side.path, reason: "plan-failed" }));
      continue;
    }
    if (applied.nextContent !== current) {
      next.set(side.path, applied.nextContent);
    }
    dropped += applied.dropped;
    mirrorDropped += applied.mirrorDropped;
    for (const reason of applied.skipped) {
      skipped.push(Object.freeze({ path: side.path, reason }));
    }
  }
  const changed = [...next]
    .filter(([path, content]) => content !== contents.get(path))
    .map(([path]) => path);
  return Object.freeze({
    contents: next,
    changed: Object.freeze(changed),
    dropped,
    mirrorDropped,
    skipped: Object.freeze(skipped),
  });
}

// Cross-note absorption follow-ups, applied after the dependency commit
// through the existing follow-up machinery shape (preimage-checked,
// editor-or-vault writes, best-effort with a failed list). Each entry is
// `{path, preimage, pairs: [{owner, other}]}`; `io` supplies the app plus
// the linkpath resolver. A leftover plain link is folded by reconcile.
async function applyTieLinksFollowUps(args = {}) {
  const app = args.app || null;
  const followUps = Array.isArray(args.followUps) ? args.followUps : [];
  const resolveLinkpath =
    typeof args.resolveLinkpath === "function" ? args.resolveLinkpath : null;
  const isWritable =
    typeof args.isWritable === "function"
      ? args.isWritable
      : (path) => !isDoneArchivePath(path);
  const failed = new Set();
  let dropped = 0;
  let mirrorDropped = 0;
  if (followUps.length === 0) {
    return Object.freeze({
      ok: true,
      failed: Object.freeze([]),
      dropped: 0,
      mirrorDropped: 0,
    });
  }
  const vault = app && app.vault;
  const workspace = app && app.workspace;
  const findEditor = (path) => {
    try {
      if (!workspace || typeof workspace.getLeavesOfType !== "function") {
        return null;
      }
      for (const leaf of workspace.getLeavesOfType("markdown") || []) {
        const view = leaf && leaf.view;
        if (
          view &&
          view.file &&
          normalizeVaultRelativePath(view.file.path) === path &&
          view.editor &&
          typeof view.editor.getValue === "function"
        ) {
          return view.editor;
        }
      }
    } catch (_error) {
      return null;
    }
    return null;
  };
  for (const entry of followUps) {
    const path = normalizeVaultRelativePath((entry && entry.path) || "");
    const preimage = entry && typeof entry.preimage === "string" ? entry.preimage : null;
    const pairs = entry && Array.isArray(entry.pairs) ? entry.pairs : [];
    if (!path || preimage === null || pairs.length === 0) {
      if (path) {
        failed.add(path);
      }
      continue;
    }
    let writable = false;
    try {
      writable = isWritable(path) === true;
    } catch (_error) {
      writable = false;
    }
    if (!writable) {
      failed.add(path);
      continue;
    }
    const editor = findEditor(path);
    let current = null;
    if (editor) {
      current = String(editor.getValue() || "");
    } else {
      try {
        const file = vault && typeof vault.getAbstractFileByPath === "function"
          ? vault.getAbstractFileByPath(path)
          : null;
        if (file && vault && typeof vault.cachedRead === "function") {
          current = String(await vault.cachedRead(file));
        } else if (file && vault && typeof vault.read === "function") {
          current = String(await vault.read(file));
        }
      } catch (_error) {
        current = null;
      }
    }
    if (current === null || current !== preimage) {
      failed.add(path);
      continue;
    }
    let applied = null;
    try {
      applied = absorbTiePairsFromContents({
        contents: new Map([[path, current]]),
        pairs,
        paths: [path],
        resolveLinkpath,
        isWritable,
      });
    } catch (_error) {
      failed.add(path);
      continue;
    }
    if (applied.skipped.length > 0) {
      failed.add(path);
      continue;
    }
    const nextContent = applied.contents.get(path) || current;
    if (nextContent === current) {
      dropped += applied.dropped;
      mirrorDropped += applied.mirrorDropped;
      continue;
    }
    dropped += applied.dropped;
    mirrorDropped += applied.mirrorDropped;
    if (editor) {
      let committed = false;
      try {
        committed =
          String(editor.getValue() || "") === preimage &&
          applyEditorContentTransaction(
            editor,
            preimage,
            nextContent,
            null,
            RELATIONS_MACHINE_WRITE_ANNOTATION,
          );
      } catch (_error) {
        committed = false;
      }
      if (!committed) {
        failed.add(path);
      }
      continue;
    }
    try {
      const file = vault && typeof vault.getAbstractFileByPath === "function"
        ? vault.getAbstractFileByPath(path)
        : null;
      if (!file || !vault || typeof vault.process !== "function") {
        failed.add(path);
        continue;
      }
      let wrote = false;
      await vault.process(file, (data) => {
        if (String(data || "") !== preimage) {
          return data;
        }
        wrote = true;
        return nextContent;
      });
      if (!wrote) {
        failed.add(path);
      }
    } catch (_error) {
      failed.add(path);
    }
  }
  return Object.freeze({
    ok: failed.size === 0,
    failed: Object.freeze([...failed]),
    dropped,
    mirrorDropped,
  });
}

// Notice segments for absorbed ties (`docs/task-dependencies.md` §6.7/§15.7):
// `· replaced the 🪢 link` when a drop landed, and the honest failure
// suffix when a needed drop did not.
function withTieAbsorptionNotice(notice, absorbed) {
  if (!notice) {
    return notice;
  }
  const count =
    (absorbed && Number.isInteger(absorbed.dropped) ? absorbed.dropped : 0) +
    (absorbed && Number.isInteger(absorbed.mirrorDropped) ? absorbed.mirrorDropped : 0);
  if (count <= 0) {
    return notice;
  }
  return `${notice} · replaced the 🪢 link`;
}

function withTieAbsorptionFailureSuffix(notice, failed) {
  const count = Array.isArray(failed)
    ? failed.length
    : failed && Number.isInteger(failed.length)
      ? failed.length
      : failed
        ? 1
        : 0;
  if (count <= 0 || !notice) {
    return notice;
  }
  return `${notice} · 🪢 link not removed (reconcile will fold it)`;
}
