function windowPrefixLeafParent(leaf) {
  return leaf && (leaf.parent || leaf.parentSplit) || null;
}

function windowPrefixRootLeaves(workspace) {
  if (!workspace || typeof workspace.iterateRootLeaves !== "function") return [];
  const leaves = [];
  workspace.iterateRootLeaves((leaf) => {
    if (leaf && !leaves.includes(leaf)) leaves.push(leaf);
  });
  return leaves;
}

function windowPrefixIsInRoot(leaf, rootSplit) {
  if (!leaf || !rootSplit) return false;
  let current = windowPrefixLeafParent(leaf);
  const seen = new Set();
  while (current && !seen.has(current)) {
    if (current === rootSplit) return true;
    seen.add(current);
    current = current.parent || current.parentSplit || null;
  }
  return false;
}

function windowPrefixLayoutGroups(leaves) {
  const groups = [];
  const seen = new Set();
  for (const leaf of leaves) {
    const parent = windowPrefixLeafParent(leaf);
    if (!parent || seen.has(parent)) continue;
    seen.add(parent);
    groups.push(parent);
  }
  return groups;
}

function windowPrefixGroupCanMove(group) {
  return Boolean(
    group && Array.isArray(group.children) &&
    typeof group.removeChild === "function" &&
    typeof group.insertChild === "function" &&
    typeof group.selectTab === "function",
  );
}

function windowPrefixTreeCanReattach(group, rootSplit) {
  let child = group;
  const seen = new Set();
  while (child && child !== rootSplit && !seen.has(child)) {
    seen.add(child);
    const parent = child.parent || child.parentSplit || null;
    if (!parent || !Array.isArray(parent.children) ||
        typeof parent.insertChild !== "function") return false;
    child = parent;
  }
  return child === rootSplit;
}

function inspectWindowPrefixLayoutApis(workspace, leaf, groups = null) {
  const rootGroups = Array.isArray(groups)
    ? groups
    : leaf
      ? [windowPrefixLeafParent(leaf)]
      : [];
  const hasRootAdapter = Boolean(
    workspace && workspace.rootSplit &&
    typeof workspace.iterateRootLeaves === "function",
  );
  const canFocus = Boolean(
    hasRootAdapter && typeof workspace.setActiveLeaf === "function",
  );
  const canMove = Boolean(
    canFocus && rootGroups.length > 0 && rootGroups.every(windowPrefixGroupCanMove) &&
    rootGroups.every((group) => windowPrefixTreeCanReattach(group, workspace.rootSplit)) &&
    typeof workspace.getMostRecentLeaf === "function" &&
    typeof workspace.onLayoutChange === "function" &&
    typeof workspace.requestSaveLayout === "function",
  );
  const canCreateSplit = Boolean(
    canMove && typeof workspace.createLeafBySplit === "function" &&
    leaf && typeof leaf.detach === "function",
  );
  const sourceGroup = leaf ? windowPrefixLeafParent(leaf) : null;
  const splitParent = sourceGroup?.parent || sourceGroup?.parentSplit || null;
  const canCreateSplitLeft = Boolean(
    canCreateSplit && splitParent && Array.isArray(splitParent.children) &&
    splitParent.children.includes(sourceGroup) &&
    typeof splitParent.recomputeChildrenDimensions === "function",
  );
  const canDuplicate = Boolean(
    canFocus && typeof workspace.duplicateLeaf === "function",
  );
  const missing = {
    focus: [],
    move: [],
    createSplit: [],
    createSplitLeft: [],
    duplicate: [],
  };
  if (!hasRootAdapter) missing.focus.push("main-area layout adapter");
  if (typeof workspace?.setActiveLeaf !== "function") missing.focus.push("setActiveLeaf");
  if (!rootGroups.length || rootGroups.some((group) => !Array.isArray(group?.children))) {
    missing.move.push("WorkspaceTabs children");
  }
  if (rootGroups.some((group) => typeof group?.removeChild !== "function")) {
    missing.move.push("WorkspaceTabs.removeChild");
  }
  if (rootGroups.some((group) => typeof group?.insertChild !== "function")) {
    missing.move.push("WorkspaceTabs.insertChild");
  }
  if (rootGroups.some((group) => typeof group?.selectTab !== "function")) {
    missing.move.push("WorkspaceTabs.selectTab");
  }
  if (rootGroups.some((group) => !windowPrefixTreeCanReattach(group, workspace?.rootSplit))) {
    missing.move.push("WorkspaceSplit.insertChild");
  }
  if (typeof workspace?.getMostRecentLeaf !== "function") missing.move.push("getMostRecentLeaf");
  if (typeof workspace?.onLayoutChange !== "function") missing.move.push("onLayoutChange");
  if (typeof workspace?.requestSaveLayout !== "function") missing.move.push("requestSaveLayout");
  if (typeof workspace?.createLeafBySplit !== "function") missing.createSplit.push("createLeafBySplit");
  if (typeof leaf?.detach !== "function") missing.createSplit.push("placeholder detach");
  if (!canCreateSplitLeft) {
    missing.createSplitLeft.push("sibling split ordering and dimension recomputation");
  }
  if (typeof workspace?.duplicateLeaf !== "function") missing.duplicate.push("duplicateLeaf");
  return {
    capabilities: {
      focus: canFocus,
      move: canMove,
      createSplit: canCreateSplit,
      createSplitLeft: canCreateSplitLeft,
      duplicate: canDuplicate,
    },
    missing,
  };
}

function windowPrefixReadRect(group) {
  try {
    const rect = group?.containerEl?.getBoundingClientRect?.();
    if (!rect) return null;
    const left = Number(rect.left);
    const top = Number(rect.top);
    const width = Number(rect.width);
    const height = Number(rect.height);
    const right = Number.isFinite(Number(rect.right)) ? Number(rect.right) : left + width;
    const bottom = Number.isFinite(Number(rect.bottom)) ? Number(rect.bottom) : top + height;
    if (![left, top, right, bottom, width, height].every(Number.isFinite)) return null;
    return { left, top, right, bottom, width, height };
  } catch (_error) {
    return null;
  }
}

function windowPrefixLiveLeafLabel(leaf) {
  try {
    if (typeof leaf?.getDisplayText === "function") {
      const text = leaf.getDisplayText();
      if (text) return String(text);
    }
  } catch (_error) {
    // A partial/deferred view may not have a title yet.
  }
  try {
    const file = leaf?.view?.file;
    if (file?.basename) return String(file.basename);
    if (file?.path) return String(file.path).split("/").pop().replace(/\.[^.]+$/, "");
  } catch (_error) {
    // Fall through to the view type or a stable leaf label.
  }
  try {
    if (typeof leaf?.view?.getViewType === "function") return String(leaf.view.getViewType());
  } catch (_error) {
    // Fall through.
  }
  return "Untitled tab";
}

function windowPrefixSelectedLeaf(workspace, group, leaves) {
  const contains = (candidate) => candidate && leaves.includes(candidate);
  try {
    if (contains(group?.selectedTab)) return group.selectedTab;
  } catch (_error) {
    // Use the workspace recency API below.
  }
  try {
    if (contains(group?.currentTab)) return group.currentTab;
  } catch (_error) {
    // Use the workspace recency API below.
  }
  try {
    const recent = workspace?.getMostRecentLeaf?.(group);
    if (contains(recent)) return recent;
  } catch (_error) {
    // Keep a deterministic fallback for an incomplete Obsidian API.
  }
  return leaves[0] ?? null;
}

function windowPrefixCaptureAncestorChain(group, rootSplit) {
  const chain = [];
  let child = group;
  const seen = new Set();
  while (child && child !== rootSplit && !seen.has(child)) {
    seen.add(child);
    const parent = child.parent || child.parentSplit || null;
    const children = parent?.children;
    if (!parent || !Array.isArray(children)) return null;
    const index = children.indexOf(child);
    if (index < 0) return null;
    chain.unshift({ parent, child, index });
    child = parent;
  }
  return child === rootSplit ? chain : null;
}

function windowPrefixRecomputeGroup(group) {
  if (group?.children?.length && typeof group.recomputeChildrenDimensions === "function") {
    group.recomputeChildrenDimensions();
  }
}

function windowPrefixNextFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function windowPrefixCaptureScroll(leaf) {
  const candidates = [
    leaf?.view?.editor?.cm?.scrollDOM,
    leaf?.view?.editor?.editor?.cm?.scrollDOM,
    leaf?.view?.containerEl,
  ];
  const element = candidates.find((candidate) => candidate &&
    Number.isFinite(candidate.scrollTop) && Number.isFinite(candidate.scrollLeft));
  return element
    ? { element, top: element.scrollTop, left: element.scrollLeft }
    : null;
}

function windowPrefixRestoreScroll(state) {
  if (!state?.element) return;
  try {
    state.element.scrollTop = state.top;
    state.element.scrollLeft = state.left;
  } catch (_error) {
    // A view may be in the middle of replacing its editor DOM.
  }
}

function windowPrefixSplitIsPlaced(sourceGroup, targetGroup, direction) {
  const sourceRect = windowPrefixReadRect(sourceGroup);
  const targetRect = windowPrefixReadRect(targetGroup);
  const sourceCenter = sourceRect && sourceRect.left + sourceRect.width / 2;
  const targetCenter = targetRect && targetRect.left + targetRect.width / 2;
  const placedCorrectly = direction === "left"
    ? targetCenter < sourceCenter
    : targetCenter > sourceCenter;
  return Number.isFinite(sourceCenter) && Number.isFinite(targetCenter) && placedCorrectly;
}

async function windowPrefixPutSplitBeside(workspace, sourceGroup, targetGroup, direction) {
  const parent = sourceGroup?.parent || sourceGroup?.parentSplit || null;
  const targetParent = targetGroup?.parent || targetGroup?.parentSplit || null;
  if (!parent || parent !== targetParent || !Array.isArray(parent.children)) {
    throw new Error("Obsidian did not expose sibling split ordering");
  }
  const children = parent.children;
  const targetIndex = children.indexOf(targetGroup);
  const sourceIndex = children.indexOf(sourceGroup);
  if (targetIndex < 0 || sourceIndex < 0) throw new Error("created split left its parent");
  children.splice(targetIndex, 1);
  const reorderedSourceIndex = children.indexOf(sourceGroup);
  children.splice(reorderedSourceIndex + (direction === "right" ? 1 : 0), 0, targetGroup);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (typeof parent.recomputeChildrenDimensions === "function") {
      parent.recomputeChildrenDimensions();
    }
    workspace.onLayoutChange();
    await windowPrefixNextFrame();
    if (windowPrefixSplitIsPlaced(sourceGroup, targetGroup, direction)) return;
  }
  throw new Error(`Obsidian did not place the new split ${direction}`);
}

async function windowPrefixUpdateLayout(workspace, groups, activeLeaf, scrollState = null) {
  const seen = new Set();
  for (const group of groups) {
    if (!group || seen.has(group)) continue;
    seen.add(group);
    windowPrefixRecomputeGroup(group);
  }
  workspace.onLayoutChange();
  workspace.setActiveLeaf(activeLeaf, { focus: true });
  if (workspace.activeLeaf !== activeLeaf) {
    await windowPrefixNextFrame();
    workspace.setActiveLeaf(activeLeaf, { focus: true });
  }
  if (workspace.activeLeaf !== activeLeaf) {
    throw new Error("Obsidian did not focus the requested tab");
  }
  windowPrefixRestoreScroll(scrollState);
  workspace.requestSaveLayout();
  await windowPrefixNextFrame();
  windowPrefixRestoreScroll(scrollState);
}

function windowPrefixRemoveLeaf(group, leaf) {
  if (!group || !Array.isArray(group.children) || !group.children.includes(leaf)) return;
  group.removeChild(leaf);
}

function windowPrefixInsertLeaf(group, index, leaf) {
  if (!group || !Array.isArray(group.children)) {
    throw new Error("tab group is no longer available");
  }
  const clamped = Math.max(0, Math.min(Number.isFinite(index) ? index : 0, group.children.length));
  group.insertChild(clamped, leaf);
}

function windowPrefixSameItems(left, right) {
  return left.length === right.length && left.every((item) => right.includes(item));
}

function windowPrefixRestoreSource(source, placeholder, sourceChain, sourceGroup,
    sourceIndex, sourceSelectedLeaf, targetGroup, targetSelectedLeaf, workspace) {
  let ok = true;
  try {
    if (placeholder) {
      const placeholderGroup = windowPrefixLeafParent(placeholder);
      if (placeholderGroup?.children?.includes(placeholder)) {
        try { placeholder.detach(); } catch (_error) { /* use the known owner below */ }
        if (placeholderGroup.children.includes(placeholder)) {
          try { placeholderGroup.removeChild(placeholder); } catch (_error) { ok = false; }
        }
      }
    }
  } catch (_error) {
    ok = false;
  }
  try {
    const movedParent = windowPrefixLeafParent(source);
    if (movedParent?.children?.includes(source)) {
      try { windowPrefixRemoveLeaf(movedParent, source); } catch (_error) { ok = false; }
    }
    if (placeholder && targetGroup?.children?.length === 0) {
      const targetOuter = targetGroup.parent || targetGroup.parentSplit;
      if (targetOuter?.children?.includes(targetGroup)) {
        try { targetOuter.removeChild(targetGroup); } catch (_error) { ok = false; }
      }
    }
    for (const link of sourceChain || []) {
      if (Array.isArray(link.parent.children) && !link.parent.children.includes(link.child)) {
        try { windowPrefixInsertLeaf(link.parent, link.index, link.child); } catch (_error) { ok = false; }
      }
    }
    if (!sourceGroup.children?.includes(source)) {
      try { windowPrefixInsertLeaf(sourceGroup, sourceIndex, source); } catch (_error) { ok = false; }
    }
    if (sourceSelectedLeaf && sourceGroup.children.includes(sourceSelectedLeaf)) {
      try { sourceGroup.selectTab(sourceSelectedLeaf); } catch (_error) { ok = false; }
    }
    if (targetSelectedLeaf && targetGroup?.children?.includes(targetSelectedLeaf)) {
      try { targetGroup.selectTab(targetSelectedLeaf); } catch (_error) { ok = false; }
    }
    const parents = [sourceGroup, targetGroup];
    const uniqueParents = [...new Set(parents.filter(Boolean))];
    try { workspace.onLayoutChange(); } catch (_error) { ok = false; }
    try { workspace.setActiveLeaf(source, { focus: true }); } catch (_error) { ok = false; }
    try { workspace.requestSaveLayout(); } catch (_error) { ok = false; }
    for (const group of uniqueParents) windowPrefixRecomputeGroup(group);
    const placeholderStillAttached = placeholder && windowPrefixLeafParent(placeholder)?.children?.includes(placeholder);
    return ok && workspace.activeLeaf === source && sourceGroup.children.includes(source) &&
      !placeholderStillAttached;
  } catch (_error) {
    return false;
  }
}

async function windowPrefixWaitForFile(leaf, expectedPath, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      if (leaf?.view?.file?.path === expectedPath) return true;
    } catch (_error) {
      // The duplicate view may not have mounted yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

class BobNavigationHotkeysWindowLayoutMixin {
  initializeWindowPrefixLayoutAdapter() {
    if (!(this.windowPrefixLeafIds instanceof WeakMap)) this.windowPrefixLeafIds = new WeakMap();
    if (!(this.windowPrefixSplitIds instanceof WeakMap)) this.windowPrefixSplitIds = new WeakMap();
    if (!Number.isFinite(this.windowPrefixIdSequence)) this.windowPrefixIdSequence = 0;
    const workspace = this.app?.workspace;
    const leaves = windowPrefixRootLeaves(workspace);
    this.windowPrefixApiCanary = inspectWindowPrefixLayoutApis(
      workspace,
      workspace?.activeLeaf,
      windowPrefixLayoutGroups(leaves),
    );
    this.windowPrefixLeafById = new Map();
    this.windowPrefixSplitById = new Map();
    return this.windowPrefixApiCanary;
  }

  getWindowPrefixObjectId(kind, object) {
    if (!object || (typeof object !== "object" && typeof object !== "function")) return null;
    if (!(this.windowPrefixLeafIds instanceof WeakMap)) this.windowPrefixLeafIds = new WeakMap();
    if (!(this.windowPrefixSplitIds instanceof WeakMap)) this.windowPrefixSplitIds = new WeakMap();
    const ids = kind === "split" ? this.windowPrefixSplitIds : this.windowPrefixLeafIds;
    let id = ids.get(object);
    if (!id) {
      this.windowPrefixIdSequence = (this.windowPrefixIdSequence || 0) + 1;
      id = `${kind}-${this.windowPrefixIdSequence}`;
      ids.set(object, id);
    }
    return id;
  }

  getWindowPrefixApiCanary() {
    const workspace = this.app?.workspace;
    const leaves = windowPrefixRootLeaves(workspace);
    const result = inspectWindowPrefixLayoutApis(
      workspace,
      workspace?.activeLeaf,
      windowPrefixLayoutGroups(leaves),
    );
    this.windowPrefixApiCanary = result;
    return result;
  }

  snapshotWindowPrefixLayout() {
    if (!(this.windowPrefixLeafIds instanceof WeakMap) ||
        !(this.windowPrefixSplitIds instanceof WeakMap)) {
      this.initializeWindowPrefixLayoutAdapter();
    }
    if (!(this.windowPrefixLeafById instanceof Map)) this.windowPrefixLeafById = new Map();
    if (!(this.windowPrefixSplitById instanceof Map)) this.windowPrefixSplitById = new Map();
    const workspace = this.app?.workspace;
    const rootSplit = workspace?.rootSplit;
    if (!workspace || !rootSplit || typeof workspace.iterateRootLeaves !== "function") return null;
    const activeLeaf = workspace.activeLeaf;
    if (!windowPrefixIsInRoot(activeLeaf, rootSplit)) return null;
    const leaves = windowPrefixRootLeaves(workspace).filter((leaf) =>
      windowPrefixIsInRoot(leaf, rootSplit),
    );
    if (!leaves.includes(activeLeaf)) return null;
    const groups = windowPrefixLayoutGroups(leaves);
    if (!groups.length) return null;

    const leafIds = new Map();
    const splitIds = new Map();
    const splitSnapshots = [];
    for (const group of groups) {
      const groupLeaves = leaves.filter((leaf) => windowPrefixLeafParent(leaf) === group);
      const rect = windowPrefixReadRect(group);
      if (!groupLeaves.length || !rect) return null;
      const groupId = this.getWindowPrefixObjectId("split", group);
      splitIds.set(group, groupId);
      this.windowPrefixSplitById.set(groupId, group);
      const snapshotLeaves = groupLeaves.map((leaf) => {
        const id = this.getWindowPrefixObjectId("leaf", leaf);
        leafIds.set(leaf, id);
        this.windowPrefixLeafById.set(id, leaf);
        let pinned = false;
        try { pinned = leaf.pinned === true; } catch (_error) { /* best effort */ }
        return { id, label: windowPrefixLiveLeafLabel(leaf), pinned };
      });
      const selected = windowPrefixSelectedLeaf(workspace, group, groupLeaves);
      let mostRecent = null;
      try { mostRecent = workspace.getMostRecentLeaf?.(group) ?? null; } catch (_error) { /* best effort */ }
      const selectedLeafId = selected ? leafIds.get(selected) : null;
      const mostRecentLeafId = groupLeaves.includes(mostRecent) ? leafIds.get(mostRecent) : selectedLeafId;
      splitSnapshots.push({
        id: groupId,
        rect,
        leaves: snapshotLeaves,
        selectedLeafId,
        mostRecentLeafId,
        recency: groups.indexOf(group),
      });
    }
    const api = inspectWindowPrefixLayoutApis(workspace, activeLeaf, groups);
    this.windowPrefixApiCanary = api;
    this.windowPrefixLeafById = new Map(
      [...leafIds.entries()].map(([leaf, id]) => [id, leaf]),
    );
    this.windowPrefixSplitById = new Map(
      [...splitIds.entries()].map(([group, id]) => [id, group]),
    );
    return {
      activeLeafId: leafIds.get(activeLeaf),
      splits: splitSnapshots,
      capabilities: api.capabilities,
    };
  }

  async focusWindowPrefixLeaf(leaf) {
    const workspace = this.app?.workspace;
    if (!workspace || !leaf || typeof workspace.setActiveLeaf !== "function") return false;
    workspace.setActiveLeaf(leaf, { focus: true });
    return workspace.activeLeaf === leaf;
  }

  showWindowPrefixActionFailure(restored) {
    const message = restored
      ? "Window action failed · layout restored"
      : "Window action failed · check the layout";
    try { new Notice(message); } catch (_error) { /* Notice is best effort in tests/unload */ }
  }

  async executeWindowPrefixPlan(plan, armed = {}) {
    if (!plan || plan.ok !== true || !plan.available ||
        ["noop", "cancel", "unmapped", "unavailable"].includes(plan.action)) {
      return { ok: true, skipped: true, plan };
    }
    const workspace = this.app?.workspace;
    const snapshot = this.snapshotWindowPrefixLayout();
    const normalized = normalizeWindowPrefixSnapshot(snapshot);
    if (!workspace || !normalized) return { ok: false, reason: "layout-changed" };
    const expectedLeafId = armed.activeLeafId ?? plan.sourceLeafId ?? plan.movedLeafId ?? normalized.activeLeafId;
    const expectedSplitId = armed.sourceSplitId ?? plan.sourceSplitId ?? normalized.activeSplitId;
    if (normalized.activeLeafId !== String(expectedLeafId) || normalized.activeSplitId !== expectedSplitId) {
      return { ok: false, reason: "layout-changed" };
    }
    const freshPlan = planWindowPrefixKey(snapshot, plan.key);
    if (!freshPlan || freshPlan.ok !== true || !freshPlan.available) {
      return { ok: false, reason: freshPlan?.reason ?? "layout-changed", plan: freshPlan };
    }
    const sourceLeaf = this.windowPrefixLeafById.get(normalized.activeLeafId);
    if (!sourceLeaf || sourceLeaf !== workspace.activeLeaf) return { ok: false, reason: "layout-changed" };

    try {
      if (freshPlan.action === "focus") {
        const target = this.windowPrefixLeafById.get(freshPlan.targetLeafId);
        const focused = target && await this.focusWindowPrefixLeaf(target);
        if (!focused) throw new Error("could not focus the target split");
        return { ok: true, action: "focus", leafId: freshPlan.targetLeafId };
      }
      if (freshPlan.action === "duplicate") {
        return await this.executeWindowPrefixDuplicate(freshPlan, sourceLeaf, snapshot);
      }
      if (freshPlan.action === "join" || freshPlan.action === "create-split") {
        return await this.executeWindowPrefixMove(freshPlan, sourceLeaf, snapshot);
      }
      return { ok: true, skipped: true, plan: freshPlan };
    } catch (error) {
      this.showWindowPrefixActionFailure(false);
      return { ok: false, reason: "execution-failed", error: String(error?.message || error) };
    }
  }

  async executeWindowPrefixDuplicate(plan, sourceLeaf) {
    const workspace = this.app?.workspace;
    if (typeof workspace?.duplicateLeaf !== "function") throw new Error("duplicateLeaf is unavailable");
    const before = windowPrefixRootLeaves(workspace);
    const beforeGroups = windowPrefixLayoutGroups(before);
    const sourceGroup = windowPrefixLeafParent(sourceLeaf);
    const sourcePath = sourceLeaf.view?.file?.path ?? null;
    let duplicate = null;
    let duplicateError = null;
    try {
      duplicate = await workspace.duplicateLeaf(sourceLeaf, "split", "vertical");
      if (duplicate && sourcePath) await windowPrefixWaitForFile(duplicate, sourcePath);
    } catch (error) {
      duplicateError = error;
    }
    const after = windowPrefixRootLeaves(workspace);
    const duplicateGroup = windowPrefixLeafParent(duplicate);
    const valid = Boolean(
      duplicate && duplicate !== sourceLeaf && before.length + 1 === after.length &&
      after.filter((leaf) => leaf === duplicate).length === 1 &&
      after.includes(sourceLeaf) && duplicateGroup && duplicateGroup !== sourceGroup &&
      (duplicate.view?.file?.path ?? null) === sourcePath &&
      workspace.activeLeaf === duplicate,
    );
    if (!valid) {
      let restored = false;
      try {
        const extras = windowPrefixRootLeaves(workspace).filter((leaf) => !before.includes(leaf));
        for (const extra of extras) {
          const owner = windowPrefixLeafParent(extra);
          if (!owner?.children?.includes(extra)) continue;
          try { extra.detach(); } catch (_error) {
            if (owner.children.includes(extra)) owner.removeChild(extra);
          }
        }
        workspace.setActiveLeaf(sourceLeaf, { focus: true });
        workspace.onLayoutChange?.();
        workspace.requestSaveLayout?.();
        restored = workspace.activeLeaf === sourceLeaf &&
          windowPrefixSameItems(windowPrefixRootLeaves(workspace), before) &&
          windowPrefixSameItems(windowPrefixLayoutGroups(windowPrefixRootLeaves(workspace)), beforeGroups);
      } catch (_error) {
        restored = false;
      }
      this.showWindowPrefixActionFailure(restored);
      return {
        ok: false,
        reason: "execution-failed",
        error: duplicateError ? String(duplicateError?.message || duplicateError) : undefined,
        restored,
        action: plan.action,
      };
    }
    workspace.onLayoutChange?.();
    workspace.requestSaveLayout?.();
    return {
      ok: true,
      action: "duplicate",
      sourceLeafId: plan.sourceLeafId,
      targetLeaf: duplicate,
    };
  }

  async executeWindowPrefixMove(plan, sourceLeaf) {
    const workspace = this.app?.workspace;
    const rootSplit = workspace?.rootSplit;
    const sourceGroup = windowPrefixLeafParent(sourceLeaf);
    const sourceChain = windowPrefixCaptureAncestorChain(sourceGroup, rootSplit);
    const sourceIndex = sourceGroup?.children?.indexOf(sourceLeaf) ?? -1;
    if (!workspace || !sourceGroup || sourceIndex < 0 || !sourceChain) {
      throw new Error("source split is no longer available");
    }
    const beforeLeaves = windowPrefixRootLeaves(workspace);
    const beforeGroups = windowPrefixLayoutGroups(beforeLeaves);
    const scrollState = windowPrefixCaptureScroll(sourceLeaf);
    const sourceSelectedLeaf = sourceGroup.selectedTab ?? sourceLeaf;
    const beforePinned = sourceLeaf.pinned === true;
    let targetGroup = plan.targetSplitId
      ? this.windowPrefixSplitById.get(plan.targetSplitId)
      : null;
    const targetSelectedLeaf = targetGroup?.selectedTab ?? null;
    let placeholder = null;
    let sourceSelection = null;
    try {
      if (plan.action === "create-split") {
        if (typeof workspace.createLeafBySplit !== "function") {
          throw new Error("createLeafBySplit is unavailable");
        }
        placeholder = workspace.createLeafBySplit(
          sourceLeaf,
          "vertical",
          plan.direction === "left",
        );
        if (placeholder && typeof placeholder.then === "function") placeholder = await placeholder;
        // Live Obsidian must never detach the moved tab if the split API
        // returned the source leaf instead of an empty placeholder.
        if (placeholder === sourceLeaf) placeholder = null;
        targetGroup = placeholder
          ? windowPrefixLeafParent(placeholder)
          : windowPrefixLeafParent(sourceLeaf);
        if (!targetGroup || targetGroup === sourceGroup ||
            !windowPrefixGroupCanMove(targetGroup)) {
          throw new Error("Obsidian did not create a usable split");
        }
      }
      if (!windowPrefixGroupCanMove(sourceGroup) || !windowPrefixGroupCanMove(targetGroup)) {
        throw new Error("Obsidian layout API changed");
      }
      const insertionIndex = plan.action === "create-split"
        ? 0
        : plan.destinationIndex;
      if (sourceGroup.children.includes(sourceLeaf)) sourceGroup.removeChild(sourceLeaf);
      if (targetGroup.children.includes(sourceLeaf)) {
        if (targetGroup.children.indexOf(sourceLeaf) !== insertionIndex) {
          targetGroup.removeChild(sourceLeaf);
          windowPrefixInsertLeaf(targetGroup, insertionIndex, sourceLeaf);
        }
      } else {
        windowPrefixInsertLeaf(targetGroup, insertionIndex, sourceLeaf);
      }
      targetGroup.selectTab(sourceLeaf);
      if (plan.action === "create-split") {
        await windowPrefixPutSplitBeside(workspace, sourceGroup, targetGroup, plan.direction);
      }
      if (placeholder && placeholder !== sourceLeaf &&
          targetGroup.children.includes(placeholder)) {
        placeholder.detach();
      }

      if (sourceGroup.children?.length) {
        let mostRecent = null;
        try { mostRecent = workspace.getMostRecentLeaf(sourceGroup); } catch (_error) { /* use current selection */ }
        const plannedRemaining = this.windowPrefixLeafById.get(plan.sourceSelectedLeafId);
        sourceSelection = sourceGroup.children.includes(mostRecent)
          ? mostRecent
          : sourceGroup.children.includes(sourceGroup.selectedTab)
            ? sourceGroup.selectedTab
            : sourceGroup.children.includes(plannedRemaining)
              ? plannedRemaining
              : sourceGroup.children[0];
        try { sourceGroup.selectTab(sourceSelection); } catch (_error) {
          // Remainder selection is best-effort; the moved tab is the active leaf.
        }
      }
      await windowPrefixUpdateLayout(workspace, [sourceGroup, targetGroup], sourceLeaf, scrollState);

      const afterLeaves = windowPrefixRootLeaves(workspace);
      const targetChildren = targetGroup.children;
      const sourceCollapsed = !windowPrefixLayoutGroups(afterLeaves).includes(sourceGroup);
      const expectedInsertion = plan.action === "create-split" ? 0 : plan.destinationIndex;
      const movedExactlyOnce = afterLeaves.filter((leaf) => leaf === sourceLeaf).length === 1;
      const sameLeafSet = beforeLeaves.length === afterLeaves.length &&
        beforeLeaves.every((leaf) => afterLeaves.includes(leaf));
      const parentIsTarget = windowPrefixLeafParent(sourceLeaf) === targetGroup;
      const insertionAt = targetChildren.indexOf(sourceLeaf);
      const targetSelected = windowPrefixSelectedLeaf(workspace, targetGroup, [...targetChildren]);
      const activeIsMoved = workspace.activeLeaf === sourceLeaf;
      const sourceStillHoldsTabs = !sourceCollapsed && sourceGroup.children.length > 0 &&
        !sourceGroup.children.includes(sourceLeaf);
      const sourceShapeValid = plan.sourceCollapsed ? sourceCollapsed : sourceStillHoldsTabs;
      const valid = movedExactlyOnce && sameLeafSet && parentIsTarget &&
        insertionAt === expectedInsertion && activeIsMoved &&
        sourceLeaf.pinned === beforePinned && sourceShapeValid;
      if (!valid) {
        throw new Error("tab move did not satisfy the layout invariants: " + JSON.stringify({
          movedExactlyOnce,
          sameLeafSet,
          parentIsTarget,
          insertionAt,
          expectedInsertion,
          activeIsMoved,
          pinnedPreserved: sourceLeaf.pinned === beforePinned,
          sourceShapeValid,
          sourceCollapsed,
          targetSelectedIsMoved: targetSelected === sourceLeaf,
          selectedTabIsMoved: targetGroup.selectedTab === sourceLeaf,
        }));
      }
      return {
        ok: true,
        action: plan.action,
        sourceLeafId: plan.movedLeafId,
        targetSplitId: plan.action === "create-split"
          ? this.getWindowPrefixObjectId("split", targetGroup)
          : plan.targetSplitId,
        sourceCollapsed,
      };
    } catch (error) {
      const restored = windowPrefixRestoreSource(
        sourceLeaf,
        placeholder,
        sourceChain,
        sourceGroup,
        sourceIndex,
        sourceSelectedLeaf,
        targetGroup,
        targetSelectedLeaf,
        workspace,
      );
      windowPrefixRestoreScroll(scrollState);
      await windowPrefixNextFrame();
      windowPrefixRestoreScroll(scrollState);
      const restoredLeaves = windowPrefixRootLeaves(workspace);
      const restoredGroups = windowPrefixLayoutGroups(restoredLeaves);
      const fullyRestored = restored && windowPrefixSameItems(restoredLeaves, beforeLeaves) &&
        windowPrefixSameItems(restoredGroups, beforeGroups);
      this.showWindowPrefixActionFailure(fullyRestored);
      return {
        ok: false,
        reason: "execution-failed",
        error: String(error?.message || error),
        restored: fullyRestored,
      };
    }
  }
}
