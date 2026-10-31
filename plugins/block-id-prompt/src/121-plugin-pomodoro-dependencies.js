class BlockIdPromptPomodoroDependencyMixin {
  async readTaskDependencyDocuments(source, targetFile, options = {}) {
    const vault = this.app && this.app.vault;
    let files = [];
    const pathFailures = [];
    if (options.taskBearingOnly === true) {
      const index = this.taskWikilinkIndex;
      const paths = index && typeof index.taskBearingPaths === "function"
        ? index.taskBearingPaths()
        : [];
      const wanted = new Set([...paths, source && source.sourcePath].filter(Boolean));
      files = [...wanted].map((path) => {
        try {
          const file = vault && typeof vault.getAbstractFileByPath === "function"
            ? vault.getAbstractFileByPath(path)
            : null;
          if (!file) {
            pathFailures.push(path);
          }
          return file;
        } catch (_error) {
          pathFailures.push(path);
          return null;
        }
      }).filter((file) => file && file.path);
    } else {
      files = vault && typeof vault.getMarkdownFiles === "function"
        ? vault.getMarkdownFiles().filter((file) => file && file.path)
        : [];
    }
    if (targetFile && !files.some((file) => file.path === targetFile.path)) {
      files.push(targetFile);
    }
    const documents = [];
    const fileByPath = new Map(files.map((file) => [file.path, file]));
    const failures = [...pathFailures];
    for (const file of files) {
      let content = null;
      if (
        file.path === source.sourcePath && source.editor &&
        typeof source.editor.getValue === "function"
      ) {
        content = source.editor.getValue();
      } else if (typeof readAuthoritativePromptTargetContent === "function") {
        try {
          const snapshot = await readAuthoritativePromptTargetContent(
            this,
            source,
            file,
          );
          if (!snapshot || snapshot.ambiguous) {
            failures.push(file.path);
            continue;
          }
          content = snapshot.content;
        } catch (error) {
          content = null;
        }
      } else if (typeof this.readFileSnapshot === "function") {
        content = await this.readFileSnapshot(file, source);
      }
      if (typeof content !== "string") {
        failures.push(file.path);
        continue;
      }
      documents.push({ path: file.path, text: content });
    }
    return { documents, fileByPath, failures };
  }

  async consumeBlockedTaskPomodoroLink(source, targetFile, options = {}) {
    const editor = source && source.editor;
    const targetPath = options.targetPath || source.sourcePath;
    const targetLineNumber = Number.isInteger(options.targetLine)
      ? options.targetLine
      : source.line;
    const targetLine = typeof options.targetLineText === "string"
      ? options.targetLineText
      : editor && typeof editor.getLine === "function"
        ? editor.getLine(targetLineNumber)
        : null;
    const targetMatch = typeof targetLine === "string"
      ? getObsidianTaskLineMatch(targetLine)
      : null;
    if (
      !targetMatch ||
      (options.forceCheck !== true &&
        targetMatch[1] !== BLOCKED_OBSIDIAN_TASK_STATUS &&
        !hasProjectBlockedResidentTag(targetLine))
    ) {
      return options.returnDetails === true
        ? { handled: false, kind: "clear", plan: null }
        : false;
    }
    const { documents, fileByPath, failures } =
      await this.readTaskDependencyDocuments(source, targetFile, {
        taskBearingOnly: options.taskBearingOnly === true,
      });
    if (typeof options.targetContent === "string") {
      const existing = documents.find((document) => document.path === targetPath);
      if (existing) {
        existing.text = options.targetContent;
      } else {
        documents.push({ path: targetPath, text: options.targetContent });
      }
    }
    const plan = planTaskLinkBlockConsumption(
      documents,
      targetPath,
      targetLineNumber,
      this.now(),
    );
    if (!plan) {
      if (
        options.returnDetails === true &&
        (failures.length > 0 || options.indexReady === false)
      ) {
        new Notice(
          "Task link blocked: dependency status could not be checked; no Pomodoro link was created",
        );
        return { handled: true, kind: "unavailable", plan: null, failures };
      }
      return options.returnDetails === true
        ? { handled: false, kind: "clear", plan: null }
        : false;
    }
    if (
      options.returnDetails !== true &&
      plan.unresolvedIds && plan.unresolvedIds.length > 0 &&
      (failures.length > 0 || options.indexReady === false)
    ) {
      new Notice(
        "Task link blocked: dependency status could not be checked; no Pomodoro link was created",
      );
      return options.returnDetails === true
        ? { handled: true, kind: "unavailable", plan, failures, documents }
        : true;
    }
    const projectBlocked = plan.inheritedProjectBlocked ||
      (plan.projectDependencyBlocked && !plan.projectOwnPrerequisites) || plan.projectScheduleIsFuture ||
      plan.projectDateRefusal;
    if (options.returnDetails === true && projectBlocked) {
      if (plan.inheritedProjectBlocked) {
        new Notice(
          `Project blocked by parent project · ${plan.projectParent || plan.projectPath || targetPath} · no Pomodoro link was created`,
        );
      } else if (plan.projectScheduleIsFuture) {
        new Notice(
          `Project blocked by date until ${plan.projectSchedule} · move the ^prj Schedule in ${plan.projectPath} · no Pomodoro link was created`,
        );
      } else if (plan.projectDateRefusal) {
        new Notice(
          `Project date blocked · move the project date from the ^prj Schedule action in ${plan.projectPath || targetPath} · no Pomodoro link was created`,
        );
      } else {
        new Notice(
          `Project blocked by dependency · move the ^prj Schedule in ${plan.projectPath || targetPath} · no Pomodoro link was created`,
        );
      }
      return {
        handled: true,
        kind: "project",
        plan,
        applied: 0,
        failed: false,
        failures,
        documents,
        writtenDocuments: new Map(),
      };
    }
    if (
      options.returnDetails === true &&
      plan.unresolvedIds && plan.unresolvedIds.length > 0 &&
      (failures.length > 0 || options.indexReady === false)
    ) {
      new Notice(
        "Task link blocked: dependency status could not be checked; no Pomodoro link was created",
      );
      return {
        handled: true,
        kind: "unavailable",
        plan,
        failures,
        documents,
      };
    }
    if (!plan.blocked) {
      return options.returnDetails === true
        ? { handled: false, kind: "clear", plan, failures, documents }
        : false;
    }

    let applied = 0;
    let failed = false;
    const writtenDocuments = new Map();
    const updates = [...plan.updatesByPath.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    );
    for (const [path, update] of updates) {
      if (update.text === update.preimage) {
        continue;
      }
      const file = fileByPath.get(path) ||
        (this.app.vault &&
        typeof this.app.vault.getAbstractFileByPath === "function"
          ? this.app.vault.getAbstractFileByPath(path)
          : null);
      if (!file) {
        failed = true;
        continue;
      }
      const statusPlan = {
        hasChanges: true,
        content: update.text,
        edits: update.edits,
      };
      if (
        await this.applyTargetTaskPlan(
          file,
          source,
          statusPlan,
          update.preimage,
          { noticePrefix: "Task consumption stopped" },
        )
      ) {
        applied += update.edits.length;
        writtenDocuments.set(path, update.text);
        if (options.taskBearingOnly === true && typeof this.refreshTaskWikilinkNote === "function") {
          this.refreshTaskWikilinkNote(path, update.text);
        }
      } else {
        failed = true;
      }
    }

    if (plan.inheritedProjectBlocked) {
      new Notice(
        `Project blocked by parent project · ${plan.projectParent || plan.projectPath || source.sourcePath} · no Pomodoro link was created`,
      );
    } else if (plan.dependencyBlocked) {
      const promotionText = applied > 0
        ? `raised ${applied} prerequisite${applied === 1 ? "" : "s"} to Next`
        : "prerequisites already raised";
      const suffix = failed ? " · some updates failed" : "";
      new Notice(
        `${plan.projectDependencyBlocked ? "Project blocked by dependency" : "Task blocked"} · ${promotionText}${plan.projectPath ? ` · project ${plan.projectPath}` : ""}${suffix} · no Pomodoro link created`,
      );
    } else if (plan.projectDateRefusal) {
      new Notice(
        `Project date blocked · move the project date from the ^prj Schedule action in ${plan.projectPath || source.sourcePath} · no Pomodoro link created`,
      );
    } else if (plan.projectScheduleIsFuture) {
      new Notice(
        `Project blocked by date until ${plan.projectSchedule} · move the ^prj Schedule in ${plan.projectPath} · no Pomodoro link created`,
      );
    } else {
      new Notice(`Task blocked · project reason in ${plan.projectPath || targetPath} · no Pomodoro link created`);
    }
    if (options.returnDetails === true) {
      const kind = plan.inheritedProjectBlocked ||
        (plan.projectDependencyBlocked && !plan.projectOwnPrerequisites) ||
        plan.projectScheduleIsFuture || plan.projectDateRefusal
        ? "project"
        : plan.dependencyBlocked
          ? "prerequisites"
          : "project";
      return {
        handled: true,
        kind,
        plan,
        applied,
        failed,
        failures,
        documents,
        writtenDocuments,
      };
    }
    return true;
  }

}
