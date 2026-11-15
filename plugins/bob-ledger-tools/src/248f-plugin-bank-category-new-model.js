// Pure New-category stage for the Category card. No DOM, no spawns: the
// card paints these fields and the shared guarded session dry-runs
// `category.add`. Bob owns the stored key, free hotkeys, and consequence.
const BANK_CATEGORY_NEW_TILE_KEY = "__new_category__";
const BANK_CATEGORY_NEW_NEEDS_BOB = "Setup needs a newer bob — run bob update.";

function bankCategoryNewTile() {
  return {
    key: BANK_CATEGORY_NEW_TILE_KEY,
    hotkey: "+",
    keycap: "+",
    emoji: "＋",
    label: "New category",
    text: "＋ New category",
    dimmed: false,
    isNew: true,
  };
}

function bankCategoryNewSuggestedHotkey(categories) {
  const free = typeof bankConfigFreeHotkeys === "function"
    ? bankConfigFreeHotkeys(categories)
    : [];
  return free.length > 0 ? free[0] : "";
}

function bankCategoryNewDefaultGroup(categories, highlightKey) {
  const entry = typeof bankCategoryByKey === "function"
    ? bankCategoryByKey(categories, highlightKey)
    : null;
  return entry && typeof entry.group === "string" && entry.group.trim()
    ? entry.group.trim()
    : "";
}

function bankCategoryNewStageInit(categories, highlightKey) {
  const groups = typeof bankConfigGroups === "function" ? bankConfigGroups(categories) : [];
  const hotkey = bankCategoryNewSuggestedHotkey(categories);
  return {
    label: "",
    group: bankCategoryNewDefaultGroup(categories, highlightKey),
    hotkey,
    suggestedHotkey: hotkey,
    groups,
    focus: "label",
    consequence: "",
    refusal: null,
    syncWarning: null,
    applying: false,
    canApply: false,
  };
}

function bankCategoryNewHotkeyStatus(categories, hotkey) {
  const key = typeof hotkey === "string" ? hotkey.trim().toLowerCase() : "";
  if (!key) {
    return { kind: "empty", owner: null, canApply: true, text: "" };
  }
  if (key === BANK_CONFIG_RESERVED_HOTKEY) {
    return { kind: "reserved", owner: null, canApply: false, text: "q cancels the card" };
  }
  if (typeof bankConfigIsHotkeyChar === "function" && !bankConfigIsHotkeyChar(key)) {
    return { kind: "invalid", owner: null, canApply: false, text: "use a letter or digit" };
  }
  const owner = typeof bankConfigHotkeyOwner === "function"
    ? bankConfigHotkeyOwner(categories, key)
    : null;
  if (owner) {
    const name = typeof bankCategoryTileLabel === "function"
      ? bankCategoryTileLabel(owner)
      : (owner.label || owner.key);
    return { kind: "taken", owner, canApply: false, text: `taken by ${name}` };
  }
  return { kind: "free", owner: null, canApply: true, text: "" };
}

function bankCategoryNewCycleGroup(stage, direction) {
  const groups = Array.isArray(stage && stage.groups) ? stage.groups : [];
  if (groups.length === 0) {
    return typeof stage?.group === "string" ? stage.group : "";
  }
  const current = typeof stage?.group === "string" ? stage.group : "";
  const at = groups.indexOf(current);
  if (direction === "back") {
    if (at < 0) return groups[groups.length - 1];
    return groups[(at - 1 + groups.length) % groups.length];
  }
  if (at < 0) return groups[0];
  return groups[(at + 1) % groups.length];
}

function bankCategoryNewDraftOp(stage) {
  if (typeof bankConfigAddOp !== "function") return null;
  return bankConfigAddOp({
    label: stage && stage.label,
    group: stage && stage.group,
    hotkey: stage && stage.hotkey,
  });
}

function bankCategoryNewCanApply(stage, sessionState, categories) {
  if (!stage || stage.applying === true) return false;
  const label = typeof stage.label === "string" ? stage.label.trim() : "";
  if (!label) return false;
  const hotkey = bankCategoryNewHotkeyStatus(categories, stage.hotkey);
  if (hotkey.canApply !== true) return false;
  return Boolean(sessionState && sessionState.canApply === true);
}

function bankCategoryNewAddedKey(report) {
  if (!report || !Array.isArray(report.per_op) || !report.per_op[0]) return null;
  const key = report.per_op[0].key;
  return typeof key === "string" && key ? key : null;
}

function bankCategoryCardKeysText(mode, kind) {
  if (kind === "restricted") {
    return "␣ acknowledge · esc cancel";
  }
  const space = mode === "set" ? "Space remove category" : "Space no category";
  return `↵ accept · letter choose · ${space} · + new category · Esc cancel`;
}

function bankCategoryNewStageKeysText() {
  return "↵ add and file · ↑↓ cycle group · Esc close stage";
}

function bankCategoryIsNewCategoryKey(key) {
  return key === "+" || key === "=" || key === "＋";
}
