// Successor-offer wiring (plan:202610/cycler_successor_offers.md).
// Owns planAndApplySuccessorsNow: plan with no selection, await one nav
// picker for the batch, re-plan from fresh text with the picks, then apply.

class TaskStatusCyclerSuccessorProjectMixin {
  // The gated offer pass inside finalizeClosedTasks: plan offers with no
  // selection, await one nav picker for the batch when offers exist,
  // re-plan from fresh text with the picks, apply, and return the §12.5
  // model (or null). The close never depends on this result. Never throws.
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
      let dailyBefore = Array.isArray(active.dailyBefore)
        ? active.dailyBefore.map((line) => String(line ?? ""))
        : typeof dailyCurrent === "string"
          ? dailyCurrent.split(/\r?\n/)
          : [];
      let dailyAfter = typeof dailyCurrent === "string"
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
      let basenameCounts = countSuccessorBasenames(
        this.app,
        tasks,
        identities,
        dailyPath,
        noteTexts,
      );
      const stampLineForPass = (() => {
        try {
          return typeof this.getFreshnessStampLine === "function" ? this.getFreshnessStampLine() : null;
        } catch (error) {
          return null;
        }
      })();
      const noteTextsObject = {};
      for (const [path, text] of noteTexts) {
        noteTextsObject[path] = text;
      }
      const planFirst = (selection, dailyB, dailyA, tasksForPlan, notesObj, closingForPlan) => {
        try {
          return planSuccessors({
            closed: identities,
            index: buildDependentsIndex(tasksForPlan),
            dailyBefore: dailyB,
            dailyAfter: dailyA,
            dailyPath: dailyPath || "",
            today,
            markUnblockedLine: this.getFreshnessMarkUnblockedLine(),
            stampLine: stampLineForPass,
            selection,
            linkUnblocked,
            cancelled: cancelledClose,
            isInbox: getSuccessorIsInbox(this.app),
            basenameCounts,
            closingEntry: closingForPlan,
            noteTexts: notesObj,
            notePaths,
          });
        } catch (error) {
          return null;
        }
      };
      // First pass: plan with no selection (offers only, no IDs minted).
      let plan = planFirst(null, dailyBefore, dailyAfter, tasks, noteTextsObject, planClosingEntry);
      if (!plan) {
        return null;
      }
      // One picker for the entire close batch (§12.13). Defensive detection;
      // null/empty/malformed/exception means no picks. Without a picker API,
      // apply recovery with no picks (plain "not pulled in" fallback).
      const selectableOffers = Array.isArray(plan.offers) ? plan.offers : [];
      let selectedKeys = [];
      let originalOfferByKey = new Map();
      try {
        for (const offer of selectableOffers) {
          if (offer && offer.key) {
            originalOfferByKey.set(String(offer.key), offer);
          }
        }
      } catch (error) {
        originalOfferByKey = new Map();
      }
      const pickerApi = cancelledClose ? null : getSuccessorPickerApi(this.app);
      if (selectableOffers.length > 0 && pickerApi) {
        let model = null;
        try {
          const predecessorsForModel = identities.map((identity) => ({
            note_path: String(identity.path || ""),
            block_id: identity.blockId ? String(identity.blockId) : "",
            text: identity.text ? String(identity.text) : "",
          }));
          const stillMuted = Array.isArray(plan.still_blocked) ? plan.still_blocked : [];
          const folded = plan.foldedByProject instanceof Map ? plan.foldedByProject : new Map();
          const headers = plan.projectHeaders instanceof Map ? plan.projectHeaders : new Map();
          model = buildSuccessorPickerModel({
            predecessors: predecessorsForModel,
            offers: selectableOffers,
            stillBlocked: stillMuted,
            foldedByProject: folded,
            headers,
          });
        } catch (error) {
          model = null;
        }
        let picks = [];
        if (model && Array.isArray(model.groups) && model.groups.some((group) => Array.isArray(group.rows) && group.rows.some((row) => row.selectable))) {
          try {
            const result = await pickerApi.pick(model);
            picks = normalizeSuccessorPicks(result);
          } catch (error) {
            picks = [];
          }
        }
        selectedKeys = picks;
        if (selectedKeys.length > 0) {
          // Re-read fresh texts (editor buffers first), invalidating caches.
          const affected = new Set();
          for (const identity of identities) {
            if (identity && identity.path) {
              affected.add(String(identity.path));
            }
          }
          for (const offer of selectableOffers) {
            if (offer && offer.notePath) {
              affected.add(String(offer.notePath));
            }
          }
          for (const row of plan.unblocked || []) {
            if (row && row.note_path) {
              affected.add(String(row.note_path));
            }
          }
          for (const row of plan.still_blocked || []) {
            if (row && row.note_path) {
              affected.add(String(row.note_path));
            }
          }
          for (const path of noteTexts.keys()) {
            affected.add(String(path));
          }
          if (dailyPath) {
            affected.add(String(dailyPath));
          }
          for (const path of affected) {
            try {
              cache.delete(path);
            } catch (error) {
              // Best effort.
            }
          }
          let dailyFresh = null;
          if (dailyPath) {
            dailyFresh = await this.readSuccessorNoteText(dailyPath, active, cache);
          }
          const freshNoteTexts = new Map();
          for (const path of affected) {
            if (path === dailyPath) {
              continue;
            }
            const text = await this.readSuccessorNoteText(path, active, cache);
            if (typeof text === "string") {
              freshNoteTexts.set(path, text);
            }
          }
          // Preserve C's notes when re-read misses (deleted notes stay missing).
          for (const [path, text] of noteTexts) {
            if (!freshNoteTexts.has(path) && affected.has(String(path))) {
              freshNoteTexts.set(path, text);
            } else if (!freshNoteTexts.has(path)) {
              freshNoteTexts.set(path, text);
            }
          }
          const freshNotesObj = {};
          for (const [path, text] of freshNoteTexts) {
            freshNotesObj[path] = text;
          }
          // Rebuild the dependents index with fresh affected docs overriding
          // stale cache locations (warm) or fresh overlay (cold). No new
          // full-vault scan on a warm pass.
          let freshTasks = tasks;
          try {
            const freshCache = typeof this.readSuccessorTasksCache === "function" ? this.readSuccessorTasksCache() : { ready: false, tasks: [] };
            if (freshCache && freshCache.ready) {
              const freshBuffered = new Set(freshNoteTexts.keys());
              const base = [];
              for (const task of freshCache.tasks || []) {
                if (!freshBuffered.has(task.path)) {
                  base.push(task);
                }
              }
              for (const [path, text] of freshNoteTexts) {
                if (affected.has(String(path))) {
                  for (const task of tasksFromDocuments([{ path, text }])) {
                    base.push(task);
                  }
                }
              }
              freshTasks = base;
            } else {
              const oldByPath = new Map();
              for (const task of tasks || []) {
                if (!task || !task.path) {
                  continue;
                }
                if (!oldByPath.has(task.path)) {
                  oldByPath.set(task.path, []);
                }
                oldByPath.get(task.path).push(task);
              }
              const next = [];
              for (const [path, list] of oldByPath) {
                if (affected.has(String(path))) {
                  continue;
                }
                for (const task of list) {
                  next.push(task);
                }
              }
              for (const [path, text] of freshNoteTexts) {
                if (!affected.has(String(path))) {
                  continue;
                }
                for (const task of tasksFromDocuments([{ path, text }])) {
                  next.push(task);
                }
              }
              freshTasks = next;
            }
          } catch (error) {
            freshTasks = tasks;
          }
          const dailyFreshLines = typeof dailyFresh === "string" ? dailyFresh.split(/\r?\n/) : dailyAfter;
          // Relocate the closing entry against fresh text; never carry an old
          // bullet offset into a newly edited ledger.
          let freshClosing = null;
          if (hint && Number.isInteger(hint.line)) {
            try {
              const relocated = this.relocateSuccessorClosingEntry(dailyFreshLines, hint);
              freshClosing = relocated;
            } catch (error) {
              freshClosing = null;
            }
          } else if (Number.isInteger(planClosingEntry)) {
            freshClosing = planClosingEntry < dailyFreshLines.length ? planClosingEntry : null;
          }
          const freshBasenames = countSuccessorBasenames(this.app, freshTasks, identities, dailyPath, freshNoteTexts);
          basenameCounts = freshBasenames;
          let replanned = planFirst(selectedKeys, dailyFreshLines, dailyFreshLines, freshTasks, freshNotesObj, freshClosing);
          if (!replanned) {
            replanned = plan;
            selectedKeys = [];
          } else {
            // Refuse stale/ambiguous picks individually; newly appearing
            // offers stay unpicked (no second picker).
            const freshKeys = new Set((replanned.offers || []).map((offer) => String(offer.key)));
            const refused = selectedKeys.filter((key) => !freshKeys.has(String(key)));
            // Ambiguous idless rebinding: when a note's digest count changed,
            // refuse every idless pick for that digest in that note.
            try {
              const origTable = buildSuccessorNoteDigestTable(noteTextsObject);
              const freshTable = buildSuccessorNoteDigestTable(freshNotesObj);
              const countFor = (table, path, digest) => {
                const rows = table instanceof Map ? table.get(String(path)) : (table || {})[String(path)];
                if (!Array.isArray(rows)) {
                  return 0;
                }
                return rows.filter((row) => row.digest === digest).length;
              };
              const ambiguous = new Set();
              for (const key of selectedKeys) {
                const at = String(key).lastIndexOf("@");
                const hash = String(key).indexOf("#^");
                if (at === -1 || hash !== -1) {
                  continue;
                }
                const path = String(key).slice(0, at);
                const rest = String(key).slice(at + 1);
                const digest = rest.split("~")[0];
                if (countFor(origTable, path, digest) !== countFor(freshTable, path, digest)) {
                  ambiguous.add(String(key));
                }
              }
              for (const key of ambiguous) {
                if (!refused.includes(key)) {
                  refused.push(key);
                }
              }
            } catch (error) {
              // Best effort.
            }
            if (refused.length > 0) {
              replanned.refusedKeys = refused;
            }
            plan = replanned;
            // Swap working sets to the fresh texts for the apply below.
            tasks = freshTasks;
            for (const [path, text] of freshNoteTexts) {
              noteTexts.set(path, text);
            }
            dailyCurrent = dailyFresh;
            // dailyBefore/dailyAfter for insertion planning become fresh.
            dailyBefore = dailyFreshLines;
            dailyAfter = dailyFreshLines;
            planClosingEntry = freshClosing;
            selectedKeys = selectedKeys.filter((key) => !refused.includes(String(key)));
          }
        }
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
      // Same-file task-line edits in the daily note itself must not cause a
      // false stale failure: refresh the snapshot source after note writes.
      if (plan.placements.length > 0 && dailyPath) {
        try {
          const neededDaily = plan.edits.some((edit) => edit && edit.path === dailyPath);
          if (neededDaily) {
            cache.delete(dailyPath);
            const refreshed = await this.readSuccessorNoteText(dailyPath, active, cache);
            if (typeof refreshed === "string") {
              dailyCurrent = refreshed;
              dailyAfter = refreshed.split(/\r?\n/);
            }
          }
        } catch (error) {
          // Best effort: snapshot below still guards.
        }
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
              placement && placement.anchor && placement.anchor.bulletLine == null && placement.anchor.kind !== "implicit"
            )
          ) {
            for (const placement of plan.placements) {
              if (
                !placement || !placement.anchor ||
                placement.anchor.bulletLine != null ||
                placement.anchor.kind === "implicit"
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
      if (Array.isArray(plan.refusedKeys) && plan.refusedKeys.length > 0) {
        noteOutcome.failed += plan.refusedKeys.length;
        if (!noteOutcome.failureReason) {
          noteOutcome.failureReason = "task changed before write";
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
