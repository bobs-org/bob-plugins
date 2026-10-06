class BlockIdPromptTaskLinkOpenAndNoticesMixin {
  // Delete the selected Task Link and today's open-Pomodoro duplicates,
  // never writing the checkbox. Everything is re-validated first (link line,
  // dependency shape, target line and status); then edits are planned per
  // file — the target's Work Log insertion for an In Progress target, today's
  // daily-note cleanup of the task's other open Pomodoro links, and the
  // selected-link deletion — and written target note first, so a partial
  // failure leaves the lane unchanged with its link still in place and
  // retryable.
  async applyTaskLinkOpen(source, options = {}) {
    const editor = source.editor;
    const link = source.link;
    const normalizedSummary = normalizeWorkSummary(options.workSummary || "");

    if ((editor.getLine(source.line) || "") !== source.lineText) {
      new Notice(`Task link blocked: selected link changed in ${source.sourcePath}`);
      return false;
    }

    const activeContent = editor.getValue();
    const activeLineText = activeContent.split("\n")[source.line];
    if (isTaskDependencyLine(activeLineText) || isMalformedTaskDependencyLine(activeLineText)) {
      new Notice(TASK_DEPENDENCY_LINE_NOTICE);
      return false;
    }
    if (isDependencyTransclusionLink(activeContent.split("\n"), source.line, link)) {
      new Notice(TASK_LINK_DEPENDENCY_NOTICE);
      return false;
    }

    const activeFile = source.file || this.resolveTaskFile(source.sourcePath);
    if (!activeFile) {
      new Notice("Task link blocked: active note could not be resolved");
      return false;
    }

    const target = await this.resolveTaskLinkTarget(link, source.sourcePath, source);
    if (target.error) {
      new Notice(target.error);
      return false;
    }

    if (target.path !== source.target.path || target.rawLine !== source.target.rawLine) {
      new Notice(`Task link stopped: linked task changed in ${target.path}`);
      return false;
    }

    // Read every snapshot up front, keyed by path, so all edits below are
    // planned against one consistent view before anything is written.
    const files = new Map([
      [target.path, target.file],
      [source.sourcePath, activeFile],
    ]);
    const snapshots = new Map([
      [target.path, target.content],
      [source.sourcePath, activeContent],
    ]);
    const dailyFile = this.resolveTodayDailyFile();
    if (dailyFile && !snapshots.has(dailyFile.path)) {
      const dailyContent = await this.readFileSnapshot(dailyFile, source);
      if (dailyContent === null) {
        new Notice(`Task link blocked: ${dailyFile.path} could not be read`);
        return false;
      }

      files.set(dailyFile.path, dailyFile);
      snapshots.set(dailyFile.path, dailyContent);
    }

    if (editor.getValue() !== activeContent) {
      new Notice(`Task link stopped: ${source.sourcePath} changed before update`);
      return false;
    }

    // The lane never changes here: only an In Progress target plans a Work
    // Log insertion, from the prompt's submitted summary (blank for none).
    let workLogPlan = null;
    if (target.status === "/" && normalizedSummary) {
      workLogPlan = planWorkLogInsertion(target.content, target.line, normalizedSummary, {
        date: options.workLogDate || localTodayParts(this.now()),
      });
      if (!workLogPlan) {
        new Notice(`Task link stopped: linked task changed in ${target.path}`);
        return false;
      }
    }

    const deletion = planTaskLinkDeletion(activeContent, source.line, link);
    if (!deletion) {
      new Notice(`Task link stopped: selected link changed in ${source.sourcePath}`);
      return false;
    }

    let cleanup = { edits: [], references: [], removedCount: 0 };
    if (dailyFile) {
      cleanup = planAllOpenPomodoroLinkCleanup(snapshots.get(dailyFile.path), {
        sourcePath: dailyFile.path,
        targetPath: target.path,
        targetBlockId: target.id,
        resolveTarget: (reference, referrerPath) =>
          this.resolveReferenceDestination(reference, referrerPath),
      });
    }

    // Per file: link-deletion edits (a subtree deletion may absorb the token
    // deletions inside it, and the selected edit wins ties by going first) and
    // Work Log edits (which are never absorbed, only checked for overlap).
    const groups = new Map();
    const groupFor = (path) => {
      if (!groups.has(path)) {
        groups.set(path, {
          file: files.get(path),
          content: snapshots.get(path),
          linkEdits: [],
          taskEdits: [],
        });
      }

      return groups.get(path);
    };
    groupFor(source.sourcePath).linkEdits.push(deletion.edit);
    if (dailyFile) {
      groupFor(dailyFile.path).linkEdits.push(...cleanup.edits);
    }
    if (workLogPlan) {
      groupFor(target.path).taskEdits.push(...workLogPlan.edits);
    }

    for (const group of groups.values()) {
      group.edits = [...mergeCoveringEdits(group.linkEdits), ...group.taskEdits];
      if (!validateNonOverlappingEdits(group.edits)) {
        new Notice(`Task link stopped: overlapping edits in ${group.file.path}`);
        return false;
      }
    }

    // The target note may have no planned write (the lane never changes),
    // so re-read it explicitly: never delete links for a task that changed
    // since it was resolved.
    if (target.path !== source.sourcePath) {
      const freshTargetContent = await this.readFileSnapshot(target.file, source);
      if (freshTargetContent === null) {
        new Notice(`Task link blocked: ${target.path} could not be read`);
        return false;
      }

      if (freshTargetContent !== snapshots.get(target.path)) {
        new Notice(`Task link stopped: linked task changed in ${target.path}`);
        return false;
      }
    }

    const originalCursor =
      typeof editor.getCursor === "function" ? editor.getCursor() : null;
    const writeOrder = [
      ...new Set([
        target.path,
        ...(dailyFile ? [dailyFile.path] : []),
        source.sourcePath,
      ]),
    ];
    let wroteAny = false;
    for (const path of writeOrder) {
      const group = groups.get(path);
      if (!group || group.edits.length === 0) {
        continue;
      }

      const applied = await this.applyTargetTaskPlan(
        group.file,
        source,
        { edits: group.edits, content: applyTextEdits(group.content, group.edits) },
        group.content,
        { noticePrefix: "Task link stopped", quiet: wroteAny },
      );
      if (!applied) {
        if (wroteAny) {
          this.reportTaskLinkPartialFailure(path);
        }
        return false;
      }

      wroteAny = true;
      if (path === source.sourcePath) {
        this.restoreCursorClampedToContent(editor, originalCursor);
      }
    }

    let dailyPostContent = null;
    if (dailyFile) {
      const dailyGroup = groups.get(dailyFile.path);
      dailyPostContent =
        dailyGroup !== undefined && dailyGroup !== null
          ? applyTextEdits(dailyGroup.content, dailyGroup.edits)
          : snapshots.get(dailyFile.path);
      if (typeof dailyPostContent !== "string") {
        dailyPostContent = null;
      }
    }

    this.reportTaskLinkOpenOutcome(target, workLogPlan, dailyPostContent);
    return true;
  }

  // Put the cursor back where it was, clamped to the (possibly shorter) note.
  restoreCursorClampedToContent(editor, cursor) {
    if (!cursor) {
      return;
    }

    const lines = editor.getValue().split("\n");
    const line = Math.min(cursor.line, lines.length - 1);
    setEditorCursorIfPossible(editor, {
      line,
      ch: Math.min(cursor.ch, lines[line].length),
    });
  }

  reportTaskLinkOpenOutcome(target, workLogPlan, dailyContent = null) {
    const logged = workLogPlan && workLogPlan.workLogEntryAdded ? " · Work Log updated" : "";
    new Notice(
      `Task Link removed · stays ${laneStatusName(target.status)}${logged}${this.planBudgetNoticeSuffix(dailyContent)}`,
    );
  }

  reportTaskLinkPartialFailure(failedPath) {
    new Notice(
      `Task link removal incomplete, but ${failedPath} could not be updated; press Ctrl+Shift+Enter on the link again`,
    );
  }

  pomodoroPlanErrorNotice(error, dailyPath) {
    switch (error) {
      case "no-section":
        return `Task link blocked: ${dailyPath} has no Pomodoros section`;
      case "no-eligible-entry":
        return `Task link blocked: ${dailyPath} has no eligible open Pomodoro`;
      case "multiple-open-timed":
        return `Task link blocked: ${dailyPath} has multiple open timed Pomodoros`;
      default:
        return `Task link blocked: ${dailyPath} could not be updated`;
    }
  }

  // nav api v3 `reviewWalk` feature detection (same contract as the
  // task-status-cycler lookup): the nav version check plus a versioned
  // reviewWalk member with callable capture and continue. Never throws;
  // null means today's behavior.
  getReviewWalkApi() {
    try {
      const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
      const holder = plugins && plugins["bob-navigation-hotkeys"];
      const api = holder && holder.api;
      if (!api || !(Number(api.version) >= 3)) {
        return null;
      }
      const walk = api.reviewWalk;
      if (!walk || !(Number(walk.version) >= 1)) {
        return null;
      }
      if (
        typeof walk.capture !== "function" ||
        typeof walk.continue !== "function"
      ) {
        return null;
      }
      return walk;
    } catch (error) {
      return null;
    }
  }

  // Idempotent review origin settle: nulls the stored origin and continues
  // exactly once. A null outcome settles the gesture lock without advancing
  // and shows nothing. Never throws.
  settleLinkReviewOrigin(source, outcome) {
    try {
      const origin = source && source.reviewOrigin;
      if (!origin) {
        return;
      }
      source.reviewOrigin = null;
      const walk = this.getReviewWalkApi();
      if (!walk) {
        if (outcome && typeof outcome.notice === "string" && outcome.notice) {
          new Notice(outcome.notice);
        }
        return;
      }
      void walk.continue(origin, outcome);
    } catch (error) {
      // Best effort: never throw out of a settle path.
    }
  }

  // Review-walk link success: the "Linked · …" text becomes the first line
  // of nav's composed landing toast via continue; off a landing it is shown
  // as today. Failures never reach here: they keep their own notices and
  // the toggle's finally (or the prompt cancel) settles with null.
  reportPomodoroLinkOutcomeOrContinue(source, plan, pomodoroPlan) {
    const text = this.formatPomodoroLinkOutcome(plan, pomodoroPlan);
    if (source && source.reviewOrigin) {
      this.settleLinkReviewOrigin(source, { kind: "link-today", notice: text });
    } else {
      new Notice(text);
    }
  }

  formatPomodoroLinkOutcome(plan, pomodoroPlan) {
    const base = plan.statusChanged
      ? "Linked · Next"
      : `Linked · stays ${laneStatusName(plan.newStatus)}`;
    const chips = [];
    if (plan.removedFutureSchedule) {
      chips.push("removed future schedule");
    }
    if (plan.logEntryAdded) {
      chips.push("logged schedule change");
    }
    const suffix = chips.length ? ` · ${chips.join(" · ")}` : "";

    return `${base}${suffix}${this.futureLinkCleanupNoticeSuffix(pomodoroPlan.removedCount)}${this.planBudgetNoticeSuffix(pomodoroPlan && pomodoroPlan.content)}`;
  }

  reportPomodoroLinkOutcome(plan, pomodoroPlan) {
    new Notice(this.formatPomodoroLinkOutcome(plan, pomodoroPlan));
  }

  reportPomodoroUnlinkOutcome(cleanupPlan, workLogPlan = {}, status) {
    const logged = workLogPlan.workLogEntryAdded ? " · Work Log updated" : "";
    new Notice(
      `Unlinked · stays ${laneStatusName(status)}${logged}${this.planBudgetNoticeSuffix(cleanupPlan && cleanupPlan.content)}`,
    );
  }

  reportPomodoroUnlinkPartialFailure(cleanupPlan, status, workLogSummary) {
    const removedCount = cleanupPlan.removedCount;
    const summarySuffix = workLogSummary ? " and work summary was not logged" : "";
    new Notice(
      `Removed ${removedCount} open Pomodoro ${pluralize(
        removedCount,
        "link",
        "links",
      )}, but task stays ${laneStatusName(status)}${summarySuffix}`,
    );
  }

  reportPomodoroLinkPartialFailure(plan, isNewId, dailyPath) {
    const parts = activationPartialFailureParts(plan);
    if (isNewId) {
      new Notice(
        `Task block ID added${parts.length ? ` and ${parts.join(", ")}` : ""}, but ${dailyPath} could not be updated`,
      );
      return;
    }

    new Notice(
      `Task ${parts.length ? parts.join(", ") : "updated"}, but ${dailyPath} could not be updated`,
    );
  }

  currentFutureLinkCleanupNoticeSuffix(removedCount, options = {}) {
    if (Number.isInteger(removedCount) && removedCount > 0) {
      return ` · removed ${removedCount} current/future Pomodoro ${pluralize(
        removedCount,
        "link",
        "links",
      )}`;
    }

    return options.includeNoop ? " · no current/future Pomodoro links removed" : "";
  }

  // Plan-budget meter for Ctrl+Shift+Enter Notices: ` · plan T/Tc · L/Lc`,
  // with a trailing ` 🔴` when over the cap. Computed synchronously from the
  // post-write daily content through bob-ledger-tools' public API. Returns ""
  // (no suffix) when the API is missing, the budget shape is unexpected, or
  // the daily note wasn't part of the operation (non-string content). Warns
  // only, never refuses: failures degrade to no suffix.
  planBudgetNoticeSuffix(dailyContent) {
    if (typeof dailyContent !== "string") {
      return "";
    }
    try {
      const plugins = this.app && this.app.plugins;
      const byId =
        plugins && plugins.plugins
          ? plugins.plugins["bob-ledger-tools"]
          : null;
      const holder =
        byId ||
        (plugins && typeof plugins.getPlugin === "function"
          ? plugins.getPlugin("bob-ledger-tools")
          : null);
      const api = holder && holder.api;
      if (!api || typeof api.planBudget !== "function") {
        return "";
      }
      const budget = api.planBudget({ content: dailyContent });
      if (!budget || typeof budget !== "object" || typeof budget.then === "function") {
        return "";
      }
      const themes = budget.themes;
      const links = budget.links;
      if (
        !themes ||
        !links ||
        !Number.isInteger(themes.count) ||
        !Number.isInteger(themes.cap) ||
        !Number.isInteger(links.count) ||
        !Number.isInteger(links.cap)
      ) {
        return "";
      }
      const over =
        budget.status === "over" || themes.over === true || links.over === true;
      return ` · plan ${themes.count}/${themes.cap} · ${links.count}/${links.cap}${over ? " 🔴" : ""}`;
    } catch (error) {
      return "";
    }
  }

}
