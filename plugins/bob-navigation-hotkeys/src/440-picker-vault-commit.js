class BulletPropertyPickerVaultCommitMixin extends FilteredPickerModal {
  reopenDependencyStageFresh() {
    try {
      const plugin = this.plugin;
      const editor = this.editor;
      if (
        !plugin ||
        !editor ||
        typeof plugin.openBulletPropertyPicker !== "function"
      ) {
        return;
      }
      try {
        this.close();
      } catch (_closeError) {
        // Best-effort close only.
      }
      void plugin.openBulletPropertyPicker(editor, {
        initialProperty: "dependsOn",
        inboxRoute: this.inboxRoute || null,
      });
    } catch (_reopenError) {
      // Best-effort reopen only.
    }
  }

  refuseDependencyStale(message = "changed — reopen") {
    new Notice(message);
    this.reopenDependencyStageFresh();
    return false;
  }

  async removeSingleDependency(item) {
    const ownerPath = normalizeVaultRelativePath(this.filePath || "");
    const blockId = normalizeBulletPropertyValue(
      item.blockId || item.existingBlockId || "",
    );
    if (!ownerPath || !blockId) {
      new Notice("⛓ Could not remove dependency (missing link target)");
      return false;
    }
    const removeAction = { label: "remove 1 prerequisite" };
    const removeWrite = async () => {
      const outcome = await this.plugin.applyDependencyEdit({
        editor: this.editor,
        parentPath: ownerPath,
        parentLine: this.cursor.line,
        add: [],
        remove: [
          { path: normalizeVaultRelativePath(item.path || ownerPath), blockId },
        ],
      });
      if (!outcome.ok) {
        if (outcome.reason === "stale-editor") {
          // `applyDependencyEdit` already showed `changed — reopen`: only
          // reopen the stage fresh, without a second notice (§6.4).
          this.reopenDependencyStageFresh();
          return false;
        }
        new Notice(`⛓ Could not remove dependency (${outcome.reason})`);
        return false;
      }
      new Notice(outcome.notice || "⛓ Dependency removed");
      return true;
    };
    if (typeof this.runInboxRoutedCommit === "function") {
      return await this.runInboxRoutedCommit(removeAction, removeWrite);
    }
    return await removeWrite();
  }

  // Vault-wide single add: re-read the target note and refuse when the
  // target changed since the stage opened, then commit through the writer.
  // Rows without a block id detour through the `+ id` prompt first.
  async chooseVaultTaskDependency(item) {
    const parentValidation = validateDependencyParentForEditor(
      this.editor,
      this.cursor,
      this.lineText,
    );
    if (!parentValidation.valid) {
      new Notice(parentValidation.message);
      return false;
    }
    const ownerPath = normalizeVaultRelativePath(this.filePath || "");
    const snapshot = {
      markKey: bulletPropertyTaskMarkKey(item),
      path: normalizeVaultRelativePath(item.path || ownerPath),
      line: item.line,
      rawLine: item.rawLine,
      displayText: item.displayText,
      existingIdField: item.existingIdField || null,
      blockId: item.existingBlockId || null,
    };
    const ownerForSingle = normalizeVaultRelativePath(this.filePath || "");
    const singleTargetPath = normalizeVaultRelativePath(
      snapshot.path || ownerForSingle,
    );
    const singleFiles = await this.readVaultStageFiles([singleTargetPath]);
    if (!singleFiles) {
      return false;
    }
    if (this.vaultStage && this.vaultStage.files instanceof Map) {
      this.vaultStage.files.set(
        singleTargetPath,
        singleFiles.get(singleTargetPath),
      );
    }
    if (!snapshot.blockId && snapshot.rawLine == null) {
      // Cache-only `+ id` row: match the target fresh by display text.
      const located = locateStageDisplayText(
        singleFiles.get(singleTargetPath),
        snapshot.displayText,
      );
      if (!located) {
        return this.refuseDependencyStale();
      }
      snapshot.line = located.line;
      snapshot.rawLine = located.rawLine;
      if (located.blockId) {
        snapshot.blockId = located.blockId;
      }
    }
    if (!snapshot.blockId) {
      this.pendingVaultSingle = { snapshot, reservedIds: new Set() };
      this.showBlockIdStage(snapshot, { mode: "vault-single" });
      return false;
    }
    const files = singleFiles;
    const counters = { stale: 0, other: 0 };
    const addition = this.collectVaultAddition(snapshot, files, counters);
    if (!addition) {
      if (counters.stale > 0) {
        return this.refuseDependencyStale();
      }
      new Notice("Could not identify the selected dependency");
      return false;
    }
    return this.commitVaultRefs([addition], [], counters);
  }

  // Fresh contents for the parent plus every involved target note: stage
  // snapshots first (open buffers win), then a guarded vault read for the
  // rest. Returns null with a notice when an addition target is unreadable:
  // if preparation fails, the dependent is untouched (§6.6).
  async readVaultStageFiles(paths) {
    const ownerPath = normalizeVaultRelativePath(this.filePath || "");
    const files = new Map();
    if (this.vaultStage && this.vaultStage.files instanceof Map) {
      for (const [path, content] of this.vaultStage.files) {
        files.set(path, String(content || ""));
      }
    }
    files.set(ownerPath, String(this.editor.getValue() || ""));
    for (const rawPath of paths || []) {
      const path = normalizeVaultRelativePath(rawPath || "");
      if (!path) {
        continue;
      }
      // Open buffers win over stage snapshots (a `+ id` pre-write lands in
      // the buffer first); otherwise re-read, so validation and planning
      // see post-open edits.
      const buffered =
        this.plugin && typeof this.plugin.readOpenBufferContent === "function"
          ? this.plugin.readOpenBufferContent(path)
          : null;
      if (buffered !== null) {
        files.set(path, buffered);
        continue;
      }
      if (files.has(path)) {
        continue;
      }
      const loaded = await this.plugin.readDependencyNoteContent(
        path,
        null,
        ownerPath,
      );
      if (loaded === null) {
        new Notice(`⛓ Could not read ${path}; no tasks were updated`);
        return null;
      }
      files.set(path, String(loaded));
    }
    return files;
  }

  // Resolve one vault addition against fresh content: the target must still
  // carry the staged block id on the staged line text, else it is stale.
  // Prompt-queue snapshots (no block id yet) match by line text instead.
  collectVaultAddition(snapshot, files, counters, confirmedId = null) {
    const ownerPath = normalizeVaultRelativePath(this.filePath || "");
    const targetPath = normalizeVaultRelativePath(
      snapshot.path || ownerPath,
    );
    const targetContent = files.get(targetPath);
    if (targetContent === undefined) {
      counters.other += 1;
      return null;
    }
    const targetLines = String(targetContent).split(/\r?\n/);
    const at = Math.floor(numericOrDefault(snapshot.line, Number.NaN));
    const wantBlockId =
      confirmedId !== null
        ? normalizeBulletPropertyValue(confirmedId)
        : normalizeBulletPropertyValue(snapshot.blockId || "");
    if (confirmedId !== null) {
      const validation = validateBlockIdCandidate(
        confirmedId,
        targetContent,
        { reservedIds: this.getBlockIdReservedIds() },
      );
      if (!validation.valid || !tryDependencyId(targetPath, validation.id)) {
        counters.other += 1;
        return null;
      }
      if (
        !Number.isFinite(at) ||
        targetLines[at] !== snapshot.rawLine ||
        !isObsidianTaskAtLine(targetContent, at, null, targetLines)
      ) {
        counters.stale += 1;
        return null;
      }
      return { path: targetPath, blockId: validation.id };
    }
    if (!wantBlockId) {
      counters.other += 1;
      return null;
    }
    // Just-prepared `+ id` targets — and cache-only rows, which carry no
    // staged line text — resolve by block id with task-ness as the check.
    if (snapshot.preparedId || snapshot.rawLine == null) {
      const placed = findTaskLineByTrailingBlockId(targetLines, wantBlockId);
      if (
        placed === null ||
        !isObsidianTaskAtLine(targetContent, placed, null, targetLines)
      ) {
        counters.stale += 1;
        return null;
      }
      return { path: targetPath, blockId: wantBlockId };
    }
    const found = findTaskLineByTrailingBlockId(targetLines, wantBlockId);
    if (
      found === null ||
      String(targetLines[found] || "") !== String(snapshot.rawLine || "") ||
      !isObsidianTaskAtLine(targetContent, found, null, targetLines)
    ) {
      counters.stale += 1;
      return null;
    }
    return { path: targetPath, blockId: wantBlockId };
  }

  // One vault commit for a whole batch: guards the batch graph for cycles
  // after the whole batch (§6.4), then writes through `applyDependencyEdit`
  // — cross-note targets prepared first, the dependent committed in one
  // editor transaction, with the §6.7 notice.
  async commitVaultRefs(addRefs, removeRefs, counters = { stale: 0, other: 0 }) {
    const ownerPath = normalizeVaultRelativePath(this.filePath || "");
    const stage = this.vaultStage;
    const dependentKey = stage && stage.dependent ? stage.dependent.key : null;
    if (dependentKey && stage && stage.edges instanceof Map) {
      const trial = new Map();
      for (const [from, targets] of stage.edges) {
        trial.set(from, targets.slice());
      }
      const dropKeys = new Set(
        removeRefs
          .map((ref) => dependencyStageRowKey(ref.path, ref.blockId))
          .filter(Boolean),
      );
      const current = (trial.get(dependentKey) || []).filter(
        (key) => !dropKeys.has(key),
      );
      for (const ref of addRefs) {
        const key = dependencyStageRowKey(ref.path, ref.blockId);
        if (key && !current.includes(key)) {
          current.push(key);
        }
      }
      trial.set(dependentKey, current);
      for (const ref of addRefs) {
        const key = dependencyStageRowKey(ref.path, ref.blockId);
        const cycle =
          key === dependentKey
            ? [dependentKey]
            : findDependencyStageCycle(trial, dependentKey, key);
        if (key && cycle) {
          new Notice(
            `⛓ Could not update dependencies (would create a cycle: ${cycle.length - 1} back-link${cycle.length - 1 === 1 ? "" : "s"})`,
          );
          return false;
        }
      }
    }
    const count = (Array.isArray(addRefs) ? addRefs.length : 0) +
      (Array.isArray(removeRefs) ? removeRefs.length : 0);
    const vaultAction = {
      label: count > 1 ? `add ${count} prerequisites` : "edit dependencies",
    };
    const vaultWrite = async () => {
      const outcome = await this.plugin.applyDependencyEdit({
        editor: this.editor,
        parentPath: ownerPath,
        parentLine: this.cursor.line,
        add: addRefs,
        remove: removeRefs,
      });
      if (!outcome.ok) {
        // A stale write refuses and reopens the stage fresh, exactly like the
        // same-note `executeDependencyBatch` (§6.4). `applyDependencyEdit`
        // already showed `changed — reopen`, so only reopen here.
        if (outcome.reason === "stale-editor") {
          this.reopenDependencyStageFresh();
          return false;
        }
        new Notice(dependencyPlanFailureNotice(outcome.reason, "update"));
        return false;
      }
      const skipped = (counters.stale || 0) + (counters.other || 0);
      new Notice(
        (outcome.notice || "⛓ Dependencies updated") +
          (skipped > 0 ? ` (${skipped} skipped)` : ""),
      );
      return true;
    };
    if (typeof this.runInboxRoutedCommit === "function") {
      return await this.runInboxRoutedCommit(vaultAction, vaultWrite);
    }
    return await vaultWrite();
  }

  // Batch executor for stages containing cross-note rows: every target is
  // re-read fresh (a stale row refuses the whole batch before any write),
  // `+ id` prompts were collected up front, and the whole batch commits
  // once.
  async executeVaultDependencyBatchWithoutInboxRoute(batch, seedCounters = null) {
    const parentValidation = validateDependencyParentForEditor(
      this.editor,
      this.cursor,
      batch.cursorLineText,
    );
    if (!parentValidation.valid) {
      new Notice(parentValidation.message);
      return false;
    }
    const ownerPath = normalizeVaultRelativePath(this.filePath || "");
    if (!ownerPath) {
      new Notice(
        "Dependencies are unavailable: this note path cannot be encoded as a dependency ID",
      );
      return false;
    }
    const targetPaths = new Set();
    for (const snapshot of [...batch.readyAdditions, ...batch.promptQueue]) {
      targetPaths.add(normalizeVaultRelativePath(snapshot.path || ownerPath));
    }
    const files = await this.readVaultStageFiles([...targetPaths]);
    if (!files) {
      return false;
    }
    const counters = {
      stale: (seedCounters && seedCounters.stale) || 0,
      other: (seedCounters && seedCounters.skippedOther) || 0,
    };
    const addRefs = [];
    for (const snapshot of batch.readyAdditions) {
      const addition = this.collectVaultAddition(snapshot, files, counters);
      if (addition) {
        addRefs.push(addition);
      }
    }
    // A stale row refuses the whole batch before any write, then reopens
    // the stage fresh — never a partial commit with a skip count — exactly
    // like the same-note `executeDependencyBatch` (§6.4).
    if (counters.stale > 0) {
      return this.refuseDependencyStale();
    }
    // Prompt-queue targets validate before any `+ id` preparation writes:
    // a stale prompt row below refuses with nothing written, even when an
    // earlier target already validated.
    const pendingPreparations = [];
    for (const snapshot of batch.promptQueue) {
      const key = snapshot.markKey !== undefined && snapshot.markKey !== null
        ? snapshot.markKey
        : snapshot.line;
      const confirmedId = batch.confirmedById.get(key);
      if (!confirmedId) {
        counters.other += 1;
        continue;
      }
      const addition = this.collectVaultAddition(
        snapshot,
        files,
        counters,
        confirmedId,
      );
      if (!addition) {
        continue;
      }
      // The planner resolves targets by `^block-id`, so the confirmed id is
      // written to the target first (open editor, else a preimage-checked
      // vault update). If preparation fails the dependent is untouched.
      const targetPath = normalizeVaultRelativePath(
        snapshot.path || ownerPath,
      );
      const freshContent = files.get(targetPath);
      const freshLines = String(freshContent).split(/\r?\n/);
      const updatedLine = applyPromptedBlockIdPreservingLegacyId(
        freshLines[snapshot.line],
        addition.blockId,
        targetPath,
      );
      if (updatedLine === null) {
        counters.other += 1;
        continue;
      }
      pendingPreparations.push({
        snapshot,
        addition,
        targetPath,
        from: freshLines[snapshot.line],
        text: updatedLine,
      });
    }
    if (counters.stale > 0) {
      return this.refuseDependencyStale();
    }
    for (const preparation of pendingPreparations) {
      const prepared = await this.plugin.prepareDependencyTargetNote(
        preparation.targetPath,
        {
          line: preparation.snapshot.line,
          from: preparation.from,
          text: preparation.text,
        },
      );
      if (!prepared.ok) {
        new Notice(
          `⛓ Could not prepare ${preparation.targetPath} (${prepared.reason}); no tasks were updated`,
        );
        return false;
      }
      addRefs.push(preparation.addition);
    }
    // Removal marks carry the field value; cross-note removals resolve
    // through the staged block id, same-note removals through the existing
    // note scan. Field-only values need no link edit: the planner sets the
    // field from the line, so they fall out on their own.
    const noteLines = String(this.editor.getValue() || "").split(/\r?\n/);
    const removeRefs = [];
    for (const removal of batch.removals) {
      const removalPath = normalizeVaultRelativePath(
        removal.path || ownerPath,
      );
      if (removalPath !== ownerPath) {
        if (normalizeBulletPropertyValue(removal.blockId || "")) {
          removeRefs.push({ path: removalPath, blockId: removal.blockId });
        } else {
          counters.other += 1;
        }
        continue;
      }
      const candidates = [
        removal.linkBlockId,
        removal.depValue,
        removal.legacyDepValue,
      ]
        .map(normalizeBulletPropertyValue)
        .filter(Boolean);
      let resolved = null;
      for (const candidate of candidates) {
        if (findTaskLineByTrailingBlockId(noteLines, candidate) !== null) {
          resolved = candidate;
          break;
        }
      }
      if (!resolved) {
        for (let index = 0; index < noteLines.length; index += 1) {
          if (!isObsidianTaskAtLine(String(this.editor.getValue() || ""), index)) {
            continue;
          }
          const idField = findBulletPropertyField(noteLines[index], "id");
          const idValue = idField && normalizeBulletPropertyValue(idField.value);
          if (idValue && candidates.includes(idValue)) {
            const blockId = getTrailingBlockId(noteLines[index]);
            if (blockId) {
              resolved = blockId;
              break;
            }
          }
        }
      }
      if (resolved) {
        removeRefs.push({ path: ownerPath, blockId: resolved });
      }
    }
    if (addRefs.length === 0 && removeRefs.length === 0) {
      const skipped = counters.stale + counters.other;
      new Notice(
        skipped > 0
          ? `No dependencies changed (${skipped} skipped)`
          : "No dependencies changed",
      );
      return false;
    }
    return this.commitVaultRefs(addRefs, removeRefs, counters);
  }

  hasCountedRollBatchForDateProperty(datePropertyName) {
    if (!this.isCountedSession()) {
      return false;
    }
    const batch = this.getCountedRollBatchForDateProperty(datePropertyName);
    if (!batch) {
      return false;
    }
    return (
      batch.actionableCount > 0 || Boolean(batch.unavailableReason)
    );
  }

  async applyCountedRecommendedRoll() {
    const cached = this.countedRollBatch;
    if (!cached) {
      return false;
    }
    if (cached.unavailableReason) {
      new Notice(cached.unavailableReason);
      return false;
    }
    if (this.opening) {
      return false;
    }
    this.opening = true;
    try {
      const fresh = this.computeCountedRollBatch();
      if (
        !fresh ||
        fresh.actionableCount !== cached.actionableCount ||
        fresh.counts.roll !== cached.counts.roll ||
        fresh.counts.decay !== cached.counts.decay ||
        fresh.counts.cancel !== cached.counts.cancel ||
        Boolean(fresh.unavailableReason) !==
          Boolean(cached.unavailableReason)
      ) {
        new Notice("Task changed while the picker was open; nothing was written");
        this.countedRollBatch = fresh;
        this.countedRollBatchReady = true;
        this.returnHome({ rebuild: true });
        return false;
      }
      return await this.maybeOfferCountedRecommendedWorkLog(cached);
    } finally {
      this.opening = false;
    }
  }

  describeInboxRouteCountedRollAction(cached) {
    try {
      const count =
        cached && Number.isInteger(cached.actionableCount)
          ? cached.actionableCount
          : 0;
      return {
        label:
          count > 1 ? `apply ${count} rolls` : "apply recommendation",
      };
    } catch (error) {
      return { label: "apply recommendation" };
    }
  }

  async maybeOfferCountedRecommendedWorkLog(cached) {
    const entries = Array.isArray(cached.entries) ? cached.entries : [];
    const schedulingEntries = entries.filter(
      (entry) =>
        entry &&
        entry.recommendation &&
        (entry.recommendation.kind === "roll" ||
          entry.recommendation.kind === "decay"),
    );
    const countedAction = this.describeInboxRouteCountedRollAction(cached);
    const runCountedRoll = async (schedulingWorkLog) =>
      await this.plugin.applyCountedRecommendedRoll(this, {
        schedulingWorkLog: schedulingWorkLog || null,
      });
    const runRoutedCountedRoll = async (schedulingWorkLog) => {
      if (typeof this.runInboxRoutedCommit === "function") {
        return await this.runInboxRoutedCommit(countedAction, () =>
          runCountedRoll(schedulingWorkLog),
        );
      }
      return await runCountedRoll(schedulingWorkLog);
    };
    if (schedulingEntries.length === 0) {
      return await runRoutedCountedRoll(null);
    }
    const targets = schedulingEntries.map((entry) => ({
      line: entry.line,
      rawLine: entry.rawLine,
    }));
    const eligible = collectSchedulingWorkLogEligibleOriginalLines(targets);
    if (eligible.size === 0) {
      return await runRoutedCountedRoll(null);
    }
    const dates = schedulingEntries
      .map((entry) => entry.recommendation && entry.recommendation.date)
      .filter(Boolean);
    const scheduleSummary = formatSchedulingWorkLogDateSpan(dates);
    return await this.offerSchedulingWorkLogOrDispatch({
      targets,
      scheduleSummary,
      dispatch: async (summary) =>
        await runRoutedCountedRoll(
          summary
            ? {
                summary,
                dateText: formatBulletPropertyDate(
                  this.valueBaseDate instanceof Date
                    ? this.valueBaseDate
                    : getLocalDateStart(new Date()),
                ),
              }
            : null,
        ),
    });
  }

  async applyLinkRecommendedRoll() {
    const cached = this.linkRollBatch;
    if (!cached) {
      return false;
    }
    if (cached.unavailableReason) {
      new Notice(cached.unavailableReason);
      return false;
    }
    if (this.opening) {
      return false;
    }
    this.opening = true;
    try {
      const fresh = this.computeLinkRollBatch();
      if (
        !fresh ||
        fresh.actionableCount !== cached.actionableCount ||
        fresh.counts.roll !== cached.counts.roll ||
        fresh.counts.decay !== cached.counts.decay ||
        fresh.counts.cancel !== cached.counts.cancel ||
        Boolean(fresh.unavailableReason) !==
          Boolean(cached.unavailableReason)
      ) {
        new Notice("Task changed while the picker was open; nothing was written");
        this.linkRollBatch = fresh;
        this.linkRollBatchReady = true;
        this.returnHome({ rebuild: true });
        return false;
      }
      return await this.maybeOfferLinkRecommendedWorkLog(cached);
    } finally {
      this.opening = false;
    }
  }

  async maybeOfferLinkRecommendedWorkLog(cached) {
    const entries = Array.isArray(cached.entries) ? cached.entries : [];
    const schedulingEntries = entries.filter(
      (entry) =>
        entry &&
        entry.recommendation &&
        (entry.recommendation.kind === "roll" ||
          entry.recommendation.kind === "decay"),
    );
    if (schedulingEntries.length === 0) {
      return await this.plugin.applyLinkRecommendedRoll(this);
    }
    const targets = schedulingEntries.map((entry) => ({
      line: entry.line,
      rawLine: entry.rawLine,
      path: entry.path,
    }));
    const eligible = collectSchedulingWorkLogEligibleOriginalLines(targets);
    if (eligible.size === 0) {
      return await this.plugin.applyLinkRecommendedRoll(this);
    }
    const dates = schedulingEntries
      .map((entry) => entry.recommendation && entry.recommendation.date)
      .filter(Boolean);
    const scheduleSummary = formatSchedulingWorkLogDateSpan(dates);
    // Writers resolve per-note groups and deduplicate repeated links by
    // note and task identity so each qualifying task receives at most one
    // entry; the prompt names the qualifying count for the scheduling subset.
    return await this.offerSchedulingWorkLogOrDispatch({
      targets,
      scheduleSummary,
      dispatch: async (summary) =>
        await this.plugin.applyLinkRecommendedRoll(this, {
          schedulingWorkLog: summary
            ? {
                summary,
                dateText: formatBulletPropertyDate(
                  this.valueBaseDate instanceof Date
                    ? this.valueBaseDate
                    : getLocalDateStart(new Date()),
                ),
              }
            : null,
        }),
    });
  }

  async executeVaultDependencyBatch(batch, seedCounters = null) {
    const inboxAction = { label: "add 2 prerequisites" };
    const inboxWrite = async () => await this.executeVaultDependencyBatchWithoutInboxRoute(batch, seedCounters);
    if (typeof this.runInboxRoutedCommit === "function") {
      return await this.runInboxRoutedCommit(inboxAction, inboxWrite);
    }
    return await inboxWrite();
  }
}
