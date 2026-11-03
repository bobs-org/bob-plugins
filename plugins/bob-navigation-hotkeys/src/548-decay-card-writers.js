class BobNavigationHotkeysDecayCardWriterMixin {
  freshnessDecayCardWriteSession(cardCtx, live) {
    return Object.freeze({
      valid: true,
      explicit: false,
      targets: Object.freeze([Object.freeze({
        line: cardCtx.line,
        rawLine: live.lineText,
      })]),
    });
  }

  appendFreshnessDecayCardLog(content, cardCtx, kind, reason, toRung) {
    const body = formatFreshnessDecayRottenLogBody({
      kind,
      rung: cardCtx.rung,
      toRung,
      keeps: cardCtx.keeps,
      reason,
    });
    return appendFreshnessDecayRottenLogEntry(
      content,
      cardCtx.line,
      cardCtx.dateText,
      body,
    );
  }

  async applyFreshnessDecayCardLinePlan(cardCtx, live, content, noticeText, action) {
    try {
      if (typeof content !== "string" || content === live.content) {
        new Notice("Could not update task; no tasks were updated");
        return false;
      }
      const line = String(splitMarkdownContent(content).lines[cardCtx.line] || "");
      if (!applyEditorContentTransaction(
        cardCtx.cm,
        live.content,
        content,
        { line: cardCtx.line, ch: Math.min(Math.max(cardCtx.invokeCh || 0, 0), line.length) },
      )) {
        new Notice("Could not update task; no tasks were updated");
        return false;
      }
      this.rememberFreshnessDecayCardAnchor(cardCtx);
      new Notice(noticeText);
      await this.maybeAdvanceFreshnessDecayWalk(cardCtx, action);
      return true;
    } catch (error) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
  }

  async applyFreshnessDecayCardStep(cardCtx, live) {
    try {
      const step = cardCtx && cardCtx.plan ? cardCtx.plan.step : null;
      if (!step || step.available !== true) {
        new Notice(`${step && step.unavailableReason ? step.unavailableReason : "Step unavailable"}; nothing was written`);
        return false;
      }
      const session = this.freshnessDecayCardWriteSession(cardCtx, live);
      const stampLine = this.getFreshnessStampLine();
      const common = {
        dateText: cardCtx.dateText,
        stampLine,
        freshDateText: cardCtx.dateText,
      };
      if (cardCtx.rung === "WIP" || cardCtx.rung === "Next") {
        const plan = cardCtx.rung === "WIP"
          ? planTaskLinkLaneBatch(live.content, session, { ...common, mode: "pause" })
          : planTaskLaneBatch(live.content, session, common);
        if (!plan.valid) {
          new Notice(plan.stale ? REVIEW_QUEUE_CHANGED_NOTICE : `${plan.error}; no tasks were updated`);
          return false;
        }
        const logged = this.appendFreshnessDecayCardLog(
          plan.content,
          cardCtx,
          "step",
          "",
          step.toLabel,
        );
        if (!logged.ok) {
          new Notice(freshStampRefusalNotice(logged.refusal));
          return false;
        }
        return this.applyFreshnessDecayCardLinePlan(
          cardCtx,
          live,
          logged.content,
          `${cardCtx.rung} → ${step.toLabel} · Ctrl+Z undoes`,
          "step",
        );
      }

      const property = cardCtx.property;
      const level = this.resolveFreshnessDecayCardLevel(step, property);
      if (!property || !level || !step.date || !Number.isInteger(step.offset)) {
        new Notice(REVIEW_QUEUE_CHANGED_NOTICE);
        return false;
      }
      const noticeText = cardCtx.rung === step.toLabel && step.kind === "roll"
        ? `${step.label} · Ctrl+Z undoes`
        : `${cardCtx.rung} → ${step.toLabel} · Ctrl+Z undoes`;
      const ok = await this.setBulletPriorityValue(
        cardCtx.cm,
        { line: cardCtx.line, ch: 0 },
        cardCtx.filePath,
        cardCtx.rawLine,
        property,
        level,
        {
          baseDate: getLocalDateStart(new Date()),
          precomputedRoll: { date: step.date, offset: step.offset },
          scheduleReasonOverride: step.reason,
          decayRottenLogBody: this.appendFreshnessDecayCardLogBody(
            cardCtx,
            "step",
            "",
            step.toLabel,
          ),
          decayRottenLogDateText: cardCtx.dateText,
          noticeOverride: noticeText,
        },
      );
      if (!ok) return false;
      this.rememberFreshnessDecayCardAnchor(cardCtx);
      await this.maybeAdvanceFreshnessDecayWalk(cardCtx, "step");
      return true;
    } catch (error) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
  }

  appendFreshnessDecayCardLogBody(cardCtx, kind, reason, toRung) {
    return formatFreshnessDecayRottenLogBody({
      kind,
      rung: cardCtx.rung,
      toRung,
      keeps: cardCtx.keeps,
      reason,
    });
  }

  async applyFreshnessDecayCardStay(cardCtx, live, reason = "") {
    try {
      const stamper = this.getFreshnessStampLine();
      if (typeof stamper !== "function") {
        new Notice(REVIEW_FRESHNESS_API_REQUIRED_NOTICE);
        return false;
      }
      const plan = planFreshStampBatch(
        live.content,
        [{ line: cardCtx.line, path: cardCtx.filePath, raw: live.lineText }],
        stamper,
        cardCtx.dateText,
      );
      if (!plan.ok) {
        new Notice(freshStampRefusalNotice(plan.refusal));
        return false;
      }
      const logged = this.appendFreshnessDecayCardLog(
        plan.content,
        cardCtx,
        "stay",
        reason,
        "",
      );
      if (!logged.ok) {
        new Notice(freshStampRefusalNotice(logged.refusal));
        return false;
      }
      return this.applyFreshnessDecayCardLinePlan(
        cardCtx,
        live,
        logged.content,
        `Stay ${rottenKeepRungPreposition(cardCtx.rung)} ${cardCtx.rung} · count restarted · Ctrl+Z undoes`,
        "stay",
      );
    } catch (error) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
  }
}
