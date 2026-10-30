function taskWikilinkPomodoroDisplayDate(value) {
  const date = value && typeof value === "object"
    ? value
    : parseStrictCalendarDate(value);
  if (!date || !Number.isInteger(date.month) || !Number.isInteger(date.day)) {
    return "";
  }
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[date.month - 1]} ${date.day}`;
}

function taskWikilinkPaddedTaskText(row) {
  const line = row && Number.isInteger(row.line) ? row.line : 0;
  return `${"\n".repeat(Math.max(0, line))}${String((row && row.rawLine) || "")}`;
}

function taskWikilinkPomodoroCanonicalId(path, blockId) {
  return `${String(path || "").replace(/\.md$/i, "").replace(/\//g, "__")}__${String(blockId || "")}`;
}

class BlockIdPromptTaskWikilinkPomodoroMixin {
  taskWikilinkPomodoroContext(source) {
    const wikilinkToken = source && source.trigger === "((";
    if (!wikilinkToken && !sourceQualifiesForPomodoroActivation(source)) {
      return null;
    }
    try {
      const content = source.editor.getValue();
      const lines = String(content || "").split("\n");
      if (wikilinkToken && !isSoleContentLinkBullet(
        source.editor.getLine(source.line) || "",
        source.replaceStart,
        source.replaceEnd,
      )) {
        return null;
      }
      const ancestry = findPomodoroSourceContext(lines, source.line);
      if (!ancestry || !ancestry.isOpen) {
        return null;
      }
      const model = collectPomodoroLinkEntries(content);
      const entry = (model.entries || []).find((candidate) => candidate.entryLine === ancestry.ownerLine);
      if (!entry || !entry.open) {
        return null;
      }
      const parts = parsePomodoroEntryParts(entry.entryText);
      return {
        sourcePath: source.sourcePath,
        ownerLine: entry.entryLine,
        entryText: entry.entryText,
        title: entry.name || entry.label || entry.range && entry.range.text || entry.title,
        range: entry.range ? entry.range.text : "planned",
        entry,
        parts,
      };
    } catch (_error) {
      return null;
    }
  }

  async taskWikilinkPomodoroDocuments(source) {
    const index = this.ensureTaskWikilinkIndex();
    if (!index.progress.ready) {
      await new Promise((resolve) => {
        let settled = false;
        let unsubscribe = () => {};
        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          unsubscribe();
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(finish, 30000);
        unsubscribe = index.subscribe(() => {
          if (index.progress.ready) {
            finish();
          }
        });
        if (index.progress.ready) {
          finish();
        }
      });
    }
    const snapshot = await this.readTaskDependencyDocuments(source, null, { taskBearingOnly: true });
    const indexReady = Boolean(index.progress && index.progress.ready);
    if (!indexReady) {
      snapshot.failures.push("task index is not ready");
    }
    return { ...snapshot, indexReady };
  }

  taskWikilinkPomodoroTarget(context, row, shown) {
    const target = {
      kind: "existing",
      entryLine: context.ownerLine,
      entryText: context.entryText,
      title: context.title,
    };
    if (shown && typeof shown === "object" && shown.theme) {
      target.themeIntent = {
        deliberate: true,
        linkOnce: false,
        shown: clonePomodoroThemeSuggestion(shown),
      };
    }
    return target;
  }

  taskWikilinkPomodoroThemePreview(row, context) {
    try {
      const api = getBlockPomodoroThemesApi(this.app);
      if (!api || typeof api.suggestFor !== "function") {
        return { target: this.taskWikilinkPomodoroTarget(context, row, null), typeClause: null };
      }
      const text = taskWikilinkPaddedTaskText(row);
      const shown = api.suggestFor({
        path: row.notePath,
        line: row.line + 1,
        text,
      });
      const target = this.taskWikilinkPomodoroTarget(context, row, shown);
      if (!target.themeIntent) {
        return { target, typeClause: null };
      }
      const source = {
        sourcePath: row.notePath,
        line: row.line,
        pomodoroTarget: target,
      };
      const write = resolvePomodoroLinkThemeWrite(this, source, target, text);
      let typeClause = null;
      if (write.retypeKind === "set" && write.destinationThemeName) {
        typeClause = `type becomes ${write.destinationThemeName}`;
      } else if (write.retypeKind === "clear") {
        typeClause = `type cleared (inherits ${write.destinationThemeName || write.keepsName || "the note type"})`;
      } else if (write.retypeKind && write.keepsName) {
        typeClause = `keeps ${write.keepsName}`;
      }
      return { target, typeClause };
    } catch (_error) {
      return { target: this.taskWikilinkPomodoroTarget(context, row, null), typeClause: null };
    }
  }

  taskWikilinkPomodoroProjectGuard(plan, path) {
    if (!plan) {
      return null;
    }
    const projectPath = plan.projectPath || path;
    if (plan.inheritedProjectBlocked) {
      return `Blocked by its project ${plan.projectParent || projectPath} · move the ^prj Schedule`;
    }
    if (plan.projectScheduleIsFuture) {
      return `Blocked by project date until ${plan.projectSchedule} · move the ^prj Schedule in ${projectPath}`;
    }
    if (plan.projectDateRefusal) {
      return `Project date blocked · move the project date from the ^prj Schedule action in ${projectPath}`;
    }
    if (plan.projectDependencyBlocked) {
      return `Blocked by project prerequisites · move the ^prj Schedule in ${projectPath}`;
    }
    return null;
  }

  taskWikilinkPomodoroAlreadyLinked(context, row, id) {
    if (!context || !row || !id) {
      return false;
    }
    for (const link of context.entry.links || []) {
      if (link.blockId !== id) {
        continue;
      }
      try {
        const destination = this.resolveReferenceDestination(link.targetText, context.sourcePath);
        const path = typeof destination === "string" ? destination : destination && destination.path;
        if (path === row.notePath || (!link.targetText && context.sourcePath === row.notePath)) {
          return true;
        }
      } catch (_error) {
        if (!link.targetText && context.sourcePath === row.notePath) {
          return true;
        }
      }
    }
    return false;
  }

  taskWikilinkPomodoroDetail(source, row, context, dependencySnapshot) {
    const detail = {
      scheduledDate: null,
      scheduleLogPresent: Boolean(row.scheduleLogPresent),
      typeClause: null,
      target: null,
      waitingOn: 0,
      guardText: null,
      dependencyUnavailable: false,
    };
    const scheduled = findSingleFutureScheduledField(row.rawLine, localTodayParts(this.now()));
    if (scheduled) {
      detail.scheduledDate = taskWikilinkPomodoroDisplayDate(scheduled.date);
    }
    const theme = this.taskWikilinkPomodoroThemePreview(row, context);
    detail.target = theme.target;
    detail.typeClause = theme.typeClause;
    if (row.blockId && this.taskWikilinkPomodoroAlreadyLinked(context, row, row.blockId)) {
      detail.guardText = "Already in this Pomodoro";
      return detail;
    }
    const docs = dependencySnapshot && Array.isArray(dependencySnapshot.documents)
      ? dependencySnapshot.documents
      : [];
    const plan = planTaskLinkBlockConsumption(docs, row.notePath, row.line, this.now());
    const failures = dependencySnapshot && Array.isArray(dependencySnapshot.failures)
      ? dependencySnapshot.failures
      : [];
    if (
      !dependencySnapshot || dependencySnapshot.indexReady === false ||
      failures.length > 0
    ) {
      detail.dependencyUnavailable = true;
    }
    if (plan && plan.blocked) {
      const unavailable = (plan.unresolvedIds || []).length > 0 &&
        failures.length > 0;
      const projectGuard = this.taskWikilinkPomodoroProjectGuard(plan, row.notePath);
      if (projectGuard) {
        detail.guardText = projectGuard;
        return detail;
      }
      if (unavailable) {
        detail.dependencyUnavailable = true;
      } else if (plan.dependencyBlocked && !detail.dependencyUnavailable) {
        detail.waitingOn = plan.openPrerequisiteCount || 0;
      }
    } else if (row.prjBlocked) {
      detail.guardText = `Blocked by its project ${row.notePath} · move the ^prj Schedule`;
      return detail;
    } else if (!plan && failures.length > 0) {
      detail.dependencyUnavailable = true;
    }
    return detail;
  }

  async taskWikilinkPomodoroPrepare(source, task, options = {}) {
    const context = this.taskWikilinkPomodoroContext(source);
    if (!context) {
      new Notice("Task link stopped: the source is no longer under an open Pomodoro");
      return { handled: true, kind: "stale" };
    }
    const sourcePresent = source.trigger === "(("
      ? this.taskWikilinkTokenStillPresent(source)
      : this.sourceMarkerStillPresent(source, { quiet: true });
    if (!sourcePresent) {
      new Notice("Task link stopped: the source link changed");
      return { handled: true, kind: "stale" };
    }
    const chosenTarget = options.pomodoroTarget || task.pomodoroTarget || source.pomodoroTarget || null;
    if (
      chosenTarget && chosenTarget.kind === "existing" &&
      (chosenTarget.entryLine !== context.ownerLine || chosenTarget.entryText !== context.entryText)
    ) {
      new Notice("Task link stopped: the source Pomodoro changed");
      return { handled: true, kind: "stale" };
    }
    const file = this.resolveTaskFile(task.notePath) ||
      (this.app.vault && this.app.vault.getAbstractFileByPath
        ? this.app.vault.getAbstractFileByPath(task.notePath)
        : null);
    if (!file) {
      new Notice("Task link blocked: target note could not be resolved");
      return { handled: true, kind: "stale" };
    }
    const authoritative = await readAuthoritativePromptTargetContent(this, source, file);
    if (!authoritative || typeof authoritative.content !== "string") {
      new Notice(`Task link blocked: ${task.notePath} could not be read`);
      return { handled: true, kind: "stale" };
    }
    let currentTask = { ...task };
    if (source.trigger === "((" && options.isNewId === true) {
      const relocated = taskWikilinkLineForIdentity(authoritative.content, task);
      if (!relocated) {
        new Notice(`Task link blocked: selected task moved or changed in ${task.notePath}`);
        return { handled: true, kind: "stale" };
      }
      currentTask = { ...currentTask, ...relocated };
    } else if ((authoritative.content.split("\n")[task.line] || "") !== task.rawLine) {
      new Notice(`Task link blocked: selected task changed in ${task.notePath}`);
      return { handled: true, kind: "stale" };
    }
    const taskMatch = getObsidianTaskLineMatch(currentTask.rawLine);
    if (!taskMatch || !OPEN_OBSIDIAN_TASK_STATUSES.has(taskMatch[1])) {
      new Notice("Closed tasks can't join a Pomodoro");
      return { handled: true, kind: "closed" };
    }
    const existingId = getTrailingBlockId(currentTask.rawLine);
    const id = options.id || null;
    if (options.isNewId === true && existingId) {
      new Notice(`Task link stopped: selected task now has ^${existingId}`);
      return { handled: true, kind: "stale" };
    }
    if (options.isNewId !== true && id && existingId !== id) {
      new Notice("Task link blocked: selected task block ID changed");
      return { handled: true, kind: "stale" };
    }
    if (id) {
      const matches = blockTokenMatches(authoritative.content, id);
      if (options.isNewId === true ? matches.length > 0 : matches.length !== 1) {
        new Notice(`Block ID ^${id} is no longer unique in ${task.notePath}`);
        return { handled: true, kind: "stale" };
      }
      if (this.taskWikilinkPomodoroAlreadyLinked(context, currentTask, id)) {
        new Notice("Already in this Pomodoro");
        return { handled: true, kind: "duplicate" };
      }
    }
    let dependencySnapshot;
    try {
      dependencySnapshot = await this.taskWikilinkPomodoroDocuments(source);
    } catch (_error) {
      new Notice(
        "Task link blocked: dependency status could not be checked; no Pomodoro link was created",
      );
      return { handled: true, kind: "unavailable" };
    }
    let dependency;
    try {
      dependency = await this.consumeBlockedTaskPomodoroLink(source, file, {
        forceCheck: true,
        returnDetails: true,
        taskBearingOnly: true,
        indexReady: dependencySnapshot.indexReady !== false,
        targetPath: currentTask.notePath,
        targetLine: currentTask.line,
        targetLineText: currentTask.rawLine,
        targetContent: authoritative.content,
      });
    } catch (_error) {
      new Notice(
        "Task link blocked: dependency status could not be checked; no Pomodoro link was created",
      );
      return { handled: true, kind: "unavailable" };
    }
    if (dependency && dependency.handled) {
      if (dependency.kind === "prerequisites") {
        if (source.trigger === "^^") {
          this.revertTaskPickerMarker(source, { quiet: true });
          return { handled: true, kind: "prerequisites", result: { completed: true } };
        }
        return {
          handled: true,
          kind: "prerequisites",
          result: {
            keepOpen: true,
            raised: this.taskWikilinkPomodoroRaisedSection(currentTask, dependency),
          },
        };
      }
      return {
        handled: true,
        kind: dependency.kind,
        result: source.trigger === "((" ? { keepOpen: true } : null,
      };
    }
    const themeTarget = chosenTarget || this.taskWikilinkPomodoroThemePreview(currentTask, context).target;
    if (hasProjectBlockedResidentTag(currentTask.rawLine)) {
      const projectReason = `Blocked by its project ${currentTask.notePath} · move the ^prj Schedule`;
      new Notice(projectReason);
      return {
        handled: true,
        kind: "project",
        result: source.trigger === "((" ? { keepOpen: true } : null,
      };
    }
    return {
      handled: false,
      context,
      task: currentTask,
      file,
      content: authoritative.content,
      target: themeTarget,
      themeWrite: null,
    };
  }

  taskWikilinkPomodoroRaisedSection(task, dependency) {
    const plan = dependency && dependency.plan;
    const documents = dependency && Array.isArray(dependency.documents)
      ? dependency.documents
      : [];
    const written = dependency && dependency.writtenDocuments instanceof Map
      ? dependency.writtenDocuments
      : new Map();
    const openIds = new Set((plan && plan.openPrerequisites || []).map(String));
    const nextDocuments = documents.map((document) => ({
      path: document.path,
      text: written.has(document.path) ? written.get(document.path) : document.text,
    }));
    const records = taskDependencyRecordsFromDocuments(nextDocuments);
    const matching = records.filter((record) => {
      if (record.status !== "*") {
        return false;
      }
      const keys = [record.taskId, record.blockId ? taskWikilinkPomodoroCanonicalId(record.path, record.blockId) : null]
        .filter(Boolean)
        .map(String);
      return keys.some((key) => openIds.has(key));
    });
    const rows = [];
    for (const document of nextDocuments) {
      const parsed = parseNoteTaskRows(
        document.path,
        document.text,
        (this.taskWikilinkIndex && this.taskWikilinkIndex.settings) || defaultTaskWikilinkSettings(),
      );
      for (const row of parsed) {
        if (row.status === "*" && matching.some((record) => record.path === row.notePath && record.line === row.line)) {
          rows.push(row);
        }
      }
    }
    const count = rows.length;
    const banner = count > 0
      ? dependency.applied > 0
        ? `Raised ${count} ${count === 1 ? "prerequisite" : "prerequisites"} to Next · pick one to link`
        : "Prerequisites already Next · pick one to link"
      : "Prerequisites changed · pick one to link";
    return { rows, taskTitle: task.displayText || cleanTaskDisplayText(task.rawLine), banner };
  }

  async taskWikilinkPomodoroCommit(source, task, options = {}) {
    const id = options.id || task.existingId;
    const prepared = await this.taskWikilinkPomodoroPrepare(source, task, {
      ...options,
      id,
      isNewId: options.isNewId === true,
    });
    if (prepared.handled) {
      return prepared.result || (prepared.kind === "stale" ? { stale: true } : null);
    }
    const themeSource = {
      sourcePath: prepared.task.notePath,
      line: prepared.task.line,
      pomodoroTarget: prepared.target,
    };
    const themeWrite = resolvePomodoroLinkThemeWrite(
      this,
      themeSource,
      prepared.target,
      prepared.content,
    );
    const plan = planTargetTaskUpdate(prepared.content, prepared.task.line, {
      activationEligible: true,
      forceNext: true,
      newBlockId: options.isNewId === true ? id : null,
      now: this.now(),
      stampLine: this.getFreshnessStampLine(),
      freshDateText: this.getFreshnessDateText(),
      themeEdit: themeWrite.themeEdit,
    });
    if (!plan) {
      new Notice(`Task link stopped: selected task changed in ${prepared.task.notePath}`);
      return { stale: true };
    }
    attachPomodoroLinkThemeOutcome(plan, themeWrite);
    if (
      plan.hasChanges &&
      !(await this.applyTargetTaskPlan(prepared.file, source, plan, prepared.content))
    ) {
      return { stale: true };
    }
    const linkTarget = this.taskWikilinkLinkTarget(prepared.task, source.sourcePath);
    const completionSource = this.adjustSourceForPlan(
      {
        ...source,
        targetText: linkTarget,
        blockPrefix: CANONICAL_BLOCK_LINK_PREFIX,
        aliasSuffix: "",
      },
      prepared.task.notePath,
      plan,
    );
    const completion = this.completeTaskSourceLink(
      completionSource,
      id,
      prepared.task.notePath,
    );
    if (!completion) {
      const parts = activationPartialFailureParts(plan);
      new Notice(`Task ${parts.length ? parts.join(", ") : "updated"}, but the source link changed before completion`);
      return { stale: true };
    }
    this.refreshTaskWikilinkNote(prepared.task.notePath, plan.content);
    const themeChip = formatPomodoroThemeLinkChip(plan);
    const entryName = pomodoroTargetDestinationName(prepared.target) || prepared.context.title;
    const dailyContent = source.editor && typeof source.editor.getValue === "function"
      ? source.editor.getValue()
      : null;
    new Notice(
      `Linked under ${entryName}${themeChip}${activationSuccessSuffix(plan)}${this.futureLinkCleanupNoticeSuffix(completion.removedCount)}${this.planBudgetNoticeSuffix(dailyContent)}`,
    );
    return { ok: true, completed: true };
  }

  taskWikilinkLinkTarget(task, sourcePath) {
    let target = task.linkTarget || taskWikilinkPathStem(task.notePath);
    try {
      const resolved = this.app.metadataCache &&
        typeof this.app.metadataCache.getFirstLinkpathDest === "function"
        ? this.app.metadataCache.getFirstLinkpathDest(target, sourcePath)
        : null;
      if (!resolved || resolved.path !== task.notePath) {
        target = taskWikilinkPathStem(task.notePath);
      }
    } catch (_error) {
      target = taskWikilinkPathStem(task.notePath);
    }
    return target;
  }
}
