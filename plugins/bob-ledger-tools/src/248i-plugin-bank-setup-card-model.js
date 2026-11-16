// Pure Setup-card models and gesture envelopes. Bob owns validation, derived
// keys, ordering, consequences, and every write; these helpers only translate
// an explicit card gesture into one guarded config op.
const BANK_SETUP_CARD_SECTION_ORDER = ["categories", "accounts", "rules", "checks"];
const BANK_SETUP_CARD_SECTION_LABELS = {
  categories: "Categories",
  accounts: "Accounts",
  rules: "Rules",
  checks: "Checks",
};

function bankSetupCardModel(report, selection = null) {
  const setup = bankSetupModel(report, { desktop: true, expanded: true });
  const categories = Array.isArray(report?.categories) ? report.categories : [];
  const items = [];
  const sections = (setup.sections || []).map((section) => {
    const group = section.group || "";
    const enriched = { ...section, items: [] };
    if (group) {
      const item = {
        type: "group", group, id: `group:${group}`, label: group,
        builtin: group === BANK_SETUP_MONEY_GROUP,
        count: Array.isArray(section.tiles) ? section.tiles.length : 0,
      };
      enriched.items.push(item);
      items.push(item);
    }
    enriched.tiles = (section.tiles || []).map((tile) => {
      const entry = categories.find((candidate) => candidate && candidate.key === tile.key) || {};
      const full = bankSetupTile(entry) || tile;
      const item = { type: "category", key: tile.key, id: `category:${tile.key}`, entry, tile: { ...tile, ...full } };
      enriched.items.push(item);
      items.push(item);
      return item.tile;
    });
    return enriched;
  });
  const hiddenTiles = (setup.hiddenTiles || []).map((tile) => {
    const entry = categories.find((candidate) => candidate && candidate.key === tile.key) || {};
    const item = { type: "category", key: tile.key, id: `category:${tile.key}`, entry, tile: { ...tile, hidden: true } };
    return item.tile;
  });
  if (hiddenTiles.length) {
    items.push({ type: "group", group: "", id: "group:hidden", label: "HIDDEN", hidden: true, count: hiddenTiles.length });
    for (const tile of hiddenTiles) {
      const entry = categories.find((candidate) => candidate && candidate.key === tile.key) || {};
      items.push({ type: "category", key: tile.key, id: `category:${tile.key}`, entry, tile });
    }
  }
  const chosen = selection && items.find((item) => item.id === selection.id)
    ? items.find((item) => item.id === selection.id)
    : items.find((item) => item.type === "category") || items[0] || null;
  return {
    ...setup,
    categories,
    sections,
    hiddenTiles,
    items,
    selection: chosen ? { type: chosen.type, key: chosen.key || null, group: chosen.group || null, id: chosen.id } : null,
    selectedItem: chosen,
    canEdit: setup.state === "valid" && report?.state === "valid",
  };
}

function bankSetupCardSelection(model, id) {
  const item = (model && Array.isArray(model.items) ? model.items : []).find((candidate) => candidate.id === id);
  return item ? { type: item.type, key: item.key || null, group: item.group || null, id: item.id } : null;
}

function bankSetupCardSelectionByHotkey(categories, hotkey) {
  const wanted = typeof hotkey === "string" && hotkey.length === 1 ? hotkey.toLowerCase() : "";
  if (!wanted || wanted === BANK_CONFIG_RESERVED_HOTKEY) return null;
  const entry = bankCategoryVisible(categories).find((item) => String(item.hotkey || "").toLowerCase() === wanted);
  return entry ? { type: "category", key: entry.key, group: entry.group || null, id: `category:${entry.key}` } : null;
}

function bankSetupCardMoveSelection(model, selection, direction) {
  const items = Array.isArray(model?.items) ? model.items : [];
  if (!items.length) return null;
  const current = selection && items.findIndex((item) => item.id === selection.id);
  const at = Number.isInteger(current) && current >= 0 ? current : 0;
  const next = Math.max(0, Math.min(items.length - 1, at + (direction === "back" ? -1 : 1)));
  const item = items[next];
  return item ? { type: item.type, key: item.key || null, group: item.group || null, id: item.id } : null;
}

function bankSetupCardSetCategoryOp(entry, draft = {}) {
  if (!entry || typeof entry.key !== "string" || !entry.key) return null;
  const set = {};
  const unset = [];
  const label = typeof draft.label === "string" ? draft.label.trim() : "";
  if (label && label !== (entry.label || entry.key)) set.label = label;
  const group = typeof draft.group === "string" ? draft.group.trim() : "";
  const oldGroup = typeof entry.group === "string" ? entry.group.trim() : "";
  if (group !== oldGroup) {
    if (group) set.group = group;
    else if (oldGroup) unset.push("group");
  }
  if (draft.hotkeyTouched === true) {
    const hotkey = typeof draft.hotkey === "string" ? draft.hotkey.trim().toLowerCase() : "";
    const oldHotkey = typeof entry.hotkey === "string" ? entry.hotkey.toLowerCase() : "";
    if (hotkey) {
      if (hotkey !== oldHotkey || entry.hotkey_source !== "explicit") set.hotkey = hotkey;
    } else if (oldHotkey) {
      unset.push("hotkey");
    }
  }
  if (!Object.keys(set).length && !unset.length) return null;
  return { op: "category.set", key: entry.key, ...(Object.keys(set).length ? { set } : {}), ...(unset.length ? { unset } : {}) };
}

function bankSetupCardHotkeyStatus(categories, hotkey, ignoreKey = "") {
  const key = typeof hotkey === "string" ? hotkey.trim().toLowerCase() : "";
  if (!key) return { kind: "empty", owner: null, canApply: true, text: "" };
  if (key === BANK_CONFIG_RESERVED_HOTKEY) return { kind: "reserved", owner: null, canApply: false, text: "q cancels the card" };
  if (!bankConfigIsHotkeyChar(key)) return { kind: "invalid", owner: null, canApply: false, text: "use a letter or digit" };
  const owner = bankConfigHotkeyOwner(categories, key);
  if (owner && owner.key !== ignoreKey) {
    const name = bankCategoryTileLabel(owner);
    return { kind: "taken", owner, canApply: false, text: `taken by ${name}` };
  }
  return { kind: "free", owner: null, canApply: true, text: "" };
}

function bankSetupCardCategoryMoveOp(categories, key, direction) {
  const entries = (Array.isArray(categories) ? categories : []).filter((entry) => entry && entry.declared !== false && (entry.group || "") === ((bankCategoryByKey(categories, key) || {}).group || ""));
  const at = entries.findIndex((entry) => entry.key === key);
  const neighbor = entries[at + (direction === "back" ? -1 : 1)];
  if (at < 0 || !neighbor) return null;
  return { op: "category.move", key, [direction === "back" ? "before" : "after"]: neighbor.key };
}

function bankSetupCardGroupMoveOp(categories, group, direction) {
  if (!group || group === BANK_SETUP_MONEY_GROUP) return null;
  const groups = bankConfigGroups(categories).filter((item) => item !== BANK_SETUP_MONEY_GROUP);
  const at = groups.indexOf(group);
  const neighbor = groups[at + (direction === "back" ? -1 : 1)];
  if (at < 0 || !neighbor) return null;
  return { op: "group.move", group, [direction === "back" ? "before" : "after"]: neighbor };
}

function bankSetupCardHiddenOp(entry) {
  return entry && typeof entry.key === "string"
    ? { op: "category.set", key: entry.key, set: { hidden: entry.hidden !== true } }
    : null;
}

function bankSetupCardRemoveOp(entry) {
  return entry && typeof entry.key === "string" && entry.builtin !== true && entry.declared !== false
    ? { op: "category.remove", key: entry.key }
    : null;
}

function bankSetupCardRestoreOp(entry) {
  return entry && typeof entry.key === "string" && entry.builtin === true && entry.declared === true
    ? { op: "category.reset", key: entry.key }
    : null;
}

function bankSetupCardGroupRenameOp(group, to) {
  const next = typeof to === "string" ? to.trim() : "";
  if (!group || !next || next === group || group === BANK_SETUP_MONEY_GROUP) return null;
  return { op: "group.rename", group, to: next };
}

function bankSetupCardStatus(report) {
  if (!report) return { state: "unavailable", readOnly: true, label: "Loading the current bank config report." };
  const state = String(report?.state || "missing");
  if (state === "valid") return { state, readOnly: false, label: "✓ bank: is valid — bob uses it as shown" };
  if (state === "invalid") return { state, readOnly: true, label: "✗ bank: has problems — fix the located lines in YAML" };
  if (state === "missing" || report?.teaching_empty === true) return { state: "missing", readOnly: true, label: "bank: mapping is missing — add it in YAML" };
  return { state: "unavailable", readOnly: true, label: "Setup needs a current bank config report." };
}
