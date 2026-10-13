class BobNavigationHotkeysPropertyDependencyMixin {

  async deleteProjectNoteScheduledValue(
    cm,
    cursor,
    filePath,
    expectedLine,
    expectedValue,
  ) {
    const writeContext = this.getProjectScheduledWriteContext(
      cm,
      cursor,
      filePath,
      expectedLine,
      expectedValue,
      "deleted",
    );
    if (!writeContext.valid) {
      new Notice(writeContext.error);
      return null;
    }

    const today = new Date();
    const recoveryByLine = await buildTargetScheduledRecoveryByLine(
      this.app,
      filePath,
      writeContext.content,
      getProjectScheduleRecoveryTargetLines(writeContext.content),
      today,
      { projectScheduled: null },
    );
    const guarded = this.getProjectScheduledWriteContext(
      cm,
      cursor,
      filePath,
      expectedLine,
      expectedValue,
      "deleted",
    );
    if (!guarded.valid || guarded.content !== writeContext.content) {
      new Notice(
        guarded.valid
          ? "Active project note changed; scheduled was not deleted"
          : guarded.error,
      );
      return null;
    }
    const plan = planProjectScheduledDelete(
      writeContext.content,
      cursor.line,
      {
        today,
        recoveryByLine,
        markUnblockedLine: navFreshnessMarkUnblockedLine(
          this.getFreshnessApi(),
        ),
        ...navNoteScopeFlags(filePath),
      },
    );
    if (!plan.valid) {
      new Notice(plan.error);
      return null;
    }

    const plannedSource = splitMarkdownContent(plan.content);
    let finalLine = plannedSource.lines[plan.cursorLine] || "";
    if (finalLine !== String(expectedLine || "")) {
      const stamper = this.getFreshnessStampLine();
      if (typeof stamper === "function") {
        finalLine = applyFreshStampLine(
          finalLine,
          stamper,
          this.getFreshnessDateText(),
        );
        plannedSource.lines[plan.cursorLine] = finalLine;
      }
    }
    const finalContent = plannedSource.lines.join(plannedSource.lineEnding);
    try {
      if (
        plan.changed &&
        !applyEditorContentTransaction(
          cm,
          writeContext.content,
          finalContent,
          {
            line: plan.cursorLine,
            ch: Math.min(Math.max(cursor.ch, 0), finalLine.length),
          },
        )
      ) {
        throw new Error("Editor cannot replace note content");
      }
    } catch (error) {
      new Notice("Could not delete project scheduled");
      return null;
    }

    // §13.19 schedule_cascade: a delete runs the same subtree pass as
    // Depends on.
    let deletedScheduleSubtreeSuffix = "";
    if (plan.changed) {
      const deletedCascade = await this.applyScheduleSubtreePass(
        filePath,
        writeContext.content,
        String(cm.getValue ? cm.getValue() : finalContent) || finalContent,
        { today },
      );
      if (deletedCascade.subtree) {
        const suffix = subtreePassNoticeSuffix(deletedCascade.subtree);
        if (suffix) {
          deletedScheduleSubtreeSuffix = ` ${suffix}`;
        }
      }
    }

    new Notice(
      `scheduled ✗ removed${
        plan.removedScheduledTaskCount > 0
          ? `; removed propagated schedule from ${formatCountLabel(
              plan.removedScheduledTaskCount,
              "task",
            )}`
          : ""
      }${scheduledRecoveryNoticeSuffix({
        ready: plan.recoveredReadyTaskCount,
        next: plan.recoveredNextTaskCount,
        inProgress: plan.recoveredInProgressTaskCount,
        stillBlocked: plan.stillBlockedTaskCount,
        deferred: plan.deferredRecoveryTaskCount,
      })}${deletedScheduleSubtreeSuffix}`,
    );
    return { deleted: true, line: finalLine };
  }


  async setBulletPropertyValue(cm, cursor, name, value, options = {}) {
    const propertyName = normalizeBulletPropertyName(name);
    return await this.setInlineBulletPropertyValues(
      cm,
      cursor,
      [{ name, value }],
      propertyName === "scheduled" ? value : null,
      options,
    );
  }

  async setBulletPriorityValue(
    cm,
    cursor,
    filePath,
    lineText,
    property,
    level,
    context = {},
  ) {
    if (!property || property.values !== "priority" || !level) {
      new Notice("Could not update priority: invalid configured level");
      return false;
    }

    const baseDate =
      context.baseDate instanceof Date
        ? getLocalDateStart(context.baseDate)
        : getLocalDateStart(new Date());
    // A decay write reuses the previewed date (what you see is what you get)
    // instead of rolling a fresh one. The override holds an already-formatted
    // `date` plus its window `offset` for the reason text.
    const precomputedRoll =
      context.precomputedRoll && typeof context.precomputedRoll === "object"
        ? context.precomputedRoll
        : null;
    const precomputedMatch =
      precomputedRoll &&
      /^(\d{4})-(\d{2})-(\d{2})/.exec(
        normalizeBulletPropertyValue(precomputedRoll.date),
      );
    const roll =
      precomputedMatch &&
      Number.isInteger(Number(precomputedRoll.offset)) &&
      getPriorityRollBounds(level) !== null &&
      Number(precomputedRoll.offset) >= getPriorityRollBounds(level).minDays &&
      Number(precomputedRoll.offset) <= getPriorityRollBounds(level).maxDays
        ? Object.freeze({
            date: new Date(
              Number(precomputedMatch[1]),
              Number(precomputedMatch[2]) - 1,
              Number(precomputedMatch[3]),
            ),
            offset: Number(precomputedRoll.offset),
          })
        : rollPriorityScheduledDateWithOffset(
            level,
            baseDate,
            typeof context.random === "function" ? context.random : Math.random,
          );
    const rolledDate = roll.date;
    const rolledValue = formatBulletPropertyDate(rolledDate);
    const levelIndex = normalizePriorityLevelIndex(property, level);
    // Read the live line rather than the captured one so the transition is correct
    // even if `lineText` was not supplied; the writers' own expectedLine guard is
    // what aborts the whole write if the note moved underneath us.
    const currentLine = getEditorLine(cm, cursor.line) ?? lineText ?? "";
    const priorityField = findBulletPropertyField(currentLine, property.name);
    const fromLevelLabel = getPriorityRollFromLevelLabel(property, priorityField ? priorityField.value : "");
    const propertyContext =
      context.propertyContext ||
      getProjectNotePropertyContext(
        cm && typeof cm.getValue === "function" ? cm.getValue() : "",
        cursor.line,
      );
    const scheduledTarget = resolveBulletPropertyTarget(
      property.schedules,
      propertyContext,
    );
    const schedulingWorkLogForPriority =
      context.schedulingWorkLog || context.workLog || null;
    if (scheduledTarget.kind === "project-inline") {
      const expectedScheduledField = findBulletPropertyField(
        currentLine,
        property.schedules,
      );
      const expectedScheduledValue = expectedScheduledField
        ? expectedScheduledField.value
        : "";
      return await this.setProjectNoteScheduledValue(
        cm,
        cursor,
        filePath,
        lineText,
        expectedScheduledValue,
        rolledValue,
        {
          inlineEdits: [{ name: property.name, value: level.value }],
          today: baseDate,
          scheduleLog: context.scheduleReasonOverride
            ? buildPriorityDecayScheduleLogPayload(
                expectedScheduledValue,
                rolledValue,
                context.scheduleReasonOverride,
              )
            : buildPriorityRollScheduleLog({
                source: "priority",
                level,
                rolledDays: roll.offset,
                fromLevelLabel,
                from: expectedScheduledValue,
                to: rolledValue,
              }),
          schedulingWorkLog: schedulingWorkLogForPriority,
          buildNotice: (outcome) =>
            buildPriorityNoticeModel({
              property,
              level,
              levelIndex,
              baseDate,
              scheduledValues: [outcome.scheduled || rolledValue],
              taskCount: 1,
              scope: "project",
              roll: context.noticeRoll || null,
              outcome: {
                ...outcome,
                scheduleLoggedTaskCount:
                  outcome.scheduleLogOutcome === "added" ||
                  outcome.scheduleLogOutcome === "created"
                    ? 1
                    : 0,
              },
            }),
        },
      );
    }

    return await this.setInlineBulletPropertyValues(
      cm,
      cursor,
      [
        { name: property.name, value: level.value },
        { name: property.schedules, value: rolledValue },
      ],
      rolledValue,
      {
        filePath,
        expectedLine: lineText,
        today: baseDate,
        scheduleLog: context.scheduleReasonOverride
          ? buildPriorityDecayScheduleLogPayload(
              (findBulletPropertyField(currentLine, property.schedules) || {}).value || "",
              rolledValue,
              context.scheduleReasonOverride,
            )
          : buildPriorityRollScheduleLog({
              source: "priority",
              level,
              rolledDays: roll.offset,
              fromLevelLabel,
              from: (findBulletPropertyField(currentLine, property.schedules) || {}).value || "",
              to: rolledValue,
            }),
        schedulingWorkLog: schedulingWorkLogForPriority,
        buildNotice: (outcome) =>
          buildPriorityNoticeModel({
            property,
            level,
            levelIndex,
            baseDate,
            scheduledValues: [rolledValue],
            taskCount: 1,
            scope: "task",
            roll: context.noticeRoll || null,
            outcome: {
              blockedTaskCount: outcome.blocked ? 1 : 0,
              recoveryCounts: outcome.recoveryCounts,
              scheduleLoggedTaskCount:
                outcome.scheduleLogOutcome === "added" ||
                outcome.scheduleLogOutcome === "created"
                  ? 1
                  : 0,
              schedulingWorkLogWrittenCount:
                outcome.schedulingWorkLogWrittenCount || 0,
              removedPomodoroLinkCount: outcome.removedPomodoroLinkCount,
              pomodoroPruneFailed: outcome.pomodoroPruneFailed,
            },
          }),
        // Rebuild an existing schedules field after the priority, matching the
        // counted writer, so a level value outside Tasks' priority names can
        // never hide the rolled date from a right-to-left trailing-field parse.
        reorderPropertyNames: [property.schedules],
      },
    );
  }

  // Single-transaction Depends-On writer (`docs/task-dependencies.md` §6.6).
  // Plans with `planDependencyEdit`, prepares cross-note targets first (an
  // unused target id is acceptable, a link to an unprepared target is not),
  // then commits the dependent's note in one editor transaction: the line,
  // the field, same-note target ids, status effects, legacy folding, and
  // `[fresh:: today]`. `args.editor` + `args.filePath` select the live same-
  // note flow; `args.content` + `args.files` drive the pure/test flow.
  // `args.stamper` overrides the freshness stamper (tests inject one).
  async applyDependencyEdit(args = {}) {
    try {
      const editor =
        args.editor ||
        (args.cm !== undefined ? args.cm : null);
      const parentPath = normalizeVaultRelativePath(
        args.parentPath || args.filePath || "",
      );
      const parentLine = Math.floor(
        numericOrDefault(
          args.parentLine !== undefined ? args.parentLine : args.line,
          Number.NaN,
        ),
      );
      if (!parentPath || !Number.isFinite(parentLine)) {
        return Object.freeze({ ok: false, reason: "invalid-ref" });
      }
      const content =
        args.content !== undefined
          ? String(args.content)
          : editor && typeof editor.getValue === "function"
            ? String(editor.getValue() || "")
            : null;
      if (content === null) {
        return Object.freeze({ ok: false, reason: "no-content" });
      }
      const add = Array.isArray(args.add) ? args.add : [];
      const remove = Array.isArray(args.remove) ? args.remove : [];
      const blocksExisting = Array.isArray(args.blocksExisting) ? args.blocksExisting : null;
      const files = new Map();
      if (args.files instanceof Map) {
        for (const [filePath, fileContent] of args.files) {
          files.set(normalizeVaultRelativePath(filePath), String(fileContent || ""));
        }
      } else if (args.files && typeof args.files === "object") {
        for (const filePath of Object.keys(args.files)) {
          files.set(
            normalizeVaultRelativePath(filePath),
            String(args.files[filePath] || ""),
          );
        }
      }
      if (!files.has(parentPath)) {
        files.set(parentPath, content);
      }
      // Every note the edit touches is loaded: the add/remove targets plus
      // every note already linked on the line (open buffers first, else the
      // vault). A link whose note cannot be loaded stays verbatim in the
      // planner (or drops when removed), so one cross-note prerequisite
      // never blocks every other add or remove.
      const resolveLinkpath = this.dependencyLinkpathResolver();
      const wanted = new Set([parentPath]);
      for (const ref of [...add, ...remove, ...(blocksExisting || [])]) {
        const normalized = normalizeDependencyTargetRef(ref);
        if (normalized.path && normalized.blockId) {
          wanted.add(normalized.path);
        }
      }
      const existingLinks = collectDependencyNavigationBullets(content, parentLine);
      if (!existingLinks.reason) {
        for (const target of existingLinks.targets) {
          const targetPath = dependencyPathForLinkNote(
            target.note,
            parentPath,
            resolveLinkpath,
          );
          if (targetPath) {
            wanted.add(targetPath);
          }
        }
      }
      for (const filePath of wanted) {
        if (files.has(filePath)) {
          continue;
        }
        const loaded = await this.readDependencyNoteContent(
          filePath,
          editor,
          parentPath,
        );
        if (loaded === null) {
          if (filePath === parentPath) {
            return Object.freeze({ ok: false, reason: "target-not-found" });
          }
          continue;
        }
        files.set(filePath, loaded);
      }
      const mirrorTouch = args.mirrorTouch === true;
      const registry = args.registry || (await readTasksStatusRegistry(this.app));
      const vaultContents =
        args.vaultContents !== undefined
          ? args.vaultContents
          : needsDependencyRecoverySnapshot(content, parentLine, remove, mirrorTouch, add)
            ? await this.readDependencyRecoveryVaultContents(parentPath, content)
            : null;
      const scopeFlags = navNoteScopeFlags(parentPath);
      // §13.19: read the sub-project descendants before planning, so
      // commitment transfer sees the lanes the pass is about to block.
      const subtreePrep = await this.prepareSubtreeForDependencyPlan(
        parentPath,
        content,
        { files, add, remove, mirrorTouch, today: args.today || new Date() },
      );
      const plan = planDependencyEdit({
        content,
        parentLine,
        parentPath,
        add,
        remove,
        files,
        vaultFiles: this.readDependencyVaultFileList(),
        resolveLinkpath,
        blocksLinesEnabled: loadBlocksLinesEnabled(),
        ...(blocksExisting ? { blocksExisting } : {}),
        mirrorTouch,
        ...(subtreePrep && subtreePrep.lanes.length > 0
          ? { projectLaneStatuses: subtreePrep.lanes }
          : {}),
        recovery: {
          registry,
          today: args.today || new Date(),
          vaultContents,
          markUnblockedLine: navFreshnessMarkUnblockedLine(
            typeof this.getFreshnessApi === "function"
              ? this.getFreshnessApi()
              : null,
          ),
          ...scopeFlags,
        },
      });
      if (!plan.ok) {
        return Object.freeze({ ok: false, reason: plan.reason });
      }
      if (!plan.changed) {
        // The dependent's bytes can already match (a hand-typed canonical
        // line) while cross-note BLOCKS follow-ups still have work (BW10).
        if ((plan.blocksFollowUps || []).length > 0) {
          let blocks = Object.freeze({ ok: true, failed: Object.freeze([]) });
          try {
            blocks = await this.applyBlocksFollowUps(plan.blocksFollowUps);
          } catch (_error) {
            blocks = Object.freeze({
              ok: false,
              failed: Object.freeze((plan.blocksFollowUps || []).map((entry) => entry.path)),
            });
          }
          const failed = [
            ...(plan.blocksFailedPaths || []),
            ...((blocks && blocks.failed) || []),
          ];
          return Object.freeze({
            ok: true,
            reason: null,
            notice: withBlocksFollowUpNotice(plan.notice, failed),
            blocks,
          });
        }
        return Object.freeze({ ok: true, reason: "unchanged", notice: plan.notice });
      }
      // §13.19: plan the subtree pass before the commit, off the predicted
      // content, and fold its newly-Blocked targets into the deferred daily
      // cleanup below. Descendants are written after the commit through the
      // shared transaction; a stale one is skipped, never rolled back.
      const subtreePlanned = subtreePrep
        ? await this.planSubtreePassForPrjEdit(
            parentPath,
            content,
            plan.nextContent,
            {
              files,
              descendantTexts: subtreePrep.texts,
              childrenMap: subtreePrep.childrenMap,
              notePaths: subtreePrep.notePaths,
              today: args.today || new Date(),
              registry,
              mirrorTouch,
              markUnblockedLine: navFreshnessMarkUnblockedLine(
                typeof this.getFreshnessApi === "function"
                  ? this.getFreshnessApi()
                  : null,
              ),
            },
          )
        : null;
      const subtreePomodoroTargets = subtreePlanned
        ? subtreePlanned.pass.pomodoroTargets || []
        : [];
      // §13.10: consume the live Pomodoro links of `^prj` and its newly
      // Blocked residents. A cleanup failure is reported, never rolled
      // back; reconcile repairs it within one interval.
      let commitPlan = plan;
      if (subtreePomodoroTargets.length > 0 && plan.summary && plan.summary.project) {
        commitPlan = {
          ...plan,
          summary: {
            ...plan.summary,
            project: {
              ...plan.summary.project,
              pomodoroTargets: Object.freeze([
                ...(plan.summary.project.pomodoroTargets || []),
                ...subtreePomodoroTargets,
              ]),
            },
          },
        };
      }
      let pomodoroPrep = null;
      if (!mirrorTouch) {
        pomodoroPrep = await prepareProjectPomodoroCleanup(
          (snapshotOptions) =>
            this.readDeferredPomodoroSnapshot(this.app, snapshotOptions),
          commitPlan,
          parentPath,
          content,
          args.today || new Date(),
        );
        if (pomodoroPrep.commitContent !== commitPlan.nextContent) {
          commitPlan = { ...commitPlan, nextContent: pomodoroPrep.commitContent };
        }
      }
      const outcome = await applyDependencyEditTransaction(commitPlan, {
        // The hand-edit mirror never writes cross-note targets' `[id::]`;
        // the hooks reconcile them (contract §4).
        prepareTargetFile: mirrorTouch
          ? async () => ({ ok: true })
          : (filePath, preparation) =>
              this.prepareDependencyTargetNote(filePath, preparation),
        applyBlocksFollowUps: (followUps) => this.applyBlocksFollowUps(followUps),
        planSubtreePass: subtreePlanned ? async () => subtreePlanned : null,
        writeSubtreePass: async (planned) => {
          const wrote = await this.writeSubtreePass(planned.pass);
          return Object.freeze({
            blocked: planned.pass.blocked,
            recovered: planned.pass.recovered,
            written: wrote.written,
            skipped: wrote.skipped,
          });
        },
        commitDependentContent: (nextContent) => {
          if (!editor) {
            return { ok: false, reason: "no-editor" };
          }
          if (typeof editor.getValue === "function") {
            const live = String(editor.getValue() || "");
            if (live !== content) {
              return { ok: false, reason: "stale-editor" };
            }
          }
          // The hand-edit mirror never stamps freshness.
          const finalContent = mirrorTouch
            ? nextContent
            : this.stampDependencyParentLine(
                nextContent,
                parentLine,
                args.stamper,
                args.dateText,
              );
          const committed = applyEditorContentTransaction(
            editor,
            content,
            finalContent,
            null,
            BLOCKS_MACHINE_WRITE_ANNOTATION,
          );
          return committed
            ? { ok: true }
            : { ok: false, reason: "commit-failed" };
        },
      });
      if (!outcome.ok && outcome.reason === "stale-editor") {
        new Notice("changed — reopen");
      }
      if (!outcome.ok) {
        return outcome;
      }
      const blocksFailedPaths = [
        ...(plan.blocksFailedPaths || []),
        ...((outcome.blocks && outcome.blocks.failed) || []),
      ];
      // Cross-note daily cleanup lands after the dependent's own write and
      // is never rolled back (§13.10).
      const pomodoroDone = pomodoroPrep
        ? await finishProjectPomodoroCleanup(
            (snapshot, cleanup) =>
              this.writeDeferredPomodoroCleanup(snapshot, cleanup),
            pomodoroPrep.snapshot,
            pomodoroPrep.cleanup,
          )
        : { removed: 0, failed: false };
      const projectNotice = projectPomodoroNotice(
        plan,
        pomodoroDone.removed,
        pomodoroDone.failed,
      );
      if (projectNotice) {
        return Object.freeze({
          ok: true,
          reason: null,
          notice: withBlocksFollowUpNotice(
            withSubtreePassNotice(projectNotice, outcome.subtree),
            blocksFailedPaths,
          ),
          subtree: outcome.subtree || null,
        });
      }
      if (outcome.subtree && subtreePassNoticeSuffix(outcome.subtree)) {
        return Object.freeze({
          ok: true,
          reason: null,
          notice: withBlocksFollowUpNotice(
            withSubtreePassNotice(
              outcome.notice || "⛓ Dependencies updated",
              outcome.subtree,
            ),
            blocksFailedPaths,
          ),
          subtree: outcome.subtree,
        });
      }
      return Object.freeze({
        ...outcome,
        notice: withBlocksFollowUpNotice(outcome.notice, blocksFailedPaths),
      });
    } catch (_error) {
      return Object.freeze({ ok: false, reason: "apply-failed" });
    }
  }

}
