class BulletPropertyPickerVaultBatchMixin extends FilteredPickerModal {
  async prepareVaultBatch(batch) {
    const ownerPath = normalizeVaultRelativePath(this.filePath || "");
    const live = [];
    for (const snapshot of batch.promptQueue) {
      const targetPath = normalizeVaultRelativePath(
        snapshot.path || ownerPath,
      );
      const files = await this.readVaultStageFiles([targetPath]);
      if (!files) {
        return false;
      }
      if (this.vaultStage && this.vaultStage.files instanceof Map) {
        this.vaultStage.files.set(targetPath, files.get(targetPath));
      }
      if (snapshot.rawLine == null && !snapshot.blockId) {
        const located = locateStageDisplayText(
          files.get(targetPath),
          snapshot.displayText,
        );
        if (!located) {
          snapshot.dead = true;
          live.push(snapshot);
          continue;
        }
        snapshot.line = located.line;
        snapshot.rawLine = located.rawLine;
        if (located.blockId) {
          snapshot.blockId = located.blockId;
          batch.readyAdditions.push(snapshot);
          continue;
        }
      }
      live.push(snapshot);
    }
    batch.promptQueue = live.filter((snapshot) => !snapshot.dead);
    const deadCount = live.filter((snapshot) => snapshot.dead).length;
    if (deadCount > 0) {
      batch.deadPromptCount = (batch.deadPromptCount || 0) + deadCount;
    }
    if (batch.promptQueue.length === 0) {
      this.clearPendingBatch();
      return this.executeVaultDependencyBatch(batch, {
        skippedOther: batch.deadPromptCount || 0,
      });
    }
    this.pendingBatch = batch;
    return this.promptNextBatchBlockId();
  }

  // Open the block-ID prompt for the task at the current queue position. Returns
  // false so the modal stays open while prompts are collected.
  promptNextBatchBlockId() {
    const batch = this.pendingBatch;
    if (!batch) {
      return false;
    }

    const snapshot = batch.promptQueue[batch.promptIndex];
    if (!snapshot) {
      return false;
    }

    this.showBlockIdStage(snapshot, {
      mode: "batch",
      position: batch.promptIndex + 1,
      total: batch.promptQueue.length,
    });
    return false;
  }

  confirmBlockId(item) {
    if (!this.selectedPropertyItem || !this.pendingTask || !item) {
      return false;
    }

    if (!item.valid) {
      return false;
    }

    if (this.blockIdMode === "batch" && this.pendingBatch) {
      return this.confirmBatchBlockId(item);
    }

    if (
      this.blockIdMode === "counted-source" &&
      this.pendingCountedDependency
    ) {
      return this.confirmCountedDependencyBlockId(item);
    }

    if (this.blockIdMode === "vault-single" && this.pendingVaultSingle) {
      return this.confirmVaultSingleBlockId(item);
    }

    if (this.blockIdMode === "vault-counted" && this.pendingVaultCounted) {
      return this.confirmVaultCountedBlockId(item);
    }

    return this.confirmSingleBlockId(item);
  }

  // Single `+ id` for a cross-note row: the confirmed id is written to the
  // target note first (an unused target id is acceptable, a link to an
  // unprepared target is not), then the link commits through the writer.
  async confirmVaultSingleBlockId(item) {
    const pending = this.pendingVaultSingle;
    if (!pending || !item.valid) {
      return false;
    }
    const snapshot = pending.snapshot;
    const ownerPath = normalizeVaultRelativePath(this.filePath || "");
    const targetPath = normalizeVaultRelativePath(
      snapshot.path || ownerPath,
    );
    const files = await this.readVaultStageFiles([targetPath]);
    if (!files) {
      return false;
    }
    const targetContent = files.get(targetPath);
    const validation = validateBlockIdCandidate(item.id, targetContent, {
      reservedIds: pending.reservedIds || new Set(),
    });
    if (!validation.valid || !tryDependencyId(targetPath, validation.id)) {
      new Notice(
        validation.message || "That block ID cannot be used in the target note",
      );
      return false;
    }
    const targetLines = String(targetContent).split(/\r?\n/);
    if (
      targetLines[snapshot.line] !== snapshot.rawLine ||
      !isObsidianTaskAtLine(targetContent, snapshot.line, null, targetLines)
    ) {
      return this.refuseDependencyStale();
    }
    const updatedLine = applyPromptedBlockIdPreservingLegacyId(
      targetLines[snapshot.line],
      validation.id,
      targetPath,
    );
    if (updatedLine === null) {
      new Notice(
        "Dependency not added: this note path cannot be encoded as a dependency ID",
      );
      return false;
    }
    const prepared = await this.plugin.prepareDependencyTargetNote(
      targetPath,
      {
        line: snapshot.line,
        from: targetLines[snapshot.line],
        text: updatedLine,
      },
    );
    if (!prepared.ok) {
      new Notice(`⛓ Could not prepare ${targetPath} (${prepared.reason})`);
      return false;
    }
    this.clearPendingBatch();
    const counters = { stale: 0, other: 0 };
    return this.commitVaultRefs(
      [{ path: targetPath, blockId: validation.id }],
      [],
      counters,
    );
  }

  // Counted `+ id` for a cross-note row: one prompt, then the link applies
  // to every source task that is not already linked.
  async confirmVaultCountedBlockId(item) {
    const pending = this.pendingVaultCounted;
    if (!pending || !item.valid) {
      return false;
    }
    const snapshot = pending.snapshot;
    const targetPath = normalizeVaultRelativePath(
      snapshot.path || this.filePath || "",
    );
    const files = await this.readVaultStageFiles([targetPath]);
    if (!files) {
      return false;
    }
    const validation = validateBlockIdCandidate(
      item.id,
      files.get(targetPath),
      { reservedIds: pending.reservedIds || new Set() },
    );
    if (!validation.valid || !tryDependencyId(targetPath, validation.id)) {
      new Notice(
        validation.message || "That block ID cannot be used in the target note",
      );
      return false;
    }
    // The planner resolves targets by `^block-id`, so the confirmed id is
    // written to the target before the single commit below runs.
    const targetLines = String(files.get(targetPath)).split(/\r?\n/);
    if (
      targetLines[snapshot.line] !== snapshot.rawLine ||
      !isObsidianTaskAtLine(files.get(targetPath), snapshot.line, null, targetLines)
    ) {
      return this.refuseDependencyStale();
    }
    const updatedLine = applyPromptedBlockIdPreservingLegacyId(
      targetLines[snapshot.line],
      validation.id,
      targetPath,
    );
    if (updatedLine === null) {
      new Notice(
        "Dependency not added: this note path cannot be encoded as a dependency ID",
      );
      return false;
    }
    const prepared = await this.plugin.prepareDependencyTargetNote(
      targetPath,
      {
        line: snapshot.line,
        from: targetLines[snapshot.line],
        text: updatedLine,
      },
    );
    if (!prepared.ok) {
      new Notice(`⛓ Could not prepare ${targetPath} (${prepared.reason})`);
      return false;
    }
    const confirmed = { ...snapshot, blockId: validation.id, preparedId: true };
    this.clearPendingBatch();
    return this.applyVaultCountedDependencyRef(confirmed);
  }

  async confirmCountedDependencyBlockId(item) {
    const dependencyTask = this.pendingCountedDependency;
    if (!dependencyTask || !item.valid) {
      return false;
    }
    const countedConfirmAction = { label: "add 2 prerequisites" };
    const countedConfirmWrite = async () => {
      const applied = await this.plugin.applyCountedLocalTaskDependency(
        this.editor,
        this.cursor,
        this.filePath,
        this.taskSession,
        dependencyTask,
        { confirmedBlockId: item.id },
      );
      if (applied) {
        this.clearPendingBatch();
      }
      return applied;
    };
    if (typeof this.runInboxRoutedCommit === "function") {
      return await this.runInboxRoutedCommit(
        countedConfirmAction,
        countedConfirmWrite,
      );
    }
    return await countedConfirmWrite();
  }

  // Record one confirmed block ID and either advance to the next prompt (modal
  // stays open) or, on the final prompt, run the batch executor and close only
  // when it succeeds.
  async confirmBatchBlockId(item) {
    const batch = this.pendingBatch;
    const snapshot = batch.promptQueue[batch.promptIndex];
    if (!snapshot) {
      return false;
    }

    batch.confirmedById.set(snapshot.line, item.id);
    if (snapshot.markKey !== undefined && snapshot.markKey !== null) {
      batch.confirmedById.set(snapshot.markKey, item.id);
    }
    batch.reservedIds.add(item.id);
    batch.promptIndex += 1;

    if (batch.promptIndex < batch.promptQueue.length) {
      return this.promptNextBatchBlockId();
    }

    // Cross-note and same-note batches both commit asynchronously (stale
    // re-read per target plus target preparation and recovery).
    if (batch.hasVault) {
      return this.executeVaultDependencyBatch(batch).then((applied) => {
        if (applied) {
          this.clearPendingBatch();
        }
        return applied;
      });
    }
    if (await this.executeDependencyBatch(batch)) {
      this.clearPendingBatch();
      return true;
    }

    // Executor aborted (e.g. cursor bullet changed). Leave the modal open with
    // the failure notice already shown; Esc cancels with nothing written.
    return false;
  }

  confirmSingleBlockId(item) {
    const parentValidation = validateDependencyParentForEditor(
      this.editor,
      this.cursor,
      this.lineText,
    );
    if (!parentValidation.valid) {
      new Notice(parentValidation.message);
      return false;
    }
    const task = this.pendingTask;
    const targetLine = getEditorLine(this.editor, task.line);
    if (targetLine !== task.rawLine) {
      return this.refuseDependencyStale();
    }
    if (!isObsidianTaskAtLine(this.getEditorContent(), task.line)) {
      new Notice("Selected dependency is no longer a #task checkbox");
      return false;
    }

    // An existing valid `[id::]` is never rewritten (§3); the planner
    // resolves the kept id for the field. Unencodable paths refuse only
    // when the target has no `[id::]` yet. The confirmed id folds into the
    // writer's one transaction below (one Ctrl+Z).
    const updatedLine = applyPromptedBlockIdPreservingLegacyId(
      targetLine,
      item.id,
      this.filePath,
    );
    if (updatedLine === null) {
      new Notice(
        "Dependency not added: this note path cannot be encoded as a dependency ID",
      );
      return false;
    }

    const confirmedIdField = findBulletPropertyField(updatedLine, "id");
    const depValue = confirmedIdField
      ? normalizeBulletPropertyValue(confirmedIdField.value)
      : "";

    const singleConfirmArgs = {
      showNotice: false,
      linkBlockId: item.id,
      filePath: this.filePath,
      pendingTargetLine: {
        line: task.line,
        expected: targetLine,
        text: updatedLine,
      },
    };
    let armed = false;
    try {
      armed =
        typeof this.isInboxRouteArmed === "function" &&
        this.isInboxRouteArmed() === true &&
        typeof this.runInboxRoutedCommit === "function";
    } catch (error) {
      armed = false;
    }
    if (!armed) {
      const linked = this.plugin.setLocalTaskDependency(
        this.editor,
        this.cursor,
        this.selectedPropertyItem.property.name,
        depValue,
        singleConfirmArgs,
      );
      if (!linked) {
        return false;
      }

      new Notice(`Added ^${item.id} + linked dependency + navigation link`);
      return true;
    }
    const singleConfirmAction = { label: "add 1 prerequisite" };
    const singleConfirmWrite = async () => {
      const linked = await this.plugin.setLocalTaskDependency(
        this.editor,
        this.cursor,
        this.selectedPropertyItem.property.name,
        depValue,
        singleConfirmArgs,
      );
      if (!linked) {
        return false;
      }

      new Notice(`Added ^${item.id} + linked dependency + navigation link`);
      return true;
    };
    return this.runInboxRoutedCommit(singleConfirmAction, singleConfirmWrite);
  }

  // Execution phase: re-guard the cursor bullet, apply each target's edits,
  // rewrite the `[dependsOn:: ...]` list once, then reconcile navigation
  // bullets. Target-line edits are single-line replaces, so target indices stay
  // stable; only the nav reconciliation shifts lines and re-reads as it goes.
  async executeDependencyBatchWithoutInboxRoute(batch) {
    const parentValidation = validateDependencyParentForEditor(
      this.editor,
      this.cursor,
      batch.cursorLineText,
    );
    if (!parentValidation.valid) {
      new Notice(parentValidation.message);
      return false;
    }

    // Batch Depends-On write through the pure planner: snapshots resolve
    // read-only here, then one gesture commits the line, the field,
    // same-note target ids, status effects, and legacy folding in one
    // editor transaction (one Ctrl+Z), with `[fresh:: today]` stamped last.
    const originalContent = String(this.editor.getValue() || "");
    const filePath = normalizeVaultRelativePath(this.filePath || "");
    if (!filePath) {
      new Notice(
        "Dependencies are unavailable: this note path cannot be encoded as a dependency ID",
      );
      return false;
    }
    const removals = batch.removals.slice();
    let skippedStale = 0;
    let skippedOther = 0;
    // Confirmed `+ id` targets are stamped into a working copy first (the
    // planner resolves by `^block-id`), so the single commit below writes
    // the target ids and the link together.
    const workingLines = originalContent.split(/\r?\n/);
    const collectAddition = (snapshot, confirmedId = null) => {
      const targetLine = getEditorLine(this.editor, snapshot.line);
      if (targetLine !== snapshot.rawLine) {
        skippedStale += 1;
        return null;
      }
      if (!isObsidianTaskAtLine(originalContent, snapshot.line)) {
        skippedOther += 1;
        return null;
      }
      if (confirmedId !== null) {
        // Validated against the working copy (an earlier stamp in this
        // batch already landed there), not the batch's reserved set, which
        // already holds this confirmed id.
        const validation = validateBlockIdCandidate(
          confirmedId,
          workingLines.join(originalContent.includes("\r\n") ? "\r\n" : "\n"),
        );
        if (!validation.valid) {
          skippedOther += 1;
          return null;
        }
        if (!tryDependencyId(filePath, confirmedId)) {
          skippedOther += 1;
          return null;
        }
        const stampedLine = applyPromptedBlockIdPreservingLegacyId(
          targetLine,
          confirmedId,
          filePath,
        );
        if (stampedLine === null) {
          skippedOther += 1;
          return null;
        }
        workingLines[snapshot.line] = stampedLine;
        return { blockId: confirmedId };
      }
      const resolved = resolveTargetTaskIdentity(targetLine, {
        promptWhenBlockIdMissing: true,
        filePath,
      });
      if (resolved.needsBlockIdPrompt || !resolved.value) {
        skippedOther += 1;
        return null;
      }
      return { blockId: resolved.linkBlockId };
    };

    const addRefs = [];
    batch.readyAdditions.forEach((snapshot) => {
      const addition = collectAddition(snapshot);
      if (addition) {
        addRefs.push({ path: filePath, blockId: addition.blockId });
      }
    });
    batch.promptQueue.forEach((snapshot) => {
      const confirmedId = batch.confirmedById.get(snapshot.line);
      if (!confirmedId) {
        skippedOther += 1;
        return;
      }
      const addition = collectAddition(snapshot, confirmedId);
      if (addition) {
        addRefs.push({ path: filePath, blockId: addition.blockId });
      }
    });

    // A stale target refuses the whole batch before any write, then reopens
    // the stage fresh — never a partial commit with a skip count.
    if (skippedStale > 0) {
      return this.refuseDependencyStale();
    }

    // Removal marks carry the field value; resolve each to its `^block-id`
    // in this note. Field-only values need no link edit: the planner sets
    // the field from the line, so they fall out on their own.
    const noteLines = originalContent.split(/\r?\n/);
    const removeRefs = [];
    removals.forEach((removal) => {
      const candidates = [
        removal.linkBlockId,
        removal.depValue,
        removal.legacyDepValue,
      ]
        .map(normalizeBulletPropertyValue)
        .filter(Boolean);
      for (const candidate of candidates) {
        if (findTaskLineByTrailingBlockId(noteLines, candidate) !== null) {
          removeRefs.push({ path: filePath, blockId: candidate });
          return;
        }
      }
      for (let index = 0; index < noteLines.length; index += 1) {
        if (!isObsidianTaskAtLine(originalContent, index)) {
          continue;
        }
        const idField = findBulletPropertyField(noteLines[index], "id");
        const idValue =
          idField && normalizeBulletPropertyValue(idField.value);
        if (idValue && candidates.includes(idValue)) {
          const blockId = getTrailingBlockId(noteLines[index]);
          if (blockId) {
            removeRefs.push({ path: filePath, blockId });
            return;
          }
        }
      }
    });

    // Cycle guard on the post-batch graph (§6.4): a marked row whose edge
    // closes a cycle back to the dependent refuses before any write, like
    // the vault path above (every added edge leaves the same dependent, so
    // one row alone closes a simple cycle). The single-note graph covers
    // same-note batches; cross-note rows commit through `commitVaultRefs`,
    // which guards the full graph.
    {
      const cursorLines = originalContent.split(/\r?\n/);
      const cursorText = String(cursorLines[this.cursor.line] || "");
      const cursorBlockId = getTrailingBlockId(cursorText);
      const cursorIdField = findBulletPropertyField(cursorText, "id");
      const cursorIdValue =
        cursorIdField && normalizeBulletPropertyValue(cursorIdField.value);
      const batchDependentKey =
        (cursorBlockId && dependencyStageRowKey(filePath, cursorBlockId)) ||
        (cursorIdValue ? `id:${cursorIdValue}` : null) ||
        `${filePath}#line:${this.cursor.line}`;
      const trialNotes = [{ path: filePath, content: originalContent }];
      const trialIndex = indexDependencyStageNotes(trialNotes);
      const trialEdges = collectDependencyStageEdges(trialNotes, trialIndex);
      const trial = new Map();
      for (const [from, targets] of trialEdges) {
        trial.set(from, targets.slice());
      }
      const dropKeys = new Set(
        removeRefs
          .map((ref) => dependencyStageRowKey(ref.path, ref.blockId))
          .filter(Boolean),
      );
      const current = (trial.get(batchDependentKey) || []).filter(
        (key) => !dropKeys.has(key),
      );
      for (const ref of addRefs) {
        const key = dependencyStageRowKey(ref.path, ref.blockId);
        if (key && !current.includes(key)) {
          current.push(key);
        }
      }
      trial.set(batchDependentKey, current);
      for (const ref of addRefs) {
        const key = dependencyStageRowKey(ref.path, ref.blockId);
        const cycle =
          key === batchDependentKey
            ? [batchDependentKey]
            : findDependencyStageCycle(trial, batchDependentKey, key);
        if (key && cycle) {
          new Notice(
            `⛓ Could not update dependencies (would create a cycle: ${cycle.length - 1} back-link${cycle.length - 1 === 1 ? "" : "s"})`,
          );
          return false;
        }
      }
    }
    const workingContent = workingLines.join(
      originalContent.includes("\r\n") ? "\r\n" : "\n",
    );
    const registry = await readTasksStatusRegistry(
      this.plugin ? this.plugin.app : null,
    );
    const vaultContents =
      this.plugin &&
      needsDependencyRecoverySnapshot(workingContent, this.cursor.line, removeRefs, false, addRefs)
        ? await this.plugin.readDependencyRecoveryVaultContents(
            filePath,
            workingContent,
          )
        : null;
    const plan = planDependencyEdit({
      content: workingContent,
      parentLine: this.cursor.line,
      parentPath: filePath,
      add: addRefs,
      remove: removeRefs,
      files: { [filePath]: workingContent },
      vaultFiles: this.plugin
        ? this.plugin.readDependencyVaultFileList()
        : null,
      resolveLinkpath: this.plugin
        ? this.plugin.dependencyLinkpathResolver()
        : null,
      recovery: { registry, today: new Date(), vaultContents },
    });
    if (!plan.ok) {
      new Notice(dependencyPlanFailureNotice(plan.reason, "update"));
      return false;
    }
    if (plan.changed) {
      const nextContent =
        this.plugin &&
        typeof this.plugin.stampDependencyParentLine === "function"
          ? this.plugin.stampDependencyParentLine(
              plan.nextContent,
              this.cursor.line,
              undefined,
              undefined,
            )
          : plan.nextContent;
      if (!applyEditorContentTransaction(this.editor, originalContent, nextContent)) {
        new Notice("Could not update bullet property");
        return false;
      }
    }

    const finalCursorLine =
      getEditorLine(this.editor, this.cursor.line) || this.cursor.line;
    setEditorCursorSafely(
      this.editor,
      this.cursor.line,
      Math.min(
        Math.max(this.cursor.ch, 0),
        String(finalCursorLine || "").length,
      ),
    );

    const skipped = skippedStale + skippedOther;
    new Notice(
      plan.notice + (skipped > 0 ? ` (${skipped} skipped)` : ""),
    );
    return true;
  }

  // Vault-wide single remove: CURRENT rows toggle off through the writer
  // (`docs/task-dependencies.md` §6.6). Removing a link is always allowed,
  // so the target is never re-read; the dependent is guarded by its
  // snapshot line text.
  // A stale target or dependent refuses with `changed — reopen` and then
  // reopens the stage fresh (`docs/task-dependencies.md` §6.4). Best-effort:
  // harness stubs without a picker opener just keep the refusal.
  async executeDependencyBatch(batch) {
    const inboxAction = { label: "add 2 prerequisites" };
    const inboxWrite = async () => await this.executeDependencyBatchWithoutInboxRoute(batch);
    if (typeof this.runInboxRoutedCommit === "function") {
      return await this.runInboxRoutedCommit(inboxAction, inboxWrite);
    }
    return await inboxWrite();
  }
}
