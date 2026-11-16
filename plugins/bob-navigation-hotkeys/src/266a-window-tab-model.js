const WINDOW_PREFIX_TAB_LIMIT = 9;

function windowPrefixTabCatalogSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.splits) || snapshot.splits.length === 0) {
    return null;
  }
  const rawLeafIds = new Set();
  for (const split of snapshot.splits) {
    if (!split || !Array.isArray(split.leaves)) return null;
    for (const leaf of split.leaves) {
      const value = typeof leaf === "string" ? leaf : leaf?.id ?? leaf?.leafId ?? leaf?.path;
      if (value == null) continue;
      rawLeafIds.add(String(value));
    }
  }
  const requestedActive = snapshot.activeLeafId == null
    ? null
    : String(snapshot.activeLeafId);
  const activeLeafId = requestedActive && rawLeafIds.has(requestedActive)
    ? requestedActive
    : null;
  const fallbackSplit = snapshot.splits[0];
  const fallbackLeaf = fallbackSplit.selectedLeafId == null
    ? fallbackSplit.leaves[0]
    : fallbackSplit.leaves.find((leaf) => {
        const id = typeof leaf === "string" ? leaf : leaf?.id ?? leaf?.leafId ?? leaf?.path;
        return id != null && String(id) === String(fallbackSplit.selectedLeafId);
      });
  const fallbackId = typeof fallbackLeaf === "string"
    ? fallbackLeaf
    : fallbackLeaf?.id ?? fallbackLeaf?.leafId ?? fallbackLeaf?.path;
  if (fallbackId == null) return null;
  return normalizeWindowPrefixSnapshot({
    ...snapshot,
    activeLeafId: activeLeafId ?? String(fallbackId),
  });
}

function windowPrefixTabRangeLabel(first, last, unnumbered = 0) {
  let label = first == null || last == null
    ? ""
    : first === last
      ? String(first)
      : String(first) + "–" + String(last);
  if (unnumbered > 0) label = label ? label + " +" + String(unnumbered) : "+" + String(unnumbered);
  return label;
}

function windowPrefixTabRangeAriaLabel(first, last, unnumbered = 0) {
  let label = first == null || last == null
    ? ""
    : first === last
      ? "tab " + String(first)
      : "tabs " + String(first) + " to " + String(last);
  if (unnumbered > 0) {
    const extra = String(unnumbered) + " more unnumbered";
    label = label ? label + ", " + extra : extra;
  }
  return label;
}

function buildWindowPrefixTabCatalog(snapshot) {
  const layout = windowPrefixTabCatalogSnapshot(snapshot);
  if (!layout) {
    return {
      ok: false,
      tabs: [],
      byNumber: {},
      splits: [],
      total: 0,
      numbered: 0,
      unnumbered: 0,
    };
  }
  const requestedActive = snapshot.activeLeafId == null
    ? null
    : String(snapshot.activeLeafId);
  const activeLeafId = layout.splits.some((split) =>
    split.leaves.some((leaf) => leaf.id === requestedActive),
  ) ? requestedActive : null;
  const tabs = [];
  const byNumber = {};
  const splitRanges = new Map();
  let nextNumber = 1;
  for (const split of windowPrefixReadingOrder(layout.splits)) {
    const range = { id: split.id, first: null, last: null, unnumbered: 0 };
    for (const leaf of split.leaves) {
      const number = nextNumber <= WINDOW_PREFIX_TAB_LIMIT ? nextNumber : null;
      const tab = {
        number,
        leafId: leaf.id,
        splitId: split.id,
        label: leaf.label,
        pinned: leaf.pinned,
        selected: leaf.id === split.selectedLeafId,
        active: leaf.id === activeLeafId,
      };
      tabs.push(tab);
      if (number == null) {
        range.unnumbered += 1;
      } else {
        if (range.first == null) range.first = number;
        range.last = number;
        byNumber[number] = tab;
        nextNumber += 1;
      }
    }
    splitRanges.set(split.id, range);
  }
  return {
    ok: true,
    tabs,
    byNumber,
    splits: [...splitRanges.values()],
    total: tabs.length,
    numbered: Math.min(tabs.length, WINDOW_PREFIX_TAB_LIMIT),
    unnumbered: Math.max(0, tabs.length - WINDOW_PREFIX_TAB_LIMIT),
  };
}

function windowPrefixDigitFromKeydown(eventLike) {
  const event = eventLike ?? {};
  if (event.repeat || event.isComposing || event.keyCode === 229 || event.metaKey || event.altKey) {
    return null;
  }
  const key = typeof event.key === "string" ? event.key : "";
  if (/^[1-9]$/.test(key)) return key;
  const controlKey = !key || /[\u0000-\u001f\u007f]/.test(key);
  if (!event.ctrlKey || event.shiftKey || !controlKey) return null;
  const code = typeof event.code === "string" ? event.code : "";
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return digit ? digit[1] : null;
}

function windowPrefixNoTabPreview(number, total) {
  if (total === 1) return "No tab " + String(number) + " · only 1 tab";
  if (total < 1) return "No tab " + String(number) + " · no tabs";
  return "No tab " + String(number) + " · " + String(total) + " tabs";
}

function planWindowPrefixTabJump(snapshot, number, options = {}) {
  const key = String(number);
  const layout = normalizeWindowPrefixSnapshot(snapshot);
  if (!layout) return windowPrefixPlanError(key, "invalid-layout");
  const source = windowPrefixActiveSplit(layout);
  if (!layout.capabilities.focus) {
    return windowPrefixPlanNoop(
      key, source, layout, "layout-api-changed", "Obsidian layout API changed",
    );
  }
  const catalog = buildWindowPrefixTabCatalog(snapshot);
  if (!catalog.ok) return windowPrefixPlanError(key, "invalid-layout");
  const target = catalog.byNumber[number] ?? null;
  const armedCatalog = options && options.armedCatalog;
  if (armedCatalog && armedCatalog.ok === true) {
    const armedTarget = armedCatalog.byNumber instanceof Map
      ? armedCatalog.byNumber.get(number)
      : armedCatalog.byNumber?.[number] ?? null;
    if ((armedTarget?.leafId ?? null) !== (target?.leafId ?? null)) {
      const stale = windowPrefixPlanNoop(
        key, source, layout, "tabs-changed", "Tabs changed — try again",
      );
      stale.disarm = true;
      return stale;
    }
  }
  if (!target) {
    return windowPrefixPlanNoop(
      key, source, layout, "no-such-tab", windowPrefixNoTabPreview(number, catalog.total),
    );
  }
  const targetSplit = layout.splits.find((split) => split.id === target.splitId);
  if (!targetSplit) return windowPrefixPlanError(key, "invalid-layout");
  const alreadyHere = target.leafId === layout.activeLeafId;
  return {
    ok: true,
    available: true,
    action: "focus-tab",
    key,
    tabNumber: number,
    sourceSplitId: source.id,
    sourceLeafId: layout.activeLeafId,
    targetSplitId: target.splitId,
    targetLeafId: target.leafId,
    crossSplit: source.id !== target.splitId,
    alreadyHere,
    ...(alreadyHere ? { reason: "already-here" } : {}),
    preview: "jump to tab " + String(number) + " · " + target.label,
    consequence: null,
  };
}

function windowPrefixCtrlWOwner(entries, options = {}) {
  const mac = options.mac === true;
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || String(entry.key ?? "").toLowerCase() !== "w") continue;
    const modifiers = Array.isArray(entry.modifiers)
      ? entry.modifiers.map((value) => String(value).toLowerCase())
      : [];
    if (modifiers.length !== 1) continue;
    const modifier = modifiers[0];
    const isCtrl = modifier === "ctrl" || modifier === "control";
    const isMod = modifier === "mod" && !mac;
    if ((isCtrl || isMod) && typeof entry.commandId === "string" && entry.commandId) {
      return entry.commandId;
    }
  }
  return null;
}

function windowTabNumeralsVerdict(input = {}) {
  const phone = input.phone === true;
  const tabCount = Number.isFinite(input.tabCount) ? input.tabCount : 0;
  const headersAvailable = input.headersAvailable !== false;
  const litRequested = input.lit === true;
  let show = false;
  let reason = "available";
  if (phone) {
    reason = "phone";
  } else if (tabCount < 2) {
    reason = tabCount === 1 ? "one-tab" : "no-tabs";
  } else if (!headersAvailable) {
    reason = "headers-unavailable";
  } else {
    const known = input.hotkeysKnown === true;
    const unknownOwner = !known && input.mac !== true;
    const hasOwner = input.ctrlWOwner != null || unknownOwner;
    if (hasOwner && !litRequested) {
      reason = known ? "ctrl-w-owned" : "hotkeys-unknown";
    } else {
      show = true;
      reason = litRequested ? "lit" : "available";
    }
  }
  return { show, lit: show && litRequested, reason };
}
