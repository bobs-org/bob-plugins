// Offer-aware verdict applier (docs/task-dependencies.md §12.2 SELECTION,
// §12.4 PICK, §12.5 reporting). Pure code: no vault reads, no editor writes.
// Extracted from 089 so both fragments stay ≤1000 lines. Shared scope.

function applySuccessorVerdicts(context) {
  const recovers = Array.isArray(context.recovers) ? context.recovers : [];
  const successorMarks = Array.isArray(context.successorMarks) ? context.successorMarks : [];
  const stillBlocked = Array.isArray(context.stillBlocked) ? context.stillBlocked : [];
  const edits = Array.isArray(context.projectTagStripEdits) ? context.projectTagStripEdits.slice() : [];
  const dailyPath = context.dailyPath || "";
  const dailyBefore = context.dailyBefore != null ? context.dailyBefore : [];
  const today = context.today;
  const markUnblockedLine = context.markUnblockedLine;
  const stampLine = typeof context.stampLine === "function" ? context.stampLine : null;
  const rawSelection = context.selection;
  const selection = rawSelection && typeof rawSelection === "object" && rawSelection.mode
    ? rawSelection
    : normalizeSuccessorSelection(rawSelection);
  const destinations = context.destinations instanceof Map
    ? context.destinations
    : (context.destinations && typeof context.destinations === "object"
      ? new Map(Object.entries(context.destinations))
      : new Map());
  const isInbox = context.isInbox;
  const basenameCounts = context.basenameCounts;
  const noteTexts = context.noteTexts || {};
  const hasLiveLink = context.hasLiveLink;
  const foldedByProject = context.foldedByProject instanceof Map ? context.foldedByProject : new Map();
  const projectHeaders = context.projectHeaders instanceof Map ? context.projectHeaders : new Map();

  const unblocked = [];
  let placements = [];

  // DEDUP (§12.2): one row per task identity; a resident also directly
  // dependent appears once in hand_off, merging causes.
  const deduped = new Map();
  const priorityOf = (mark) => {
    const group = mark.group || (mark.pullIn ? "project_finished" : "hand_off");
    if (group === "hand_off") {
      return 0;
    }
    if (group === "project") {
      return 1;
    }
    return 2;
  };
  for (const mark of successorMarks) {
    if (!mark || !mark.task || !mark.task.path) {
      continue;
    }
    const location = `${mark.task.path}\0${mark.task.line}`;
    const existing = deduped.get(location);
    if (!existing) {
      deduped.set(location, mark);
      continue;
    }
    if (priorityOf(mark) < priorityOf(existing)) {
      const mergedRows = [...(existing.predecessorRows || [])];
      for (const row of mark.predecessorRows || []) {
        if (!mergedRows.some((candidate) => candidate.note_path === row.note_path && candidate.block_id === row.block_id)) {
          mergedRows.push(row);
        }
      }
      deduped.set(location, { ...mark, predecessorRows: mergedRows });
    } else {
      const mergedRows = [...(existing.predecessorRows || [])];
      for (const row of mark.predecessorRows || []) {
        if (!mergedRows.some((candidate) => candidate.note_path === row.note_path && candidate.block_id === row.block_id)) {
          mergedRows.push(row);
        }
      }
      existing.predecessorRows = mergedRows;
    }
  }
  const uniqueMarks = [...deduped.values()];
  for (const mark of uniqueMarks) {
    if (!mark.group) {
      mark.group = mark.pullIn ? "project_finished" : "hand_off";
    }
  }

  // Stable keys (§12.2 KEYS). Ordinals derive from the note's full task rows.
  let digestTable = null;
  try {
    digestTable = buildSuccessorNoteDigestTable(noteTexts);
  } catch (error) {
    digestTable = new Map();
  }
  const keyByTask = assignSuccessorOfferKeys(uniqueMarks.map((mark) => mark.task), digestTable);
  // Fallback for cache tasks whose note rows lack the line: assign by digest.
  for (const mark of uniqueMarks) {
    if (!keyByTask.has(mark.task)) {
      if (mark.task.blockId) {
        keyByTask.set(mark.task, `${mark.task.path}#^${String(mark.task.blockId)}`);
      } else {
        keyByTask.set(mark.task, `${mark.task.path}@${successorDigestForTask(mark.task)}`);
      }
    }
  }

  // ORDER (§12.2): group, anchor ledger position, note path, line.
  uniqueMarks.sort(successorOfferOrderCompare);
  const offerNumberByKey = new Map();
  uniqueMarks.forEach((mark, index) => {
    offerNumberByKey.set(keyByTask.get(mark.task), index + 1);
  });

  const pushRow = (task, rank, extra) => {
    const pullIn = extra.pullIn === true;
    const before = task.rawLine != null ? String(task.rawLine) : null;
    let after = before;
    if (before != null) {
      if (extra.linked) {
        after = extra.after;
      } else if (pullIn) {
        after = projectPullInRewriteLine(before, rank, {
          recoverRank: extra.recoverRank === true,
          markUnblockedLine,
          today,
          isDailyNote: isDailyNotePath(task.path),
          isToday: typeof hasLiveLink === "function" ? hasLiveLink(task) : false,
        });
      } else {
        after = rewriteRecoveredTaskLine(before, rank, {
          markUnblockedLine,
          today,
          isDailyNote: isDailyNotePath(task.path),
          isToday: typeof hasLiveLink === "function" ? hasLiveLink(task) : false,
        });
      }
    }
    const hideRemoved = pullIn && before != null && removeProjectHideTags(before) !== before;
    const isOffer = extra.offer != null;
    if (!isOffer && rank === task.status && !extra.always && !hideRemoved && !extra.linked) {
      return null;
    }
    if (before !== after && after != null) {
      edits.push({ path: task.path, line: task.line, before, after });
    }
    const text = pullIn
      ? projectPullInDisplayText(task, after != null ? after : before)
      : successorDisplayText(task);
    const row = {
      note_path: task.path,
      block_id: extra.blockId || task.blockId || "",
      line: task.line,
      text,
      previous_status_symbol: task.status,
      previous_status_name: successorStatusName(task.status),
      status_symbol: rank,
      status_name: successorStatusName(rank),
      inbox: typeof isInbox === "function" ? isInbox(task.path) === true : false,
      unblocked_by: extra.predecessorRows || [],
      link: extra.link || null,
      not_linked: extra.not_linked == null ? null : extra.not_linked,
      trigger: pullIn ? "project_empty" : "dependency",
      hide_removed: hideRemoved,
    };
    if (isOffer) {
      row.offer = extra.offer;
    }
    unblocked.push(row);
    return unblocked.length - 1;
  };

  const pushRecover = (recover, alwaysReason) => {
    const task = recover.task;
    const pullIn = recover.pullIn === true;
    const rank = recover.raiseToNext
      ? (task.status === "?" || task.status === " " ? "*" : task.status)
      : (task.status === "?" ? (typeof hasLiveLink === "function" && hasLiveLink(task) ? "*" : " ") : task.status);
    const reason = alwaysReason || recover.reason;
    pushRow(task, rank, {
      pullIn,
      recoverRank: pullIn && !recover.raiseToNext,
      always: recover.hideRemoved === true,
      predecessorRows: recover.predecessorRows,
      not_linked: reason,
    });
  };

  for (const recover of recovers) {
    pushRecover(recover, false);
  }

  const mintedByNote = new Map();
  const offers = [];
  for (const mark of uniqueMarks) {
    const task = mark.task;
    const key = keyByTask.get(task);
    const group = mark.group || (mark.pullIn ? "project_finished" : "hand_off");
    const destination = successorOfferDestination(mark.anchor, mark.implicit, dailyBefore, dailyPath);
    const selected = successorSelectionPicks(selection, key);
    const needsBlockId = !task.blockId;
    const offer = {
      key: String(key),
      n: offerNumberByKey.get(key) || 0,
      group,
      ...(mark.project || group === "project" ? { project: String(mark.project || task.path) } : {}),
      destination,
      selected,
      block_id_needed: needsBlockId,
    };
    const noteText = projectNoteTextFor(noteTexts, task.path);
    offers.push({
      key: offer.key, text: successorDisplayText(task), notePath: task.path, status: task.status,
      destination, needsBlockId, group, project: offer.project || null,
      anchor: mark.anchor, implicit: mark.implicit || null, predecessorRows: mark.predecessorRows || [],
      task, line: task.line,
      ...(noteText ? { noteText } : {}),
    });
    if (!selected) {
      // Unpicked: recover exactly as today's recover rule (WRITE rule kept),
      // no mint, no link, no stamp. Emitted even when unchanged (SO8).
      const rank = mark.pullIn && mark.raiseToNext
        ? (task.status === "?" || task.status === " " ? "*" : task.status)
        : (task.status === "?" ? (typeof hasLiveLink === "function" && hasLiveLink(task) ? "*" : " ") : task.status);
      const before = task.rawLine != null ? String(task.rawLine) : null;
      let after = before;
      if (before != null) {
        if (mark.pullIn) {
          after = projectPullInRewriteLine(before, rank, {
            recoverRank: true,
            markUnblockedLine,
            today,
            isDailyNote: isDailyNotePath(task.path),
            isToday: typeof hasLiveLink === "function" ? hasLiveLink(task) : false,
          });
        } else {
          after = rewriteRecoveredTaskLine(before, rank, {
            markUnblockedLine,
            today,
            isDailyNote: isDailyNotePath(task.path),
            isToday: typeof hasLiveLink === "function" ? hasLiveLink(task) : false,
          });
        }
      }
      const hideRemoved = mark.pullIn === true && before != null && removeProjectHideTags(before) !== before;
      if (before !== after && after != null) {
        edits.push({ path: task.path, line: task.line, before, after });
      }
      const text = mark.pullIn ? projectPullInDisplayText(task, after != null ? after : before) : successorDisplayText(task);
      unblocked.push({
        note_path: task.path,
        block_id: task.blockId || "",
        line: task.line,
        text,
        previous_status_symbol: task.status,
        previous_status_name: successorStatusName(task.status),
        status_symbol: rank,
        status_name: successorStatusName(rank),
        inbox: typeof isInbox === "function" ? isInbox(task.path) === true : false,
        unblocked_by: mark.predecessorRows || [],
        link: null,
        not_linked: "not_selected",
        trigger: mark.pullIn ? "project_empty" : "dependency",
        hide_removed: hideRemoved,
        offer: { ...offer, selected: false },
      });
      continue;
    }
    // Picked (§12.4 PICK): raise Ready/Blocked to Next without demoting
    // Next/Pending, mint only when necessary, strip the project tag, stamp
    // freshness through ledger-tools. One guarded edit per task line.
    const rank = task.status === "?" || task.status === " " ? "*" : task.status;
    let blockId = task.blockId || "";
    let blockIdCreated = false;
    const before = task.rawLine != null ? String(task.rawLine) : null;
    let sourceNoteText = "";
    try {
      sourceNoteText = noteTexts instanceof Map
        ? String(noteTexts.get(task.path) ?? "")
        : String(noteTexts[task.path] ?? "");
    } catch (error) {
      sourceNoteText = "";
    }
    let after = before;
    if (before != null) {
      if (mark.pullIn) {
        const raised = projectPullInRewriteLine(before, rank, {
          recoverRank: false,
          markUnblockedLine,
          today,
          isDailyNote: isDailyNotePath(task.path),
          isToday: true,
        });
        after = applyFreshStampLine(
          raised != null ? raised : before,
          stampLine,
          today,
          { content: sourceNoteText, line: task.line },
        );
      } else {
        if (!blockId) {
          if (!mintedByNote.has(task.path)) {
            let stagedText = "";
            try {
              stagedText = noteTexts instanceof Map ? noteTexts.get(task.path) : noteTexts[task.path];
            } catch (error) {
              stagedText = "";
            }
            mintedByNote.set(task.path, collectSuccessorUsedIds(stagedText ?? ""));
          }
          const used = mintedByNote.get(task.path);
          blockId = mintBlockId(cleanDescription(successorBodyAfterStatusBox(task.rawLine || ""), "#task"), used);
          used.add(blockId);
          blockIdCreated = true;
        }
        let raised = replaceTaskStatusSymbol(before, rank);
        if (blockIdCreated) {
          raised = `${raised.replace(/\s+$/, "")} ^${blockId}`;
        }
        // Strip the inherited project tag per PDC3 without touching own
        // reasons (schedules/IDs/dependency fields never change here).
        raised = stripProjectBlockedResidentTag(raised);
        after = applyFreshStampLine(raised, stampLine, today, {
          content: sourceNoteText,
          line: task.line,
        });
      }
    } else if (!blockId && !mark.pullIn) {
      if (!mintedByNote.has(task.path)) {
        mintedByNote.set(task.path, collectSuccessorUsedIds(""));
      }
      const used = mintedByNote.get(task.path);
      blockId = mintBlockId(cleanDescription(successorBodyAfterStatusBox(task.rawLine || ""), "#task"), used);
      used.add(blockId);
      blockIdCreated = true;
    }
    const rowIndex = pushRow(task, rank, {
      pullIn: mark.pullIn === true,
      linked: true,
      after,
      blockId,
      predecessorRows: mark.predecessorRows,
      not_linked: null,
      link: {
        day_file: dailyPath,
        entry_name: destination.entry_name || "",
        entry_line: null,
        entry_created: false,
        next_up: false,
        line: null,
        block_link: successorLinkText(task.path, blockId, dailyPath, basenameCounts),
        block_id_created: blockIdCreated,
      },
      offer: { ...offer, selected: true },
    });
    // Fix the queued edit to the consolidated pick line (pushRow queued the
    // pre-stamp line for non-pullIn picks via extra.after pre-mint? No: we
    // passed the stamped line, so the edit is already consolidated. For
    // pullIn picks the rewrite+stamp line is likewise consolidated.)
    if (rowIndex != null) {
      const placement = {
        key: String(key),
        rowIndex,
        anchor: mark.anchor,
        implicit: mark.implicit || null,
        blockLink: unblocked[rowIndex].link.block_link,
      };
      // Per-row destination override (§12.13): validated here so a stale
      // shape from an older picker falls back to the planned anchor.
      const override = normalizeSuccessorPickDestination(destinations.get(String(key)));
      if (override) {
        placement.override = override;
      }
      placements.push(placement);
    }
  }

  // Placements already in ORDER (offers sorted); keep that order for the
  // insertion planner.
  return {
    unblocked,
    still_blocked: stillBlocked,
    edits,
    placements,
    unblocked_check: "checked",
    offers,
    foldedByProject,
    projectHeaders,
  };
}
