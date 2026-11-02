// Parked-event successor API for unlink hand-offs
// (plan:202611/starts_after_relation.md phase obsidian_unlink).
// offerParkedSuccessors is additive on cycler api v4: relation-only offers
// with event: parked, never throws, resolves {offered, picked}.

function parkedSuccessorIdentityIsLiveLinked(identity, dailyLines, dailyPath) {
  const entries = typeof findLiveLinks === "function"
    ? findLiveLinks(dailyLines)
    : [];
  if (!Array.isArray(entries)) {
    return false;
  }
  for (const entry of entries) {
    const links = entry && Array.isArray(entry.links) ? entry.links : [];
    if (links.some((link) => successorLinkMatchesIdentity(link, identity, dailyPath))) {
      return true;
    }
  }
  return false;
}

function parkedSuccessorCounts(model) {
  if (!model || typeof model !== "object" || model.gated === true) {
    return { offered: 0, picked: 0 };
  }
  const rows = Array.isArray(model.relation_successors) ? model.relation_successors : [];
  const offered = rows.length;
  const picked = rows.filter((row) => row && row.link && !row.not_linked).length;
  return { offered, picked };
}

function parkedSuccessorPendingTask(noteText, path, blockId) {
  if (typeof noteText !== "string" || !path || !blockId) {
    return null;
  }
  if (typeof parseTaskDependencyDocument !== "function") {
    return null;
  }
  try {
    const tasks = parseTaskDependencyDocument(noteText, path);
    return tasks.find((task) => String(task.blockId || "") === String(blockId)) || null;
  } catch (_error) {
    return null;
  }
}

class TaskStatusCyclerSuccessorParkedMixin {
  // Versioned cross-plugin API for keymaps that park a Pending task by
  // removing its last live Task Link (block-id-prompt Unlink task). Plans
  // relation-only offers with event: parked, presents the nav picker, and
  // never throws. Resolves `{offered, picked}`. Empty, still-linked, and
  // non-Pending identities are silence.
  offerParkedSuccessors(identities, options = {}) {
    const run = async () => {
      try {
        return await this.offerParkedSuccessorsNow(identities, options || {});
      } catch (_error) {
        return { offered: 0, picked: 0 };
      }
    };
    if (typeof this.enqueueTaskReferenceMutation === "function") {
      return this.enqueueTaskReferenceMutation(run);
    }
    return run();
  }

  async offerParkedSuccessorsNow(identities, options) {
    const quiet = { offered: 0, picked: 0 };
    const list = Array.isArray(identities)
      ? identities.filter((item) => item && item.path && item.blockId)
      : [];
    if (list.length === 0) {
      return quiet;
    }
    const active = options && typeof options === "object" ? options : {};
    const cache = new Map();
    let dailyPath = typeof active.dailyPath === "string" && active.dailyPath
      ? active.dailyPath
      : null;
    if (!dailyPath) {
      try {
        dailyPath = todayDailyPath(this.app);
      } catch (_error) {
        dailyPath = null;
      }
    }
    let dailyText = null;
    if (dailyPath) {
      dailyText = await this.readSuccessorNoteText(dailyPath, active, cache);
    }
    const dailyLines = typeof dailyText === "string" ? dailyText.split(/\r?\n/) : [];
    const eligible = [];
    for (const identity of list) {
      const noteText = await this.readSuccessorNoteText(identity.path, active, cache);
      const task = parkedSuccessorPendingTask(noteText, identity.path, identity.blockId);
      if (!task || String(task.status || "") !== "/") {
        continue;
      }
      if (parkedSuccessorIdentityIsLiveLinked(identity, dailyLines, dailyPath || "")) {
        continue;
      }
      eligible.push({
        path: String(identity.path),
        blockId: String(identity.blockId),
        ...(identity.taskId ? { taskId: String(identity.taskId) } : {}),
        text: identity.text
          ? String(identity.text)
          : String(task.text || task.lineText || ""),
      });
    }
    if (eligible.length === 0) {
      return quiet;
    }
    const slot = active.slot && typeof active.slot === "object" ? active.slot : null;
    const model = await this.planAndApplySuccessorsNow([], {
      ...active,
      parkedIdentities: eligible,
      relationEventKind: "parked",
      parkedSlot: slot,
      dailyPath: dailyPath || active.dailyPath || "",
    });
    try {
      this.presentSuccessorModel(model, active);
    } catch (_error) {
      // Best effort: the unlink already landed.
    }
    return parkedSuccessorCounts(model);
  }
}
