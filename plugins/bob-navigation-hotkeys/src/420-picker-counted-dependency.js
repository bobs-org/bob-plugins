class BulletPropertyPickerCountedDependencyMixin extends FilteredPickerModal {
  chooseCountedTaskDependency(item) {
    if (!item) {
      return false;
    }
    if (item.disabled) {
      new Notice(item.disabledReason || "That task cannot be linked");
      return false;
    }
    const sessionValidation = validateCountedTaskSession(
      this.getEditorContent(),
      this.taskSession,
    );
    if (!sessionValidation.valid) {
      new Notice(`${sessionValidation.error}; no tasks were updated`);
      return false;
    }
    // CURRENT rows carry no target line, so they toggle off through the
    // counted remover below instead of the line-pinned paths.
    if (item.stageSection === "current" && item.alreadyLinked) {
      return this.removeCountedDependency(item);
    }
    // Vault-wide rows plan every source on one working copy and commit once
    // through the writer; same-note rows keep the counted single-transaction
    // planner.
    if (
      item.stageSection &&
      item.path &&
      normalizeVaultRelativePath(item.path) !==
        normalizeVaultRelativePath(this.filePath)
    ) {
      return this.chooseVaultCountedDependency(item);
    }
    const targetLine = getEditorLine(this.editor, item.line);
    if (
      targetLine !== item.rawLine ||
      !isObsidianTaskAtLine(this.getEditorContent(), item.line)
    ) {
      return this.refuseDependencyStale();
    }

    const resolved = resolveTargetTaskIdentity(targetLine, {
      promptWhenBlockIdMissing: true,
      filePath: this.filePath,
    });
    if (resolved.needsBlockIdPrompt) {
      this.pendingCountedDependency = item;
      this.showBlockIdStage(item, { mode: "counted-source" });
      return false;
    }

    return this.plugin.applyCountedLocalTaskDependency(
      this.editor,
      this.cursor,
      this.filePath,
      this.taskSession,
      item,
    );
  }

  // Counted (`N<Ctrl+Shift+P>`) vault-wide commits: the existing
  // add-to-all / remove-from-all semantics, one writer transaction per
  // source task, with the target re-read fresh. Rows without a block id
  // detour through one `+ id` prompt first.
  async chooseVaultCountedDependency(item) {
    const sessionValidation = validateCountedTaskSession(
      this.getEditorContent(),
      this.taskSession,
    );
    if (!sessionValidation.valid) {
      new Notice(`${sessionValidation.error}; no tasks were updated`);
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
      blockId: item.blockId || item.existingBlockId || null,
    };
    if (item.alreadyLinked) {
      return this.applyVaultCountedDependencyRef(
        { ...snapshot, remove: true },
      );
    }
    if (!snapshot.blockId) {
      this.pendingVaultCounted = {
        snapshot,
        session: this.taskSession,
        reservedIds: new Set(),
      };
      this.showBlockIdStage(snapshot, { mode: "vault-counted" });
      return false;
    }
    return this.applyVaultCountedDependencyRef(snapshot);
  }

  // Counted CURRENT toggle-off: ↵ on a fully linked CURRENT row removes
  // that prerequisite from every source task. A same-note target that still
  // resolves keeps the counted one-transaction planner; anything else
  // (cross-note, or a target whose note is gone) plans every source on one
  // working copy bottom-up and commits once, so a missing target is always
  // removable.
  async removeCountedDependency(item) {
    const sessionValidation = validateCountedTaskSession(
      this.getEditorContent(),
      this.taskSession,
    );
    if (!sessionValidation.valid) {
      new Notice(`${sessionValidation.error}; no tasks were updated`);
      return false;
    }
    const ownerPath = normalizeVaultRelativePath(this.filePath || "");
    const blockId = normalizeBulletPropertyValue(
      item.blockId || item.existingBlockId || "",
    );
    const targetPath = normalizeVaultRelativePath(
      item.path || ownerPath,
    );
    if (!ownerPath || !blockId) {
      new Notice("⛓ Could not remove dependency (missing link target)");
      return false;
    }
    // A CURRENT row may be linked on only some sources: the counted
    // one-transaction planner toggles, so it runs only when every source
    // carries the link. Otherwise every linked source is planned onto one
    // working copy and removed in the single commit below.
    if (targetPath === ownerPath) {
      const content = String(this.editor.getValue() || "");
      const contentLines = content.split(/\r?\n/);
      const found = findTaskLineByTrailingBlockId(contentLines, blockId);
      if (found !== null && isObsidianTaskAtLine(content, found)) {
        const targetText = String(contentLines[found] || "");
        const targetIdField = findBulletPropertyField(targetText, "id");
        const aliases = new Set(
          [
            dependencyTargetId(targetText, ownerPath, blockId),
            targetIdField
              ? normalizeBulletPropertyValue(targetIdField.value)
              : "",
            blockId,
          ]
            .map(normalizeBulletPropertyValue)
            .filter(Boolean),
        );
        const everyLinked = (this.taskSession.targets || []).every(
          (target) => {
            const field = findBulletPropertyField(
              String(target.rawLine || ""),
              "dependsOn",
            );
            const values = new Set(
              field ? parseLocalTaskIdList(field.value) : [],
            );
            return [...aliases].some((alias) => values.has(alias));
          },
        );
        if (everyLinked) {
          return this.plugin.applyCountedLocalTaskDependency(
            this.editor,
            this.cursor,
            this.filePath,
            this.taskSession,
            {
              line: found,
              rawLine: contentLines[found],
              displayText: item.displayText,
              existingIdField: item.existingIdField || null,
              existingBlockId: blockId,
            },
          );
        }
      }
    }
    // One gesture plans every source on one working copy bottom-up,
    // refuses before any write when any source fails to plan, then commits
    // once (one Ctrl+Z) with one summary notice — the same shape as the
    // counted add above. The notice counts only sources that changed.
    const ordered = (this.taskSession.targets || [])
      .slice()
      .sort((first, second) => second.line - first.line);
    const originalContent = String(this.editor.getValue() || "");
    const removeRef = { path: targetPath, blockId };
    const resolveLinkpath =
      this.plugin && typeof this.plugin.dependencyLinkpathResolver === "function"
        ? this.plugin.dependencyLinkpathResolver()
        : null;
    const vaultFiles =
      this.plugin && typeof this.plugin.readDependencyVaultFileList === "function"
        ? this.plugin.readDependencyVaultFileList()
        : null;
    const registry = this.plugin
      ? await readTasksStatusRegistry(this.plugin.app)
      : null;
    const baseFiles = new Map();
    baseFiles.set(ownerPath, originalContent);
    {
      const wanted = new Set([targetPath]);
      for (const target of ordered) {
        if (!Number.isInteger(target.line)) {
          continue;
        }
        const collection = collectDependencyNavigationBullets(originalContent, target.line);
        if (collection.reason) {
          continue;
        }
        for (const entry of collection.targets) {
          const entryPath = dependencyPathForLinkNote(
            entry.note,
            ownerPath,
            resolveLinkpath,
          );
          if (entryPath) {
            wanted.add(entryPath);
          }
        }
      }
      for (const wantedPath of wanted) {
        if (baseFiles.has(wantedPath)) {
          continue;
        }
        const loaded = await this.plugin.readDependencyNoteContent(
          wantedPath,
          null,
          ownerPath,
        );
        if (loaded !== null) {
          baseFiles.set(wantedPath, String(loaded));
        }
      }
    }
    const removeNeedsSnapshot = String(originalContent || "")
      .split(/\r?\n/)
      .some((line, index) => {
        if (!ordered.some((target) => target.line === index)) {
          return false;
        }
        return getObsidianTaskCheckboxStatus(String(line || "")) === "?";
      });
    const baseVaultContents =
      this.plugin && removeNeedsSnapshot
        ? await this.plugin.readDependencyRecoveryVaultContents(ownerPath, originalContent)
        : null;
    const today = new Date();
    let working = originalContent;
    let removed = 0;
    const preparations = new Map();
    for (const target of ordered) {
      if (!Number.isInteger(target.line)) {
        new Notice(
          `⛓ Could not update the counted task (invalid line); no tasks were updated`,
        );
        return false;
      }
      const planFiles = new Map(baseFiles);
      planFiles.set(ownerPath, working);
      const plan = planDependencyEdit({
        content: working,
        parentLine: target.line,
        parentPath: ownerPath,
        add: [],
        remove: [removeRef],
        files: planFiles,
        vaultFiles,
        resolveLinkpath,
        recovery: { registry, today, vaultContents: baseVaultContents },
      });
      if (!plan.ok) {
        new Notice(
          plan.reason === "in-blockquote"
            ? "⛓ Dependencies can't be edited inside a blockquote; no tasks were updated"
            : `⛓ Could not update the task on line ${target.line + 1} (${plan.reason}); no tasks were updated`,
        );
        return false;
      }
      for (const preparation of plan.preparations || []) {
        const key = `${preparation.path}\x00${preparation.line}\x00${preparation.from}\x00${preparation.text}`;
        if (!preparations.has(key)) {
          preparations.set(key, preparation);
        }
      }
      if (plan.changed) {
        removed += 1;
        let nextWorking = plan.nextContent;
        if (this.plugin && typeof this.plugin.stampDependencyParentLine === "function") {
          nextWorking = this.plugin.stampDependencyParentLine(nextWorking, target.line);
        }
        working = nextWorking;
      }
    }
    for (const preparation of preparations.values()) {
      let result = null;
      try {
        result = await this.plugin.prepareDependencyTargetNote(preparation.path, preparation);
      } catch (_error) {
        result = { ok: false, reason: "target-preparation-threw" };
      }
      if (!result || result.ok !== true) {
        new Notice(
          `⛓ Could not prepare the dependency removal (${(result && result.reason) || "target-preparation-failed"}); no tasks were updated`,
        );
        return false;
      }
    }
    if (working === originalContent) {
      new Notice("No dependencies changed");
      return false;
    }
    // A concurrent edit refuses with `changed — reopen` and reopens the
    // stage fresh, like every other stale stage path (§6.4).
    if (String(this.editor.getValue() || "") !== originalContent) {
      return this.refuseDependencyStale();
    }
    if (!applyEditorContentTransaction(this.editor, originalContent, working)) {
      new Notice("Could not update counted dependencies; no tasks were updated");
      return false;
    }
    new Notice(
      `⛓ Removed from ${removed} task${removed === 1 ? "" : "s"}`,
    );
    return true;
  }

  // Apply one vault-wide counted toggle: linked everywhere removes from
  // every source, otherwise unlinked sources gain the link. One gesture
  // plans every source on one working copy bottom-up, refuses before any
  // write when any source fails to plan, then commits once; the notice
  // counts only sources that actually changed.
  async applyVaultCountedDependencyRef(snapshot) {
    const sessionValidation = validateCountedTaskSession(
      this.getEditorContent(),
      this.taskSession,
    );
    if (!sessionValidation.valid) {
      new Notice(`${sessionValidation.error}; no tasks were updated`);
      return false;
    }
    const ownerPath = normalizeVaultRelativePath(this.filePath || "");
    const targetPath = normalizeVaultRelativePath(
      snapshot.path || ownerPath,
    );
    const resolveLinkpath =
      this.plugin && typeof this.plugin.dependencyLinkpathResolver === "function"
        ? this.plugin.dependencyLinkpathResolver()
        : null;
    const files = await this.readVaultStageFiles([targetPath]);
    if (!files) {
      return false;
    }
    // The old per-source writer also loaded the notes behind each source's
    // existing links: a source with an unloaded cross-note link and a
    // missing or out-of-sync field must still add, not refuse
    // `target-not-found`. Best-effort (an unreadable note stays verbatim in
    // the planner), so one missing note never blocks the gesture.
    {
      const ownerContent = String(this.editor.getValue() || "");
      const wanted = new Set();
      for (const target of this.taskSession.targets || []) {
        if (!Number.isInteger(target.line)) {
          continue;
        }
        const collection = collectDependencyNavigationBullets(ownerContent, target.line);
        if (collection.reason) {
          continue;
        }
        for (const entry of collection.targets) {
          const entryPath = dependencyPathForLinkNote(
            entry.note,
            ownerPath,
            resolveLinkpath,
          );
          if (entryPath && !files.has(entryPath)) {
            wanted.add(entryPath);
          }
        }
      }
      for (const wantedPath of wanted) {
        const buffered =
          this.plugin && typeof this.plugin.readOpenBufferContent === "function"
            ? this.plugin.readOpenBufferContent(wantedPath)
            : null;
        if (buffered !== null) {
          files.set(wantedPath, buffered);
          continue;
        }
        if (
          this.vaultStage &&
          this.vaultStage.files instanceof Map &&
          this.vaultStage.files.has(wantedPath)
        ) {
          files.set(wantedPath, String(this.vaultStage.files.get(wantedPath) || ""));
          continue;
        }
        const loaded = await this.plugin.readDependencyNoteContent(
          wantedPath,
          null,
          ownerPath,
        );
        if (loaded !== null) {
          files.set(wantedPath, String(loaded));
        }
      }
    }
    const counters = { stale: 0, other: 0 };
    if (!snapshot.remove) {
      const addition = this.collectVaultAddition(snapshot, files, counters);
      if (!addition) {
        // A changed target refuses with `changed — reopen` and reopens the
        // stage fresh, exactly like the same-note `executeDependencyBatch`
        // (§6.4); anything else keeps the specific notice.
        if (counters.stale > 0) {
          return this.refuseDependencyStale();
        }
        new Notice("Could not identify the selected dependency");
        return false;
      }
      snapshot = { ...snapshot, blockId: addition.blockId };
    }
    const ref = { path: targetPath, blockId: snapshot.blockId };
    // One gesture commits every source in one editor transaction (one
    // Ctrl+Z): plan every source on one working copy bottom-up, refuse
    // before any write when any source fails to plan, then commit once.
    const orderedSources = (this.taskSession.targets || [])
      .slice()
      .sort((first, second) => second.line - first.line);
    const originalContent = String(this.editor.getValue() || "");
    let working = originalContent;
    let changedSources = 0;
    const preparations = new Map();
    const vaultFiles =
      this.plugin && typeof this.plugin.readDependencyVaultFileList === "function"
        ? this.plugin.readDependencyVaultFileList()
        : null;
    const countedRegistry = this.plugin
      ? await readTasksStatusRegistry(this.plugin.app)
      : null;
    const countedNeedsRecovery =
      Boolean(snapshot.remove) &&
      String(originalContent || "")
        .split(/\r?\n/)
        .some((line, index) => {
          if (!orderedSources.some((target) => target.line === index)) {
            return false;
          }
          return getObsidianTaskCheckboxStatus(String(line || "")) === "?";
        });
    const countedVaultContents =
      this.plugin && countedNeedsRecovery
        ? await this.plugin.readDependencyRecoveryVaultContents(ownerPath, originalContent)
        : null;
    for (const target of orderedSources) {
      const targetContent = files.get(targetPath);
      const planFiles = new Map();
      planFiles.set(ownerPath, working);
      if (targetPath !== ownerPath && targetContent !== undefined) {
        planFiles.set(targetPath, String(targetContent));
      }
      for (const [path, content] of files) {
        if (!planFiles.has(path)) {
          planFiles.set(path, String(content));
        }
      }
      const plan = planDependencyEdit({
        content: working,
        parentLine: target.line,
        parentPath: ownerPath,
        add: snapshot.remove ? [] : [ref],
        remove: snapshot.remove ? [ref] : [],
        files: planFiles,
        vaultFiles,
        resolveLinkpath,
        recovery: {
          registry: countedRegistry,
          today: new Date(),
          vaultContents: countedVaultContents,
        },
      });
      if (!plan.ok) {
        new Notice(
          plan.reason === "in-blockquote"
            ? "⛓ Dependencies can't be edited inside a blockquote; no tasks were updated"
            : `⛓ Could not update the task on line ${target.line + 1} (${plan.reason}); no tasks were updated`,
        );
        return false;
      }
      for (const preparation of plan.preparations || []) {
        const key = `${preparation.path}\x00${preparation.line}\x00${preparation.from}\x00${preparation.text}`;
        if (!preparations.has(key)) {
          preparations.set(key, preparation);
        }
      }
      let nextWorking = plan.nextContent;
      if (plan.changed) {
        changedSources += 1;
      }
      if (plan.changed && this.plugin && typeof this.plugin.stampDependencyParentLine === "function") {
        nextWorking = this.plugin.stampDependencyParentLine(nextWorking, target.line);
      }
      working = nextWorking;
    }
    for (const preparation of preparations.values()) {
      let result = null;
      try {
        result = await this.plugin.prepareDependencyTargetNote(preparation.path, preparation);
      } catch (_error) {
        result = { ok: false, reason: "target-preparation-threw" };
      }
      if (!result || result.ok !== true) {
        new Notice(
          `⛓ Could not prepare the selected dependency (${(result && result.reason) || "target-preparation-failed"}); no tasks were updated`,
        );
        return false;
      }
    }
    if (working === originalContent) {
      new Notice("No dependencies changed");
      return true;
    }
    if (String(this.editor.getValue() || "") !== originalContent) {
      return this.refuseDependencyStale();
    }
    if (
      !applyEditorContentTransaction(this.editor, originalContent, working)
    ) {
      new Notice("Could not update counted dependencies; no tasks were updated");
      return false;
    }
    const applied = changedSources;
    new Notice(
      snapshot.remove
        ? `⛓ Removed from ${applied} task${applied === 1 ? "" : "s"}`
        : `⛓ Linked ${applied} task${applied === 1 ? "" : "s"}`,
    );
    return true;
  }

  // Preparation phase for a marked batch apply. Guards the cursor bullet, then
  // partitions the marked rows into removals, ready additions (already have a
  // trailing block ID), and additions that still need a prompted block ID. When
  // prompts are needed it stashes a pending batch and opens the first prompt
  // (returning false so the modal stays open); otherwise it executes the batch
  // immediately. No editor writes happen in this phase.
  commitMarkedDependencies() {
    if (!this.selectedPropertyItem || this.getMarkedCount() === 0) {
      return false;
    }

    const propertyName = this.selectedPropertyItem.property.name;
    const parentValidation = validateDependencyParentForEditor(
      this.editor,
      this.cursor,
      this.lineText,
    );
    if (!parentValidation.valid) {
      new Notice(parentValidation.message);
      return false;
    }
    const cursorLineText = parentValidation.line;

    const removals = [];
    const readyAdditions = [];
    const promptQueue = [];

    const ownerPath = normalizeVaultRelativePath(this.filePath || "");
    this.getMarkedTaskItems().forEach((item) => {
      const itemPath = normalizeVaultRelativePath(item.path || ownerPath);
      if (item.alreadyLinked) {
        // alreadyLinked implies a non-empty dependency value.
        removals.push({
          path: itemPath,
          blockId: item.blockId || item.existingBlockId || null,
          depValue: item.value,
          legacyDepValue: item.legacyDependencyValue || null,
          linkBlockId:
            item.existingBlockId || item.existingIdField || item.value,
        });
        return;
      }

      const snapshot = {
        markKey: bulletPropertyTaskMarkKey(item),
        path: itemPath,
        line: item.line,
        rawLine: item.rawLine,
        displayText: item.displayText,
        existingIdField: item.existingIdField || null,
        blockId: item.existingBlockId || null,
      };

      if (item.needsPromptForAdd) {
        promptQueue.push(snapshot);
      } else {
        readyAdditions.push(snapshot);
      }
    });

    const batch = {
      propertyName,
      cursorLineText,
      removals,
      readyAdditions,
      promptQueue,
      promptIndex: 0,
      confirmedById: new Map(),
      reservedIds: new Set(),
      // Cross-note batches commit through the vault writer (stale re-read
      // per target, one dependent transaction); same-note batches keep the
      // existing single-transaction executor below.
      hasVault: removals.some(
        (removal) => removal.path && removal.path !== ownerPath,
      ),
    };
    if (!batch.hasVault) {
      batch.hasVault = [...readyAdditions, ...promptQueue].some(
        (snapshot) => snapshot.path && snapshot.path !== ownerPath,
      );
    }

    // Cross-note batches preload every prompt target (suggestion content
    // plus cache-only locating) before the first prompt opens.
    if (batch.hasVault) {
      return this.prepareVaultBatch(batch);
    }

    if (promptQueue.length === 0) {
      this.clearPendingBatch();
      return this.executeDependencyBatch(batch);
    }

    this.pendingBatch = batch;
    return this.promptNextBatchBlockId();
  }

  // Preload prompt-target contents for a vault batch: cache-only rows gain
  // fresh line snapshots (or drop as stale), and every prompt target lands
  // in the stage files so `+ id` suggestions validate against the right
  // note. Empty queues execute straight through.
}
