function windowPrefixFocusTabFailureMessage(tabNumber, restored) {
  const n = String(tabNumber);
  return restored
    ? "Couldn't jump to tab " + n + " · focus restored"
    : "Couldn't jump to tab " + n + " · check the layout";
}

function windowPrefixShowFocusTabFailure(tabNumber, restored) {
  try { new Notice(windowPrefixFocusTabFailureMessage(tabNumber, restored)); } catch (_error) {
    // Notice is best effort in tests and during unload.
  }
}

function windowPrefixLeafParents(leaves) {
  const map = new Map();
  for (const leaf of leaves) map.set(leaf, windowPrefixLeafParent(leaf));
  return map;
}

function windowPrefixSameParents(before, leaves) {
  if (!(before instanceof Map) || before.size !== leaves.length) return false;
  for (const leaf of leaves) {
    if (!before.has(leaf)) return false;
    if (before.get(leaf) !== windowPrefixLeafParent(leaf)) return false;
  }
  return true;
}

class BobNavigationHotkeysWindowTabActionsMixin {
  async executeWindowPrefixFocusTab(plan, sourceLeaf, armed = {}) {
    const run = () => this.executeWindowPrefixFocusTabNow(plan, sourceLeaf, armed);
    const queued = (this.windowPrefixFocusTabTail || Promise.resolve())
      .catch(() => {})
      .then(run);
    this.windowPrefixFocusTabTail = queued;
    return queued;
  }

  async executeWindowPrefixFocusTabNow(plan, sourceLeaf, armed = {}) {
    const workspace = this.app?.workspace;
    const tabNumber = plan?.tabNumber;
    if (!workspace || !plan || plan.action !== "focus-tab") {
      return { ok: false, reason: "execution-failed" };
    }
    const isCurrent = typeof armed.isCurrent === "function" ? armed.isCurrent : () => true;

    if (plan.alreadyHere) {
      if (!isCurrent()) {
        return { ok: false, reason: "superseded" };
      }
      return {
        ok: true,
        action: "focus-tab",
        tabNumber,
        leafId: plan.targetLeafId,
        targetSplitId: plan.targetSplitId,
        crossSplit: plan.crossSplit === true,
        alreadyHere: true,
      };
    }

    const target = this.windowPrefixLeafById.get(plan.targetLeafId);
    if (!target) {
      windowPrefixShowFocusTabFailure(tabNumber, false);
      return { ok: false, reason: "execution-failed", restored: false };
    }

    const sourceGroup = windowPrefixLeafParent(sourceLeaf);
    const targetGroup = windowPrefixLeafParent(target);
    const sourceSelectedBefore = sourceGroup
      ? windowPrefixSelectedLeaf(workspace, sourceGroup, [...(sourceGroup.children || [])])
      : null;
    const beforeLeaves = windowPrefixRootLeaves(workspace);
    const beforeParents = windowPrefixLeafParents(beforeLeaves);

    try {
      if (typeof target.loadIfDeferred === "function") {
        await target.loadIfDeferred();
      }
      if (!isCurrent()) {
        return { ok: false, reason: "superseded" };
      }
      workspace.setActiveLeaf(target, { focus: true });
      if (workspace.activeLeaf !== target) {
        await windowPrefixNextFrame();
        if (!isCurrent()) {
          return { ok: false, reason: "superseded" };
        }
        workspace.setActiveLeaf(target, { focus: true });
      }

      const afterLeaves = windowPrefixRootLeaves(workspace);
      const afterParent = windowPrefixLeafParent(target);
      const selected = afterParent
        ? windowPrefixSelectedLeaf(workspace, afterParent, [...(afterParent.children || [])])
        : null;
      const sourceSelectedAfter = sourceGroup
        ? windowPrefixSelectedLeaf(workspace, sourceGroup, [...(sourceGroup.children || [])])
        : null;
      const sourceSelectionOk = plan.crossSplit !== true
        || sourceSelectedAfter === sourceSelectedBefore;
      const valid = workspace.activeLeaf === target
        && afterParent === targetGroup
        && selected === target
        && windowPrefixSameItems(beforeLeaves, afterLeaves)
        && windowPrefixSameParents(beforeParents, afterLeaves)
        && sourceSelectionOk;
      if (!valid) {
        throw new Error("tab jump did not satisfy the layout invariants");
      }
      try {
        const header = target.tabHeaderEl;
        if (header && typeof header.scrollIntoView === "function") {
          header.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
      } catch (_error) {
        // Clipped-header scrolling is best-effort and must never undo a good jump.
      }
      return {
        ok: true,
        action: "focus-tab",
        tabNumber,
        leafId: plan.targetLeafId,
        targetSplitId: plan.targetSplitId,
        crossSplit: plan.crossSplit === true,
        alreadyHere: false,
      };
    } catch (error) {
      let restored = false;
      try {
        if (sourceLeaf && typeof workspace.setActiveLeaf === "function") {
          workspace.setActiveLeaf(sourceLeaf, { focus: true });
          restored = workspace.activeLeaf === sourceLeaf;
        }
      } catch (_error) {
        restored = false;
      }
      windowPrefixShowFocusTabFailure(tabNumber, restored);
      return {
        ok: false,
        reason: "execution-failed",
        error: String(error?.message || error),
        restored,
      };
    }
  }
}
