class BobNavigationHotkeysTransclusionLinkMixin {

  // Pure transclusion toggle (`docs/task-dependencies.md` §7): `!` only adds
  // or removes embed markers. It never writes `[dependsOn::]`, ids, or
  // statuses — dependencies are edited through Ctrl+Shift+P.
  async applyDependencyAwareTransclusionChanges(
    cm,
    changesByLine,
    cursorOptions = null,
  ) {
    if (!cm || typeof cm.getValue !== "function") {
      return false;
    }
    const commitCursorOptions =
      normalizeTransclusionCommitCursorOptions(cursorOptions);
    const originalContent = String(cm.getValue() || "");
    const originalLines = originalContent.split(/\r?\n/);
    const nextLines = originalLines.slice();
    for (const change of changesByLine) {
      const line = change && change.line;
      const nextLineText = change && change.nextLineText;
      if (
        !Number.isInteger(line) ||
        line < 0 ||
        line >= nextLines.length ||
        typeof nextLineText !== "string" ||
        nextLineText.includes("\n")
      ) {
        return false;
      }
      nextLines[line] = nextLineText;
    }
    if (String(cm.getValue() || "") !== originalContent) {
      return false;
    }
    return applyEditorLineChanges(
      cm,
      originalLines,
      nextLines,
      getTransclusionCommitFinalCursor(cm, commitCursorOptions),
    );
  }


  getOpenMarkdownEditorForPath(filePath) {
    if (!this.app.workspace) return null;
    const active = this.getActiveMarkdownView();
    if (active && active.file && active.file.path === filePath) {
      return active.editor || null;
    }
    if (typeof this.app.workspace.getLeavesOfType !== "function") return null;
    const leaf = this.app.workspace.getLeavesOfType("markdown").find(
      (candidate) =>
        candidate &&
        candidate.view &&
        candidate.view.file &&
        candidate.view.file.path === filePath,
    );
    return leaf && leaf.view ? leaf.view.editor || null : null;
  }

  // Snapshot today's daily note ahead of a scheduling write that will defer a
  // task to the future. Returns null (clean no-op for the caller) when the
  // vault API is unavailable, open Markdown buffers are ambiguous, there is no
  // daily note for `today`, or the read throws. When the edited note (
  // `options.sourcePath`) *is* today's daily note, `sameFile` is true and
  // `file`/`editor`/`content` are left unused — the caller already holds the
  // note's content and folds the prune into its own single write instead of
  // reading or writing the daily note separately here.
  async readDeferredPomodoroSnapshot(app, options = {}) {
    const vault = app && app.vault;
    if (!vault || typeof vault.getMarkdownFiles !== "function") {
      return null;
    }
    const sourcePath = normalizeVaultRelativePath(options.sourcePath);
    const today = options.today instanceof Date ? options.today : new Date();
    const buffers = getOpenMarkdownBufferContents(app);
    if (buffers.ambiguous) {
      return null;
    }
    if (sourcePath) {
      buffers.set(sourcePath, String(options.sourceContent || ""));
    }
    let vaultFiles;
    try {
      vaultFiles = vault.getMarkdownFiles() || [];
    } catch (error) {
      return null;
    }
    const dailyPath = scheduledRecoveryDailyPaths(vaultFiles, today).current;
    if (!dailyPath) {
      return null;
    }
    const noteIndex = createScheduledRecoveryNoteIndex(
      vaultFiles.map((file) => ({
        path: normalizeVaultRelativePath(file.path),
      })),
    );
    if (dailyPath === sourcePath) {
      return Object.freeze({
        dailyPath,
        file: null,
        editor: null,
        content: null,
        noteIndex,
        sameFile: true,
      });
    }

    const dailyFile = vaultFiles.find(
      (file) => normalizeVaultRelativePath(file.path) === dailyPath,
    );
    if (!dailyFile) {
      return null;
    }
    const editor = this.getOpenMarkdownEditorForPath(dailyPath);
    let content = null;
    if (buffers.has(dailyPath)) {
      content = buffers.get(dailyPath);
    } else if (editor && typeof editor.getValue === "function") {
      content = String(editor.getValue() || "");
    } else if (typeof vault.cachedRead === "function") {
      try {
        content = String((await vault.cachedRead(dailyFile)) || "");
      } catch (error) {
        return null;
      }
    }
    if (content === null) {
      return null;
    }
    return Object.freeze({
      dailyPath,
      file: dailyFile,
      editor,
      content,
      noteIndex,
      sameFile: false,
    });
  }

  // Apply a `planDeferredPomodoroLinkCleanup` plan to the (separate-file)
  // daily note captured by `snapshot`, guarded by the same preimage-check
  // pattern as `writeTaskMoveChange`. Never throws: the schedule write this
  // follows is already durable, so a prune failure is reported and dropped,
  // never retried and never allowed to roll the schedule back. Returns true
  // for a same-file snapshot or an unchanged plan, since the caller is
  // responsible for folding those into its own primary write instead.
  async writeDeferredPomodoroCleanup(snapshot, plan) {
    if (!snapshot || snapshot.sameFile || !plan || !plan.changed) {
      return true;
    }
    const { dailyPath, file } = snapshot;
    try {
      const editor =
        snapshot.editor && typeof snapshot.editor.getValue === "function"
          ? snapshot.editor
          : this.getOpenMarkdownEditorForPath(dailyPath);
      if (editor && typeof editor.getValue === "function") {
        if (String(editor.getValue() || "") !== snapshot.content) {
          return false;
        }
        const applied = applyEditorContentTransaction(
          editor,
          snapshot.content,
          plan.content,
        );
        return applied && String(editor.getValue() || "") === plan.content;
      }
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.process !== "function" || !file) {
        return false;
      }
      let transformed = false;
      await vault.process(file, (content) => {
        if (String(content || "") !== snapshot.content) {
          throw new Error("Daily note preimage changed");
        }
        transformed = true;
        return plan.content;
      });
      return transformed;
    } catch (error) {
      return false;
    }
  }

  async toggleCurrentLineTransclusions(cm) {
    const cursor = getEditorCursor(cm);
    if (!cursor) {
      new Notice("No active markdown editor");
      return false;
    }

    const lineText = getEditorLine(cm, cursor.line);
    if (lineText === null) {
      new Notice("No active markdown editor");
      return false;
    }

    if (parseDependencyLine(lineText, {}).verdict !== "not-a-line") {
      new Notice("⛓ Dependencies use plain links — edit them with Ctrl+Shift+P");
      return false;
    }

    const result = toggleLineTransclusions(lineText);
    if (!result.found) {
      new Notice("No links found on current line");
      return false;
    }

    if (!result.changed) {
      return false;
    }
    const nextCh = adjustCursorChForTransclusionChanges(
      cursor.ch,
      result.changes,
      result.line.length,
    );
    const applied = await this.applyDependencyAwareTransclusionChanges(
      cm,
      [{ line: cursor.line, nextLineText: result.line }],
      {
        invocationCursor: cursor,
        finalCursor: { line: cursor.line, ch: nextCh },
      },
    );
    if (!applied) {
      return false;
    }

    return true;
  }

  async toggleCountedLineTransclusions(editor, cursor, repeat) {
    const normalizedCursor = normalizePosition(cursor);
    if (!normalizedCursor || !editor) {
      return false;
    }

    const firstLine = getEditorFirstLine(editor);
    const lastLine = getEditorLastLine(editor);
    if (lastLine === null) {
      return false;
    }

    const startLine = Math.max(
      firstLine === null ? 0 : firstLine,
      Math.min(normalizedCursor.line, lastLine),
    );
    const endLine = Math.min(startLine + Math.max(0, repeat), lastLine);
    const lines = [];

    for (let line = startLine; line <= endLine; line += 1) {
      const lineText = getEditorLine(editor, line);
      lines[line] = lineText === null ? "" : lineText;
    }

    // Counted `N!` never toggles a Depends-On line: like bare `!` it is
    // refused with a notice pointing to Ctrl+Shift+P
    // (`docs/task-dependencies.md` §8). Other lines in the range still
    // toggle; the notice reports the skipped Depends-On lines.
    let skippedDependencyLine = false;
    for (let line = startLine; line <= endLine; line += 1) {
      if (
        parseDependencyLine(String(lines[line] || ""), {}).verdict !==
        "not-a-line"
      ) {
        skippedDependencyLine = true;
        break;
      }
    }
    const result = toggleLineRangeTransclusions(lines, startLine, endLine);
    if (!result.found || !result.changed) {
      if (skippedDependencyLine) {
        new Notice(
          "⛓ Dependencies use plain links — edit them with Ctrl+Shift+P",
        );
      }
      return false;
    }

    const activeChange = result.changesByLine.find(
      (change) => change.line === startLine,
    );
    const nextActiveLine =
      activeChange && typeof activeChange.nextLineText === "string"
        ? activeChange.nextLineText
        : getEditorLine(editor, startLine) || "";
    const nextCh = activeChange
      ? adjustCursorChForTransclusionChanges(
          normalizedCursor.ch,
          activeChange.changes,
          nextActiveLine.length,
        )
      : Math.min(Math.max(normalizedCursor.ch, 0), nextActiveLine.length);

    if (
      !(await this.applyDependencyAwareTransclusionChanges(
        editor,
        result.changesByLine,
        {
          invocationCursor: normalizedCursor,
          finalCursor: { line: startLine, ch: nextCh },
        },
      ))
    ) {
      return false;
    }

    if (skippedDependencyLine) {
      new Notice(
        "⛓ Dependencies use plain links — edit them with Ctrl+Shift+P",
      );
    }
    return true;
  }


  // Read one note's current content for link-picker resolution and planning:
  // the live open editor first, then any open buffer, then the vault. Null
  // when the note cannot be read (including ambiguous open buffers, mirroring
  // readDeferredPomodoroSnapshot).
  async readLinkPickerNoteContent(path, file) {
    const normalized = normalizeVaultRelativePath(path);
    const editor = this.getOpenMarkdownEditorForPath(normalized);
    if (editor && typeof editor.getValue === "function") {
      return String(editor.getValue() || "");
    }
    const buffers = getOpenMarkdownBufferContents(this.app);
    if (buffers.ambiguous) {
      return null;
    }
    if (buffers.has(normalized)) {
      return String(buffers.get(normalized) || "");
    }
    const vault = this.app && this.app.vault;
    const vaultFile =
      file ||
      (vault && typeof vault.getAbstractFileByPath === "function"
        ? vault.getAbstractFileByPath(normalized)
        : null);
    if (!vault || !vaultFile) {
      return null;
    }
    try {
      if (typeof vault.cachedRead === "function") {
        return String((await vault.cachedRead(vaultFile)) || "");
      }
      if (typeof vault.read === "function") {
        return String((await vault.read(vaultFile)) || "");
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  // Resolve every discovered Task Link to the open #task line behind it,
  // reading the target's live editor buffer when it is open. Either every
  // link resolves or the whole result is an error: a missing, duplicated,
  // non-task, or closed target changes nothing. With `{ allowClosed: true }`
  // closed targets resolve with their status instead of failing (the Task
  // Link lane toggle skips them); the default keeps Alt+N byte-identical.
  async resolveLinkPickerTargets(sourcePath, discovery, options = {}) {
    const allowClosed = Boolean(options && options.allowClosed === true);
    const targets = [];
    const seen = new Set();
    for (const entry of discovery.targets || []) {
      const linkTarget = `${entry.link.target}#^${entry.link.blockId}`;
      const file = this.resolveLinkTargetFile(linkTarget, sourcePath);
      if (!file || !this.isMarkdownFile(file)) {
        return Object.freeze({
          error: `Task link target not found: ${
            entry.link.target || "(this note)"
          }#^${entry.link.blockId}`,
          targets: null,
        });
      }
      const path = normalizeVaultRelativePath(file.path);
      const content = await this.readLinkPickerNoteContent(path, file);
      if (content === null) {
        return Object.freeze({
          error: `Task link blocked: ${path} could not be read`,
          targets: null,
        });
      }
      const found = findUniqueLinkPickerTargetLine(
        content,
        entry.link.blockId,
        { allowClosed },
      );
      if (!found.valid) {
        if (found.error === "missing" || found.error === "duplicated") {
          return Object.freeze({
            error: `Task link target ^${entry.link.blockId} is missing or duplicated in ${path}`,
            targets: null,
          });
        }
        return Object.freeze({
          error: `Task link target ^${entry.link.blockId} is not an open task in ${path}`,
          targets: null,
        });
      }
      const key = `${path} ${entry.link.blockId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      targets.push(
        Object.freeze({
          path,
          file,
          content,
          line: found.line,
          rawLine: found.rawLine,
          blockId: entry.link.blockId,
          displayText: cleanTaskDisplayText(found.rawLine),
        }),
      );
    }
    return Object.freeze({ error: null, targets: Object.freeze(targets) });
  }

  // Open the Task Link shell synchronously, then resolve its target notes.
  // Keys pressed while resolution is pending are consumed by the shell and
  // never replayed after the linked session becomes ready.
  async openLinkPicker(cm, options = {}) {
    let activePicker = this.activeBulletPropertyPicker;
    if (
      activePicker &&
      typeof isStaleRegisteredPicker === "function" &&
      isStaleRegisteredPicker(activePicker)
    ) {
      if (this.activeBulletPropertyPicker === activePicker) {
        this.activeBulletPropertyPicker = null;
      }
      activePicker = null;
    }
    const incomingCountExplicit = options.countExplicit === true;
    if (activePicker) {
      const activeCountExplicit = Boolean(
        activePicker.taskSession && activePicker.taskSession.explicit,
      );
      if (!incomingCountExplicit || activeCountExplicit) {
        return true;
      }
      activePicker.close();
    }

    const cursor = getEditorCursor(cm);
    if (!cursor) {
      new Notice("No active markdown editor");
      return false;
    }
    const lineText = getEditorLine(cm, cursor.line);
    if (lineText === null) {
      new Notice("No active markdown editor");
      return false;
    }
    const content =
      cm && typeof cm.getValue === "function"
        ? String(cm.getValue() || "")
        : "";
    const discovery =
      options.linkDiscovery ||
      discoverLinkPickerTargets(
        content,
        cursor.line,
        incomingCountExplicit ? options.additionalTaskCount : 0,
      );
    if (!discovery.valid) {
      new Notice(
        discovery.notLink ? "Cursor is not on a Task Link" : discovery.error,
      );
      return false;
    }

    const activeView = this.getActiveMarkdownView();
    if (!activeView || activeView.editor !== cm || !activeView.file) {
      new Notice("No active markdown note");
      return false;
    }
    const filePath = activeView.file.path;
    const config = options.config || loadBulletPropertyConfig();
    if (!config) {
      return false;
    }
    const basePropertyContext = getProjectNotePropertyContext(
      content,
      cursor.line,
    );
    if (!basePropertyContext.valid) {
      new Notice(basePropertyContext.error);
      return false;
    }
    const requestToken = (this.linkPickerRequestToken || 0) + 1;
    this.linkPickerRequestToken = requestToken;
    const linkSession = Object.freeze({
      ...discovery,
      resolved: Object.freeze([]),
      valid: false,
      error: "Resolving Task Link targets…",
    });
    const picker = new BulletPropertyPickerModal(
      this.app,
      this,
      cm,
      cursor,
      lineText,
      config,
      {
        filePath,
        propertyContext: { ...basePropertyContext, isObsidianTask: false },
        linkSession,
        linkResolving: true,
        random: options.random,
        baseDate: options.baseDate,
      },
    );
    picker.linkResolutionToken = requestToken;
    this.activeBulletPropertyPicker = picker;
    try {
      picker.open();
    } catch (error) {
      if (this.activeBulletPropertyPicker === picker) {
        this.activeBulletPropertyPicker = null;
      }
      throw error;
    }

    let resolution;
    try {
      resolution = await this.resolveLinkPickerTargets(filePath, discovery);
    } catch (_error) {
      resolution = Object.freeze({ error: "Task Link targets could not be read", targets: null });
    }
    const stillCurrent =
      requestToken === this.linkPickerRequestToken &&
      this.activeBulletPropertyPicker === picker &&
      picker.pickerOpen === true &&
      picker.linkResolutionToken === requestToken &&
      this.taskCardPluginUnloading !== true;
    if (!stillCurrent) {
      return false;
    }
    const currentView = this.getActiveMarkdownView();
    if (
      !currentView ||
      currentView.editor !== cm ||
      !currentView.file ||
      currentView.file.path !== filePath ||
      !cm ||
      typeof cm.getValue !== "function" ||
      String(cm.getValue() || "") !== content
    ) {
      new Notice("Current note changed; no tasks were updated");
      picker.close();
      return false;
    }
    if (resolution && resolution.error) {
      new Notice(resolution.error);
      picker.close();
      return false;
    }
    const resolvedSession = Object.freeze({
      ...discovery,
      resolved: resolution.targets,
      valid: true,
      error: null,
    });
    const aggregate = createLinkPickerPropertyItems(config, resolvedSession.resolved);
    if (!aggregate.valid) {
      new Notice(aggregate.error);
      picker.close();
      return false;
    }
    picker.linkSession = resolvedSession;
    picker.linkResolving = false;
    picker.refreshPriorityRollRecommendation();
    picker.refreshCountedRollBatch();
    picker.refreshLinkRollBatch();
    picker.refreshPropertyItems();
    picker.showTaskCard({ rebuild: true });
    return true;
  }

  // Write one planned link-picker note change: through the open editor when
  // one exists, otherwise through vault.process with a preimage guard, as
  // writeTaskMoveChange does. Throws when the preimage changed.
  async writeLinkPickerNoteChange(path, file, before, after) {
    const editor = this.getOpenMarkdownEditorForPath(path);
    if (editor && typeof editor.getValue === "function") {
      if (String(editor.getValue() || "") !== before) {
        throw new Error(`Task Link preimage changed: ${path}`);
      }
      const applied = applyEditorContentTransaction(editor, before, after);
      if (!applied || String(editor.getValue() || "") !== after) {
        throw new Error(`Task Link editor transaction failed: ${path}`);
      }
      return;
    }
    const vault = this.app && this.app.vault;
    if (!vault || typeof vault.process !== "function" || !file) {
      throw new Error("Vault content updates are unavailable");
    }
    let transformed = false;
    await vault.process(file, (content) => {
      if (String(content || "") !== before) {
        throw new Error(`Task Link preimage changed: ${path}`);
      }
      transformed = true;
      return after;
    });
    if (!transformed) {
      throw new Error(`Task Link file transaction failed: ${path}`);
    }
  }

  // Apply one picked property value to every task behind the picker's Task
  // Links. Targets are grouped by note and each note is planned with the pure
  // counted-batch planner; tasks given a strictly future scheduled date are
  // marked Blocked by that planner and pruned from today's open Pomodoros
  // afterwards. Write order is targets, then the daily note. The whole
  // operation is refused when any preimage changed.
  async deleteLinkPickerPropertyValue(picker, item) {
    const linkSession = picker && picker.linkSession;
    const property = item && item.property;
    if (!linkSession || !property || !linkSession.resolved) {
      new Notice("Could not delete task property; no tasks were updated");
      return null;
    }
    const name = normalizeBulletPropertyName(property.name);
    const baseDate = picker.valueBaseDate instanceof Date
      ? getLocalDateStart(picker.valueBaseDate)
      : getLocalDateStart(new Date());
    const groups = groupLinkPickerTargetsByNote(linkSession.resolved);
    const planned = [];
    for (const group of groups) {
      let recoveryByLine = null;
      if (name === "scheduled") {
        recoveryByLine = await buildTargetScheduledRecoveryByLine(
          this.app,
          group.path,
          group.content,
          group.session.targets.map((target) => target.line),
          baseDate,
        );
        const guarded = await this.readLinkPickerNoteContent(group.path, group.file);
        if (guarded !== group.content) {
          new Notice("A linked note changed; no tasks were updated");
          return null;
        }
      }
      const plan = planCountedBulletPropertyBatch(
        group.content,
        group.session,
        name,
        null,
        {
          operation: "delete",
          today: baseDate,
          recoveryByLine,
          stampLine: this.getFreshnessStampLine(),
          freshDateText: this.getFreshnessDateText(),
        },
      );
      if (!plan.valid) {
        new Notice(plan.stale ? `${plan.error}; no tasks were updated` : plan.error);
        return null;
      }
      planned.push({ group, plan });
    }
    const committed = await this.commitLinkPickerPlans(
      picker,
      linkSession,
      planned,
      baseDate,
      { header: `${name} ✗ removed` },
    );
    return committed === true ? { deleted: true } : null;
  }

  async applyLinkPickerPropertyValue(picker, item, options = {}) {
    const linkSession = picker.linkSession;
    const property = picker.selectedPropertyItem &&
      picker.selectedPropertyItem.property;
    if (!linkSession || !property || !item) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
    if (property.values === "priority") {
      return await this.applyLinkPickerPriorityValue(picker, item, options);
    }
    const name = normalizeBulletPropertyName(property.name);
    const value = item.value;
    const baseDate = picker.valueBaseDate instanceof Date
      ? picker.valueBaseDate
      : getLocalDateStart(new Date());
    const groups = groupLinkPickerTargetsByNote(linkSession.resolved);
    if (groups.length === 0) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }

    const planned = [];
    for (const group of groups) {
      let recoveryByLine = null;
      if (
        name === "scheduled" &&
        isDueInlineScheduledValue(value, baseDate)
      ) {
        recoveryByLine = await buildTargetScheduledRecoveryByLine(
          this.app,
          group.path,
          group.content,
          group.session.targets.map((target) => target.line),
          baseDate,
        );
        const guarded = await this.readLinkPickerNoteContent(
          group.path,
          group.file,
        );
        if (guarded !== group.content) {
          new Notice("A linked note changed; no tasks were updated");
          return false;
        }
      }
      const plan = planCountedBulletPropertyBatch(
        group.content,
        group.session,
        name,
        value,
        {
          operation: "set",
          today: baseDate,
          recoveryByLine,
          scheduleLog: options.scheduleLog,
          schedulingWorkLog: options.schedulingWorkLog || options.workLog,
          stampLine: this.getFreshnessStampLine(),
          freshDateText: this.getFreshnessDateText(),
        },
      );
      if (!plan.valid) {
        new Notice(
          plan.stale ? `${plan.error}; no tasks were updated` : plan.error,
        );
        return false;
      }
      planned.push({ group, plan });
    }

    return await this.commitLinkPickerPlans(
      picker,
      linkSession,
      planned,
      baseDate,
      {
        header: `${name} → ${normalizeBulletPropertyValue(value)}`,
        scheduleLog: options.scheduleLog,
        schedulingWorkLog: options.schedulingWorkLog || options.workLog,
      },
    );
  }

  // Apply one picked priority level to every task behind the picker's Task
  // Links, rolling an independent scheduled date per target exactly as the
  // counted priority writer does.
  async applyLinkPickerPriorityValue(picker, item, options = {}) {
    const linkSession = picker.linkSession;
    const property = picker.selectedPropertyItem &&
      picker.selectedPropertyItem.property;
    const level = item && item.priorityLevel;
    if (!linkSession || !property || property.values !== "priority" || !level) {
      new Notice("Could not update priority: invalid configured level");
      return false;
    }
    const baseDate = picker.valueBaseDate instanceof Date
      ? picker.valueBaseDate
      : getLocalDateStart(new Date());
    const random = typeof picker.priorityRandom === "function"
      ? picker.priorityRandom
      : Math.random;
    const groups = groupLinkPickerTargetsByNote(linkSession.resolved);
    if (groups.length === 0) {
      new Notice("Could not update priority: invalid configured level");
      return false;
    }

    const planned = [];
    const rolledDates = [];
    const precomputedByPath =
      options.precomputedByPath instanceof Map ? options.precomputedByPath : null;
    for (const group of groups) {
      const precomputed = precomputedByPath
        ? precomputedByPath.get(group.path)
        : null;
      const rollByLine =
        precomputed && precomputed.rollByLine instanceof Map
          ? precomputed.rollByLine
          : new Map(
              group.session.targets.map((target) => [
                target.line,
                rollPriorityScheduledDateWithOffset(level, baseDate, random),
              ]),
            );
      const scheduledValueByLine =
        precomputed && precomputed.scheduledValueByLine instanceof Map
          ? precomputed.scheduledValueByLine
          : new Map(
              Array.from(rollByLine, ([line, roll]) => [
                line,
                formatBulletPropertyDate(roll.date),
              ]),
            );
      for (const date of scheduledValueByLine.values()) {
        rolledDates.push(date);
      }
      let recoveryByLine = null;
      if (
        Array.from(scheduledValueByLine.values()).some((scheduledValue) =>
          isDueInlineScheduledValue(scheduledValue, baseDate)
        )
      ) {
        recoveryByLine = await buildTargetScheduledRecoveryByLine(
          this.app,
          group.path,
          group.content,
          group.session.targets.map((target) => target.line),
          baseDate,
        );
        const guarded = await this.readLinkPickerNoteContent(
          group.path,
          group.file,
        );
        if (guarded !== group.content) {
          new Notice("A linked note changed; no tasks were updated");
          return false;
        }
      }
      const scheduleLogReasonByLine = new Map(
        group.session.targets.map((target) => [
          target.line,
          formatPriorityRollScheduleReason({
            source: "priority",
            level,
            rolledDays: (rollByLine.get(target.line) || {}).offset,
            fromLevelLabel: getPriorityRollFromLevelLabel(
              property,
              (findBulletPropertyField(target.rawLine, property.name) || {})
                .value || "",
            ),
          }),
        ]),
      );
      const plan = planCountedBulletPropertyBatch(
        group.content,
        group.session,
        property.name,
        null,
        {
          operation: "set-priority",
          priorityValue: level.value,
          scheduledPropertyName: property.schedules,
          scheduledValueByLine,
          today: baseDate,
          recoveryByLine,
          scheduleLog: {
            automatic: true,
            reasonByLine: scheduleLogReasonByLine,
          },
          schedulingWorkLog: options.schedulingWorkLog || options.workLog,
          stampLine: this.getFreshnessStampLine(),
          freshDateText: this.getFreshnessDateText(),
        },
      );
      if (!plan.valid) {
        new Notice(
          plan.stale ? `${plan.error}; no tasks were updated` : plan.error,
        );
        return false;
      }
      planned.push({ group, plan });
    }

    return await this.commitLinkPickerPlans(
      picker,
      linkSession,
      planned,
      baseDate,
      {
        header: null,
        priority: { property, level },
        rolledDates,
        schedulingWorkLog: options.schedulingWorkLog || options.workLog,
      },
    );
  }
}
