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
  const rawAccounts = Array.isArray(report?.accounts) ? report.accounts : [];
  const rawRules = Array.isArray(report?.rules) ? report.rules : [];
  const rawFindings = Array.isArray(setup.findings) ? setup.findings : [];
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
  const accountItems = rawAccounts
    .filter((entry) => entry && typeof entry.alias === "string" && entry.alias)
    .map((entry) => ({ type: "account", alias: entry.alias, key: null, group: null, id: `account:${entry.alias}`, entry }));
  const ruleItems = rawRules
    .filter((entry) => entry && typeof entry.match === "string")
    .map((entry, position) => {
      const index = Number.isInteger(entry.index) && entry.index >= 0 ? entry.index : position;
      return { type: "rule", index, key: null, group: null, id: `rule:${index}`, entry: { ...entry, index } };
    });
  const findingItems = rawFindings.map((entry, position) => ({
    type: "finding", index: position, key: null, group: null, id: `finding:${position}`, entry,
  }));
  const allItems = items.concat(accountItems, ruleItems, findingItems);
  const chosen = selection && allItems.find((item) => item.id === selection.id)
    ? allItems.find((item) => item.id === selection.id)
    : items.find((item) => item.type === "category") || items[0] || null;
  const staleAfter = setup && setup.staleAfterDays !== undefined
    ? { days: setup.staleAfterDays, explicit: setup.staleAfterExplicit === true, line: setup.staleAfterLine || null }
    : { days: 10, explicit: false, line: null };
  return {
    ...setup,
    categories,
    accounts: rawAccounts,
    rules: rawRules,
    sections,
    hiddenTiles,
    items,
    accountItems,
    ruleItems,
    findingItems,
    allItems,
    staleAfter,
    selection: chosen
      ? {
        type: chosen.type,
        key: chosen.key || null,
        group: chosen.group || null,
        alias: chosen.alias || null,
        index: Number.isInteger(chosen.index) ? chosen.index : null,
        id: chosen.id,
      }
      : null,
    selectedItem: chosen,
    canEdit: setup.state === "valid" && report?.state === "valid",
  };
}

function bankSetupCardAllItems(model) {
  if (!model) return [];
  if (Array.isArray(model.allItems)) return model.allItems;
  const out = Array.isArray(model.items) ? model.items.slice() : [];
  for (const item of Array.isArray(model.accountItems) ? model.accountItems : []) out.push(item);
  for (const item of Array.isArray(model.ruleItems) ? model.ruleItems : []) out.push(item);
  for (const item of Array.isArray(model.findingItems) ? model.findingItems : []) out.push(item);
  return out;
}

function bankSetupCardSelection(model, id) {
  const item = bankSetupCardAllItems(model).find((candidate) => candidate.id === id);
  if (!item) return null;
  return {
    type: item.type,
    key: item.key || null,
    group: item.group || null,
    alias: item.alias || null,
    index: Number.isInteger(item.index) ? item.index : null,
    id: item.id,
  };
}

function bankSetupCardSelectionByHotkey(categories, hotkey) {
  const wanted = typeof hotkey === "string" && hotkey.length === 1 ? hotkey.toLowerCase() : "";
  if (!wanted || wanted === BANK_CONFIG_RESERVED_HOTKEY) return null;
  const entry = bankCategoryVisible(categories).find((item) => String(item.hotkey || "").toLowerCase() === wanted);
  return entry ? { type: "category", key: entry.key, group: entry.group || null, id: `category:${entry.key}` } : null;
}

function bankSetupCardMoveSelection(model, selection, direction, arrange) {
  let items = Array.isArray(model?.items) ? model.items : [];
  if (arrange && typeof bankSetupCardPaintedCategoryItems === "function") {
    try {
      const byId = new Map(items.map((item) => [item.id, item]));
      const painted = bankSetupCardPaintedCategoryItems(model, arrange)
        .map((entry) => byId.get(entry.id))
        .filter(Boolean);
      if (painted.length === items.length) items = painted;
    } catch (_) {}
  }
  if (!items.length) return null;
  const current = selection && items.findIndex((item) => item.id === selection.id);
  const at = Number.isInteger(current) && current >= 0 ? current : 0;
  const next = Math.max(0, Math.min(items.length - 1, at + (direction === "back" ? -1 : 1)));
  const item = items[next];
  return item ? { type: item.type, key: item.key || null, group: item.group || null, id: item.id } : null;
}

// Painted category-walk items: group labels and tiles in the order the
// Categories tab paints them, so keys and arrows never drift from the
// screen while a reorder is pending. Ends with group:hidden and its
// tiles when hidden categories exist.
function bankSetupCardPaintedCategoryItems(model, arrange) {
  const out = [];
  let sections = Array.isArray(model?.sections) ? model.sections : [];
  if (arrange && typeof bankSetupCardProjectedSections === "function") {
    try {
      sections = bankSetupCardProjectedSections(model, arrange) || sections;
    } catch (_) {}
  }
  for (const section of sections) {
    if (section && section.group) {
      out.push({ type: "group", group: section.group, key: null, id: `group:${section.group}` });
    }
    for (const tile of (section && section.tiles) || []) {
      if (tile && tile.key) out.push({ type: "category", group: section.group || null, key: tile.key, id: `category:${tile.key}` });
    }
  }
  const hiddenTiles = Array.isArray(model?.hiddenTiles) ? model.hiddenTiles : [];
  if (hiddenTiles.length) {
    out.push({ type: "group", group: "", key: null, id: "group:hidden", hidden: true });
    for (const tile of hiddenTiles) {
      if (tile && tile.key) out.push({ type: "category", group: null, key: tile.key, id: `category:${tile.key}`, hidden: true });
    }
  }
  return out;
}

// Next/previous group label strictly after/before the selection in
// painted order. From a tile, Ctrl+K lands on its own group first
// (parent first); at an end there is no group, so the caller bumps.
function bankSetupCardGroupStep(items, selection, direction) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  const step = direction === "back" ? -1 : 1;
  const at = selection && list.findIndex((item) => item && item.id === selection.id);
  const from = Number.isInteger(at) && at >= 0 ? at : (step < 0 ? list.length : -1);
  for (let index = from + step; index >= 0 && index < list.length; index += step) {
    if (list[index] && list[index].type === "group") return list[index];
  }
  return null;
}

function bankSetupCardComposeLabel(entry, draft = {}) {
  const label = typeof draft.label === "string" ? draft.label.trim() : "";
  const emoji = Object.prototype.hasOwnProperty.call(draft, "emoji")
    ? String(draft.emoji || "")
    : String(entry?.emoji || "");
  if (typeof albumEmojiSlotFusedToken === "function") return albumEmojiSlotFusedToken(label, emoji);
  return emoji ? (label ? `${emoji} ${label}` : emoji) : label;
}

function bankSetupCardSetCategoryOp(entry, draft = {}) {
  if (!entry || typeof entry.key !== "string" || !entry.key) return null;
  const set = {};
  const unset = [];
  const label = typeof draft.label === "string" ? draft.label.trim() : "";
  const composed = bankSetupCardComposeLabel(entry, draft);
  const previous = bankSetupCardComposeLabel(entry, { label: entry.label || entry.key, emoji: entry.emoji || "" });
  if (label && composed !== previous) set.label = composed;
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

function bankSetupCardDeriveAccountAlias(label) {
  let alias = "";
  for (const character of String(label || "")) {
    if (/[A-Za-z0-9]/.test(character)) alias += character.toLowerCase();
    else if (alias && !alias.endsWith("_")) alias += "_";
  }
  alias = alias.replace(/^_+|_+$/g, "");
  return /^[a-z][a-z0-9_]*$/.test(alias) ? alias : "";
}

function bankSetupCardAccountKinds() {
  return ["checking", "savings", "cash", "credit"];
}

function bankSetupCardAccountAddOp(draft = {}) {
  const label = typeof draft.label === "string" ? draft.label.trim() : "";
  const kind = typeof draft.kind === "string" ? draft.kind.trim().toLowerCase() : "";
  if (!label || !bankSetupCardAccountKinds().includes(kind)) return null;
  const op = { op: "account.add", label, kind };
  const start = typeof draft.start === "string" ? draft.start.trim() : "";
  if (start) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
    op.start = start;
  } else if (kind !== "cash") {
    return null;
  }
  const alias = typeof draft.alias === "string" ? draft.alias.trim().toLowerCase() : "";
  if (alias) {
    if (!/^[a-z][a-z0-9_]*$/.test(alias)) return null;
    op.alias = alias;
  }
  return op;
}

function bankSetupCardAccountAddStatus(accounts, draft = {}) {
  const label = typeof draft.label === "string" ? draft.label.trim() : "";
  const kind = typeof draft.kind === "string" ? draft.kind.trim().toLowerCase() : "";
  if (!label) return { kind: "empty", canApply: false, text: "name the account" };
  if (!bankSetupCardAccountKinds().includes(kind)) return { kind: "empty", canApply: false, text: "pick a kind" };
  const start = typeof draft.start === "string" ? draft.start.trim() : "";
  if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return { kind: "invalid", canApply: false, text: "use YYYY-MM-DD for the start date" };
  }
  if (!start && kind !== "cash") return { kind: "empty", canApply: false, text: "cash needs no start date" };
  const alias = typeof draft.alias === "string" && draft.alias.trim()
    ? draft.alias.trim().toLowerCase()
    : bankSetupCardDeriveAccountAlias(label);
  if (!/^[a-z][a-z0-9_]*$/.test(alias)) {
    return { kind: "invalid", canApply: false, text: "alias must match [a-z][a-z0-9_]*", alias: "" };
  }
  const owner = (Array.isArray(accounts) ? accounts : []).find((entry) => entry && entry.alias === alias);
  if (owner) return { kind: "taken", owner, canApply: false, text: `alias ${alias} already exists`, alias };
  return { kind: "free", owner: null, canApply: true, text: "", alias };
}

function bankSetupCardAccountSetOp(entry, draft = {}) {
  if (!entry || typeof entry.alias !== "string" || !entry.alias) return null;
  const label = typeof draft.label === "string" ? draft.label.trim() : "";
  if (!label || label === (entry.label || entry.alias)) return null;
  return { op: "account.set", alias: entry.alias, set: { label } };
}

function bankSetupCardAccountRemoveOp(entry) {
  return entry && typeof entry.alias === "string" && entry.alias
    ? { op: "account.remove", alias: entry.alias }
    : null;
}

function bankSetupCardRuleAddOp(draft = {}, categories = []) {
  const match = typeof draft.match === "string" ? draft.match.trim() : "";
  if (!match) return null;
  const op = { op: "rule.add", match };
  const payee = typeof draft.payee === "string" ? draft.payee.trim() : "";
  if (payee) op.payee = payee;
  const cat = typeof draft.cat === "string" ? draft.cat.trim() : "";
  if (cat) {
    const known = (Array.isArray(categories) ? categories : []).some((entry) => entry && entry.key === cat);
    if (!known) return null;
    op.cat = cat;
  }
  const link = typeof draft.link === "string" ? draft.link.trim() : "";
  if (link) op.link = link;
  if (draft.position !== undefined && draft.position !== null && draft.position !== "") {
    const position = Number(draft.position);
    if (!Number.isInteger(position) || position < 0) return null;
    op.position = position;
  }
  return op;
}

function bankSetupCardRuleSetOp(entry, draft = {}, categories = []) {
  if (!entry || !Number.isInteger(entry.index) || entry.index < 0 || typeof entry.match !== "string") return null;
  const set = {};
  const unset = [];
  const match = typeof draft.match === "string" ? draft.match.trim() : "";
  if (match && match !== entry.match) set.match = match;
  const payee = draft.payee === null || draft.payee === undefined ? null : String(draft.payee).trim();
  const oldPayee = entry.payee === null || entry.payee === undefined ? "" : String(entry.payee);
  if (payee !== null && payee !== oldPayee) {
    if (payee) set.payee = payee;
    else if (oldPayee) unset.push("payee");
  }
  const cat = draft.cat === null || draft.cat === undefined ? null : String(draft.cat).trim();
  const oldCat = entry.cat === null || entry.cat === undefined ? "" : String(entry.cat);
  if (cat !== null && cat !== oldCat) {
    if (cat) {
      const known = (Array.isArray(categories) ? categories : []).some((candidate) => candidate && candidate.key === cat);
      if (!known) return null;
      set.cat = cat;
    } else if (oldCat) {
      unset.push("cat");
    }
  }
  const link = draft.link === null || draft.link === undefined ? null : String(draft.link).trim();
  const oldLink = entry.link === null || entry.link === undefined ? "" : String(entry.link);
  if (link !== null && link !== oldLink) {
    if (link) set.link = link;
    else if (oldLink) unset.push("link");
  }
  if (!Object.keys(set).length && !unset.length) return null;
  return {
    op: "rule.set", index: entry.index, match_was: entry.match,
    ...(Object.keys(set).length ? { set } : {}),
    ...(unset.length ? { unset } : {}),
  };
}

function bankSetupCardRuleMoveOp(rules, index, direction) {
  const list = Array.isArray(rules) ? rules : [];
  const at = list.findIndex((entry) => entry && entry.index === index);
  if (at < 0) return null;
  const next = at + (direction === "back" ? -1 : 1);
  if (next < 0 || next >= list.length) return null;
  const entry = list[at];
  return { op: "rule.move", index, match_was: entry.match, position: next };
}

function bankSetupCardRuleRemoveOp(entry) {
  return entry && Number.isInteger(entry.index) && entry.index >= 0 && typeof entry.match === "string"
    ? { op: "rule.remove", index: entry.index, match_was: entry.match }
    : null;
}

function bankSetupCardStaleAfterOp(days) {
  const value = typeof days === "string" && days.trim() !== "" ? Number(days) : days;
  if (!Number.isInteger(value) || value < 0) return null;
  return { op: "bank.set", set: { stale_after: value } };
}

function bankSetupCardStaleAfterUnsetOp() {
  return { op: "bank.set", unset: ["stale_after"] };
}

function bankSetupCardMoveInList(list, id, direction) {
  const items = Array.isArray(list) ? list : [];
  const at = items.findIndex((item) => item && item.id === id);
  if (at < 0) return null;
  const next = Math.max(0, Math.min(items.length - 1, at + (direction === "back" ? -1 : 1)));
  const item = items[next];
  if (!item) return null;
  return {
    type: item.type,
    key: item.key || null,
    group: item.group || null,
    alias: item.alias || null,
    index: Number.isInteger(item.index) ? item.index : null,
    id: item.id,
  };
}

function bankSetupCardMoveAccountSelection(model, selection, direction) {
  const list = Array.isArray(model?.accountItems) ? model.accountItems : [];
  const id = selection && selection.id ? selection.id : (list[0] && list[0].id);
  return bankSetupCardMoveInList(list, id, direction);
}

function bankSetupCardMoveRuleSelection(model, selection, direction) {
  const list = Array.isArray(model?.ruleItems) ? model.ruleItems : [];
  const id = selection && selection.id ? selection.id : (list[0] && list[0].id);
  return bankSetupCardMoveInList(list, id, direction);
}

function bankSetupCardMoveFindingSelection(model, selection, direction) {
  const list = Array.isArray(model?.findingItems) ? model.findingItems : [];
  const id = selection && selection.id ? selection.id : (list[0] && list[0].id);
  return bankSetupCardMoveInList(list, id, direction);
}

function bankSetupCardArrangeScopes(model) {
  const scopes = {};
  const groups = [];
  for (const section of Array.isArray(model?.sections) ? model.sections : []) {
    const group = String(section?.group || "");
    if (!group) continue;
    groups.push(group);
    scopes[`group:${group}`] = (Array.isArray(section.tiles) ? section.tiles : [])
      .map((tile) => String(tile?.key || ""))
      .filter(Boolean);
  }
  scopes.groups = groups;
  scopes.rules = (Array.isArray(model?.ruleItems) ? model.ruleItems : [])
    .map((item) => String(item?.id || ""))
    .filter(Boolean);
  return scopes;
}

function bankSetupCardArrangeFixed(model) {
  const groups = [];
  for (const section of Array.isArray(model?.sections) ? model.sections : []) {
    const group = String(section?.group || "");
    if (group) groups.push(group);
  }
  const fixed = {};
  if (groups[0] === BANK_SETUP_MONEY_GROUP) {
    fixed.groups = { ids: [BANK_SETUP_MONEY_GROUP], slots: [0] };
  }
  return fixed;
}

function bankSetupCardStatus(report) {
  if (!report) return { state: "unavailable", readOnly: true, label: "Loading the current bank config report." };
  const state = String(report?.state || "missing");
  if (state === "valid") return { state, readOnly: false, label: "✓ bank: is valid — bob uses it as shown" };
  if (state === "invalid") return { state, readOnly: true, label: "✗ bank: has problems — fix the located lines in YAML" };
  if (state === "missing" || report?.teaching_empty === true) return { state: "missing", readOnly: true, label: "bank: mapping is missing — add it in YAML" };
  return { state: "unavailable", readOnly: true, label: "Setup needs a current bank config report." };
}
