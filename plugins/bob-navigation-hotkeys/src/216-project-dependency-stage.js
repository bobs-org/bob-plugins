// Ctrl+Shift+P Depends on side effects for `^prj` (nav-deps-stage,
// `docs/task-dependencies.md` §13.10): the ordinary Depends-On writer also
// blocks, tags, and unlinks residents with commitment transfer, and removal
// recovers them with `[unblocked::]`. Same-note and cycle guards, api routes,
// and notices live here alongside the writer so every entry point (stage,
// Ctrl+D, counted sessions, api v3) shares one recognition rule.

function getProjectPrjDependencyResidents(text, notePath) {
  const content = String(text || "");
  const path = normalizeVaultRelativePath(notePath);
  if (!path || canonicalRecoveryDailyDate(path)) {
    return null;
  }
  const recognition = readProjectFrontmatterRecognition(content);
  if (!recognition.isProjectType) {
    return null;
  }
  if (PROJECT_TERMINAL_STATUSES.has(recognition.status)) {
    return null;
  }
  const rows = collectProjectNoteTaskRows(content);
  if (rows.prj.length !== 1) {
    return null;
  }
  return Object.freeze({
    path,
    prjLine: rows.prj[0].line,
    prjStatus: rows.prj[0].status,
    residents: rows.residents,
  });
}

function isProjectPrjDependencyParent(content, parentPath, parentLine) {
  const { lines } = splitMarkdownContent(String(content || ""));
  const at = Math.floor(numericOrDefault(parentLine, Number.NaN));
  if (!Number.isFinite(at) || at < 0 || at >= lines.length) {
    return null;
  }
  if (!isProjectLifecycleTaskLine(lines[at])) {
    return null;
  }
  const info = getProjectPrjDependencyResidents(content, parentPath);
  if (!info || info.prjLine !== at) {
    return null;
  }
  return info;
}

function isSameNoteDependencyTargetRef(ref, parentPath) {
  const target = normalizeDependencyTargetRef(ref);
  const parent = normalizeVaultRelativePath(parentPath);
  return !target.path || target.path === parent;
}

// Strongest lane across the given checkbox statuses for commitment
// transfer (Design §5 Lanes): In Progress beats Next beats Ready/Blocked.
// Returns "/" or "*" when a lane is present, else null.
function strongestDependencyPromotionLane(statuses) {
  let star = false;
  for (const status of Array.isArray(statuses) ? statuses : []) {
    if (status === "/") {
      return "/";
    }
    if (status === "*") {
      star = true;
    }
  }
  return star ? "*" : null;
}

// One resident line blocked and tagged for the `^prj` add path
// (§13.10, PDT1): every open resident goes `[?]` with exactly one
// `#prj_is_blocked`. Already-`[?]` residents keep their status and only
// gain the tag. Closed lines are never touched (PDT7): callers pass the
// open-only resident rows from `collectProjectNoteTaskRows`.
function blockProjectResidentLine(lineText) {
  const text = String(lineText || "");
  return setProjectBlockedTag(blockObsidianTaskCheckboxStatus(text), true);
}

// Recover one resident line through the gate once `^prj`'s last reason
// clears. The tag always comes off — even when the resident keeps its own
// Blocked state (PDB3, PDT2). A Ready recovery additionally writes
// `[unblocked::]` through the freshness writer (Design §4); recoveries
// into a lane skip the field. Returns `{line, recovered, ready}`.
function recoverProjectResidentLine(lineText, metadata, options = {}) {
  const text = String(lineText || "");
  const untagged = setProjectBlockedTag(text, false);
  if (getObsidianTaskCheckboxStatus(text) !== "?") {
    return Object.freeze({ line: untagged, recovered: false, ready: false });
  }
  // An own future schedule keeps the resident `[?]` (its own reason); the
  // project tag still comes off because the project itself is unblocked.
  if (
    dependencyParentHasFutureSchedule(
      text,
      options.today instanceof Date ? options.today : new Date(),
    )
  ) {
    return Object.freeze({ line: untagged, recovered: false, ready: false });
  }
  const reconciled = reconcileBlockedScheduledTaskLine(text, metadata, {
    today: options.today,
    ownLine: false,
    markUnblockedLine: options.markUnblockedLine,
    isDailyNote: options.isDailyNote === true,
    isToday: options.isToday === true,
  });
  if (
    reconciled.outcome === "ready" ||
    reconciled.outcome === "next" ||
    reconciled.outcome === "in-progress"
  ) {
    return Object.freeze({
      line: reconciled.line,
      recovered: true,
      ready: reconciled.outcome === "ready",
    });
  }
  return Object.freeze({ line: untagged, recovered: false, ready: false });
}

// Map an original line number through one plan's structural ops (deletes,
// then an insert; a replace holds its line), mirroring
// `applyDependencyPlanLines` so recovery evaluated on the preview applies
// to the final assembly at the same index.
function mapLineThroughStructural(line, structural) {
  const original = Math.floor(numericOrDefault(line, Number.NaN));
  if (!Number.isFinite(original) || original < 0) {
    return -1;
  }
  const deletes = structural && Array.isArray(structural.deleteLines)
    ? structural.deleteLines
    : [];
  let mapped = original;
  for (const deleted of deletes) {
    if (Number.isInteger(deleted) && deleted < original) {
      mapped -= 1;
    }
  }
  if (
    structural &&
    structural.insertAt !== null &&
    structural.insertAt !== undefined
  ) {
    let delta = structural.insertAt;
    for (const deleted of deletes) {
      if (Number.isInteger(deleted) && deleted < structural.insertAt) {
        delta -= 1;
      }
    }
    if (mapped >= delta) {
      mapped += 1;
    }
  }
  return mapped;
}

// Project notices (§13.10). `details` carries the planner summary shape:
// `{added, removed, blocked, recovered, pomodoroRemoved,
// pomodoroPruneFailed}` plus `firstAdded` / `firstRemoved` display names.
// The planner omits the Pomodoro counts (unknown until the daily-note
// write); the plugin writer rebuilds the notice with them.
function formatProjectDependencyNotice(details = {}) {
  const added = Math.max(0, Math.floor(numericOrDefault(details.added, 0)));
  const removed = Math.max(0, Math.floor(numericOrDefault(details.removed, 0)));
  const blocked = Math.max(0, Math.floor(numericOrDefault(details.blocked, 0)));
  const recovered = Math.max(
    0,
    Math.floor(numericOrDefault(details.recovered, 0)),
  );
  const pomodoroRemoved = details.pomodoroRemoved == null
    ? null
    : Math.max(0, Math.floor(numericOrDefault(details.pomodoroRemoved, 0)));
  const pomodoroPruneFailed = details.pomodoroPruneFailed === true;
  const firstAdded = String(details.firstAdded || "");
  const firstRemoved = String(details.firstRemoved || "");
  const pomodoroSuffix =
    pomodoroRemoved !== null && pomodoroRemoved > 0
      ? ` · removed ${formatCountLabel(pomodoroRemoved, "Pomodoro link")}`
      : pomodoroPruneFailed
        ? "; Pomodoro links not removed"
        : "";
  if (added > 0 && blocked > 0 && firstAdded) {
    return `⛓ Project waits on "${firstAdded}" · ${formatCountLabel(blocked, "task")} Blocked${pomodoroSuffix}`;
  }
  if (removed > 0 && added === 0 && recovered > 0 && firstRemoved) {
    return `⛓ Project no longer waits on "${firstRemoved}" · ${formatCountLabel(recovered, "task")} Ready again${pomodoroSuffix}`;
  }
  return null;
}

// Detect a project `^prj` edit for the writer. The hand-edit mirror keeps
// today's field behavior and leaves resident side effects to reconcile,
// so it never counts as a project edit.
function detectProjectPrjDependencyParent(args, content, parentPath, parentLine) {
  if (args && args.mirrorTouch === true) {
    return null;
  }
  return isProjectPrjDependencyParent(content, parentPath, parentLine);
}

// Dependency-graph row keys for every open resident of a `^prj` parent
// note that carries a block id (§13.10): adding `^prj → X` implicitly adds
// resident `→ X` for each one, so cycle guards must test those edges too.
// Returns a frozen array, empty when the parent is not a `^prj`.
function projectDependentResidentKeys(content, parentPath, parentLine) {
  const projectPrj = isProjectPrjDependencyParent(content, parentPath, parentLine)
    ? getProjectPrjDependencyResidents(content, parentPath)
    : null;
  if (!projectPrj) {
    return Object.freeze([]);
  }
  const path = normalizeVaultRelativePath(parentPath);
  const keys = [];
  for (const resident of projectPrj.residents) {
    if (!resident.blockId) {
      continue;
    }
    const key = dependencyStageRowKey(path, resident.blockId);
    if (key) {
      keys.push(key);
    }
  }
  return Object.freeze(keys);
}

// Refusal reason when the gesture adds a same-note target to `^prj`, or
// null when the adds are clean.
function failProjectPrjInternalAdd(
  projectPrj,
  add,
  parentPath,
  descendantPaths,
) {
  if (!projectPrj) {
    return null;
  }
  const internal = (Array.isArray(add) ? add : []).filter((ref) =>
    isSameNoteDependencyTargetRef(ref, parentPath),
  );
  if (internal.length > 0) {
    return "project-internal-target";
  }
  const descendants = new Set(
    (Array.isArray(descendantPaths) ? descendantPaths : []).map((path) =>
      normalizeVaultRelativePath(path),
    ),
  );
  if (descendants.size === 0) {
    return null;
  }
  const descendant = (Array.isArray(add) ? add : []).some((ref) => {
    const target = normalizeDependencyTargetRef(ref);
    const path = normalizeVaultRelativePath(target.path || "");
    return Boolean(path && descendants.has(path));
  });
  return descendant ? "project-descendant-target" : null;
}

// Kept-link rows comparable against the old `[dependsOn::]` field by
// position. On `^prj` the field never carries internal targets, so only
// cross-note links participate.
function filterProjectedExisting(projectPrj, existing, parentPath) {
  if (!projectPrj) {
    return existing;
  }
  return existing.filter((entry) => entry.path !== parentPath);
}

// Resolved rows projected into the field and counted as open reasons.
// Internal targets stay on the line only (§13.2, §13.6).
function projectResolvedTargets(projectPrj, resolved, parentPath) {
  if (!projectPrj) {
    return resolved;
  }
  return resolved.filter((row) => row.ref.path !== parentPath);
}

// §13.10 add path: every open resident goes `[?]` with exactly one
// `#prj_is_blocked`. Closed lines are never touched (PDT7): residents are
// open-only rows by construction. Returns `{edits, newlyBlocked}`.
function planProjectResidentBlockEdits(projectPrj, lines, addedOpen) {
  const edits = [];
  const newlyBlocked = [];
  if (projectPrj && Array.isArray(addedOpen) && addedOpen.length > 0) {
    for (const resident of projectPrj.residents) {
      const current = String(lines[resident.line] || "");
      const next = blockProjectResidentLine(current);
      if (next !== current) {
        edits.push(
          Object.freeze({ line: resident.line, from: current, text: next }),
        );
        if (getObsidianTaskCheckboxStatus(current) !== "?") {
          newlyBlocked.push(resident.line);
        }
      }
    }
  }
  return Object.freeze({
    edits: Object.freeze(edits),
    newlyBlocked: Object.freeze(newlyBlocked),
  });
}

// Resident checkbox statuses for commitment transfer (Design §5 Lanes),
// or null for ordinary dependents.
function projectPromotionLaneStatuses(projectPrj, lines) {
  if (!projectPrj) {
    return null;
  }
  return projectPrj.residents.map((resident) =>
    getObsidianTaskCheckboxStatus(String(lines[resident.line] || "")),
  );
}

// Resident block edits join the dependent's one transaction. A resident
// that is also a kept same-note target composes: the identity write lands
// first, then the block and tag.
function mergeProjectResidentBlockEdits(targetEdits, residentBlockEdits, parentPath) {
  const byLine = new Map(
    (Array.isArray(residentBlockEdits) ? residentBlockEdits : []).map(
      (edit) => [edit.line, edit],
    ),
  );
  const merged = (Array.isArray(targetEdits) ? targetEdits : [])
    .filter((edit) => edit.path === parentPath)
    .map((edit) => {
      if (!byLine.has(edit.line)) {
        return edit;
      }
      byLine.delete(edit.line);
      return Object.freeze({
        ...edit,
        text: blockProjectResidentLine(edit.text),
      });
    });
  for (const edit of byLine.values()) {
    merged.push(
      Object.freeze({
        path: parentPath,
        line: edit.line,
        from: edit.from,
        text: edit.text,
      }),
    );
  }
  return Object.freeze(merged);
}

// Whether `^prj`'s removal recovers residents through the gate: the last
// projected reason cleared and no future inline date remains.
function shouldRecoverProjectResidents(
  projectPrj,
  recovery,
  removedCount,
  fieldCleared,
  openRemaining,
  parentText,
  today,
) {
  return Boolean(
    projectPrj &&
      recovery &&
      recovery.registry &&
      (removedCount > 0 || fieldCleared) &&
      openRemaining === 0 &&
      !taskHasProjectBlockedTag(parentText) &&
      !dependencyParentHasFutureSchedule(parentText, today),
  );
}

// Recover every open resident through the gate. Evaluation reads the
// preview (post-structural) lines, but emitted edits carry ORIGINAL line
// numbers: the assembly applies same-note replacements before its
// structural ops. Returns `{edits, recovered, ready}`.
function recoverProjectResidents(
  projectPrj,
  lines,
  previewLines,
  recoveryIndex,
  parentPath,
  structural,
  today,
  markUnblockedLine,
  scopeFlags = {},
) {
  const edits = [];
  const recovered = [];
  const ready = [];
  const scope = scopeFlags && typeof scopeFlags === "object" ? scopeFlags : {};
  // The parent is a project note (never a daily note), but keep the
  // explicit override for callers that already know better.
  const isDailyNote = scope.isDailyNote === undefined
    ? Boolean(
        canonicalRecoveryDailyDate(normalizeVaultRelativePath(parentPath)),
      )
    : scope.isDailyNote === true;
  const isToday = scope.isToday === true;
  for (const resident of projectPrj.residents) {
    const previewLine = mapLineThroughStructural(resident.line, structural);
    if (previewLine < 0 || previewLine >= previewLines.length) {
      continue;
    }
    const current = String(previewLines[previewLine] || "");
    // Only tagged residents recover here (§13.10): an untagged resident was
    // never project-blocked, so its own `[?]` reasons are none of this
    // gesture's business.
    if (!taskHasProjectBlockedTag(current)) {
      continue;
    }
    const metadata = getScheduledRecoveryMetadata(
      recoveryIndex,
      parentPath,
      previewLine,
    );
    const result = recoverProjectResidentLine(current, metadata, {
      today,
      markUnblockedLine,
      isDailyNote,
      isToday,
    });
    if (result.line !== current) {
      edits.push(
        Object.freeze({
          line: resident.line,
          from: String(lines[resident.line] || ""),
          text: result.line,
        }),
      );
      if (
        getObsidianTaskCheckboxStatus(current) === "?" &&
        getObsidianTaskCheckboxStatus(result.line) !== "?"
      ) {
        recovered.push(resident.line);
        if (result.ready) {
          ready.push(resident.line);
        }
      }
    }
  }
  return Object.freeze({
    edits: Object.freeze(edits),
    recovered: Object.freeze(recovered),
    ready: Object.freeze(ready),
  });
}

// The plan summary's `project` block, or null for ordinary dependents.
// Pomodoro targets are stable `{path, blockId}` identities because block
// ids survive status and tag edits.
function summarizeProjectDependencyEdit(projectPrj, details = {}) {
  if (!projectPrj) {
    return null;
  }
  const lines = Array.isArray(details.lines) ? details.lines : [];
  const addedOpen = Array.isArray(details.addedOpen) ? details.addedOpen : [];
  const targets = [];
  if (addedOpen.length > 0) {
    if (getObsidianTaskCheckboxStatus(String(details.parentText || "")) === "?") {
      const prjBlockId = getTrailingBlockId(
        String(lines[details.parentIndex] || ""),
      );
      if (prjBlockId) {
        targets.push(
          Object.freeze({ path: projectPrj.path, blockId: prjBlockId }),
        );
      }
    }
    for (const resident of projectPrj.residents) {
      if (resident.blockId) {
        targets.push(
          Object.freeze({ path: projectPrj.path, blockId: resident.blockId }),
        );
      }
    }
  }
  return Object.freeze({
    blocked: (details.newlyBlocked || []).length,
    recovered: (details.recovered || []).length,
    ready: (details.ready || []).length,
    pomodoroTargets: Object.freeze(targets),
  });
}

// Plan the Pomodoro-link consumption for a project edit. Returns
// `{commitContent, snapshot, cleanup}`: the dependent note's content to
// commit (with the same-file cleanup folded in), plus the daily snapshot
// and cleanup for the writer's follow-up write. Never throws.
async function prepareProjectPomodoroCleanup(
  readSnapshot,
  plan,
  parentPath,
  content,
  today,
) {
  const empty = Object.freeze({
    commitContent: plan.nextContent,
    snapshot: null,
    cleanup: null,
  });
  const targets =
    plan && plan.summary && plan.summary.project
      ? plan.summary.project.pomodoroTargets || []
      : [];
  if (targets.length === 0 || typeof readSnapshot !== "function") {
    return empty;
  }
  let snapshot = null;
  try {
    snapshot = await readSnapshot({
      sourcePath: parentPath,
      sourceContent: content,
      today,
    });
  } catch (_snapshotError) {
    snapshot = null;
  }
  if (!snapshot) {
    return empty;
  }
  let cleanup = null;
  try {
    cleanup = planDeferredPomodoroLinkCleanup(
      snapshot.sameFile ? plan.nextContent : snapshot.content,
      targets,
      {
        dailyPath: snapshot.dailyPath,
        noteIndex: snapshot.noteIndex,
        removeEmptiedEntries: true,
      },
    );
  } catch (_cleanupError) {
    cleanup = null;
  }
  if (!cleanup || !cleanup.changed) {
    return Object.freeze({
      commitContent: plan.nextContent,
      snapshot,
      cleanup: null,
    });
  }
  if (snapshot.sameFile) {
    return Object.freeze({
      commitContent: cleanup.content,
      snapshot,
      cleanup,
    });
  }
  return Object.freeze({ commitContent: plan.nextContent, snapshot, cleanup });
}

// Complete the cross-note daily cleanup after the dependent's own write.
// A failure is reported, never rolled back. Returns `{removed, failed}`.
async function finishProjectPomodoroCleanup(writeCleanup, snapshot, cleanup) {
  if (!cleanup || !cleanup.changed || !snapshot) {
    return Object.freeze({ removed: 0, failed: false });
  }
  if (snapshot.sameFile) {
    return Object.freeze({ removed: cleanup.removedLinkCount, failed: false });
  }
  if (typeof writeCleanup !== "function") {
    return Object.freeze({ removed: 0, failed: false });
  }
  let written = false;
  try {
    written = await writeCleanup(snapshot, cleanup);
  } catch (_writeError) {
    written = false;
  }
  return written
    ? Object.freeze({ removed: cleanup.removedLinkCount, failed: false })
    : Object.freeze({ removed: 0, failed: true });
}

// Final writer notice with Pomodoro counts. Returns the notice string, or
// null when the plan carries no project flips (the caller keeps its own).
function projectPomodoroNotice(plan, removed, failed) {
  if (!plan || !plan.summary || !plan.summary.project) {
    return null;
  }
  const rebuilt = formatProjectDependencyNotice({
    added: plan.summary.added,
    removed: plan.summary.removed,
    blocked: plan.summary.project.blocked,
    recovered: plan.summary.project.recovered,
    firstAdded: (plan.added || [])[0],
    firstRemoved: (plan.removed || [])[0],
    pomodoroRemoved: removed,
    pomodoroPruneFailed: failed,
  });
  if (rebuilt) {
    return rebuilt;
  }
  if (removed > 0 || failed) {
    const suffix =
      removed > 0
        ? ` · removed ${formatCountLabel(removed, "Pomodoro link")}`
        : "; Pomodoro links not removed";
    return `${plan.notice || "⛓ Dependencies updated"}${suffix}`;
  }
  return null;
}

// Contract §6.7 notices for one dependency gesture.
function buildDependencyEditNotice(summary, names = {}) {
  const added = Math.max(0, summary.added || 0);
  const removed = Math.max(0, summary.removed || 0);
  const firstAdded = (names.added || [])[0];
  const firstRemoved = (names.removed || [])[0];
  const state = summary.blockedAfter
    ? `Blocked${summary.openRemaining > 0 ? ` (${summary.openRemaining} open)` : ""}`
    : summary.recoveredOutcome && summary.recoveredOutcome !== "still-blocked"
      ? "Ready again"
      : "Ready";
  if (added === 1 && removed === 0 && firstAdded) {
    return `⛓ Now waits on "${firstAdded}" · ${summary.blockedAfter ? "Blocked" : "Ready"}`;
  }
  if (added === 0 && removed === 1 && firstRemoved) {
    return `⛓ No longer waits on "${firstRemoved}" · ${summary.blockedAfter ? "Still blocked" : "Ready again"}`;
  }
  const parts = [];
  if (added > 0) {
    parts.push(`${added} added`);
  }
  if (removed > 0) {
    parts.push(`${removed} removed`);
  }
  if (parts.length === 0) {
    return `⛓ Dependencies updated · ${state}`;
  }
  return `⛓ ${parts.join(" · ")} · ${state}`;
}

// Build the notice for a local-task dependency write, distinguishing whether the
// `[dependsOn:: ...]` field was newly added vs already present and summarizing
// how the single managed navigation bullet changed.
function buildLocalTaskDependencyNotice(details = {}) {
  const id = normalizeBulletPropertyValue(details.id);
  const name = String(details.name || "");
  const dependencyText = details.dependencyAlreadyPresent
    ? `Already depends on ${id}`
    : `${name} → ${id}`;
  const navigationParts = [];

  switch (details.navigationResult) {
    case "added":
      navigationParts.push("added navigation link");
      break;
    case "updated":
      navigationParts.push("updated navigation bullet");
      break;
    case "already-present":
      navigationParts.push("navigation link already present");
      break;
    case "failed":
    case "guard-failed":
      return `${dependencyText} (could not add navigation link)`;
    default:
      break;
  }

  if (details.navigationConsolidated) {
    navigationParts.push("consolidated navigation bullet");
  }

  return navigationParts.length > 0
    ? `${dependencyText}; ${navigationParts.join("; ")}`
    : dependencyText;
}

// Notice entry for the writer: the project strings above when residents
// flipped, else today's generic dependency notice. `names` carries the
// planner's `added` / `removed` display-name arrays.
function buildDependencyEditNoticeWithProject(summary, names = {}) {
  const project = summary && summary.project;
  if (project && (project.blocked > 0 || project.recovered > 0)) {
    const notice = formatProjectDependencyNotice({
      added: summary.added,
      removed: summary.removed,
      blocked: project.blocked,
      recovered: project.recovered,
      firstAdded: (names.added || [])[0],
      firstRemoved: (names.removed || [])[0],
      pomodoroRemoved: null,
      pomodoroPruneFailed: false,
    });
    if (notice) {
      return notice;
    }
  }
  return buildDependencyEditNotice(summary, names);
}
