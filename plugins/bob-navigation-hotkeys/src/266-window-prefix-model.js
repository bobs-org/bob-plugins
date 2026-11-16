// Pure model for the Ctrl+W window prefix. The live adapter converts Obsidian's
// WorkspaceTabs groups into this small, serializable snapshot:
// { activeLeafId, splits: [{ id, rect, leaves: [{ id, label?, pinned? }],
//   selectedLeafId, mostRecentLeafId?, recency? }] }.
const WINDOW_PREFIX_EDGE_EPSILON = 0.5;
const WINDOW_PREFIX_KEY_ALIASES = Object.freeze({
  ArrowLeft: "h",
  ArrowRight: "l",
  Esc: "Escape",
});
const WINDOW_PREFIX_CANCEL_KEYS = Object.freeze([
  Object.freeze({ key: "Escape", label: "Cancel" }),
  Object.freeze({ key: "Ctrl+[", label: "Cancel" }),
  Object.freeze({ key: "q", label: "Cancel" }),
]);

function normalizeWindowPrefixRect(rect) {
  if (!rect || typeof rect !== "object") return null;
  const left = Number.isFinite(rect.left) ? rect.left : rect.x;
  const top = Number.isFinite(rect.top) ? rect.top : rect.y;
  const right = Number.isFinite(rect.right)
    ? rect.right
    : Number.isFinite(left) && Number.isFinite(rect.width)
      ? left + rect.width
      : NaN;
  const bottom = Number.isFinite(rect.bottom)
    ? rect.bottom
    : Number.isFinite(top) && Number.isFinite(rect.height)
      ? top + rect.height
      : NaN;
  if (![left, top, right, bottom].every(Number.isFinite)) return null;
  if (right < left || bottom < top) return null;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function normalizeWindowPrefixLeaf(leaf) {
  const value = typeof leaf === "string" ? { id: leaf } : leaf;
  if (!value || typeof value !== "object") return null;
  const id = value.id ?? value.leafId ?? value.path;
  if (typeof id !== "string" && typeof id !== "number") return null;
  const normalizedId = String(id);
  if (!normalizedId) return null;
  const label = value.label ?? value.basename ?? value.name ?? value.path ?? normalizedId;
  return { id: normalizedId, label: String(label), pinned: value.pinned === true };
}

function normalizeWindowPrefixSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.splits) || snapshot.splits.length === 0) {
    return null;
  }
  const splitIds = new Set();
  const leafIds = new Set();
  const splits = [];
  for (const rawSplit of snapshot.splits) {
    if (!rawSplit || typeof rawSplit.id !== "string" || !rawSplit.id) return null;
    if (splitIds.has(rawSplit.id) || !Array.isArray(rawSplit.leaves) || rawSplit.leaves.length === 0) {
      return null;
    }
    splitIds.add(rawSplit.id);
    const rect = normalizeWindowPrefixRect(rawSplit.rect);
    if (!rect) return null;
    const leaves = rawSplit.leaves.map(normalizeWindowPrefixLeaf);
    if (leaves.some((leaf) => !leaf)) return null;
    for (const leaf of leaves) {
      if (leafIds.has(leaf.id)) return null;
      leafIds.add(leaf.id);
    }
    const selectedLeafId = rawSplit.selectedLeafId == null
      ? leaves[0]?.id ?? null
      : String(rawSplit.selectedLeafId);
    if (selectedLeafId != null && !leaves.some((leaf) => leaf.id === selectedLeafId)) {
      return null;
    }
    const mostRecentLeafId = rawSplit.mostRecentLeafId == null
      ? null
      : String(rawSplit.mostRecentLeafId);
    if (mostRecentLeafId != null && !leaves.some((leaf) => leaf.id === mostRecentLeafId)) {
      return null;
    }
    splits.push({
      id: rawSplit.id,
      rect,
      leaves,
      selectedLeafId,
      mostRecentLeafId,
      recency: Number.isFinite(rawSplit.recency) ? rawSplit.recency : 0,
    });
  }
  const activeLeafId = snapshot.activeLeafId == null ? null : String(snapshot.activeLeafId);
  const activeSplitId = snapshot.activeSplitId == null ? null : String(snapshot.activeSplitId);
  let sourceSplit = activeLeafId == null
    ? null
    : splits.find((split) => split.leaves.some((leaf) => leaf.id === activeLeafId));
  if (!sourceSplit && activeSplitId) sourceSplit = splits.find((split) => split.id === activeSplitId);
  const resolvedActiveLeafId = activeLeafId ?? sourceSplit?.selectedLeafId ?? null;
  if (!sourceSplit || resolvedActiveLeafId == null ||
      !sourceSplit.leaves.some((leaf) => leaf.id === resolvedActiveLeafId)) {
    return null;
  }
  return { splits, activeLeafId: resolvedActiveLeafId, activeSplitId: sourceSplit.id };
}

function windowPrefixActiveSplit(layout) {
  return layout.splits.find((split) => split.id === layout.activeSplitId) ?? null;
}

function windowPrefixLeaf(split, leafId) {
  return split?.leaves.find((leaf) => leaf.id === leafId) ?? null;
}

function windowPrefixLeafLabel(layout, leafId) {
  for (const split of layout.splits) {
    const leaf = windowPrefixLeaf(split, leafId);
    if (leaf) return leaf.label;
  }
  return String(leafId ?? "split");
}

function windowPrefixReadingOrder(splits) {
  return [...splits].sort((left, right) =>
    left.rect.left - right.rect.left ||
    left.rect.top - right.rect.top ||
    left.rect.right - right.rect.right ||
    left.rect.bottom - right.rect.bottom ||
    left.id.localeCompare(right.id),
  );
}

function windowPrefixDirectionalNeighbor(layout, source, direction) {
  if (direction !== "left" && direction !== "right") return null;
  const candidates = [];
  for (const candidate of layout.splits) {
    if (candidate.id === source.id) continue;
    const verticalOverlap = Math.max(
      0,
      Math.min(source.rect.bottom, candidate.rect.bottom) -
        Math.max(source.rect.top, candidate.rect.top),
    );
    if (verticalOverlap <= 0) continue;
    const gap = direction === "left"
      ? source.rect.left - candidate.rect.right
      : candidate.rect.left - source.rect.right;
    if (gap < -WINDOW_PREFIX_EDGE_EPSILON) continue;
    candidates.push({ split: candidate, gap: Math.max(0, gap), verticalOverlap });
  }
  candidates.sort((left, right) =>
    left.gap - right.gap ||
    right.verticalOverlap - left.verticalOverlap ||
    right.split.recency - left.split.recency ||
    left.split.id.localeCompare(right.split.id),
  );
  return candidates[0]?.split ?? null;
}

function windowPrefixPlanError(key, reason) {
  return {
    ok: false,
    available: false,
    action: "unavailable",
    key,
    reason,
    preview: reason === "invalid-layout" ? "layout unavailable" : "window unavailable",
    consequence: null,
  };
}

function windowPrefixPlanNoop(key, source, layout, reason, preview) {
  return {
    ok: true,
    available: false,
    action: "noop",
    key,
    sourceSplitId: source?.id ?? null,
    activeLeafId: layout?.activeLeafId ?? null,
    reason,
    preview,
    consequence: null,
  };
}

function planWindowPrefixFocus(snapshot, direction) {
  const key = direction === "left" ? "h" : direction === "right" ? "l" : "w";
  const layout = normalizeWindowPrefixSnapshot(snapshot);
  if (!layout) return windowPrefixPlanError(key, "invalid-layout");
  const source = windowPrefixActiveSplit(layout);
  let target = null;
  if (direction === "next") {
    const order = windowPrefixReadingOrder(layout.splits);
    const index = order.findIndex((split) => split.id === source.id);
    if (order.length > 1) target = order[(index + 1) % order.length];
  } else {
    target = windowPrefixDirectionalNeighbor(layout, source, direction);
  }
  if (!target) {
    const reason = direction === "next" ? "only-one-split" : `at-${direction}-edge`;
    const preview = direction === "next" ? "only split" : `already at ${direction} edge`;
    return windowPrefixPlanNoop(key, source, layout, reason, preview);
  }
  const targetLeafId = target.selectedLeafId;
  return {
    ok: true,
    available: true,
    action: "focus",
    key,
    direction,
    sourceSplitId: source.id,
    targetSplitId: target.id,
    targetLeafId,
    preview: `focus ${windowPrefixLeafLabel(layout, targetLeafId)}`,
    consequence: null,
  };
}

function planWindowPrefixMove(snapshot, direction) {
  const key = direction === "left" ? "H" : "L";
  const layout = normalizeWindowPrefixSnapshot(snapshot);
  if (!layout) return windowPrefixPlanError(key, "invalid-layout");
  const source = windowPrefixActiveSplit(layout);
  const movedLeaf = windowPrefixLeaf(source, layout.activeLeafId);
  const sourceAfter = source.leaves.filter((leaf) => leaf.id !== movedLeaf.id);
  const neighbor = windowPrefixDirectionalNeighbor(layout, source, direction);
  if (!neighbor && sourceAfter.length === 0) {
    if (layout.splits.length === 1) {
      return windowPrefixPlanNoop(
        key, source, layout, "only-tab-in-layout", "only tab here · v splits",
      );
    }
    return windowPrefixPlanNoop(
      key, source, layout, `at-${direction}-edge`, `already at ${direction} edge`,
    );
  }
  const sourceSelectedLeafId = sourceAfter.length === 0
    ? null
    : sourceAfter.some((leaf) => leaf.id === source.mostRecentLeafId)
      ? source.mostRecentLeafId
      : sourceAfter[0].id;
  if (!neighbor) {
    return {
      ok: true,
      available: true,
      action: "create-split",
      key,
      direction,
      sourceSplitId: source.id,
      targetSplitId: null,
      movedLeafId: movedLeaf.id,
      destinationIndex: 0,
      sourceSelectedLeafId,
      sourceCollapsed: false,
      preservePinned: movedLeaf.pinned,
      preview: `create a split ${direction}`,
      consequence: `creates a split ${direction}`,
    };
  }
  const destinationPinnedCount = neighbor.leaves.filter((leaf) => leaf.pinned).length;
  const destinationSelectedIndex = neighbor.leaves.findIndex(
    (leaf) => leaf.id === neighbor.selectedLeafId,
  );
  const destinationIndex = movedLeaf.pinned
    ? destinationPinnedCount
    : Math.max(destinationSelectedIndex + 1, destinationPinnedCount);
  const sourceCollapsed = sourceAfter.length === 0;
  const destinationLabel = windowPrefixLeafLabel(layout, neighbor.selectedLeafId);
  return {
    ok: true,
    available: true,
    action: "join",
    key,
    direction,
    sourceSplitId: source.id,
    targetSplitId: neighbor.id,
    movedLeafId: movedLeaf.id,
    destinationIndex,
    sourceSelectedLeafId,
    sourceCollapsed,
    preservePinned: movedLeaf.pinned,
    preview: `join ${destinationLabel}`,
    consequence: sourceCollapsed ? "closes this split" : null,
  };
}

function planWindowPrefixSplit(snapshot) {
  const layout = normalizeWindowPrefixSnapshot(snapshot);
  if (!layout) return windowPrefixPlanError("v", "invalid-layout");
  const source = windowPrefixActiveSplit(layout);
  return {
    ok: true,
    available: true,
    action: "duplicate",
    key: "v",
    sourceSplitId: source.id,
    sourceLeafId: layout.activeLeafId,
    direction: "right",
    preview: `split right · ${windowPrefixLeafLabel(layout, layout.activeLeafId)}`,
    consequence: "opens a duplicate in a new split",
  };
}

const WINDOW_PREFIX_KEY_TABLE = Object.freeze([
  Object.freeze({ key: "h", aliases: Object.freeze(["ArrowLeft"]), group: "focus", label: "Focus left split", plan: (snapshot) => planWindowPrefixFocus(snapshot, "left") }),
  Object.freeze({ key: "l", aliases: Object.freeze(["ArrowRight"]), group: "focus", label: "Focus right split", plan: (snapshot) => planWindowPrefixFocus(snapshot, "right") }),
  Object.freeze({ key: "w", aliases: Object.freeze(["Ctrl+W"]), group: "focus", label: "Focus next split", plan: (snapshot) => planWindowPrefixFocus(snapshot, "next") }),
  Object.freeze({ key: "H", aliases: Object.freeze([]), group: "move", label: "Move tab left", plan: (snapshot) => planWindowPrefixMove(snapshot, "left") }),
  Object.freeze({ key: "L", aliases: Object.freeze([]), group: "move", label: "Move tab right", plan: (snapshot) => planWindowPrefixMove(snapshot, "right") }),
  Object.freeze({ key: "v", aliases: Object.freeze([]), group: "split", label: "Split right", plan: planWindowPrefixSplit }),
]);
const WINDOW_PREFIX_KEY_LOOKUP = new Map(
  WINDOW_PREFIX_KEY_TABLE.flatMap((entry) => [
    [entry.key, entry],
    ...entry.aliases.map((alias) => [alias, entry]),
  ]),
);

function canonicalWindowPrefixKey(key) {
  if (typeof key !== "string") return null;
  if (key === "Ctrl+W") return "w";
  return WINDOW_PREFIX_KEY_ALIASES[key] ?? key;
}

function planWindowPrefixKey(snapshot, key) {
  const canonical = canonicalWindowPrefixKey(key);
  if (canonical === "Escape" || canonical === "q" || canonical === "Ctrl+[") {
    return {
      ok: true,
      available: true,
      action: "cancel",
      key: canonical,
      preview: "cancel window prefix",
      consequence: null,
    };
  }
  const entry = WINDOW_PREFIX_KEY_LOOKUP.get(canonical);
  if (!entry) {
    return {
      ok: true,
      available: false,
      action: "unmapped",
      key: canonical,
      reason: "not-a-window-key",
      preview: `${canonical ?? "key"} isn't a window key`,
      consequence: null,
    };
  }
  return entry.plan(snapshot);
}

function normalizeWindowPrefixKeydown(event) {
  const key = typeof event?.key === "string" ? event.key : "";
  const code = typeof event?.code === "string" ? event.code : "";
  if (["Shift", "Control", "Alt", "Meta", "OS", "CapsLock", "Fn"].includes(key)) {
    return { kind: "ignore", reason: "modifier-only" };
  }
  if (event?.repeat) return { kind: "ignore", reason: "repeat" };
  if (event?.isComposing || event?.keyCode === 229) {
    return { kind: "ignore", reason: "composition" };
  }
  if (event?.metaKey || event?.altKey) {
    return { kind: "pass-through", cancel: true, reason: "meta-or-alt" };
  }
  let normalizedKey = key;
  if (!normalizedKey || normalizedKey.length !== 1 || /[\u0000-\u001f\u007f]/.test(normalizedKey)) {
    const letter = /^Key([A-Z])$/.exec(code);
    if (letter) normalizedKey = event?.shiftKey ? letter[1] : letter[1].toLowerCase();
    else if (event?.ctrlKey && code === "BracketLeft") normalizedKey = "[";
  }
  if (normalizedKey === "Esc" || normalizedKey === "Escape") {
    return { kind: "cancel", key: "Escape", consume: true };
  }
  if ((event?.ctrlKey && normalizedKey === "[") ||
      (event?.ctrlKey && code === "BracketLeft")) {
    return { kind: "cancel", key: "Ctrl+[", consume: true };
  }
  if (normalizedKey.toLowerCase() === "q") {
    return { kind: "cancel", key: "q", consume: true };
  }
  const canonical = canonicalWindowPrefixKey(normalizedKey);
  if (WINDOW_PREFIX_KEY_LOOKUP.has(canonical)) {
    return { kind: "mapped", key: canonical, inputKey: normalizedKey, consume: true };
  }
  if (normalizedKey.length === 1) {
    return { kind: "unmapped", key: normalizedKey, consume: true };
  }
  return { kind: "pass-through", cancel: true, reason: "non-printable" };
}

function windowPrefixVimBufferIsEmpty(buffer) {
  if (Array.isArray(buffer)) return buffer.length === 0;
  if (typeof buffer === "string") return buffer.length === 0;
  return buffer == null;
}

function getWindowPrefixArmingVerdict(context) {
  const input = context ?? {};
  const key = String(input.key ?? "");
  const isCtrlW = input.ctrlKey === true &&
    (key.toLowerCase() === "w" || input.code === "KeyW");
  if (!isCtrlW) return { allowed: false, reason: "not-ctrl-w" };
  if (input.shiftKey || input.altKey || input.metaKey) {
    return { allowed: false, reason: "modified-ctrl-w" };
  }
  if (input.repeat) return { allowed: false, reason: "repeat" };
  if (input.isComposing || input.keyCode === 229) {
    return { allowed: false, reason: "composition" };
  }
  if (input.defaultPrevented) {
    return { allowed: false, reason: "default-prevented" };
  }
  if (input.isMainWindow !== true) {
    return { allowed: false, reason: "not-main-window" };
  }
  if (input.activeLeafInRootSplit !== true) {
    return { allowed: false, reason: "no-main-area-leaf" };
  }
  if (input.inModal || input.inPrompt || input.inMenu || input.inSuggestion ||
      input.inHoverPopover || input.inCommandMode || input.inBobCard) {
    return { allowed: false, reason: "blocked-overlay" };
  }
  if (input.isMarkdownEditor === true) {
    if (input.vimMode !== "normal" && input.vimMode !== "visual") {
      return { allowed: false, reason: "vim-mode" };
    }
    if (input.vimOperatorPending || input.vimCountPending ||
        input.pendingVimInput || !windowPrefixVimBufferIsEmpty(input.vimKeyBuffer)) {
      return { allowed: false, reason: "pending-vim-input" };
    }
    return { allowed: true, reason: "vim-navigation" };
  }
  if (input.isEditable !== false) {
    return { allowed: false, reason: "editable-or-unknown-focus" };
  }
  return { allowed: true, reason: "non-editable-view" };
}

function buildWindowPrefixViewModel(snapshot) {
  const layout = normalizeWindowPrefixSnapshot(snapshot);
  if (!layout) {
    return {
      ok: false,
      reason: "invalid-layout",
      splitCount: 0,
      activeSplitId: null,
      splits: [],
      groups: [],
      cancelKeys: WINDOW_PREFIX_CANCEL_KEYS,
    };
  }
  const allLeft = Math.min(...layout.splits.map((split) => split.rect.left));
  const allRight = Math.max(...layout.splits.map((split) => split.rect.right));
  const totalWidth = Math.max(1, allRight - allLeft);
  const splitView = windowPrefixReadingOrder(layout.splits).map((split) => {
    const selected = windowPrefixLeaf(split, split.selectedLeafId);
    return {
      id: split.id,
      label: selected?.label ?? split.id,
      tabCount: split.leaves.length,
      selectedLeafId: split.selectedLeafId,
      active: split.id === layout.activeSplitId,
      rect: { ...split.rect },
      widthRatio: split.rect.width / totalWidth,
    };
  });
  const rows = WINDOW_PREFIX_KEY_TABLE.map((entry) => {
    const plan = entry.plan(snapshot);
    return {
      key: entry.key,
      aliases: [...entry.aliases],
      group: entry.group,
      label: entry.label,
      available: plan.available === true,
      preview: plan.preview,
      reason: plan.reason ?? null,
      consequence: plan.consequence ?? null,
      plan,
    };
  });
  const groups = [
    { id: "focus", label: "FOCUS" },
    { id: "move", label: "MOVE" },
    { id: "split", label: "SPLIT" },
  ].map((group) => ({
    ...group,
    rows: rows.filter((row) => row.group === group.id),
  }));
  return {
    ok: true,
    splitCount: layout.splits.length,
    activeSplitId: layout.activeSplitId,
    activeLeafId: layout.activeLeafId,
    splits: splitView,
    groups,
    rows,
    cancelKeys: WINDOW_PREFIX_CANCEL_KEYS,
  };
}
