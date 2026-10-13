// Project pull-in wiring (plan:202610/project_pull_in_line_model.md `cycler`).
// Owns `planAndApplySuccessorsNow` so 135 stays at the 1000-line cap: the
// `[id::]` gate no longer suppresses a last-task pull-in, C's notes feed
// `noteTexts`, and the dependents snapshot is built only per §12.10 Gate.

class TaskStatusCyclerSuccessorProjectMixin {
  // The gated recover-and-link pass inside `finalizeClosedTasks`: gate on
  // `[id::]` for dependents, still run a project pull-in when C's own notes
  // empty a project, apply, and return the §12.5 model (or null). The close
  // never depends on this result. Never throws.
  async planAndApplySuccessorsNow(closed, context) {
    try {
      const active = context && typeof context === "object" ? context : {};
      const vault = this.app && this.app.vault;
      const cache = new Map();
      const gate = await this.resolveSuccessorClosedIdentities(
        closed,
        active,
        cache,
      );
      const quietGate = {
        version: 1,
        gated: true,
        predecessors: [],
        unblocked: [],
        still_blocked: [],
        daily_path: "",
        daily_content: null,
        failure: null,
      };
      const identities = gate.identities || [];
      const closedTaskIds = new Set(
        identities.filter((identity) => identity.taskId).map((identity) =>
          String(identity.taskId)
        ),
      );
      let today = null;
      try {
        today = typeof active.today === "string" && active.today
          ? active.today
          : typeof this.getScheduleLogDateString === "function"
            ? this.getScheduleLogDateString()
            : formatLocalDate();
      } catch (error) {
        today = formatLocalDate();
      }
      for (const identity of identities) {
        if (identity && identity.path && !cache.has(identity.path)) {
          await this.readSuccessorNoteText(identity.path, active, cache);
        }
      }
      const closedNoteTexts = {};
      for (const identity of identities) {
        if (!identity || !identity.path || !cache.has(identity.path)) {
          continue;
        }
        const text = cache.get(identity.path);
        if (typeof text === "string") {
          closedNoteTexts[identity.path] = text;
        }
      }
      const pullInPaths = projectPullInCandidatePaths(
        identities,
        closedNoteTexts,
        today,
      );
      const hasClosedProjectTask = identities.some(projectIdentityIsPrj);
      const notePaths = hasClosedProjectTask && vault &&
          typeof vault.getMarkdownFiles === "function"
        ? vault.getMarkdownFiles()
          .map((file) => file && file.path)
          .filter((path) => typeof path === "string" && path)
        : Object.keys(closedNoteTexts);
      const pullInParentPaths = projectPullInParentPaths(
        identities,
        closedNoteTexts,
        notePaths,
      );
      for (const path of pullInParentPaths) {
        if (!cache.has(path)) {
          await this.readSuccessorNoteText(path, active, cache);
        }
        const text = cache.get(path);
        if (typeof text === "string") {
          closedNoteTexts[path] = text;
        }
      }
      const pullInParentCandidates = projectPullInParentCandidatePaths(
        identities,
        closedNoteTexts,
        today,
        notePaths,
      );
      const needsDependents = projectPullInNeedsDependents(
        identities,
        closedNoteTexts,
        today,
        notePaths,
      );
      if (
        closedTaskIds.size === 0 && pullInPaths.length === 0 &&
        pullInParentCandidates.length === 0
      ) {
        return quietGate;
      }
      let linkUnblocked = true;
      try {
        linkUnblocked = loadLinkUnblocked() !== false;
      } catch (error) {
        linkUnblocked = true;
      }
      const cancelledClose = active.closeKind === "cancelled";
      if (cancelledClose) {
        linkUnblocked = false;
      }
      let dailyPath = typeof active.dailyPath === "string" && active.dailyPath
        ? active.dailyPath
        : null;
      if (!dailyPath) {
        try {
          dailyPath = todayDailyPath(this.app);
        } catch (error) {
          dailyPath = null;
        }
      }
      let dailyCurrent = null;
      if (dailyPath) {
        dailyCurrent = await this.readSuccessorNoteText(
          dailyPath,
          active,
          cache,
        );
      }
      const hint = active.closingEntry &&
          typeof active.closingEntry === "object"
        ? active.closingEntry
        : null;
      const dailyBefore = Array.isArray(active.dailyBefore)
        ? active.dailyBefore.map((line) => String(line ?? ""))
        : typeof dailyCurrent === "string"
          ? dailyCurrent.split(/\r?\n/)
          : [];
      const dailyAfter = typeof dailyCurrent === "string"
        ? dailyCurrent.split(/\r?\n/)
        : dailyBefore;
      let planClosingEntry = null;
      if (
        hint && Number.isInteger(hint.line) && hint.line >= 0 &&
        hint.line < dailyBefore.length
      ) {
        planClosingEntry = hint.line;
      }
      let tasks = [];
      let noteTexts = new Map();
      for (const [path, text] of Object.entries(closedNoteTexts)) {
        noteTexts.set(path, text);
      }
      if (needsDependents) {
        const pool = await this.buildSuccessorPool(closedTaskIds, active, cache);
        tasks = pool.tasks;
        noteTexts = pool.noteTexts;
        if (!pool.warm) {
          const cold = await this.readSuccessorColdDocuments(active, cache);
          if (cold.documents.length === 0 && !vault) {
            return null;
          }
          tasks = tasksFromDocuments(cold.documents);
          noteTexts = new Map(
            cold.documents.map((document) => [document.path, document.text]),
          );
          for (const [path, text] of pool.noteTexts) {
            if (!noteTexts.has(path)) {
              noteTexts.set(path, text);
            }
          }
        }
      } else {
        const editors = this.getOpenMarkdownEditors(active);
        for (const [path, editor] of editors) {
          try {
            const text = editor.getValue();
            if (typeof text === "string") {
              noteTexts.set(path, text);
            }
          } catch (error) {
            // Best effort: cache already holds C's notes.
          }
        }
      }
      for (const path of [
        ...pullInPaths,
        ...pullInParentPaths,
        ...identities.map((item) => item && item.path),
      ]) {
        if (!path || noteTexts.has(path)) {
          continue;
        }
        const text = await this.readSuccessorNoteText(path, active, cache);
        if (typeof text === "string") {
          noteTexts.set(path, text);
        }
      }
      const basenameCounts = countSuccessorBasenames(
        this.app,
        tasks,
        identities,
        dailyPath,
        noteTexts,
      );
      const noteTextsObject = {};
      for (const [path, text] of noteTexts) {
        noteTextsObject[path] = text;
      }
      let plan = null;
      try {
        plan = planSuccessors({
          closed: identities,
          index: buildDependentsIndex(tasks),
          dailyBefore,
          dailyAfter,
          dailyPath: dailyPath || "",
          today,
          markUnblockedLine: this.getFreshnessMarkUnblockedLine(),
          linkUnblocked,
          cancelled: cancelledClose,
          isInbox: getSuccessorIsInbox(this.app),
          basenameCounts,
          closingEntry: planClosingEntry,
          noteTexts: noteTextsObject,
          notePaths,
        });
      } catch (error) {
        return null;
      }
      if (!plan) {
        return null;
      }
      const noteOutcome = await applySuccessorNoteEditsWithUnblockedGuard(this, plan, active);
      if (noteOutcome.failed > 0) {
        const failedRows = new Set();
        for (let index = 0; index < plan.unblocked.length; index += 1) {
          if (plan.unblocked[index].not_linked === "failed") {
            failedRows.add(index);
          }
        }
        plan.placements = plan.placements.filter(
          (placement) => !failedRows.has(placement && placement.rowIndex),
        );
      }
      let insertion = { splices: [], links: [], skipped: [], text: null };
      if (plan.placements.length > 0 && dailyPath && dailyCurrent != null) {
        let relocated = null;
        let createdEntry = null;
        if (hint) {
          relocated = this.relocateSuccessorClosingEntry(dailyAfter, hint);
          if (
            relocated == null &&
            plan.placements.some((placement) =>
              !placement || !placement.anchor || placement.anchor.bulletLine == null
            )
          ) {
            for (const placement of plan.placements) {
              if (
                !placement || !placement.anchor ||
                placement.anchor.bulletLine != null
              ) {
                continue;
              }
              const row = plan.unblocked[placement.rowIndex];
              if (row && typeof row === "object" && row.link) {
                row.link = null;
                row.not_linked = "failed";
                noteOutcome.failed += 1;
                if (!noteOutcome.failureReason) {
                  noteOutcome.failureReason = "daily note changed";
                }
              }
            }
          }
          if (relocated != null && hint.createdPomodoro === true) {
            try {
              const entries = parseSuccessorLedgerEntries(dailyAfter);
              const createdName = typeof hint.createdName === "string"
                ? hint.createdName
                : "";
              const created = entries.find((entry) =>
                entry.open && entry.entryLine > relocated &&
                String(entry.name || "") === createdName
              ) || null;
              if (created) {
                createdEntry = { line: created.entryLine };
              }
            } catch (error) {
              createdEntry = null;
            }
          }
        }
        try {
          insertion = planSuccessorInsertions(dailyAfter, plan.placements, {
            ...(relocated != null ? { closingEntry: relocated } : {}),
            ...(createdEntry ? { createdEntry } : {}),
          });
        } catch (error) {
          insertion = { splices: [], links: [], skipped: [], text: null };
        }
        insertion.snapshot = dailyCurrent;
        const dailyOutcome = await this.applySuccessorDailyInsertions(
          plan,
          insertion,
          active,
          dailyPath,
        );
        noteOutcome.failed += dailyOutcome.failed;
        if (!noteOutcome.failureReason && dailyOutcome.failureReason) {
          noteOutcome.failureReason = dailyOutcome.failureReason;
        }
      } else if (plan.placements.length > 0) {
        for (const placement of plan.placements) {
          const row = plan.unblocked[placement && placement.rowIndex];
          if (row && typeof row === "object" && row.link) {
            row.link = null;
            row.not_linked = "failed";
            noteOutcome.failed += 1;
            if (!noteOutcome.failureReason) {
              noteOutcome.failureReason = "daily note unavailable";
            }
          }
        }
      }
      try {
        if (typeof this.rememberSuccessorPass === "function") {
          this.rememberSuccessorPass(identities, plan, insertion, {
            dailyPath,
            today,
          });
        }
      } catch (error) {
        // Best effort: a missed receipt only loses the take-back shortcut.
      }
      const predecessors = identities.map((identity) => ({
        note_path: String(identity.path || ""),
        block_id: identity.blockId ? String(identity.blockId) : "",
        text: identity.text ? String(identity.text) : "",
      }));
      let dailyContent = null;
      if (
        dailyPath &&
        (plan.unblocked.length > 0 || noteOutcome.failed > 0)
      ) {
        try {
          cache.delete(dailyPath);
          dailyContent = await this.readSuccessorNoteText(
            dailyPath,
            active,
            cache,
          );
        } catch (error) {
          dailyContent = null;
        }
        if (typeof dailyContent !== "string") {
          dailyContent = null;
        }
      }
      return {
        version: 1,
        predecessors,
        unblocked: plan.unblocked,
        still_blocked: plan.still_blocked,
        daily_path: dailyPath || "",
        daily_content: dailyContent,
        failure: noteOutcome.failed > 0
          ? {
            count: noteOutcome.failed,
            reason: noteOutcome.failureReason || "daily note changed",
          }
          : null,
      };
    } catch (error) {
      return null;
    }
  }
}
