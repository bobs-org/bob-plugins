// Shared post-cancel follow-ups (`docs/task-relations.md` §17 CL4/CL8).
// Runs deferred daily-note prune at most once and recovers Blocked
// dependents through the versioned cycler API. Never closes a picker,
// displays a notice, settles the walk, offers successors, or transfers
// dependencies. Task Card Cancel and the relation writer both call this.

class BobNavigationHotkeysPostCancelEffectsMixin {
  async runPostCancelEffects(details = {}) {
    const identities = Array.isArray(details.identities)
      ? details.identities
      : [];
    const snapshot = details.pomodoroSnapshot || null;
    const plan = details.dailyCleanupPlan || null;
    const cleanupHandled = details.cleanupHandled === true;
    let pomodoroLinksRemoved = 0;
    let pruneFailed = false;
    let postPruneDailyContent = null;

    if (plan && plan.changed) {
      postPruneDailyContent = plan.content;
    }
    if (cleanupHandled) {
      pomodoroLinksRemoved = Math.max(
        0,
        Math.floor(numericOrDefault(details.pomodoroLinksRemoved, 0)),
      );
      pruneFailed = Boolean(details.pruneFailed);
    } else if (plan && plan.changed && snapshot) {
      if (snapshot.sameFile) {
        pomodoroLinksRemoved = Math.max(
          0,
          Math.floor(numericOrDefault(plan.removedLinkCount, 0)),
        );
      } else {
        const written = await this.writeDeferredPomodoroCleanup(snapshot, plan);
        if (written) {
          pomodoroLinksRemoved = Math.max(
            0,
            Math.floor(numericOrDefault(plan.removedLinkCount, 0)),
          );
        } else {
          pruneFailed = true;
        }
      }
    }

    let recovered = 0;
    let recoveryAvailable = false;
    let recoveryRan = false;
    if (identities.length > 0) {
      try {
        const plugins =
          this.app && this.app.plugins && this.app.plugins.plugins;
        const holder = plugins && plugins["task-status-cycler"];
        const api = holder && holder.api;
        if (
          api &&
          typeof api.recoverBlockedDependents === "function" &&
          Number(api.version) >= 1
        ) {
          recoveryAvailable = true;
          recoveryRan = true;
          const result = await api.recoverBlockedDependents(identities, {
            activePath: details.activePath,
            editor: details.editor,
          });
          recovered = Math.max(
            0,
            Math.floor(numericOrDefault(result && result.reopened, 0)),
          );
        }
      } catch (_error) {
        recoveryRan = false;
        recovered = 0;
      }
    }

    return Object.freeze({
      pomodoroLinksRemoved,
      pruneFailed,
      recovered,
      recoveryAvailable,
      recoveryRan,
      postPruneDailyContent,
    });
  }
}
