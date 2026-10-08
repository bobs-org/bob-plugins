class BobNavigationHotkeysLaneReviewMixin {

  async toggleTaskLaneOnLinks(cm, cursor, content, options = {}) {
    const discovery =
      options.linkDiscovery ||
      discoverLinkPickerTargets(
        content,
        cursor.line,
        options.countExplicit ? options.additionalTaskCount : 0,
      );
    if (!discovery.valid) {
      new Notice(
        discovery.notLink
          ? "Cursor is not on a task or Task Link"
          : discovery.error,
      );
      return false;
    }
    const activeView = this.getActiveMarkdownView();
    if (!activeView || activeView.editor !== cm || !activeView.file) {
      new Notice("No active markdown note");
      return false;
    }
    const resolution = await this.resolveLinkPickerTargets(
      activeView.file.path,
      discovery,
    );
    if (resolution.error) {
      new Notice(resolution.error);
      return false;
    }
    if (
      cm &&
      typeof cm.getValue === "function" &&
      String(cm.getValue() || "") !== content
    ) {
      new Notice("Current note changed; no tasks were updated");
      return false;
    }
    const laneBudgets = readLaneBudgets(this.app);
    const groups = groupLinkPickerTargetsByNote(resolution.targets);
    if (groups.length === 0) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
    // Probe the mode across all groups: commit when any target is Ready.
    let probeMode = "release";
    for (const group of groups) {
      const probe = planTaskLaneBatch(group.content, group.session, {});
      if (!probe.valid) {
        new Notice("A linked note changed; no tasks were updated");
        return false;
      }
      if (probe.mode === "commit") {
        probeMode = "commit";
      }
    }
    void probeMode;
    let summary = "";
    const dateText = this.laneReleaseDateText(options);
    // A release with an In Progress target asks once for an optional summary.
    let needsReason = false;
    for (const group of groups) {
      const probe = planTaskLaneBatch(group.content, group.session, {});
      if (
        probe.valid &&
        probe.mode === "release" &&
        probe.released.some((entry) => entry.fromStatus === "/")
      ) {
        needsReason = true;
      }
    }
    if (needsReason) {
      const answer = await this.requestLaneReleaseSummary(options);
      if (answer.cancelled) {
        return false;
      }
      summary = answer.summary;
    }
    const planned = [];
    for (const group of groups) {
      const plan = planTaskLaneBatch(group.content, group.session, {
        summary,
        dateText,
        stampLine: this.getFreshnessStampLine(),
        freshDateText: this.getFreshnessDateText(),
      });
      if (!plan.valid) {
        new Notice(
          plan.stale
            ? "A linked note changed; no tasks were updated"
            : plan.error,
        );
        return false;
      }
      planned.push({ group, plan });
    }
    // Collect prune targets for releases.
    const pruneTargets = [];
    for (const { group, plan } of planned) {
      if (plan.mode !== "release") {
        continue;
      }
      for (const entry of plan.released) {
        if (entry.blockId) {
          pruneTargets.push(
            Object.freeze({ path: group.path, blockId: entry.blockId }),
          );
        }
      }
    }
    let pomodoroSnapshot = null;
    let dailyCleanupPlan = null;
    let foldedDailyPath = null;
    if (pruneTargets.length > 0) {
      const sourcePaths = planned.map(({ group }) => group.path);
      pomodoroSnapshot = await this.readDeferredPomodoroSnapshot(this.app, {
        sourcePath: sourcePaths.length === 1 ? sourcePaths[0] : "",
        sourceContent: planned.length === 1 ? planned[0].plan.content : "",
        today: new Date(),
      });
      if (pomodoroSnapshot) {
        const folded = planned.find(
          ({ group }) => group.path === pomodoroSnapshot.dailyPath,
        );
        const dailyBase = folded
          ? folded.plan.content
          : pomodoroSnapshot.content;
        if (dailyBase !== null) {
          dailyCleanupPlan = planDeferredPomodoroLinkCleanup(
            dailyBase,
            pruneTargets,
            {
              dailyPath: pomodoroSnapshot.dailyPath,
              noteIndex: pomodoroSnapshot.noteIndex,
            },
          );
          if (folded && dailyCleanupPlan.changed) {
            foldedDailyPath = folded.group.path;
          }
        }
      }
    }
    const commit = await this.commitLinkPickerNoteWrites(planned, {
      pomodoroSnapshot,
      dailyCleanupPlan,
      foldedDailyPath,
    });
    if (!commit.ok) {
      new Notice("A linked note changed; no tasks were updated");
      return false;
    }
    let changedTaskCount = 0;
    let blockedSkipped = 0;
    let releasedNextCount = 0;
    let releasedPendingCount = 0;
    let mode = "commit";
    for (const { plan } of planned) {
      changedTaskCount += plan.changedTaskCount;
      blockedSkipped += plan.blockedSkipped;
      if (plan.mode === "release") {
        mode = "release";
      }
      for (const entry of plan.released || []) {
        if (entry.fromStatus === "*") {
          releasedNextCount += 1;
        } else if (entry.fromStatus === "/") {
          releasedPendingCount += 1;
        }
      }
    }
    const removedPomodoroLinkCount =
      dailyCleanupPlan && dailyCleanupPlan.changed && !commit.pomodoroPruneFailed
        ? dailyCleanupPlan.removedLinkCount
        : 0;
    if (commit.pomodoroPruneFailed) {
      new Notice("Lane updated; Pomodoro links not removed");
    }
    new Notice(
      buildLaneToggleNotice({
        mode,
        changedTaskCount,
        blockedSkipped,
        unlinkedFromToday: removedPomodoroLinkCount,
        releasedNextCount,
        releasedPendingCount,
        laneBudgets,
      }),
    );
    return true;
  }

  // Apply the picker's pinned lane row. Task sessions (single and counted)
  // write through the open editor; link sessions write through the
  // cross-note path with the same preimage guards as the Alt+N command.
  // `options.summary`/`options.dateText` carry the reason-stage input; when
  // a release needs a reason and no summary was supplied, the caller routes
  // through the reason stage instead of calling this directly.
  // Ledger-tools freshness namespace, or a "Bob Ledger Tools api v3
  // required" Notice and null. Placement lives in ledger-tools (see the
  // freshness-review section above `openMarkdownFileWithLeafReuse`): a
  // missing api only skips the stamp, it never misplaces one.
  requireFreshnessApi() {
    const api = getReviewFreshnessApi(this.app);
    if (!api) {
      new Notice(REVIEW_FRESHNESS_API_REQUIRED_NOTICE);
    }
    return api;
  }

  readFreshnessQueue(api) {
    try {
      const queue =
        api && typeof api.queue === "function" ? api.queue() : [];
      return Array.isArray(queue) ? queue : [];
    } catch (error) {
      return [];
    }
  }

  readFreshnessCounts(api) {
    try {
      if (api && typeof api.counts === "function") {
        const counts = api.counts();
        if (counts && typeof counts === "object") {
          return counts;
        }
      }
    } catch (error) {
      // Fall through to the zero counts below.
    }
    return {
      due: 0,
      new: 0,
      resurfaced: 0,
      stale: 0,
      fresh: 0,
      refreshedToday: 0,
      budget: null,
      budgetMet: false,
    };
  }

  // Cursor context for jump positioning: the active note path, the 1-based
  // line, and the line text. Null when there is no active editor.
  getReviewJumpCursor() {
    try {
      const activeView = this.getActiveMarkdownView();
      const editor = activeView && activeView.editor;
      if (
        !editor ||
        typeof editor.getValue !== "function" ||
        typeof editor.getCursor !== "function" ||
        !activeView.file
      ) {
        return null;
      }
      const cursor = getEditorCursor(editor);
      const lineText = cursor ? getEditorLine(editor, cursor.line) : null;
      if (!cursor || lineText === null) {
        return null;
      }
      return {
        path: activeView.file.path,
        line: cursor.line + 1,
        text: String(lineText),
      };
    } catch (error) {
      return null;
    }
  }

  // Alt+F (advance false) / Ctrl+Alt+F (advance true): stamp the cursor
  // task, or a dedicated Task Link's target, plus the next N tasks when
  // counted, and change nothing else. Targets are discovered like Alt+N's;
  // the write goes through `api.freshness.stampLine` only (see the
  // freshness-review section above `openMarkdownFileWithLeafReuse`).
  // Single-note targets write through the editor transaction; cross-note
  // targets write through the Alt+N plan with the preimage check and
  // rollback. With `advance`, jump to the next due task afterwards,
  // skipping every key just stamped.
  async refreshTaskFreshness(cm, options = {}) {
    // While an answer is in flight or settling, Alt+F / Ctrl+Alt+F are
    // swallowed silently with no write.
    if (this.reviewWalkBusy()) {
      return false;
    }
    const advance = options.advance === true;
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
    let countExplicit = options.countExplicit === true;
    let additionalTaskCount = Math.max(
      0,
      Math.floor(numericOrDefault(options.additionalTaskCount, 0)),
    );
    if (!countExplicit) {
      const view = this.getActiveMarkdownView();
      const editorForVim = view && view.editor === cm ? view.editor : cm;
      if (this.isVimNormalModeEditor(editorForVim, view)) {
        const vimCm = this.resolveVimCodeMirror(editorForVim, view);
        const pending = getPendingVimRepeat(vimCm);
        if (pending.explicit) {
          countExplicit = true;
          additionalTaskCount = Math.max(
            0,
            Math.floor(numericOrDefault(pending.repeat, 0)),
          );
          resetPendingVimInputState(vimCm, "review-freshness-refresh");
        }
      }
    }
    const api = this.requireFreshnessApi();
    if (!api) {
      return false;
    }
    // Explicit keeps always go through `keepLine` when the namespace can
    // count (`docs/freshness.md` §2a) — including uncounted ones, so the
    // streak is preserved rather than reset. A v5 namespace missing
    // `keepLine` fails without writing; only pre-v5 namespaces fall back
    // to the old uncounted stamper. A single exact, due, at-limit target
    // opens the decision card instead of stamping; counted and Task Link
    // sessions skip those targets (see `refreshTaskFreshnessOnTasks`).
    if (!freshnessSupportsKeeps(api) && Number(api.version) >= 5) {
      new Notice(REVIEW_FRESHNESS_KEEP_REQUIRED_NOTICE);
      return false;
    }
    const dateText = this.laneReleaseDateText(options);
    const keepSupported = freshnessSupportsKeeps(api);
    const stamper = keepSupported
      ? (line, date, decision) =>
          String(
            api.keepLine(line, date, {
              counted: Boolean(decision && decision.counted),
            }) ?? line,
          )
      : (line) => {
          try {
            if (api && typeof api.stampLine === "function") {
              return String(api.stampLine(line, dateText) ?? line);
            }
          } catch (error) {
            // A failed stamp leaves the line unchanged below.
          }
          return String(line);
        };
    if (isObsidianTaskAtLine(content, cursor.line)) {
      return await this.refreshTaskFreshnessOnTasks(cm, cursor, content, {
        countExplicit,
        additionalTaskCount,
        stamper,
        dateText,
        advance,
        summary: options.summary,
      });
    }
    if (parseLinkPickerTaskLink(lineText)) {
      return await this.refreshTaskFreshnessOnLinks(cm, cursor, content, {
        countExplicit,
        additionalTaskCount,
        stamper,
        dateText,
        advance,
        summary: options.summary,
        linkDiscovery: options.linkDiscovery || null,
      });
    }
    new Notice("Cursor is not on a task or Task Link");
    return false;
  }

  async requestFreshnessRefreshSummary(options = {}) {
    if (typeof options.summary === "string") {
      return { cancelled: false, summary: options.summary };
    }
    if (typeof FreshnessRefreshSummaryModal !== "function") {
      return { cancelled: false, failed: true, summary: "" };
    }
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(result);
      };
      let modal;
      try {
        modal = new FreshnessRefreshSummaryModal(this.app, {
          dateText: options.dateText,
          totalCount: options.totalCount,
          eligibleCount: options.eligibleCount,
          onDone: (result) => {
            if (result === null) {
              finish({ cancelled: true, summary: "" });
            } else {
              finish({ cancelled: false, summary: String(result || "") });
            }
          },
        });
        if (!modal || typeof modal.open !== "function") {
          finish({ cancelled: false, failed: true, summary: "" });
          return;
        }
        modal.open();
      } catch (error) {
        if (modal) {
          modal.onDone = null;
          try {
            if (typeof modal.close === "function") {
              modal.close();
            }
          } catch (closeError) {
            // The prompt failure still refuses the refresh below.
          }
        }
        finish({ cancelled: false, failed: true, summary: "" });
      }
    });
  }

  async refreshTaskFreshnessOnTasks(cm, cursor, content, options = {}) {
    const session = discoverCountedObsidianTaskTargets(
      content,
      cursor.line,
      options.countExplicit ? options.additionalTaskCount : 0,
    );
    if (!session.valid) {
      new Notice(session.error);
      return false;
    }
    const api = getReviewFreshnessApi(this.app);
    if (!api) {
      new Notice(REVIEW_FRESHNESS_API_REQUIRED_NOTICE);
      return false;
    }
    const activeView = this.getActiveMarkdownView();
    const filePath =
      activeView && activeView.file ? activeView.file.path : null;
    const queueBefore = this.readFreshnessQueue(api);
    const countsBefore = this.readFreshnessCounts(api);
    // Resolve every target exactly against the pre-write queue: only an
    // exact due-Ready ROTTEN/TICKLER row counts (`docs/freshness.md` §2a).
    // Every other explicit keep still goes through `keepLine` uncounted so
    // the streak is preserved, never reset.
    const contentLines = splitMarkdownContent(content).lines;
    const resolved = deduplicateFreshStampTargets(
      session.targets.map((target) => ({
        path: filePath,
        line: target.line,
        rawLine: target.rawLine,
      })),
    ).map((target) => {
      const raw = String(contentLines[target.line] || "");
      const match = matchFreshStampExactEntry(queueBefore, {
        path: target.path,
        line: target.line,
        raw,
      });
      return Object.freeze({
        target: Object.freeze({
          line: target.line,
          path: target.path,
          raw,
          counted: match.ok,
        }),
        match,
      });
    });
    if (options.countExplicit !== true && resolved.length === 1) {
      const cursorRef = {
        path: filePath,
        line: cursor.line + 1,
        text: String(contentLines[cursor.line] || ""),
      };
      const checklist = matchReviewChecklistCursor(queueBefore, cursorRef);
      if (checklist) {
        // The checklist completion holds the gesture lock, like the claim.
        this.takeReviewWalkLock(REVIEW_GESTURE_LOCK_MS);
        let completed = false;
        try {
          completed = await this.completeReviewChecklistRow(cm, {
            api,
            queueBefore,
            entry: checklist,
            filePath,
            dateText: options.dateText,
            advance: options.advance === true,
          });
          return completed;
        } finally {
          this.settleReviewWalkLock(completed === true);
        }
      }
      if (
        reviewLineChecklistKind(contentLines[cursor.line]) &&
        !reviewFreshnessSupportsChecklistTiers(api)
      ) {
        new Notice(REVIEW_CHECKLIST_UPDATE_LEDGER_NOTICE);
        return false;
      }
      // RECURRING landing (ctrl_alt_f=refuse): a single uncounted target
      // matching a live recurring queue row writes nothing, shows the
      // recurring-tier notice, and stays. Counted/Task Link batches,
      // non-landing recurring rows, and pre-v9 namespaces keep the
      // existing refusal path below.
      const recurring = matchReviewRecurringCursor(queueBefore, cursorRef);
      if (recurring && reviewFreshnessSupportsRecurringTier(api)) {
        new Notice(REVIEW_RECURRING_TIER_NOTICE);
        return false;
      }
    }
    // Single source-task trigger: one requested target outside a counted
    // session, exact eligible with a due choice, opens the card and writes
    // nothing. A press moving below-limit to limit simply stamps; the next
    // due press asks.
    if (
      freshnessSupportsDecayDecisions(api) &&
      options.countExplicit !== true &&
      resolved.length === 1 &&
      resolved[0].match.ok === true &&
      isFreshnessDecayDecisionEntry(resolved[0].match.entry)
    ) {
      const opened = await this.maybeOpenFreshnessDecayCard(
        cm,
        cursor,
        content,
        filePath,
        resolved[0],
        queueBefore,
        {
          dateText: options.dateText,
          advance: options.advance === true,
        },
      );
      if (opened) {
        return true;
      }
      // The card cannot render (mixed versions, unusable plan): fall
      // through to counting so the streak still counts.
      const fallback = resolved.map((item) => item.target);
      const fallbackPlan = planFreshStampBatch(
        content,
        fallback,
        options.stamper,
        options.dateText,
      );
      if (!fallbackPlan.ok) {
        new Notice(freshStampRefusalNotice(fallbackPlan.refusal));
        return false;
      }
      if (
        cm &&
        typeof cm.getValue === "function" &&
        String(cm.getValue() || "") !== content
      ) {
        new Notice("Current note changed; no tasks were updated");
        return false;
      }
      const fallbackGuarded = this.getCountedTaskWriteContext(cm, filePath, session);
      if (!fallbackGuarded.valid || fallbackGuarded.content !== content) {
        new Notice(
          fallbackGuarded.valid
            ? "Active note changed; no tasks were updated"
            : fallbackGuarded.error,
        );
        return false;
      }
      if (fallbackPlan.content !== content) {
        const nextLines = fallbackPlan.content.split(/\r?\n/);
        const applied = applyEditorContentTransaction(cm, content, fallbackPlan.content, {
          line: cursor.line,
          ch: Math.min(
            Math.max(cursor.ch, 0),
            String(nextLines[cursor.line] || "").length,
          ),
        });
        if (!applied) {
          new Notice("Could not update task; no tasks were updated");
          return false;
        }
      }
      // Ctrl+Alt+F advances through the shared tail with the stamp text
      // as its preamble, giving one composed toast.
      const fallbackPreamble = this.finishFreshStamp(
        queueBefore,
        countsBefore,
        fallbackPlan.stamped.map((entry) => ({
          path: filePath,
          line: entry.line,
          raw: entry.before,
        })),
        fallbackPlan.stamped,
        options.dateText,
        { deferNotice: options.advance === true },
      );
      if (options.advance === true) {
        return await this.jumpToDueTask(1, {
          fromStamp: this.reviewAnchor,
          fromAdvance: true,
          preamble: fallbackPreamble,
        });
      }
      return true;
    }
    // Batch path: counted sessions skip exact at-limit targets without
    // changing fresh/count; skipped tasks stay due for the walk later.
    // Older freshness namespaces fall back to counting every target.
    // PRE/POST checklist rows skip too — they close by completion, never
    // by a stamp.
    const checklistPart = partitionFreshStampChecklistSkips(
      resolved,
      queueBefore,
    );
    const partition = partitionFreshStampDecisionSkips(checklistPart.stamp, {
      enabled: freshnessSupportsDecayDecisions(api),
    });
    const keepTargets = partition.stamp;
    const skipTail =
      formatFreshStampSkipTail(partition.skipped.length) +
      formatFreshStampChecklistSkipTail(checklistPart.skipped.length);
    if (
      keepTargets.length === 0 &&
      (partition.skipped.length > 0 || checklistPart.skipped.length > 0)
    ) {
      if (partition.skipped.length > 0) {
        new Notice(
          formatFreshStampSkippedNotice(partition.skipped.length) +
            formatFreshStampChecklistSkipTail(checklistPart.skipped.length),
        );
      } else {
        new Notice(
          formatFreshStampChecklistSkippedNotice(checklistPart.skipped.length),
        );
      }
      return true;
    }
    for (const target of keepTargets) {
      const check = classifyFreshStampTarget(target.raw);
      if (!check.ok) {
        new Notice(freshStampRefusalNotice(check.refusal));
        return false;
      }
    }
    const eligibleTargets = keepTargets.filter((target) =>
      isPendingWorkLogTargetRawLine(target.raw),
    );
    let summary = "";
    if (eligibleTargets.length > 0) {
      const result = await this.requestFreshnessRefreshSummary({
        summary: options.summary,
        dateText: options.dateText,
        totalCount: keepTargets.length,
        eligibleCount: eligibleTargets.length,
      });
      if (result.failed) {
        new Notice("Could not open Work Log prompt; no tasks were updated");
        return false;
      }
      if (result.cancelled) {
        return false;
      }
      summary = result.summary;
    }
    if (
      cm &&
      typeof cm.getValue === "function" &&
      String(cm.getValue() || "") !== content
    ) {
      new Notice("Current note changed; no tasks were updated");
      return false;
    }
    const guarded = this.getCountedTaskWriteContext(cm, filePath, session);
    if (!guarded.valid || guarded.content !== content) {
      new Notice(
        guarded.valid
          ? "Active note changed; no tasks were updated"
          : guarded.error,
      );
      return false;
    }
    const plan = planFreshStampBatchWithWorkLogs(
      content,
      keepTargets,
      options.stamper,
      options.dateText,
      summary,
    );
    if (!plan.ok) {
      new Notice(freshStampRefusalNotice(plan.refusal));
      return false;
    }
    if (plan.content !== content) {
      const nextLines = plan.content.split(/\r?\n/);
      const applied = applyEditorContentTransaction(cm, content, plan.content, {
        line: cursor.line,
        ch: Math.min(
          Math.max(cursor.ch, 0),
          String(nextLines[cursor.line] || "").length,
        ),
      });
      if (!applied) {
        new Notice("Could not update task; no tasks were updated");
        return false;
      }
    }
    // Ctrl+Alt+F advances through the shared tail with the stamp text
    // as its preamble, giving one composed toast.
    const stampPreamble = this.finishFreshStamp(
      queueBefore,
      countsBefore,
      plan.stamped.map((entry) => ({
        path: filePath,
        line: entry.line,
        raw: entry.before,
      })),
      plan.stamped,
      options.dateText,
      {
        skipTail,
        workLogWrittenCount: plan.workLogWrittenCount,
        deferNotice: options.advance === true,
      },
    );
    if (options.advance === true) {
      return await this.jumpToDueTask(1, {
        fromStamp: this.reviewAnchor,
        fromAdvance: true,
        preamble: stampPreamble,
      });
    }
    return true;
  }
}
