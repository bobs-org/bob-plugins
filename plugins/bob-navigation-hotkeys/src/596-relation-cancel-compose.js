// Relation-writer composition for §17 cancel labels. Preview/commit
// contract for bob-cli-dl.6: `summarizeRelationCancelEffects` over the
// same planner; pass `expectedCancelEffects` into `applyRelationEdit`.
// At commit the writer reloads config/date, re-plans over live snapshots,
// and compares consequences (identities, edge/label keys, verdicts, day).
// A mismatch returns `{ ok: false, stale: true, cancelEffects }` and
// writes nothing. Ordinary callers omit the expected summary and plan
// from current state.

function relocateRelationCancelSource(content, source, consumedLines) {
  if (!source || typeof content !== "string") return source;
  const lines = content.split(/\r?\n/);
  const consumed = consumedLines instanceof Set ? consumedLines : new Set();
  const blockId = normalizeBulletPropertyValue(source.blockId || "");
  if (blockId) {
    const found = findTaskLineByTrailingBlockId(lines, blockId);
    if (found !== null && !consumed.has(found)) {
      return Object.freeze({
        ...source,
        line: found,
        rawLine: String(lines[found] || source.rawLine || ""),
        blockId: getTrailingBlockId(lines[found]) || blockId,
      });
    }
  }
  const rawLine = String(source.rawLine || "");
  const matches = [];
  if (rawLine) {
    for (let index = 0; index < lines.length; index += 1) {
      if (consumed.has(index)) continue;
      if (
        lines[index] === rawLine &&
        isObsidianTaskAtLine(content, index)
      ) {
        matches.push(index);
      }
    }
  }
  if (matches.length === 1) {
    return Object.freeze({
      ...source,
      line: matches[0],
      rawLine: String(lines[matches[0]] || rawLine),
      blockId: getTrailingBlockId(lines[matches[0]]) || source.blockId || null,
    });
  }
  if (matches.length > 1) {
    const hint = Math.floor(numericOrDefault(source.line, 0));
    const best = matches.reduce((chosen, index) =>
      Math.abs(index - hint) < Math.abs(chosen - hint) ? index : chosen,
    );
    return Object.freeze({
      ...source,
      line: best,
      rawLine: String(lines[best] || rawLine),
      blockId: getTrailingBlockId(lines[best]) || source.blockId || null,
    });
  }
  return source;
}

function remapConsumedRelationCancelLines(consumedLines, insertAt, insertCount) {
  if (!(consumedLines instanceof Set) || !Number.isInteger(insertAt) || insertCount <= 0) {
    return consumedLines;
  }
  const next = new Set();
  for (const line of consumedLines) {
    next.add(line >= insertAt ? line + insertCount : line);
  }
  return next;
}

function relationCancelSourceStatus(rawLine) {
  return getObsidianTaskCheckboxStatus(String(rawLine || ""));
}

function formatRelationCancelCount(count, singular, plural) {
  const numeric = Math.max(0, Math.floor(numericOrDefault(count, 0)));
  if (numeric === 1) return `1 ${singular}`;
  return `${numeric} ${plural || `${singular}s`}`;
}

function relationCancelPolicySourceFromLine(source, rawLine, edges) {
  return {
    path: source && source.path,
    blockId:
      (source && source.blockId) || getTrailingBlockId(rawLine) || null,
    line: source && source.line,
    status: relationCancelSourceStatus(rawLine),
    isNew: false,
    isProject: isProjectLifecycleTaskLine(rawLine),
    isRecurring: isRecurringTaskLine(rawLine),
    itemModifiers: [],
    edges: Array.isArray(edges) ? edges : [],
  };
}

function composeRelationSourceCancel(details = {}) {
  const content = String(details.content || "");
  const source = details.source;
  const consumed =
    details.consumed instanceof Set ? details.consumed : new Set();
  const liveSource = relocateRelationCancelSource(content, source, consumed);
  const sourceLine = liveSource.line;
  const rawLine = String(
    content.split(/\r?\n/)[sourceLine] || liveSource.rawLine || "",
  );
  const policy = planRelationCancelEffects({
    cancelLabels: details.cancelLabels,
    trigger: details.trigger || RELATION_CANCEL_EXPLICIT_TRIGGER,
    sources: [relationCancelPolicySourceFromLine(liveSource, rawLine, details.edges)],
  });
  const planned = policy.sources[0] || null;
  if (!planned || !planned.cancels) {
    return Object.freeze({
      ok: true,
      content,
      planned,
      identity: null,
      noticeRow: null,
      consumed,
      sourceLine,
    });
  }
  const session = Object.freeze({
    valid: true,
    error: null,
    explicit: false,
    startLine: sourceLine,
    requestedAdditionalCount: 0,
    requestedCount: 1,
    actualCount: 1,
    clamped: false,
    targets: Object.freeze([{ line: sourceLine, rawLine }]),
  });
  const batch = planTaskCancelBatch(content, session, {
    date: details.cancelDate,
    reason: "",
    fallbackReason: planned.fallbackReason,
  });
  if (!batch.valid) {
    return Object.freeze({
      ok: false,
      reason: batch.error,
      recurring: batch.recurring === true,
      planned,
      content,
      consumed,
      sourceLine,
    });
  }
  const insertCount =
    batch.content.split(/\r?\n/).length - content.split(/\r?\n/).length;
  let nextConsumed = consumed;
  if (insertCount > 0) {
    nextConsumed = remapConsumedRelationCancelLines(
      consumed,
      sourceLine + 1,
      insertCount,
    );
  }
  nextConsumed.add(sourceLine);
  const cancelled = (batch.cancelled || [])[0];
  const triggering = planned.triggeringEdges[0] || {};
  return Object.freeze({
    ok: true,
    content: batch.content,
    planned,
    identity: Object.freeze({
      path: liveSource.path,
      blockId:
        (cancelled && cancelled.blockId) ||
        getTrailingBlockId(String(batch.content.split(/\r?\n/)[sourceLine] || "")) ||
        liveSource.blockId ||
        null,
      taskId: (cancelled && cancelled.taskId) || null,
    }),
    noticeRow: Object.freeze({
      sourceName:
        liveSource.description || relationNoticeNameFromLine(rawLine) || "task",
      targetName: details.targetName || "task",
      label: triggering.label || triggering.displayLabel || "",
    }),
    consumed: nextConsumed,
    sourceLine,
  });
}

function foldRelationCancelDailyCleanup(sourceWrites, identities, snapshot) {
  if (!snapshot || !Array.isArray(identities) || identities.length === 0) {
    return Object.freeze({ plan: null, folded: false });
  }
  const pruneTargets = identities
    .filter((entry) => entry && entry.path && entry.blockId)
    .map((entry) =>
      Object.freeze({ path: entry.path, blockId: entry.blockId }),
    );
  if (pruneTargets.length === 0) {
    return Object.freeze({ plan: null, folded: false });
  }
  const dailyPath = snapshot.dailyPath;
  const staged = sourceWrites instanceof Map ? sourceWrites.get(dailyPath) : null;
  const dailyBase = staged ? staged.nextContent : snapshot.content;
  if (dailyBase == null) {
    return Object.freeze({ plan: null, folded: false });
  }
  const plan = planDeferredPomodoroLinkCleanup(dailyBase, pruneTargets, {
    dailyPath,
    noteIndex: snapshot.noteIndex,
  });
  if (staged && plan && plan.changed) {
    sourceWrites.set(dailyPath, {
      path: dailyPath,
      original: staged.original,
      nextContent: plan.content,
    });
    return Object.freeze({ plan, folded: true });
  }
  return Object.freeze({ plan, folded: false });
}

function relationCancelCommitGate(
  cancelSourcePlans,
  cancelRefusals,
  cancelDate,
  expectedCancelEffects,
  staleReason,
) {
  if (Array.isArray(cancelRefusals) && cancelRefusals.length > 0) {
    const refusal = cancelRefusals[0] && cancelRefusals[0].refusal;
    return Object.freeze({
      ok: false,
      reason: (refusal && refusal.code) || "relation-cancel-refused",
      notice: (refusal && refusal.message) || null,
      stale: false,
      cancelEffects: null,
    });
  }
  const effectsPlan = Object.freeze({
    sources: Object.freeze((cancelSourcePlans || []).slice()),
    cancels: Object.freeze(
      (cancelSourcePlans || []).filter((entry) => entry && entry.cancels),
    ),
    refusals: Object.freeze((cancelRefusals || []).slice()),
    refuse: false,
  });
  const cancelEffects = summarizeRelationCancelEffects(effectsPlan, cancelDate);
  if (
    expectedCancelEffects &&
    !relationCancelEffectsEqual(expectedCancelEffects, cancelEffects)
  ) {
    return Object.freeze({
      ok: false,
      reason: staleReason,
      notice: staleReason,
      stale: true,
      cancelEffects,
    });
  }
  return Object.freeze({
    ok: true,
    reason: null,
    notice: null,
    stale: false,
    cancelEffects,
  });
}

function applyRelationCancelStaleToPicker(picker, outcome) {
  if (!outcome || outcome.stale !== true) return false;
  if (picker) {
    picker.relationCancelExpected = outcome.cancelEffects || null;
    picker.relationCancelConfirmNonce = null;
    if (typeof picker.refreshRelationConsequenceStrip === "function") {
      try {
        picker.refreshRelationConsequenceStrip();
      } catch (_error) {
        // Best-effort cue refresh for phase .6.
      }
    }
  }
  return true;
}

function buildRelationCancelComposeNotice(details = {}) {
  const cancelled = Array.isArray(details.cancelled) ? details.cancelled : [];
  const relationNotice = details.relationNotice || null;
  const pruneFailed = details.pruneFailed === true;
  const pomodoroLinksRemoved = Math.max(
    0,
    Math.floor(numericOrDefault(details.pomodoroLinksRemoved, 0)),
  );
  const recovered = Math.max(
    0,
    Math.floor(numericOrDefault(details.recovered, 0)),
  );
  const mirrorFailed = details.mirrorFailed;
  const chips = [];
  if (pruneFailed) {
    chips.push("Pomodoro links not removed");
  } else if (pomodoroLinksRemoved > 0) {
    chips.push(
      `removed ${formatRelationCancelCount(pomodoroLinksRemoved, "Pomodoro link")}`,
    );
  }
  if (recovered > 0) {
    chips.push(`unblocked ${recovered}`);
  }

  if (cancelled.length === 0) {
    let notice = relationNotice;
    if (!notice) return null;
    if (chips.length > 0) notice = `${notice} · ${chips.join(" · ")}`;
    return withLinkedFromFollowUpNotice(notice, mirrorFailed);
  }

  if (cancelled.length === 1) {
    const row = cancelled[0];
    const sourceName = String(row.sourceName || "task");
    const targetName = String(row.targetName || "task");
    const label = String(row.label || "").trim();
    const labelPart = label ? ` ${label} → ` : " → ";
    let notice = `🪢 ${sourceName} —${labelPart}${targetName} · ⊘ cancelled`;
    if (chips.length > 0) notice = `${notice} · ${chips.join(" · ")}`;
    return withLinkedFromFollowUpNotice(notice, mirrorFailed);
  }

  const relationPart = relationNotice || `🪢 Linked ${cancelled.length} tasks`;
  let notice = `${relationPart} · ⊘ cancelled`;
  if (chips.length > 0) notice = `${notice} · ${chips.join(" · ")}`;
  return withLinkedFromFollowUpNotice(notice, mirrorFailed);
}

function applyComposedRelationSourceCancel(details = {}) {
  const policySource = details.policySource;
  const cancelRefusals = details.cancelRefusals || [];
  const consumed =
    details.consumed instanceof Set ? details.consumed : new Set();
  const source = details.source;
  const sourceLine = details.sourceLine;
  const consumedLinesByPath = details.consumedLinesByPath;
  if (!(policySource && policySource.cancels && cancelRefusals.length === 0)) {
    consumed.add(sourceLine);
    if (consumedLinesByPath && source) {
      consumedLinesByPath.set(source.path, consumed);
    }
    return Object.freeze({ ok: true });
  }
  const primaryTarget =
    (details.liveAdd && details.liveAdd[0]) ||
    (details.liveRelabel && details.liveRelabel[0]) ||
    (details.liveRemove && details.liveRemove[0]);
  const folded = composeRelationSourceCancel({
    content: details.content,
    source: {
      ...details.liveSource,
      line: sourceLine,
      description:
        (details.liveSource && details.liveSource.description) ||
        (source && source.description),
    },
    consumed,
    edges: details.cancelEdges,
    cancelLabels: details.cancelLabels,
    trigger: details.cancelTrigger,
    cancelDate: details.cancelDate,
    targetName:
      (primaryTarget && (primaryTarget.description || primaryTarget.blockId)) ||
      "task",
  });
  if (!folded.ok) return folded;
  if (consumedLinesByPath && source) {
    consumedLinesByPath.set(source.path, folded.consumed);
  }
  if (typeof details.stageWrite === "function" && source) {
    details.stageWrite(source.path, details.original, folded.content);
  }
  if (folded.identity && Array.isArray(details.cancelledIdentities)) {
    details.cancelledIdentities.push(folded.identity);
  }
  if (folded.noticeRow && Array.isArray(details.cancelledNoticeRows)) {
    details.cancelledNoticeRows.push(folded.noticeRow);
  }
  return Object.freeze({ ok: true });
}

class BobNavigationHotkeysRelationCancelComposeMixin {
  async prepareRelationCancelDailyCleanup(sourceWrites, identities, today) {
    if (!Array.isArray(identities) || identities.length === 0) {
      return Object.freeze({
        ok: true,
        snapshot: null,
        plan: null,
        cleanupHandled: false,
      });
    }
    const dailyRead = await this.readRelationCancelDailySnapshot(this.app, {
      today,
    });
    if (dailyRead && dailyRead.unreadable) {
      return Object.freeze({
        ok: false,
        reason: "unreadable-daily",
        notice: "today's daily note could not be read; no tasks were updated",
      });
    }
    const snapshot = dailyRead && dailyRead.snapshot;
    if (!snapshot) {
      return Object.freeze({
        ok: true,
        snapshot: null,
        plan: null,
        cleanupHandled: false,
      });
    }
    const foldedDaily = foldRelationCancelDailyCleanup(
      sourceWrites,
      identities,
      snapshot,
    );
    return Object.freeze({
      ok: true,
      snapshot,
      plan: foldedDaily.plan,
      cleanupHandled: foldedDaily.folded === true,
    });
  }

  // Detailed daily-note snapshot for the relation cancel writer. Absence is
  // zero cleanup; an existing unreadable note is an error. Other callers keep
  // `readDeferredPomodoroSnapshot`, which still returns null for both.
  // Uses `findRelationEditOpenEditor` so a missing workspace
  // `getActiveViewOfType` (the relation-writer test harness) cannot throw
  // and collapse into apply-failed.
  async readRelationCancelDailySnapshot(app, options = {}) {
    const vault = app && app.vault;
    if (!vault || typeof vault.getMarkdownFiles !== "function") {
      return Object.freeze({
        ok: false,
        absent: true,
        unreadable: false,
        snapshot: null,
      });
    }
    try {
      const sourcePath = normalizeVaultRelativePath(options.sourcePath);
      const today = options.today instanceof Date ? options.today : new Date();
      const buffers = getOpenMarkdownBufferContents(app);
      if (buffers.ambiguous) {
        return Object.freeze({
          ok: false,
          absent: false,
          unreadable: true,
          snapshot: null,
        });
      }
      if (sourcePath) {
        buffers.set(sourcePath, String(options.sourceContent || ""));
      }
      let vaultFiles;
      try {
        vaultFiles = vault.getMarkdownFiles() || [];
      } catch (_error) {
        return Object.freeze({
          ok: false,
          absent: true,
          unreadable: false,
          snapshot: null,
        });
      }
      const dailyPath = scheduledRecoveryDailyPaths(vaultFiles, today).current;
      if (!dailyPath) {
        return Object.freeze({
          ok: true,
          absent: true,
          unreadable: false,
          snapshot: null,
        });
      }
      const noteIndex = createScheduledRecoveryNoteIndex(
        vaultFiles.map((file) => ({
          path: normalizeVaultRelativePath(file.path),
        })),
      );
      if (dailyPath === sourcePath) {
        return Object.freeze({
          ok: true,
          absent: false,
          unreadable: false,
          snapshot: Object.freeze({
            dailyPath,
            file: null,
            editor: null,
            content: null,
            noteIndex,
            sameFile: true,
          }),
        });
      }
      const dailyFile = vaultFiles.find(
        (file) => normalizeVaultRelativePath(file.path) === dailyPath,
      );
      if (!dailyFile) {
        return Object.freeze({
          ok: true,
          absent: true,
          unreadable: false,
          snapshot: null,
        });
      }
      const editor =
        typeof this.findRelationEditOpenEditor === "function"
          ? this.findRelationEditOpenEditor(dailyPath)
          : null;
      let content = null;
      let unreadable = false;
      if (buffers.has(dailyPath)) {
        content = buffers.get(dailyPath);
      } else if (editor && typeof editor.getValue === "function") {
        content = String(editor.getValue() || "");
      } else if (typeof vault.cachedRead === "function") {
        try {
          content = String((await vault.cachedRead(dailyFile)) || "");
        } catch (_error) {
          unreadable = true;
        }
      } else {
        unreadable = true;
      }
      if (unreadable || content === null) {
        return Object.freeze({
          ok: false,
          absent: false,
          unreadable: true,
          snapshot: null,
        });
      }
      return Object.freeze({
        ok: true,
        absent: false,
        unreadable: false,
        snapshot: Object.freeze({
          dailyPath,
          file: dailyFile,
          editor,
          content,
          noteIndex,
          sameFile: false,
        }),
      });
    } catch (_error) {
      return Object.freeze({
        ok: false,
        absent: false,
        unreadable: true,
        snapshot: null,
      });
    }
  }
}
