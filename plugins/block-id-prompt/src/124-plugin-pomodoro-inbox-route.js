class BlockIdPromptPomodoroInboxRouteMixin {
  // nav `inboxRoute` v1 gate for Ctrl+Shift+Enter (link-toggle-gate). Only
  // the cursor-task toggle (`link-task-pomodoro`) routes; task-link mode
  // keeps today's behavior. Resolves `{ kind: "stay" }` (today's behavior,
  // also when nav lacks the api or the note is not an inbox note),
  // `{ kind: "move", path, name }`, or `{ kind: "cancel" }` (nothing is
  // written). Never throws.
  async gatePomodoroToggleInboxRoute(source, actionLabel, reservedBlockIds) {
    try {
      if (!source || source.kind !== "link-task-pomodoro") {
        return { kind: "stay" };
      }
      const route = this.getInboxRouteApi();
      if (!route) {
        return { kind: "stay" };
      }
      let isInbox = false;
      try {
        isInbox = route.isInboxNote(source.sourcePath) === true;
      } catch (error) {
        isInbox = false;
      }
      if (!isInbox) {
        return { kind: "stay" };
      }
      const outcome = await route.prompt({
        editor: source.editor,
        path: source.sourcePath,
        line: source.line,
        actionLabel,
        reservedBlockIds: Array.isArray(reservedBlockIds) ? reservedBlockIds : [],
      });
      if (
        outcome &&
        outcome.kind === "move" &&
        typeof outcome.path === "string" &&
        outcome.path
      ) {
        return {
          kind: "move",
          path: outcome.path,
          name: String(outcome.name || ""),
        };
      }
      if (outcome && outcome.kind === "stay") {
        return { kind: "stay" };
      }
      return { kind: "cancel" };
    } catch (error) {
      return { kind: "stay" };
    }
  }

  // Routed move commit for Ctrl+Shift+Enter (link-toggle-gate): re-reads,
  // verifies, and moves with nav's shared core. Resolves nav's commit
  // result, or null when the api is gone. Never throws.
  async commitPomodoroToggleInboxRoute(source, destinationPath, expected) {
    try {
      const route = this.getInboxRouteApi();
      if (!route) {
        return null;
      }
      return await route.commit({
        editor: source.editor,
        path: source.sourcePath,
        line: source.line,
        expected,
        destinationPath,
      });
    } catch (error) {
      return null;
    }
  }

  // Post-write finish for a routed link: one composed toast
  // (`<link text> · moved to <dest>`) continued with a `route` walk
  // outcome when the move committed, otherwise today's outcome plus the
  // partial notice. Returns true like today's link success.
  async finishPomodoroLinkWithInboxRoute(
    source,
    plan,
    pomodoroPlan,
    routeGate,
    blockId,
  ) {
    if (!routeGate || routeGate.kind !== "move") {
      this.reportPomodoroLinkOutcomeOrContinue(source, plan, pomodoroPlan);
      return true;
    }
    // No-op guard: only a real task/ledger change may lead to the routed
    // move. A missing write (both plans unchanged) stays in place with
    // today's outcome, never moving.
    const linkWroteAny =
      (plan && plan.hasChanges === true) ||
      (pomodoroPlan && pomodoroPlan.hasChanges === true);
    if (linkWroteAny !== true) {
      this.reportPomodoroLinkOutcomeOrContinue(source, plan, pomodoroPlan);
      return true;
    }
    const linkText = this.formatPomodoroLinkOutcome(plan, pomodoroPlan);
    const commit = await this.commitPomodoroToggleInboxRoute(source, routeGate.path, [
      { line: source.line, raw: source.task.rawLine, blockId },
    ]);
    if (commit && commit.ok === true) {
      const text = `${linkText} · moved to ${commit.name || routeGate.name || "destination"}`;
      if (source && source.reviewOrigin) {
        this.settleLinkReviewOrigin(source, {
          kind: "route",
          notice: text,
          handledRefs: commit.handledRefs,
        });
      } else {
        new Notice(text);
      }
      return true;
    }
    const partial =
      (commit && (commit.notice || commit.reason)) || "Inbox route failed";
    if (source && source.reviewOrigin) {
      this.settleLinkReviewOrigin(source, { kind: "link-today", notice: linkText });
    } else {
      new Notice(linkText);
    }
    new Notice(partial);
    return true;
  }

  // Post-write finish for a routed unlink: one composed toast
  // (`<unlink text> · moved to <dest>`) continued with a `route` walk
  // outcome when the move committed, otherwise today's outcome (a null
  // walk settle via the caller, which stays) plus the partial notice.
  // Returns true like today's unlink success.
  async finishPomodoroUnlinkWithInboxRoute(
    source,
    cleanupPlan,
    workLogPlan,
    status,
    routeGate,
  ) {
    const unlinkText = this.formatPomodoroUnlinkOutcome(
      cleanupPlan,
      workLogPlan || {},
      status,
    );
    if (!routeGate || routeGate.kind !== "move") {
      new Notice(unlinkText);
      return true;
    }
    // No-op guard: only a real ledger/Work Log change may move. An unlink
    // that removed nothing and wrote no log stays with today's outcome.
    const unlinkWroteAny =
      (cleanupPlan &&
        (cleanupPlan.hasChanges === true || cleanupPlan.removedCount > 0)) ||
      (workLogPlan && workLogPlan.hasChanges === true);
    if (unlinkWroteAny !== true) {
      new Notice(unlinkText);
      return true;
    }
    const existingId = source.task && source.task.existingId;
    const expected = existingId
      ? [{ line: source.line, raw: source.task.rawLine, blockId: existingId }]
      : [
          {
            line: source.line,
            raw: source.task.rawLine,
            text: cleanTaskDisplayText(source.task.rawLine),
          },
        ];
    const commit = await this.commitPomodoroToggleInboxRoute(
      source,
      routeGate.path,
      expected,
    );
    if (commit && commit.ok === true) {
      const text = `${unlinkText} · moved to ${commit.name || routeGate.name || "destination"}`;
      if (source && source.reviewOrigin) {
        this.settleLinkReviewOrigin(source, {
          kind: "route",
          notice: text,
          handledRefs: commit.handledRefs,
        });
      } else {
        new Notice(text);
      }
      return true;
    }
    const partial =
      (commit && (commit.notice || commit.reason)) || "Inbox route failed";
    new Notice(unlinkText);
    new Notice(partial);
    return true;
  }
}
