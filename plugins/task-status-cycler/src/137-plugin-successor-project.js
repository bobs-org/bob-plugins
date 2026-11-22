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
        keep_moving: [],
        still_blocked: [],
        daily_path: "",
        daily_content: null,
        failure: null,
      };
      const identities = gate.identities || [];
      const relationLookupIdentities = successorRelationLookupIdentities(
        identities,
        active,
      );
      const relationEventKind = active.relationEventKind === "parked" ? "parked" : "done";
      const parkedSlot = active.parkedSlot && typeof active.parkedSlot === "object"
        ? active.parkedSlot
        : null;
      const closedTaskIds = new Set(
        identities.filter((identity) => identity.taskId).map((identity) =>
          String(identity.taskId)
        ),
      );
      const cancelledClose = active.closeKind === "cancelled";
      const pickerApi = cancelledClose ? null : getSuccessorPickerApi(this.app);
      const pickerV2 = !!(pickerApi && Number(pickerApi.version) >= 2);
      const reqCloseOwners = pickerApi && Number(pickerApi.version) >= 6
        ? this.reqCloseOwnersForManagedDone(active.reqCloseOwners, identities, active)
        : [];
      const reqCloseGroups = reqCloseGroupsFromOwners(reqCloseOwners);
      const relationRuntime = this.prepareSuccessorRelationRuntime(
        active,
        cancelledClose,
        pickerApi,
      );
      const linkUnblocked = relationRuntime.linkUnblocked;
      const relationPreflight = this.preflightSuccessorRelationIndex(
        relationLookupIdentities,
        relationRuntime,
      );
      const relationUnavailableGate = () => {
        const result = {
          ...quietGate,
          relation_successors: [],
          relation_held: [],
          relation_check: "unavailable",
          relation_labels: (relationRuntime.labels.keys || []).map((key) =>
          relationRuntime.labels.labels && relationRuntime.labels.labels[key]
            ? relationRuntime.labels.labels[key]
            : key,
          ),
          relation_picker_opened: false,
        };
        delete result.gated;
        return result;
      };
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
      for (const identity of [...identities, ...relationLookupIdentities]) {
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
      const keepMovingPotentialPaths = !cancelledClose && pickerV2
        ? successorKeepMovingPotentialProjects(identities, closedNoteTexts, today)
        : [];
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
      let needsDependents = projectPullInNeedsDependents(
        identities,
        closedNoteTexts,
        today,
        notePaths,
      );
      const hasExistingCandidates = closedTaskIds.size > 0 || pullInPaths.length > 0 ||
        pullInParentCandidates.length > 0 || keepMovingPotentialPaths.length > 0 ||
        reqCloseGroups.length > 0;
      if (!hasExistingCandidates && relationPreflight.state !== "candidates" &&
          relationPreflight.state !== "unavailable") {
        return quietGate;
      }
      if (!hasExistingCandidates && relationPreflight.state === "unavailable") {
        return relationUnavailableGate();
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
      } else if (
        planClosingEntry == null &&
        parkedSlot &&
        parkedSlot.entryDeleted !== true &&
        Number.isInteger(parkedSlot.entryLine) &&
        parkedSlot.entryLine >= 0 &&
        parkedSlot.entryLine < dailyBefore.length
      ) {
        planClosingEntry = parkedSlot.entryLine;
      }
      const keepMovingBaseline = dailyBefore.slice();
      const dayBaselineText = keepMovingBaseline.join("\n");
      const keepMovingGatePaths = linkUnblocked && !cancelledClose
        ? keepMovingPotentialPaths.filter((path) => identities.some((identity) =>
          identity && String(identity.path || "") === String(path) && identity.blockId &&
          dayBaselineText.includes(`#^${identity.blockId}`),
        ))
        : [];
      let keepMovingEnabled = false;
      if (keepMovingGatePaths.length > 0 && pickerV2) {
        try {
          const configOptions = active.keepMovingConfig && typeof active.keepMovingConfig === "object"
            ? active.keepMovingConfig
            : {};
          keepMovingEnabled = loadKeepMoving(configOptions) !== false;
        } catch (_error) {
          keepMovingEnabled = true;
        }
      }
      const keepMovingCandidatePaths = keepMovingEnabled ? keepMovingGatePaths : [];
      if (keepMovingCandidatePaths.length > 0 &&
          successorKeepMovingNeedsDependents(keepMovingCandidatePaths, identities, closedNoteTexts, today)) {
        needsDependents = true;
      }
      if (closedTaskIds.size === 0 && pullInPaths.length === 0 &&
          pullInParentCandidates.length === 0 && keepMovingCandidatePaths.length === 0 &&
          reqCloseGroups.length === 0 &&
          relationPreflight.state !== "candidates" &&
          relationPreflight.state !== "unavailable") {
        return quietGate;
      }
      if (closedTaskIds.size === 0 && pullInPaths.length === 0 &&
          pullInParentCandidates.length === 0 && keepMovingCandidatePaths.length === 0 &&
          reqCloseGroups.length === 0 &&
          relationPreflight.state === "unavailable") {
        return relationUnavailableGate();
      }
      let tasks = [];
      let noteTexts = new Map();
      let dependencySnapshotAvailable = false;
      for (const [path, text] of Object.entries(closedNoteTexts)) {
        noteTexts.set(path, text);
      }
      if (needsDependents) {
        const pool = await this.buildSuccessorPool(closedTaskIds, active, cache);
        tasks = pool.tasks;
        noteTexts = pool.noteTexts;
        dependencySnapshotAvailable = pool.warm === true;
        if (!pool.warm) {
          const cold = await this.readSuccessorColdDocuments(active, cache);
          dependencySnapshotAvailable = cold.complete === true;
          if (cold.documents.length === 0 && !vault && keepMovingCandidatePaths.length === 0) {
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
      let relationPlanOptions = {};
      let relationNotes = null;
      if (relationPreflight.state === "unavailable") {
        relationPlanOptions = {
          relationSuccessorLabels: relationRuntime.labels,
          navSuccessorsVersion: 3,
          relationIndexReady: false,
        };
      } else if (relationPreflight.state === "candidates") {
        relationNotes = await this.readSuccessorRelationInputs({
          runtime: relationRuntime,
          preflight: relationPreflight,
          active,
          cache,
          noteTexts,
          identities: relationLookupIdentities,
          baselineDay: dailyBefore,
          currentDay: dailyAfter,
          dailyPath: dailyPath || "",
          closingEntry: planClosingEntry,
          eventKind: relationEventKind,
          slot: parkedSlot,
        });
        relationPlanOptions = relationNotes.options || {};
        for (const [path, text] of relationNotes.noteTexts || []) {
          if (typeof text === "string") noteTexts.set(path, text);
        }
      }
      // Relation candidates are discovered in-memory first. Only a positive
      // incoming lookup whose source or project carries dependency fields
      // needs the existing dependency snapshot; edge-free Done gestures keep
      // their zero-extra-read path, including idless predecessors.
      if (!needsDependents &&
          successorRelationInputsNeedDependencySnapshot(relationPlanOptions, noteTexts)) {
        const freshRelationTexts = new Map(noteTexts);
        const pool = await this.buildSuccessorPool(closedTaskIds, active, cache);
        let refreshedTasks = [];
        let refreshedNotes = new Map();
        if (pool.warm) {
          refreshedTasks = pool.tasks;
          refreshedNotes = pool.noteTexts;
          dependencySnapshotAvailable = true;
        } else {
          const cold = await this.readSuccessorColdDocuments(active, cache);
          refreshedTasks = tasksFromDocuments(cold.documents);
          refreshedNotes = new Map(cold.documents.map((document) => [document.path, document.text]));
          for (const [path, text] of pool.noteTexts) {
            if (!refreshedNotes.has(path)) refreshedNotes.set(path, text);
          }
          dependencySnapshotAvailable = cold.complete === true;
        }
        for (const [path, text] of Object.entries(closedNoteTexts)) refreshedNotes.set(path, text);
        for (const [path, text] of freshRelationTexts) refreshedNotes.set(path, text);
        const overlayPaths = new Set(freshRelationTexts.keys());
        tasks = refreshedTasks.filter((task) => !overlayPaths.has(String(task && task.path || "")));
        for (const [path, text] of freshRelationTexts) {
          if (!isExcludedSuccessorVaultPath(path)) tasks.push(...tasksFromDocuments([{ path, text }]));
        }
        noteTexts = refreshedNotes;
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
      const successorThemesApiForPass = (() => {
        try {
          return typeof getSuccessorTaskThemesApi === "function" ? getSuccessorTaskThemesApi(this.app) : null;
        } catch (error) {
          return null;
        }
      })();
      const successorLedgerApiForPass = (() => {
        try {
          return typeof getSuccessorTaskLedgerApi === "function" ? getSuccessorTaskLedgerApi(this.app) : null;
        } catch (error) {
          return null;
        }
      })();
      const successorThemeForPass = successorThemesApiForPass
        ? { themesApi: successorThemesApiForPass, ledgerApi: successorLedgerApiForPass }
        : null;
      const noteTextsObject = {};
      for (const [path, text] of noteTexts) {
        noteTextsObject[path] = text;
      }
      let keepMovingAnchorHints = new Map();
      const planFirst = (
        selection,
        dailyB,
        dailyA,
        tasksForPlan,
        notesObj,
        closingForPlan,
        destinations,
        relationOptions = relationPlanOptions,
        linkUnblockedForPlan = linkUnblocked,
      ) => {
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
            destinations,
            linkUnblocked: linkUnblockedForPlan,
            cancelled: cancelledClose,
            isInbox: getSuccessorIsInbox(this.app),
            basenameCounts,
            closingEntry: closingForPlan,
            noteTexts: notesObj,
            notePaths,
            successorTheme: successorThemeForPass,
            keepMoving: keepMovingEnabled && pickerV2,
            keepMovingCandidatePaths,
            keepMovingBaseline,
            keepMovingCurrentDay: dailyA,
            dependencySnapshotAvailable,
            keepMovingAnchorHints,
            ...relationOptions,
            app: this.app,
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
      for (const offer of plan.offers || []) {
        if (offer && offer.group === "keep_moving" && offer.project && !keepMovingAnchorHints.has(offer.project)) {
          keepMovingAnchorHints.set(offer.project, offer.anchor);
        }
      }
      // One picker for the entire close batch (§12.13). Defensive detection;
      // null/empty/malformed/exception means no picks. Without a picker API,
      // apply recovery with no picks (plain "not pulled in" fallback).
      const selectableOffers = Array.isArray(plan.offers) ? plan.offers : [];
      let selectedKeys = [];
      let closeChoices = [];
      let reqRequests = null;
      let jumpKey = null;
      let reqJumpKey = null;
      let closeRevalidatedKeys = new Set();
      let pickerOpened = false;
      let originalOfferByKey = new Map();
      let selectedDestinations = new Map();
      let closePassNoteTexts = noteTextsObject;
      let closePassTasks = tasks;
      let closePassDependencySnapshotAvailable = dependencySnapshotAvailable;
      if ((selectableOffers.length > 0 || reqCloseGroups.length > 0) && pickerApi) {
        const picked = await this.pickSuccessorOfferChoices({
          plan,
          offers: selectableOffers,
          reqCloseGroups,
          identities,
          pickerApi,
          context: active,
          noteTexts: noteTextsObject,
          tasks,
          today,
          dailyPath,
          dailyBefore,
          dailyAfter,
          dependencySnapshotAvailable,
          markUnblockedLine: this.getFreshnessMarkUnblockedLine(),
        });
        pickerOpened = picked.pickerOpened === true;
        originalOfferByKey = picked.originalOfferByKey instanceof Map
          ? picked.originalOfferByKey
          : new Map();
        const choices = picked.choices;
        jumpKey = choices && choices.jump && typeof choices.jump.key === "string" ? choices.jump.key : null;
        reqRequests = choices && Array.isArray(choices.reqs) ? choices.reqs : null;
        reqJumpKey = reqCloseOwners.some((owner) => (owner.nodes || []).some((node) => node.key === jumpKey))
          ? jumpKey
          : null;
        const closeSupported = isSuccessorOfferCloseSupported(
          this.successorOfferCloseCapabilities(pickerApi),
        );
        const picks = choices && Array.isArray(choices.picks) ? choices.picks : [];
        closeChoices = closeSupported && choices && Array.isArray(choices.closes)
          ? choices.closes
          : [];
        const closeKeySet = new Set(closeChoices.map((close) => String(close.key)));
        selectedKeys = picks.map((pick) => pick && pick.key).filter(Boolean);
        selectedKeys = selectedKeys.filter((key) => !closeKeySet.has(String(key)));
        selectedDestinations = new Map();
        for (const pick of picks) {
          // Destination overrides keep optional themeIntent / preserveSpelling
          // from both normalizers; the write phase consumes them.
          if (pick && pick.key && pick.destination && !closeKeySet.has(String(pick.key))) {
            selectedDestinations.set(String(pick.key), pick.destination);
          }
        }
        const refreshed = await this.revalidateSuccessorPickerChoices({
          identities, selectableOffers, plan, selectedKeys, closeChoices, reqRequests, reqJumpKey,
          noteTexts, noteTextsObject, dailyPath, dailyBefore, dailyAfter, hint, planClosingEntry,
          active, cache, tasks, dailyCurrent, relationLookupIdentities, cancelledClose, pickerApi, today,
          relationPreflight, relationRuntime, relationEventKind, parkedSlot, relationPlanOptions,
          linkUnblocked, keepMovingEnabled, keepMovingCandidatePaths, keepMovingAnchorHints,
          dependencySnapshotAvailable, keepMovingBaseline, basenameCounts, planFirst,
          reqCloseOwners, closeRevalidatedKeys, selectedDestinations, closePassNoteTexts,
          closePassTasks, closePassDependencySnapshotAvailable,
          updateBasenames: (value) => { basenameCounts = value; },
          updateDependencySnapshot: (value) => { dependencySnapshotAvailable = value; },
        });
        plan = refreshed.plan;
        selectedKeys = refreshed.selectedKeys;
        selectedDestinations = refreshed.selectedDestinations;
        closeRevalidatedKeys = refreshed.closeRevalidatedKeys;
        closePassNoteTexts = refreshed.closePassNoteTexts;
        closePassTasks = refreshed.closePassTasks;
        closePassDependencySnapshotAvailable = refreshed.closePassDependencySnapshotAvailable;
        tasks = refreshed.tasks;
        dailyCurrent = refreshed.dailyCurrent;
        dailyBefore = refreshed.dailyBefore;
        dailyAfter = refreshed.dailyAfter;
        planClosingEntry = refreshed.planClosingEntry;
      }
      let reqCloseResult = null;
      const noteOutcome = await applySuccessorNoteEditsWithUnblockedGuard(this, plan, active);
      if (noteOutcome.failed > 0) {
        const planRows = successorPlanRows(plan);
        const failedRows = new Set();
        for (let index = 0; index < planRows.length; index += 1) {
          if (planRows[index] && planRows[index].not_linked === "failed") {
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
      let reqPullInClosing = hint && Number.isInteger(planClosingEntry)
        ? {
          continuationName: String(hint.createdName || hint.name || ""),
          closedLine: planClosingEntry,
        }
        : null;
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
              const row = successorPlanRows(plan)[placement.rowIndex];
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
            // The closed `[x]` entry always survives, so `relocated` is the
            // predecessor: find the created continuation after it.
            if (Array.isArray(hint.createdBlockLines) && hint.createdBlockLines.length > 0) {
              // The created continuation beats same-name reuse even when its
              // headline matches another placeholder: match its full block.
              try {
                const createdLine = findCreatedContinuationEntryLine(
                  dailyAfter,
                  hint.createdBlockLines,
                  typeof hint.createdName === "string" ? hint.createdName : "",
                  relocated,
                );
                if (createdLine != null) {
                  createdEntry = { line: createdLine };
                } else {
                  createdEntry = null;
                }
              } catch (error) {
                createdEntry = null;
              }
            } else {
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
        }
        if (relocated != null) {
          reqPullInClosing = {
            continuationName: String(hint && (hint.createdName || hint.name) || ""),
            closedLine: relocated,
            ...(createdEntry && Number.isInteger(createdEntry.line)
              ? { continuation: { line: createdEntry.line + 1, created: true } }
              : {}),
          };
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
          const row = successorPlanRows(plan)[placement && placement.rowIndex];
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
      let closeResult = null;
      if (closeChoices.length > 0) {
        closeResult = await this.applySuccessorOfferCloseChoices({
          closes: closeChoices,
          revalidatedKeys: closeRevalidatedKeys,
          cardOffers: originalOfferByKey,
          freshOffers: Array.isArray(plan.offers) ? plan.offers : [],
          cardNoteTexts: noteTextsObject,
          noteTexts: closePassNoteTexts,
          plan,
          tasks: closePassTasks,
          today,
          dailyPath,
          notePaths,
          dependencySnapshotAvailable: closePassDependencySnapshotAvailable,
          markUnblockedLine: this.getFreshnessMarkUnblockedLine(),
          pickerApi,
          context: active,
        });
        if (closeResult) removeResolvedOfferCloseRows(plan, closeResult);
      }
      if (reqRequests !== null || reqJumpKey) {
        reqCloseResult = await this.applyManagedReqCloseCard({
          owners: reqCloseOwners,
          choices: {
            ...(reqRequests !== null ? { reqs: reqRequests } : {}),
            ...(reqJumpKey ? { jump: { key: reqJumpKey } } : {}),
          },
          taskOfferKeys: selectableOffers.map((offer) => String(offer && offer.key || "")).filter(Boolean),
          notes: closePassNoteTexts,
          identities,
          today,
          dailyPath,
          closing: reqPullInClosing,
          closingHint: hint,
          context: active,
        });
      }
      if (reqCloseResult && Array.isArray(reqCloseResult.outcomes) &&
          reqCloseResult.outcomes.some((row) => row && row.verdict === "carry_pulled")) {
        reqCloseResult = await this.finishManagedReqPullIn({
          result: reqCloseResult,
          owners: reqCloseOwners,
          identities,
          dailyPath,
          today,
          index: reqCloseResult.index,
          completed: reqCloseResult.completed,
          closing: reqPullInClosing,
          closingHint: hint,
          context: active,
        });
      }
      const reqRestores = reqCloseResult && Array.isArray(reqCloseResult.restores)
        ? reqCloseResult.restores
        : [];
      const closeRestores = closeResult && closeResult.undo && Array.isArray(closeResult.undo.restores)
        ? closeResult.undo.restores
        : [];
      const composedRestores = reqCloseIntegrationComposeRestores([...reqRestores, ...closeRestores]);
      if (composedRestores.length > 0) {
        closeResult = {
          ...(closeResult || {}),
          undo: { ...(closeResult && closeResult.undo || {}), restores: composedRestores },
        };
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
      plan.relation_picker_opened = pickerOpened;
      const predecessors = identities.map((identity) => ({
        note_path: String(identity.path || ""),
        block_id: identity.blockId ? String(identity.blockId) : "",
        text: identity.text ? String(identity.text) : "",
      }));
      let dailyContent = null;
      if (
        dailyPath &&
        (plan.unblocked.length > 0 || (plan.keep_moving || []).length > 0 ||
          (plan.relation_successors || []).length > 0 || noteOutcome.failed > 0)
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
      let jump = reqCloseResult && reqCloseResult.reqJump
        ? await this.resolveManagedReqCloseLanding({
          owners: reqCloseOwners,
          plan: reqCloseResult,
          key: reqCloseResult.reqJump,
          context: active,
        })
        : null;
      if (jump && jump.ok === false) {
        reqCloseResult.failures = [
          ...(Array.isArray(reqCloseResult.failures) ? reqCloseResult.failures : []),
          { kind: "requirement_jump", code: jump.code, reason: jump.message },
        ];
        jump = null;
      } else if (jump && jump.ok === true) {
        jump = { ...jump, label: jump.description || "requirement" };
      }
      if (!jump && jumpKey && !reqJumpKey) {
        jump = buildSuccessorJumpIdentity(jumpKey, originalOfferByKey, plan, closeResult);
      }
      const receiptFailures = [
        ...(closeResult && Array.isArray(closeResult.failures) ? closeResult.failures : []),
        ...(reqCloseResult && Array.isArray(reqCloseResult.failures) ? reqCloseResult.failures : []),
      ];
      return {
        version: 1,
        predecessors,
        unblocked: plan.unblocked,
        keep_moving: plan.keep_moving || [],
        still_blocked: plan.still_blocked,
        ...(Array.isArray(plan.relation_successors)
          ? { relation_successors: plan.relation_successors }
          : {}),
        ...(Array.isArray(plan.relation_held)
          ? { relation_held: plan.relation_held }
          : {}),
        ...(plan.relation_check ? { relation_check: plan.relation_check } : {}),
        ...(Array.isArray(plan.relation_labels)
          ? { relation_labels: plan.relation_labels }
          : {}),
        ...(closeResult && Array.isArray(closeResult.offer_closes)
          ? { offer_closes: closeResult.offer_closes }
          : {}),
        ...(closeResult && closeResult.offer_close_refused
          ? { offer_close_refused: closeResult.offer_close_refused }
          : {}),
        ...(closeResult && closeResult.undo ? { undo: closeResult.undo } : {}),
        ...(reqCloseResult && Array.isArray(reqCloseResult.req_outcomes)
          ? { req_outcomes: reqCloseResult.req_outcomes }
          : {}),
        ...(reqCloseResult && Array.isArray(reqCloseResult.met)
          ? { req_met: reqCloseResult.met }
          : {}),
        ...(closeResult && Array.isArray(closeResult.resolved)
          ? { resolved: closeResult.resolved }
          : {}),
        ...(receiptFailures.length > 0
          ? { failures: receiptFailures }
          : {}),
        ...(jump ? { jump } : {}),
        relation_picker_opened: pickerOpened,
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
