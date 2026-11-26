// Task Link Ctrl+Enter lives here so 160 stays under the 1000-line cap.
class TaskStatusCyclerCompletionLinksMixin {
  async handleActiveTaskBlockLinkOpenDone(editor, activeFile, options = {}) {
    const activePath = activeFile && activeFile.path;
    const candidate = this.getActiveLineTaskBlockLinkTarget(editor, activePath);
    if (!candidate) {
      return { resolved: false, changed: false };
    }

    // A link on a managed dependency line closes or reopens its target
    // root-only: the Blocked-dependent recovery in finalizeClosedTasks still
    // runs, but nothing is ever struck, restored, or embedded on the line and
    // no transcluded tree is closed. On a BLOCKS line this is the dependent
    // under the cursor (Rule 8).
    const onDependencyLine = isTaskLinkGestureLine(candidate.activeLineText);

    const context = {
      editor,
      activePath,
      originPath: activePath,
    };
    let resolvedTarget = null;
    try {
      resolvedTarget = await this.resolveTranscludedBlockTarget(
        candidate,
        context,
        { taskStatusPredicate: isOpenDoneTaskStatus },
      );
    } catch (error) {
      resolvedTarget = null;
    }
    if (!resolvedTarget || !resolvedTarget.file) {
      // A Task Link to a Cancelled task consumes the key with a notice: it
      // must never fall back to completing the owning Pomodoro. Links that
      // resolve to no task at all keep their current fallback.
      let cancelledTarget = null;
      try {
        cancelledTarget = await this.resolveTranscludedBlockTarget(
          candidate,
          context,
          { taskStatusPredicate: isCancelledTaskStatus },
        );
      } catch (error) {
        cancelledTarget = null;
      }
      if (cancelledTarget && cancelledTarget.file) {
        new Notice("Task is cancelled; reopen it with ⌥] first");
        return { resolved: true, changed: false };
      }
      return { resolved: false, changed: false };
    }

    // A live plain link under a closed Pomodoro whose target is already Done
    // is retired in place as `🍅 ~~[[X]]~~`. No task write, post-close pass,
    // or successor offers. A second press hits the struck form and reopens.
    if (
      !onDependencyLine &&
      staleDoneLinkShouldRetire(
        candidate,
        resolvedTarget,
        this.getEditorLineTexts(editor),
      )
    ) {
      const wrote = await this.strikeActiveSelectedTaskBlockLink(
        editor,
        activePath,
        candidate,
        { keepPomodoroMarker: true },
      );
      return { resolved: true, changed: !!wrote };
    }

    // Reopen always wins after resolution and is deliberately root-only, even
    // for an embedded child beneath a Pomodoro.
    if (isTranscludedReopenableStatus(resolvedTarget.taskStatus)) {
      const reopenResult = await this.reopenResolvedTranscludedTaskTarget(
        resolvedTarget,
        context,
      );
      if (reopenResult.changed && !onDependencyLine) {
        try {
          await this.unstrikeActiveSelectedTaskBlockLink(
            editor,
            activePath,
            candidate,
          );
        } catch (error) {
          // Best effort: the reopen already landed; a missed unstrike is cosmetic.
        }
      }
      if (reopenResult.changed) {
        // `cycler_polish`: the struck-link reopen takes back this pass's
        // untouched successor links the same day.
        try {
          await this.consumeSuccessorReopenReceipt(
            [{
              path: resolvedTarget.file.path,
              blockId: resolvedTarget.blockId,
            }],
            context,
          );
        } catch (error) {
          // Best effort: the reopen already landed.
        }
      }
      return { resolved: true, changed: reopenResult.changed };
    }

    const pomodoroTransclusion = candidate.embedded && !onDependencyLine
      ? this.getActivePomodoroTranscludedTaskLineTarget(editor, activePath)
      : null;
    if (pomodoroTransclusion) {
      try {
        const mail = await this.confirmCyclerMailCloseForResolvedTree(resolvedTarget, context);
        if (!mail || mail.confirmed !== true) {
          return { resolved: true, changed: false };
        }
        const result = await this.completeResolvedTranscludedTaskTargetTree(
          resolvedTarget,
          context,
          new Set(),
        );
        const order = await finalizeTaskLinkCloseForJump(this, result.closed, {
          ...context,
          reqCloseOwners: result.reqCloseOwners || [],
        }, options);
        const rootKey = `${resolvedTarget.file.path}#^${resolvedTarget.blockId}`;
        const rootClosed = Array.isArray(result.closed) && result.closed.some(
          (identity) =>
            identity &&
            `${identity.path}#^${identity.blockId}` === rootKey,
        );
        if (rootClosed && !candidate.snoozedRow) {
          try {
            await this.strikeActiveSelectedTaskBlockLink(editor, activePath, candidate);
          } catch (error) {
            // Best effort: the close already landed; a missed strike is cosmetic.
          }
        }
        await landTaskLinkCloseJump(this, order, context);
        return taskLinkCloseJumpResult(order, result.changed);
      } catch (error) {
        // Once the eligible root resolved, a partial recursive close remains a
        // handled best-effort action.
        return { resolved: true, changed: false };
      }
    }

    const closing = isTranscludedCompletionClosableStatus(
      resolvedTarget.taskStatus,
    );
    if (closing) {
      const mail = await this.confirmCyclerMailCloseForResolvedClose(resolvedTarget, context, "x");
      if (!mail || mail.confirmed !== true) {
        return { resolved: true, changed: false };
      }
    }
    const reqCloseOwners = closing
      ? this.captureReqCloseOwnersForResolvedTarget(resolvedTarget, context)
      : [];
    const wrote = await this.replaceResolvedTranscludedTaskLine(
      resolvedTarget,
      context,
    );
    if (wrote && closing) {
      const identity = this.reqCloseIdentityForResolvedTarget(resolvedTarget);
      const order = await finalizeTaskLinkCloseForJump(this, [identity], {
        ...context,
        reqCloseOwners,
      }, options);
      if (!onDependencyLine && !candidate.snoozedRow) {
        try {
          await this.strikeActiveSelectedTaskBlockLink(editor, activePath, candidate);
        } catch (error) {
          // Best effort: the close already landed; a missed strike is cosmetic.
        }
      }
      await landTaskLinkCloseJump(this, order, context);
      return taskLinkCloseJumpResult(order, wrote);
    }
    return { resolved: true, changed: !!wrote };
  }
}
