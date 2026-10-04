class BobNavigationHotkeysFreshnessDecayMixin {

  async refreshTaskFreshnessOnLinks(cm, cursor, content, options = {}) {
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
    // Task Link sessions never open cards — even a single link. Exact
    // at-limit targets skip without changing fresh/count; below
    // threshold they count normally. Skipped targets stay due for the
    // walk and never enter anchor exclusions.
    const linkResolved = groups.map((group) => {
      const groupLines = splitMarkdownContent(group.content).lines;
      return {
        group,
        resolved: group.session.targets.map((target) => {
          const raw = String(groupLines[target.line] || "");
          const match = matchFreshStampExactEntry(queueBefore, {
            path: group.path,
            line: target.line,
            raw,
          });
          return Object.freeze({
            target: Object.freeze({
              line: target.line,
              path: group.path,
              raw,
              counted: match.ok,
            }),
            match,
          });
        }),
      };
    });
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
    const eligibleTargets = stampTargetsByGroup.flatMap(({ targets }) =>
      targets.filter((target) => isPendingWorkLogTargetRawLine(target.raw)),
    );
    let summary = "";
    if (eligibleTargets.length > 0) {
      const result = await this.requestFreshnessRefreshSummary({
        summary: options.summary,
        dateText: options.dateText,
        totalCount: linkStamped,
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
      if (
        cm &&
        typeof cm.getValue === "function" &&
        String(cm.getValue() || "") !== content
      ) {
        new Notice("Current note changed; no tasks were updated");
        return false;
      }
      for (const { group } of stampTargetsByGroup) {
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
    for (const { group, targets } of stampTargetsByGroup) {
      const plan = planFreshStampBatchWithWorkLogs(
        group.content,
        targets,
        options.stamper,
        options.dateText,
        summary,
      );
      if (!plan.ok) {
        new Notice(freshStampRefusalNotice(plan.refusal));
        return false;
      }
      workLogWrittenCount += plan.workLogWrittenCount;
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
        new Notice("A linked note changed; no tasks were updated");
        return false;
      }
    }
    this.finishFreshStamp(
      queueBefore,
      countsBefore,
      refs,
      stampedAll,
      options.dateText,
      { skipTail: linkSkipTail, workLogWrittenCount },
    );
    if (options.advance === true) {
      return await this.jumpToDueTask(1, { fromStamp: this.reviewAnchor });
    }
    return true;
  }

  // Remember the walk anchor for the session (the Tasks cache lags, so
  // the jump reads the queue fresh but continues from the handled entry's
  // surviving successor or predecessor), then show the adjusted-counts
  // Notice on the upkeep meter.
  finishFreshStamp(queueBefore, countsBefore, refs, stamped, dateText, extra = {}) {
    const matched = matchFreshStampRefs(queueBefore, refs);
    this.reviewAnchor =
      matched.count > 0
        ? buildReviewAnchor(queueBefore, matched.keys, matched.rank, dateText)
        : null;
    const changed = stamped.filter(
      (entry) => entry.after !== entry.before,
    ).length;
    const counts =
      countsBefore && typeof countsBefore === "object" ? countsBefore : {};
    const dueBefore = Math.max(
      0,
      Math.floor(numericOrDefault(counts.due, 0)),
    );
    const newBefore = Math.max(
      0,
      Math.floor(numericOrDefault(counts.new, 0)),
    );
    const upkeepBefore = Number.isInteger(counts.upkeepToday)
      ? counts.upkeepToday
      : Math.max(
        0,
        Math.floor(numericOrDefault(counts.refreshedToday, 0)),
      );
    // Lane stamps (Pending/Next) never grow upkeep: only stamped tasks
    // that stay outside the lanes count.
    const newlyUpkept = stamped.filter((entry) => {
      if (freshStampLineHasToday(entry.before, dateText)) {
        return false;
      }
      const status = getObsidianTaskCheckboxStatus(entry.after);
      return status !== "/" && status !== "*";
    }).length;
    // Only actual streak increments tail the notice; preserves, same-day
    // repeats, and stale-cache mismatches report no `kept N×`.
    const kept = countFreshStampKept(stamped);
    const skipTail =
      extra && typeof extra.skipTail === "string" ? extra.skipTail : "";
    new Notice(
      buildFreshStampNotice({
        changed,
        dueAfter: Math.max(0, dueBefore - matched.count),
        newAfter: Math.max(0, newBefore - matched.newCount),
        refreshedAfter: upkeepBefore + newlyUpkept,
        budget:
          counts.budget === undefined || counts.budget === null
            ? null
            : counts.budget,
        kept,
        workLogWrittenCount: extra && extra.workLogWrittenCount,
      }) + skipTail,
    );
  }

  // Decision card: open, revalidate, and commit (`docs/freshness.md` §2a).
  // The card opens for one exact, due, at-limit source task and writes
  // nothing until approval. Every approval revalidates the task line,
  // the local day, the decay config, the trigger eligibility, the plan
  // inputs (keeps, interval, scheduled and priority values), the task's
  // child block (Schedule Log preimages), and the priority ladder
  // config, then reuses the previewed plan/date through the existing
  // transactional writers — one source-note decision is one undo step.
  // Stale inputs write nothing and rebuild for a fresh choice.

  // Normalized decay policy from the ledger api, with counting defaults
  // when the namespace is old or throwing. Never throws.
  readFreshnessDecayPolicy(api) {
    const fallback = Object.freeze({
      enabled: true,
      keeps: 3,
      enter: null,
      invalid: false,
    });
    try {
      if (api && typeof api.config === "function") {
        const config = api.config();
        const decay =
          config && config.decay && typeof config.decay === "object"
            ? config.decay
            : {};
        return Object.freeze({
          enabled: decay.enabled !== false,
          keeps:
            Number.isInteger(decay.keeps) && decay.keeps >= 0
              ? decay.keeps
              : 3,
          enter:
            typeof decay.enter === "string" && decay.enter !== ""
              ? decay.enter
              : null,
          invalid: config ? config.invalid === true : false,
        });
      }
    } catch (error) {
      // Fall through to the counting defaults below.
    }
    return fallback;
  }

  // Build the card context for one resolved single-task trigger, or null
  // when the card cannot render (mixed versions, unusable plan) so the
  // caller falls back to counting. Never throws.
  buildFreshnessDecayCardCtx(cm, cursor, content, filePath, resolved, queueBefore, options) {
    try {
      const api = getReviewFreshnessApi(this.app);
      if (!api || !freshnessSupportsDecayDecisions(api)) {
        return null;
      }
      const settings = options && typeof options === "object" ? options : {};
      const dateText = String(settings.dateText || "");
      const line = resolved && resolved.target ? resolved.target.line : NaN;
      const raw = resolved && resolved.target ? String(resolved.target.raw || "") : "";
      if (!Number.isInteger(line) || !raw || !/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
        return null;
      }
      const match = resolved.match;
      const entry = match && match.entry ? match.entry : null;
      const decay = this.readFreshnessDecayPolicy(api);
      const property = findFreshnessDecayPriorityProperty(this.config);
      const keeps = parseKeepsCount(raw);
      const intervalDays = resolveFreshnessDecayIntervalDays(api, entry, raw, content);
      const schedulesName =
        property && typeof property.schedules === "string" ? property.schedules : "";
      const scheduledField =
        schedulesName ? findBulletPropertyField(raw, schedulesName) : null;
      const currentScheduled = normalizeBulletPropertyValue(
        scheduledField ? scheduledField.value : "",
      );
      const priorityField =
        property && typeof property.name === "string"
          ? findBulletPropertyField(raw, property.name)
          : null;
      const currentValue = normalizeBulletPropertyValue(
        priorityField ? priorityField.value : "",
      );
      const plan = planFreshnessDecayCard({
        keeps,
        intervalDays,
        freshnessDecay: {
          enabled: decay.enabled,
          keeps: decay.keeps,
          enter: decay.enter,
          invalid: decay.invalid,
        },
        property,
        baseDate: new Date(),
        random: Math.random,
        currentScheduled,
        content: String(content || ""),
        taskLine: line,
      });
      if (!plan || plan.valid !== true) {
        return null;
      }
      const childBlock = snapshotFreshnessDecayChildBlock(
        String(content || ""),
        line,
      );
      const priorityConfig = serializeFreshnessDecayPriorityProperty(property);
      const taskText = cleanTaskDisplayText(raw);
      const noteBase = String(filePath || "").split("/").pop() || String(filePath || "");
      const createdField = findBulletPropertyField(raw, "created");
      const age = formatFreshnessDecayCapturedAge(
        createdField ? createdField.value : "",
        dateText,
      );
      const subtitle = age
        ? `${taskText} · ${noteBase} · ${age}`
        : `${taskText} · ${noteBase}`;
      return Object.freeze({
        cm,
        filePath: String(filePath || ""),
        line,
        rawLine: raw,
        invokeCh: cursor && Number.isInteger(cursor.ch) ? cursor.ch : 0,
        dateText,
        advance: settings.advance === true,
        queueBefore: Array.isArray(queueBefore) ? queueBefore : [],
        entry,
        keeps,
        limit: decay.keeps,
        intervalDays,
        currentScheduled,
        currentValue,
        childBlock,
        priorityConfig,
        decay,
        plan,
        rows: buildFreshnessDecayCardRows(plan),
        subtitle,
      });
    } catch (error) {
      return null;
    }
  }

  // Open the card for one trigger. True when the gesture is consumed
  // (card open, or a notice explains why nothing was written); false
  // when the caller should fall back to counting.
  async maybeOpenFreshnessDecayCard(cm, cursor, content, filePath, resolved, queueBefore, options) {
    try {
      if (this.activeFreshnessDecayCard) {
        new Notice("A decision card is already open");
        return true;
      }
      const cardCtx = this.buildFreshnessDecayCardCtx(
        cm,
        cursor,
        content,
        filePath,
        resolved,
        queueBefore,
        options,
      );
      if (!cardCtx) {
        return false;
      }
      return this.openFreshnessDecayCard(cardCtx);
    } catch (error) {
      return false;
    }
  }

  openFreshnessDecayCard(cardCtx) {
    try {
      if (!cardCtx || this.activeFreshnessDecayCard) {
        return false;
      }
      const modal = new FreshnessDecayCardModal(this.app, {
        title: cardCtx.plan.title || `Kept ${cardCtx.keeps} reviews in a row`,
        subtitle: cardCtx.subtitle,
        rows: cardCtx.rows,
        onChoose: (action) => {
          this.activeFreshnessDecayCard = null;
          void this.applyFreshnessDecayCardChoice(cardCtx, action);
        },
        onDismiss: () => {
          // Esc changes nothing: no writes, no log entries, no
          // accounting, no walk advance; the anchor is retained.
          this.activeFreshnessDecayCard = null;
        },
      });
      this.activeFreshnessDecayCard = modal;
      modal.open();
      return true;
    } catch (error) {
      this.activeFreshnessDecayCard = null;
      return false;
    }
  }

  // Revalidate the previewed plan against live state immediately before
  // commit: the task line, the local day, the decay config, the trigger
  // eligibility, the plan inputs (keeps, interval, scheduled and priority
  // values), the task's child block (Schedule Log preimages), and the
  // priority ladder config. Child-log insertion positions are still
  // recomputed at commit; any child-log content change is stale and
  // rebuilds for a fresh choice. Returns `{ ok, live }`.
  revalidateFreshnessDecayCard(cardCtx) {
    const stale = (reason) => ({ ok: false, reason, live: null });
    try {
      if (!cardCtx || !cardCtx.cm || typeof cardCtx.cm.getValue !== "function") {
        return stale("no-editor");
      }
      const cm = cardCtx.cm;
      const liveContent = String(cm.getValue() || "");
      const liveLine = getEditorLine(cm, cardCtx.line);
      if (liveLine === null || liveLine !== cardCtx.rawLine) {
        return stale("task-line");
      }
      if (this.getFreshnessDateText() !== cardCtx.dateText) {
        return stale("local-day");
      }
      const api = getReviewFreshnessApi(this.app);
      if (!api || !freshnessSupportsDecayDecisions(api)) {
        return stale("freshness-api");
      }
      const decay = this.readFreshnessDecayPolicy(api);
      if (
        decay.enabled !== cardCtx.decay.enabled ||
        decay.keeps !== cardCtx.decay.keeps ||
        decay.enter !== cardCtx.decay.enter ||
        decay.invalid !== cardCtx.decay.invalid
      ) {
        return stale("config");
      }
      const queue = this.readFreshnessQueue(api);
      const match = matchFreshStampExactEntry(queue, {
        path: cardCtx.filePath,
        line: cardCtx.line,
        raw: liveLine,
      });
      if (match.ok !== true || !isFreshnessDecayDecisionEntry(match.entry)) {
        return stale("eligibility");
      }
      if (parseKeepsCount(liveLine) !== cardCtx.keeps) {
        return stale("keeps");
      }
      if (
        resolveFreshnessDecayIntervalDays(api, match.entry, liveLine, liveContent) !==
        cardCtx.intervalDays
      ) {
        return stale("interval");
      }
      const property = findFreshnessDecayPriorityProperty(this.config);
      const schedulesName =
        property && typeof property.schedules === "string" ? property.schedules : "";
      const scheduledField =
        schedulesName ? findBulletPropertyField(liveLine, schedulesName) : null;
      if (
        normalizeBulletPropertyValue(scheduledField ? scheduledField.value : "") !==
        cardCtx.currentScheduled
      ) {
        return stale("scheduled");
      }
      const priorityField =
        property && typeof property.name === "string"
          ? findBulletPropertyField(liveLine, property.name)
          : null;
      if (
        normalizeBulletPropertyValue(priorityField ? priorityField.value : "") !==
        cardCtx.currentValue
      ) {
        return stale("priority");
      }
      if (
        serializeFreshnessDecayPriorityProperty(property) !==
        cardCtx.priorityConfig
      ) {
        return stale("priority-config");
      }
      if (
        snapshotFreshnessDecayChildBlock(liveContent, cardCtx.line) !==
        cardCtx.childBlock
      ) {
        return stale("child-log");
      }
      return {
        ok: true,
        reason: null,
        live: Object.freeze({ content: liveContent, lineText: liveLine, queue }),
      };
    } catch (error) {
      return stale("unexpected");
    }
  }

  // Rebuild for a fresh choice after a stale commit: new preview, new
  // card. False when the task no longer decides — the next press stamps.
  async reopenFreshnessDecayCard(cardCtx) {
    try {
      const cm = cardCtx ? cardCtx.cm : null;
      if (!cm || typeof cm.getValue !== "function") {
        return false;
      }
      const content = String(cm.getValue() || "");
      const liveLine = getEditorLine(cm, cardCtx.line);
      if (liveLine === null) {
        return false;
      }
      const api = getReviewFreshnessApi(this.app);
      const queue = this.readFreshnessQueue(api);
      const match = matchFreshStampExactEntry(queue, {
        path: cardCtx.filePath,
        line: cardCtx.line,
        raw: liveLine,
      });
      if (match.ok !== true || !isFreshnessDecayDecisionEntry(match.entry)) {
        return false;
      }
      const cursor = getEditorCursor(cm) || { line: cardCtx.line, ch: 0 };
      const next = this.buildFreshnessDecayCardCtx(
        cm,
        cursor,
        content,
        cardCtx.filePath,
        {
          target: Object.freeze({
            line: cardCtx.line,
            path: cardCtx.filePath,
            raw: liveLine,
            counted: true,
          }),
          match,
        },
        queue,
        { dateText: cardCtx.dateText, advance: cardCtx.advance },
      );
      if (!next) {
        return false;
      }
      return this.openFreshnessDecayCard(next);
    } catch (error) {
      return false;
    }
  }

  async applyFreshnessDecayCardChoice(cardCtx, action) {
    this.activeFreshnessDecayCard = null;
    try {
      const check = this.revalidateFreshnessDecayCard(cardCtx);
      if (!check.ok) {
        // Write nothing; rebuild for a fresh choice rather than applying
        // unseen dates or overwriting another edit.
        new Notice(REVIEW_QUEUE_CHANGED_NOTICE);
        await this.reopenFreshnessDecayCard(cardCtx);
        return false;
      }
      const key = String(action || "");
      if (key === "notNow") {
        return await this.applyFreshnessDecayCardDeferral(
          cardCtx,
          check.live,
          cardCtx.plan.notNow,
        );
      }
      if (key.startsWith("level:")) {
        const index = Number(key.slice("level:".length));
        const pick =
          cardCtx.plan.levels && Number.isInteger(index)
            ? cardCtx.plan.levels[index]
            : null;
        return await this.applyFreshnessDecayCardDeferral(cardCtx, check.live, pick);
      }
      if (key === "lessOften") {
        return await this.applyFreshnessDecayCardLessOften(cardCtx, check.live);
      }
      if (key === "reword") {
        return await this.applyFreshnessDecayCardReword(cardCtx, check.live);
      }
      if (key === "drop") {
        return await this.applyFreshnessDecayCardDrop(cardCtx, check.live);
      }
      if (key === "keep") {
        return await this.applyFreshnessDecayCardKeep(cardCtx, check.live);
      }
      return false;
    } catch (error) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
  }

  // Walk bookkeeping shared by applied decisions: the handled entry keys
  // the walk anchor (the Tasks cache lags, so the jump reads the queue
  // fresh but continues from the surviving successor or predecessor).
  rememberFreshnessDecayCardAnchor(cardCtx) {
    try {
      const matched = matchFreshStampRefs(cardCtx.queueBefore, [
        { path: cardCtx.filePath, line: cardCtx.line, raw: cardCtx.rawLine },
      ]);
      this.reviewAnchor =
        matched.count > 0
          ? buildReviewAnchor(
              cardCtx.queueBefore,
              matched.keys,
              matched.rank,
              cardCtx.dateText,
            )
          : null;
    } catch (error) {
      this.reviewAnchor = null;
    }
  }

  // Successful Ctrl+Alt+F outcomes advance exactly once after commit —
  // except Reword, which leaves focus for editing, and failed or
  // dismissed secondary pickers, which stay due.
  async maybeAdvanceFreshnessDecayWalk(cardCtx, action) {
    try {
      if (cardCtx && cardCtx.advance === true && action !== "reword") {
        return await this.jumpToDueTask(1, { fromStamp: this.reviewAnchor });
      }
    } catch (error) {
      return false;
    }
    return true;
  }

  // Resolve a previewed deferral pick to its configured level. Unknown
  // labels (or a missing ladder) refuse rather than inventing a level.
  resolveFreshnessDecayCardLevel(pick) {
    try {
      const property = findFreshnessDecayPriorityProperty(this.config);
      if (!property || !Array.isArray(property.levels)) {
        return null;
      }
      const label = normalizeBulletPropertyValue(pick ? pick.levelLabel : "");
      if (!label) {
        return null;
      }
      return (
        property.levels.find(
          (level) =>
            level && normalizeBulletPropertyValue(level.label) === label,
        ) || null
      );
    } catch (error) {
      return null;
    }
  }

  // Not now (Enter) and explicit 1–4 picks: preview and apply a deferral
  // through the existing priority writer. The previewed date persists
  // (what you see is what you get); Enter never cancels, including past
  // the last ladder level, where the planner already substituted a
  // same-level roll for this card only. Stamps and clears keeps through
  // the writer's own freshness step. One undo step.
  async applyFreshnessDecayCardDeferral(cardCtx, live, pick) {
    try {
      if (!pick || pick.available !== true) {
        new Notice("That choice is unavailable; nothing was written");
        return false;
      }
      const property = findFreshnessDecayPriorityProperty(this.config);
      if (!property) {
        new Notice("No priority ladder is configured; nothing was written");
        return false;
      }
      const level = this.resolveFreshnessDecayCardLevel(pick);
      if (!level) {
        new Notice(REVIEW_QUEUE_CHANGED_NOTICE);
        return false;
      }
      const ok = await this.setBulletPriorityValue(
        cardCtx.cm,
        { line: cardCtx.line, ch: 0 },
        cardCtx.filePath,
        cardCtx.rawLine,
        property,
        level,
        {
          baseDate: getLocalDateStart(new Date()),
          precomputedRoll: { date: pick.date, offset: pick.offset },
          scheduleReasonOverride: pick.reason,
        },
      );
      if (!ok) {
        return false;
      }
      this.rememberFreshnessDecayCardAnchor(cardCtx);
      await this.maybeAdvanceFreshnessDecayWalk(cardCtx, "deferral");
      return true;
    } catch (error) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
  }

  // Less often (L): the next refresh preset strictly above the current
  // interval, stamped and cleared, with a dated review-reason Schedule
  // Log entry. At 90+ the existing custom refresh picker takes over,
  // constrained to a longer value ≤365; at 365 the row is unavailable.
  // One source-note decision is one undo step.
  async applyFreshnessDecayCardLessOften(cardCtx, live) {
    try {
      const lessOften = cardCtx.plan.lessOften;
      if (!lessOften || lessOften.available !== true) {
        new Notice("That choice is unavailable; nothing was written");
        return false;
      }
      if (lessOften.mode === "picker") {
        this.openFreshnessDecayLessOftenPicker(cardCtx);
        return true;
      }
      if (lessOften.mode !== "refresh" || !Number.isInteger(lessOften.afterDays)) {
        new Notice("That choice is unavailable; nothing was written");
        return false;
      }
      return await this.applyFreshnessDecayLessOftenDays(
        cardCtx,
        live,
        lessOften.beforeDays,
        lessOften.afterDays,
      );
    } catch (error) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
  }

  // Commit a Less often interval: refresh-set (which stamps and clears)
  // plus the dated review-reason entry in one editor transaction.
  async applyFreshnessDecayLessOftenDays(cardCtx, live, beforeDays, days) {
    try {
      if (
        !Number.isInteger(days) ||
        days <= beforeDays ||
        days < 1 ||
        days > 365
      ) {
        new Notice("That choice is unavailable; nothing was written");
        return false;
      }
      const refresher = this.getFreshnessRefreshLine();
      if (typeof refresher !== "function") {
        new Notice(REVIEW_FRESHNESS_API_REQUIRED_NOTICE);
        return false;
      }
      const reason = formatFreshnessDecisionLessOftenReason({
        beforeDays,
        afterDays: days,
        keeps: cardCtx.keeps,
      });
      if (!reason) {
        new Notice("Could not update task; no tasks were updated");
        return false;
      }
      const nextLine = applyFreshRefreshLine(
        live.lineText,
        refresher,
        days,
        cardCtx.dateText,
      );
      if (nextLine === live.lineText) {
        new Notice("Refresh unchanged; nothing was written");
        return false;
      }
      const logPlan = planScheduleLogEntry(live.content, cardCtx.line, {
        from: cardCtx.currentScheduled,
        to: cardCtx.currentScheduled,
        reason,
      });
      const split = splitMarkdownContent(live.content);
      const lines = split.lines.slice();
      lines[cardCtx.line] = nextLine;
      applyScheduleLogEntryToLines(lines, logPlan);
      const applied = applyEditorContentTransaction(
        cardCtx.cm,
        live.content,
        lines.join(split.lineEnding),
        {
          line: cardCtx.line,
          ch: Math.min(cardCtx.invokeCh, nextLine.length),
        },
      );
      if (!applied) {
        new Notice("Could not update task; no tasks were updated");
        return false;
      }
      this.rememberFreshnessDecayCardAnchor(cardCtx);
      new Notice(`Less often · every ${beforeDays} → ${days} days · kept ${cardCtx.keeps}×`);
      await this.maybeAdvanceFreshnessDecayWalk(cardCtx, "lessOften");
      return true;
    } catch (error) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
  }

  async completeReviewChecklistRow(cm, options = {}) {
    const api = options.api;
    const entry = options.entry;
    const queueBefore = Array.isArray(options.queueBefore) ? options.queueBefore : [];
    const filePath = options.filePath;
    const advance = options.advance === true;
    const todayText =
      typeof options.dateText === "string" && options.dateText
        ? options.dateText
        : this.laneReleaseDateText({});
    const tier = reviewEntryMachineTier(entry);
    if (!reviewFreshnessSupportsChecklistTiers(api)) {
      new Notice(REVIEW_CHECKLIST_UPDATE_LEDGER_NOTICE);
      return false;
    }
    const cycler = getReviewCyclerApi(this.app);
    if (!cycler) {
      new Notice(REVIEW_CHECKLIST_UPDATE_CYCLER_NOTICE);
      return false;
    }
    const prior =
      this.reviewAnchor &&
      reviewAnchorIsCurrentDay(this.reviewAnchor, todayText) &&
      Array.isArray(this.reviewAnchor.keys)
        ? this.reviewAnchor.keys
        : [];
    const handled = new Set(prior);
    handled.add(reviewQueueEntryKey(entry));
    let nextPlan = null;
    if (advance && tier !== "post") {
      nextPlan = planReviewJump(queueBefore, {
        direction: 1,
        cursor: { path: filePath, line: entry.line, text: entry.originalMarkdown },
        anchor: buildReviewAnchor(queueBefore, Array.from(handled), entry.rank, todayText),
        todayText,
      });
    }
    let result;
    try {
      result = await cycler.completeTaskAtCursor(cm);
    } catch (error) {
      new Notice("Not completed — not-closed");
      return false;
    }
    if (!result || result.ok !== true) {
      new Notice(`Not completed — ${result && result.reason ? result.reason : "not-closed"}`);
      return false;
    }
    this.reviewAnchor = buildReviewAnchor(
      queueBefore, Array.from(handled), entry.rank, todayText,
    );
    const remaining = reviewWalkRemaining(queueBefore, handled);
    const taskText =
      entry && typeof entry.text === "string" && entry.text.trim()
        ? entry.text.trim()
        : "task";
    if (tier === "post") {
      const prefix = remaining.commitments > 0
        ? `${remaining.commitments} commitments still due · `
        : "";
      new Notice(`${prefix}Review closed — ${remaining.rotten} ROTTEN left for later`);
      return true;
    }
    if (!advance) {
      new Notice(`✓ Done · ${remaining.pre} PRE left`);
      return true;
    }
    const doneLine = `✓ Done · ${taskText}`;
    if (!nextPlan || nextPlan.kind !== "jump") {
      new Notice(doneLine);
      return true;
    }
    const landed = await this.landOnReviewQueueEntry(nextPlan.entry);
    if (!landed.ok) {
      new Notice(doneLine);
      return true;
    }
    this.reviewAnchor = buildReviewAnchor(
      queueBefore, [reviewQueueEntryKey(nextPlan.entry)], nextPlan.rank, todayText,
    );
    let landingNotice = buildReviewJumpNotice(
      nextPlan.entry, nextPlan.rank, nextPlan.total, {
        wrapped: nextPlan.wrapped,
        todayText,
        trackers: reviewFreshnessSupportsTrackers(api),
        reviewEntryView:
          api && typeof api.reviewEntryView === "function"
            ? (noticeEntry, noticeOptions) => api.reviewEntryView(noticeEntry, noticeOptions)
            : null,
      },
    );
    const destTier = reviewEntryMachineTier(nextPlan.entry);
    const boundary = buildReviewBoundaryNotice({
      originTier: tier, destTier,
      commitmentsLeft: remaining.commitments,
      rottenLeft: remaining.rotten, postLeft: remaining.post,
    });
    if (destTier === "post") {
      landingNotice = appendReviewPostLandingTail(landingNotice, remaining);
    }
    new Notice([doneLine, boundary, landingNotice].filter(Boolean).join("\n"));
    return true;
  }
}
