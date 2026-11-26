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

  async applyFreshnessDecayCardLinePlan(cardCtx, live, content, noticeText, action, reason = "") {
    try {
      if (typeof content !== "string" || content === live.content) {
        new Notice("Could not update task; no tasks were updated");
        return false;
      }
      const line = String(splitMarkdownContent(content).lines[cardCtx.line] || "");
      const settled = this.applyNavSettledEditorWrite(cardCtx.cm, cardCtx.filePath, {
        expected: live.content,
        contents: content,
        cursor: {
          line: cardCtx.line,
          ch: Math.min(Math.max(cardCtx.invokeCh || 0, 0), line.length),
        },
        identity: cardCtx.advance === true
          ? null
          : navTaskSettleIdentityAtLine(content, cardCtx.line),
        today: cardCtx.dateText,
      });
      if (!settled || settled.applied !== true) {
        new Notice("Could not update task; no tasks were updated");
        return false;
      }
      if (action === "stay") noteNavigationLogRecallUsed(this.app, "rotten", reason);
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
        // Next → Ready composes the deferred daily cleanup (live Pomodoro
        // links and active Snoozed rows) into the step: same-file folds into
        // the card write, separate-file prunes after it lands. WIP → Next
        // never touches the snooze.
        if (cardCtx.rung === "Next" && plan.mode === "release") {
          const pruneTargets = (plan.released || [])
            .filter((entry) => entry && entry.blockId)
            .map((entry) =>
              Object.freeze({ path: cardCtx.filePath, blockId: entry.blockId }),
            )
            .filter((entry) => entry.path);
          if (pruneTargets.length > 0 && cardCtx.filePath) {
            const noticeText = `${cardCtx.rung} → ${step.toLabel} · Ctrl+Z undoes`;
            const snapshot = await this.readDeferredPomodoroSnapshot(this.app, {
              sourcePath: cardCtx.filePath,
              sourceContent: live.content,
              today: new Date(),
            });
            if (snapshot && snapshot.sameFile) {
              let dailyCleanupPlan = planDeferredPomodoroLinkCleanup(
                logged.content,
                pruneTargets,
                {
                  dailyPath: snapshot.dailyPath,
                  noteIndex: snapshot.noteIndex,
                },
              );
              dailyCleanupPlan = await agreeDeferredPomodoroLinkCleanup(
                getNavigationPomodoroThemesApi(this.app),
                snapshot.dailyPath,
                dailyCleanupPlan,
              );
              if (dailyCleanupPlan.changed) {
                const writeLine =
                  cardCtx.line -
                  deferredCleanupRemovedLinesBefore(
                    dailyCleanupPlan,
                    cardCtx.line,
                  );
                return this.applyFreshnessDecayCardLinePlan(
                  { ...cardCtx, line: writeLine },
                  live,
                  dailyCleanupPlan.content,
                  noticeText,
                  "step",
                );
              }
            } else if (snapshot) {
              const applied = await this.applyFreshnessDecayCardLinePlan(
                cardCtx,
                live,
                logged.content,
                noticeText,
                "step",
              );
              if (!applied) {
                return false;
              }
              let dailyCleanupPlan = planDeferredPomodoroLinkCleanup(
                snapshot.content,
                pruneTargets,
                {
                  dailyPath: snapshot.dailyPath,
                  noteIndex: snapshot.noteIndex,
                },
              );
              dailyCleanupPlan = await agreeDeferredPomodoroLinkCleanup(
                getNavigationPomodoroThemesApi(this.app),
                snapshot.dailyPath,
                dailyCleanupPlan,
              );
              if (dailyCleanupPlan.changed) {
                const written = await this.writeDeferredPomodoroCleanup(
                  snapshot,
                  dailyCleanupPlan,
                );
                if (!written) {
                  new Notice("Step applied; Pomodoro links not removed");
                }
              }
              return true;
            }
          }
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
          settleNav: true,
          settleNavIdentity: cardCtx.advance !== true,
          today: cardCtx.dateText,
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
      const applied = await this.applyFreshnessDecayCardLinePlan(
        cardCtx,
        live,
        logged.content,
        `Stay ${rottenKeepRungPreposition(cardCtx.rung)} ${cardCtx.rung} · count restarted · Ctrl+Z undoes`,
        "stay",
        reason,
      );
      return applied;
    } catch (error) {
      new Notice("Could not update task; no tasks were updated");
      return false;
    }
  }
}
