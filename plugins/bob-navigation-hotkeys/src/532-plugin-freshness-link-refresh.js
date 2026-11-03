async function refreshTaskFreshnessOnLinks(cm, cursor, content, options = {}) {
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
    const api = getReviewFreshnessApi(this.app);
    if (!api) {
      new Notice(REVIEW_FRESHNESS_API_REQUIRED_NOTICE);
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
    const queueBefore = this.readFreshnessQueue(api);
    const countsBefore = this.readFreshnessCounts(api);
    // Duplicate references to the same source target stamp and count once:
    // dedupe before planning so a repeated Task Link cannot inflate keeps.
    const deduped = deduplicateFreshStampTargets(resolution.targets);
    const groups = groupLinkPickerTargetsByNote(deduped);
    if (groups.length === 0) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
    const localDayBefore = this.laneReleaseDateText();
    const canCountKeeps = freshnessSupportsKeeps(api);
    // Task Link sessions never open cards — even a single link. Exact
    // at-limit Ready targets skip without changing fresh/count; below
    // threshold they count normally. Lane rows count and log until the
    // rung-aware card ships (no batch skip for them). Skipped targets
    // stay due for the walk and never enter anchor exclusions. Early
    // lane rows stamp quietly with no prompt and no entry.
    const linkResolved = groups.map((group) => {
      const groupLines = splitMarkdownContent(group.content).lines;
      return {
        group,
        resolved: group.session.targets
          .filter(
            (target) =>
              !isPomodoroFreshnessLedgerEntry(group.content, target.line),
          )
          .map((target) => {
            const raw = String(groupLines[target.line] || "");
            const match = matchFreshStampExactEntry(queueBefore, {
              path: group.path,
              line: target.line,
              raw,
            });
            const isToday = match.ok === true ? freshnessTargetIsToday(api, match.entry) : false;
            const keep = canCountKeeps
              ? classifyRottenKeepTarget({
                  match,
                  raw,
                  stamper: options.stamper,
                  dateText: options.dateText,
                  isToday,
                })
              : { counted: false, keepsBefore: parseKeepsCount(raw), keepsAfter: parseKeepsCount(raw), rung: null };
            const status = getObsidianTaskCheckboxStatus(raw);
            return Object.freeze({
              target: Object.freeze({
                line: target.line,
                path: group.path,
                raw,
                counted: canCountKeeps ? keep.counted === true : match.ok,
              }),
              keep,
              isToday,
              laneRow: status === "/" || status === "*",
              rung: keep.counted === true ? keep.rung : null,
              match,
            });
          }),
      };
    });
    if (linkResolved.every(({ resolved }) => resolved.length === 0)) {
      new Notice("Pomodoro ledger rows are not freshness targets");
      return false;
    }
    const skipDecisions = freshnessSupportsDecayDecisions(api);
    let linkDecisionSkipped = 0;
    let linkChecklistSkipped = 0;
    const stampTargetsByGroup = [];
    for (const { group, resolved } of linkResolved) {
      const checklistPart = partitionFreshStampChecklistSkips(
        resolved,
        queueBefore,
      );
      linkChecklistSkipped += checklistPart.skipped.length;
      const partition = partitionFreshStampDecisionSkips(checklistPart.stamp, {
        enabled: skipDecisions,
      });
      linkDecisionSkipped += partition.skipped.length;
      stampTargetsByGroup.push({ group, targets: partition.stamp });
    }
    const linkStamped = stampTargetsByGroup.reduce(
      (count, item) => count + item.targets.length,
      0,
    );
    const linkSkipTail =
      formatFreshStampSkipTail(linkDecisionSkipped) +
      formatFreshStampChecklistSkipTail(linkChecklistSkipped);
    if (
      linkStamped === 0 &&
      (linkDecisionSkipped > 0 || linkChecklistSkipped > 0)
    ) {
      if (linkDecisionSkipped > 0) {
        new Notice(
          formatFreshStampSkippedNotice(linkDecisionSkipped) +
            formatFreshStampChecklistSkipTail(linkChecklistSkipped),
        );
      } else {
        new Notice(formatFreshStampChecklistSkippedNotice(linkChecklistSkipped));
      }
      return true;
    }
    for (const { targets } of stampTargetsByGroup) {
      for (const target of targets) {
        const check = classifyFreshStampTarget(target.raw);
        if (!check.ok) {
          new Notice(freshStampRefusalNotice(check.refusal));
          return false;
        }
      }
    }
    const rottenTargets = linkResolved.flatMap(({ group, resolved }) => {
      const stampGroup = stampTargetsByGroup.find((item) => item.group === group);
      const stampLines = new Set((stampGroup && stampGroup.targets || []).map((target) => target.line));
      return resolved
        .filter((item) => item.keep.counted === true && !item.laneRow && stampLines.has(item.target.line))
        .map((item) => ({
          ...item,
          group,
          history: readRottenLog(group.content, item.target.line),
        }));
    });
    const laneTargets = linkResolved.flatMap(({ group, resolved }) => {
      const stampGroup = stampTargetsByGroup.find((item) => item.group === group);
      const stampLines = new Set((stampGroup && stampGroup.targets || []).map((target) => target.line));
      return resolved
        .filter((item) => item.keep.counted === true && item.laneRow && stampLines.has(item.target.line))
        .map((item) => ({
          raw: item.target.raw,
          entry: item.match.entry,
          keep: item.keep,
          rung: item.keep.rung,
          history: readRottenLog(group.content, item.target.line),
          target: item.target,
          group,
        }));
    });
    const promptPlan = planFreshnessRefreshPrompt({
      singleKeep: false,
      rottenTargets: rottenTargets.map((item) => ({
        raw: item.target.raw,
        entry: item.match.entry,
        keep: item.keep,
        rung: item.keep.rung,
        history: item.history,
      })),
      laneTargets,
    });
    let keepReason = "";
    if (promptPlan.kind === "batch") {
      const result = await this.requestFreshnessRefreshAnswers({
        keepTargets: promptPlan.keepTargets,
        showWorkField: false,
        keepReason: options.keepReason,
        dateText: options.dateText,
        totalCount: linkStamped,
      });
      if (result.failed) {
        new Notice("Could not open Keep reason prompt; no tasks were updated");
        return false;
      }
      if (result.cancelled) return false;
      keepReason = result.keepReason;
    }
    const promptShown = promptPlan.kind !== "none";
    if (promptShown) {
      if (this.laneReleaseDateText() !== localDayBefore) {
        new Notice("Day changed while the prompt was open; nothing was written");
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
      for (const { group } of linkResolved) {
        const live = await this.readLinkPickerNoteContent(
          group.path,
          group.file,
        );
        if (live !== group.content) {
          new Notice("A linked note changed; no tasks were updated");
          return false;
        }
      }
    }
    const planned = [];
    const refs = [];
    const stampedAll = [];
    let workLogWrittenCount = 0;
    let rottenLogWrittenCount = 0;
    for (const { group, targets } of stampTargetsByGroup) {
      const groupRottenTargets = rottenTargets
        .filter((item) => item.group === group)
        .map((item) => ({ line: item.target.line, rung: item.keep.rung }));
      const groupLaneTargets = laneTargets
        .filter((item) => item.group === group)
        .map((item) => ({ line: item.target.line, rung: item.keep.rung }));
      const plan = planFreshStampBatchWithLogs(
        group.content,
        targets,
        options.stamper,
        options.dateText,
        {
          keepReason,
          rottenTargets: groupRottenTargets,
          laneTargets: groupLaneTargets,
        },
      );
      if (!plan.ok) {
        new Notice(freshStampRefusalNotice(plan.refusal));
        return false;
      }
      workLogWrittenCount += plan.workLogWrittenCount;
      rottenLogWrittenCount += plan.rottenLogWrittenCount;
      for (const entry of plan.stamped) {
        refs.push({ path: group.path, line: entry.line, raw: entry.before });
        stampedAll.push(entry);
      }
      if (plan.content !== group.content) {
        planned.push({ group, plan });
      }
    }
    if (planned.length > 0) {
      const commit = await this.commitLinkPickerNoteWrites(planned, {});
      if (!commit.ok) {
        new Notice(
          commit.partial
            ? "Some linked notes may have changed; review them before retrying"
            : "A linked note changed; no tasks were updated",
        );
        return false;
      }
    }
    // Uncounted lane rows with a prior-day stamp kept quietly: one
    // shared "early · not counted" tail on the stamp notice.
    let quietTail = "";
    for (const entry of stampedAll) {
      if (entry.counted !== false) continue;
      const status = getObsidianTaskCheckboxStatus(entry.before);
      if (status !== "/" && status !== "*") continue;
      if (freshnessQuietNotCountedNotice(entry.before, options.dateText)) {
        quietTail = freshnessQuietNotCountedNotice(entry.before, options.dateText);
        break;
      }
    }
    // Ctrl+Alt+F advances through the shared tail with the stamp text
    // as its preamble, giving one composed toast.
    const linkPreamble = this.finishFreshStamp(
      queueBefore,
      countsBefore,
      refs,
      stampedAll,
      options.dateText,
      {
        skipTail: linkSkipTail + quietTail,
        workLogWrittenCount,
        rottenLogWrittenCount,
        deferNotice: options.advance === true,
      },
    );
    if (options.advance === true) {
      return await this.jumpToDueTask(1, {
        fromStamp: this.reviewAnchor,
        fromAdvance: true,
        preamble: linkPreamble,
      });
    }
    return true;
  }


BobNavigationHotkeysFreshnessDecayMixin.prototype.refreshTaskFreshnessOnLinks = refreshTaskFreshnessOnLinks;
