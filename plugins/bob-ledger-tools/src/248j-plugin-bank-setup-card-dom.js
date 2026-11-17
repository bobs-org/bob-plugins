// Safe DOM painter for the keyboard-first Bank setup modal. Report strings
// are inserted as text and category tiles share the header's tile component.
function bankSetupCardAppend(parent, tag, className, text, attrs = {}) {
  const doc = parent && parent.ownerDocument;
  const node = typeof bankSetupEl === "function"
    ? bankSetupEl(doc, tag, className, text, attrs)
    : null;
  if (node && parent && typeof parent.appendChild === "function") parent.appendChild(node);
  return node;
}

function bankSetupCardListen(node, handler) {
  if (!node || typeof handler !== "function") return;
  if (typeof bankSetupListen === "function") bankSetupListen(node, handler);
  else node.addEventListener?.("click", handler);
}

function bankSetupCardArrangeContext(modal) {
  return modal && modal.bankPaintArrange && typeof modal.bankPaintArrange === "object"
    ? modal.bankPaintArrange
    : {};
}

function bankSetupCardPaintGrip(parent, scope, id) {
  return bankSetupCardAppend(parent, "span", "bob-bank-setup-card-grip", "⠿", {
    "data-drag-scope": String(scope || ""),
    "data-drag-id": String(id ?? ""),
    "aria-hidden": "true",
  });
}

function bankSetupCardDecorateArrange(node, arrangeId, arrange) {
  if (!node || !arrangeId) return;
  try { node.setAttribute?.("data-arrange-id", String(arrangeId)); } catch (_) {}
  const deltas = arrange?.deltas || {};
  const delta = Object.prototype.hasOwnProperty.call(deltas, arrangeId) ? deltas[arrangeId] : null;
  if (delta !== null && delta !== undefined) {
    try { node.classList?.add?.("is-arrange-moved"); } catch (_) {}
    if (arrange?.saving) {
      try { node.classList?.add?.("is-arrange-saving"); } catch (_) {}
    }
    const text = typeof schemaArrangeDeltaBadge === "function" ? schemaArrangeDeltaBadge(delta) : "";
    if (text) bankSetupCardAppend(node, "span", "bob-bank-setup-card-delta-badge", text);
  }
}

function bankSetupCardShiftBadgeFor(entry, arrange) {
  const shifted = Array.isArray(arrange?.shifted) ? arrange.shifted : [];
  if (!entry || !shifted.length) return "";
  const hit = shifted.find((row) => row && (row.key === entry.key
    || (entry.hotkey && (row.from === entry.hotkey || row.to === entry.hotkey))));
  if (!hit) return "";
  if (typeof schemaArrangeHotkeyShiftBadge === "function") {
    const badge = schemaArrangeHotkeyShiftBadge(hit);
    if (badge) return badge;
  }
  const from = String(hit.from || "");
  const to = String(hit.to || "");
  if (from.length === 1 && to.length === 1) return `${from.toUpperCase()}→${to.toUpperCase()}`;
  return "";
}

function bankSetupCardProjectedSections(model, arrange) {
  const sections = Array.isArray(model?.sections) ? model.sections.slice() : [];
  const projectedGroups = Array.isArray(arrange?.projected?.groups) ? arrange.projected.groups : null;
  if (!projectedGroups || !projectedGroups.length) return sections;
  const byGroup = new Map(sections.filter((section) => section.group).map((section) => [section.group, section]));
  const ordered = [];
  const seen = new Set();
  for (const group of projectedGroups) {
    const section = byGroup.get(group);
    if (section) {
      ordered.push(section);
      seen.add(group);
    }
  }
  for (const section of sections) {
    if (!section.group || !seen.has(section.group)) ordered.push(section);
  }
  return ordered.map((section) => {
    const scope = section.group ? `group:${section.group}` : "";
    const keys = scope && Array.isArray(arrange?.projected?.[scope]) ? arrange.projected[scope] : null;
    if (!keys || !section.tiles) return section;
    const byKey = new Map((section.tiles || []).map((tile) => [tile.key, tile]));
    const tiles = [];
    const used = new Set();
    for (const key of keys) {
      const tile = byKey.get(key);
      if (tile) {
        tiles.push(tile);
        used.add(key);
      }
    }
    for (const tile of section.tiles || []) {
      if (!used.has(tile.key)) tiles.push(tile);
    }
    return { ...section, tiles };
  });
}

function bankSetupCardProjectedRules(model, arrange) {
  const items = Array.isArray(model?.ruleItems) ? model.ruleItems.slice() : [];
  const projected = Array.isArray(arrange?.projected?.rules) ? arrange.projected.rules : null;
  if (!projected || !projected.length) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = [];
  const seen = new Set();
  for (const id of projected) {
    const item = byId.get(id);
    if (item) {
      ordered.push(item);
      seen.add(id);
    }
  }
  for (const item of items) {
    if (!seen.has(item.id)) ordered.push(item);
  }
  return ordered;
}

function bankSetupCardPaintGapButton(host, modal, scope, gap, label) {
  if (!host || !label) return null;
  const button = bankSetupCardAppend(host, "button", "bob-bank-setup-card-gap-hint", label, {
    type: "button",
    "data-gap-index": String(gap),
    "data-gap-scope": String(scope || ""),
    "aria-label": `Place here (gap ${label})`,
  });
  bankSetupCardListen(button, () => {
    try { modal.bankArrangeHintKey?.(label); } catch (_) {}
  });
  return button;
}

function bankSetupCardGapMap(modal, scope) {
  const mode = modal?.bankHintMode;
  const map = new Map();
  if (!mode || mode.scope !== scope) return map;
  const gaps = Array.isArray(mode.gaps) ? mode.gaps : [];
  const labels = Array.isArray(mode.labels) ? mode.labels : [];
  for (let index = 0; index < gaps.length; index += 1) {
    if (labels[index]) map.set(gaps[index], labels[index]);
  }
  return map;
}

function bankSetupCardInput(parent, modal, field, caption, value, options = {}) {
  const row = bankSetupCardAppend(parent, "label", "bob-bank-setup-card-control");
  if (!row) return null;
  bankSetupCardAppend(row, "span", "bob-bank-setup-card-control-label", caption);
  const input = bankSetupCardAppend(row, "input", "bob-bank-setup-card-input", null, {
    type: "text",
    "data-setup-field": field,
    "data-setup-card-focus": field,
    "aria-label": caption,
    placeholder: options.placeholder || "",
    autocomplete: "off",
    spellcheck: "false",
  });
  if (!input) return null;
  input.value = typeof value === "string" ? value : "";
  input.addEventListener?.("input", (event) => {
    modal.onFieldInput(field, event?.target?.value);
  });
  input.addEventListener?.("focus", () => {
    if (modal.stage) modal.stage.focus = field;
  });
  return input;
}

function bankSetupCardPaintTabs(root, modal, model) {
  const tabs = bankSetupCardAppend(root, "div", "bob-bank-setup-card-tabs", null, {
    role: "tablist",
    "aria-label": "Bank setup sections",
  });
  if (!tabs) return;
  for (const section of BANK_SETUP_CARD_SECTION_ORDER) {
    const invalidBadge = section === "checks" && model.errorCount > 0 ? ` · ${model.errorCount}` : "";
    const button = bankSetupCardAppend(tabs, "button", "bob-bank-setup-card-tab",
      `${BANK_SETUP_CARD_SECTION_LABELS[section]}${invalidBadge}`, {
        type: "button",
        role: "tab",
        "data-setup-section": section,
        "aria-selected": modal.section === section ? "true" : "false",
        "aria-controls": "bob-bank-setup-card-panel",
        "data-setup-card-focus": `tab-${section}`,
      });
    if (!button) continue;
    button.classList?.toggle?.("is-active", modal.section === section);
  }
}

function bankSetupCardPaintTile(parent, modal, item, doc) {
  const selected = modal.selection?.id === item.id;
  const tile = item.tile;
  const arrange = bankSetupCardArrangeContext(modal);
  const button = bankSharedCategoryTile(doc, tile, {
    card: true,
    selected,
    disabled: modal.busy,
  });
  if (!button) return null;
  button.setAttribute?.("data-setup-card-category", item.key);
  button.setAttribute?.("aria-label", tile.ariaLabel || `${tile.text || tile.label}; ${tile.rows || 0} rows`);
  button.setAttribute?.("data-setup-card-focus", `category-${item.key}`);
  if (tile.hidden) button.classList?.add?.("is-hidden");
  const keycap = button.querySelector?.(".bob-bank-category-keycap");
  if (keycap && tile.keycapStyle === "dashed") keycap.classList?.add?.("is-derived");
  if (Number.isInteger(tile.rows) && tile.rows > 0) {
    bankSetupCardAppend(button, "span", "bob-bank-setup-card-count", String(tile.rows), { "aria-label": `${tile.rows} rows` });
  }
  const group = String(item.entry?.group || item.group || "");
  if (group && item.entry?.hidden !== true) {
    const arrangeId = `group:${group}:${item.key}`;
    if (!modal.readOnly) bankSetupCardPaintGrip(button, `group:${group}`, item.key);
    bankSetupCardDecorateArrange(button, arrangeId, arrange);
    const shift = bankSetupCardShiftBadgeFor(item.entry, arrange);
    if (shift) bankSetupCardAppend(button, "span", "bob-bank-setup-card-hotkey-shift", shift);
  }
  bankSetupCardListen(button, () => modal.selectItem(item.id));
  parent.appendChild?.(button);
  return button;
}

function bankSetupCardPaintCategories(panel, modal, model, doc) {
  if (!model.categories.length) {
    bankSetupCardAppend(panel, "p", "bob-bank-setup-card-empty", "No categories are available.");
  }
  const arrange = bankSetupCardArrangeContext(modal);
  const sections = bankSetupCardProjectedSections(model, arrange);
  for (const section of sections) {
    const wrap = bankSetupCardAppend(panel, "section", "bob-bank-setup-card-group");
    if (!wrap) continue;
    if (section.group) {
      const groupItem = model.items.find((item) => item.type === "group" && item.group === section.group);
      const label = bankSetupCardAppend(wrap, "button", "bob-bank-setup-card-group-label", section.group, {
        type: "button",
        "aria-pressed": groupItem && modal.selection?.id === groupItem.id ? "true" : "false",
        "data-setup-card-group": section.group,
        "data-setup-card-focus": `group-${section.group}`,
      });
      if (label && !modal.readOnly) bankSetupCardPaintGrip(label, "groups", section.group);
      if (label) bankSetupCardDecorateArrange(label, `groups:${section.group}`, arrange);
      bankSetupCardListen(label, () => groupItem && modal.selectItem(groupItem.id));
      if (section.group === BANK_SETUP_MONEY_GROUP) bankSetupCardAppend(wrap, "span", "bob-bank-setup-card-group-note", "built in · shown first for money in");
    }
    const tiles = bankSetupCardAppend(wrap, "div", "bob-bank-setup-card-tiles", null, {
      role: "group",
      "aria-label": section.group || "Ungrouped categories",
      "data-drag-scope": section.group ? `group:${section.group}` : "",
    });
    const tileItems = (section.tiles || [])
      .map((tile) => model.items.find((candidate) => candidate.type === "category" && candidate.key === tile.key))
      .filter(Boolean);
    const scope = section.group ? `group:${section.group}` : "";
    const gaps = scope ? bankSetupCardGapMap(modal, scope) : new Map();
    for (let index = 0; index <= tileItems.length; index += 1) {
      if (gaps.has(index)) bankSetupCardPaintGapButton(tiles, modal, scope, index, gaps.get(index));
      if (index < tileItems.length) bankSetupCardPaintTile(tiles, modal, tileItems[index], doc);
    }
  }
  if (model.hiddenTiles.length) {
    const wrap = bankSetupCardAppend(panel, "section", "bob-bank-setup-card-group is-hidden-group");
    const groupItem = model.items.find((item) => item.id === "group:hidden");
    const label = bankSetupCardAppend(wrap, "button", "bob-bank-setup-card-group-label", "HIDDEN", {
      type: "button", "aria-pressed": groupItem && modal.selection?.id === groupItem.id ? "true" : "false",
      "data-setup-card-group": "__hidden__", "data-setup-card-focus": "group-hidden",
    });
    bankSetupCardListen(label, () => groupItem && modal.selectItem(groupItem.id));
    const tiles = bankSetupCardAppend(wrap, "div", "bob-bank-setup-card-tiles", null, { role: "group", "aria-label": "Hidden categories" });
    for (const tile of model.hiddenTiles) {
      const item = model.items.find((candidate) => candidate.type === "category" && candidate.key === tile.key);
      if (item) bankSetupCardPaintTile(tiles, modal, item, doc);
    }
  }
  const newTile = bankCategoryNewTile();
  const add = bankSetupCardAppend(panel, "button", "bob-bank-category-tile bob-bank-setup-card-new", null, {
    type: "button", "data-setup-new-category": "true", "data-setup-card-focus": "new-category",
    "aria-label": "New category",
  });
  if (add) {
    bankSetupCardAppend(add, "span", "bob-bank-category-keydot", "＋", { "aria-hidden": "true" });
    bankSetupCardAppend(add, "span", "bob-bank-category-tile-label", newTile.label);
    add.disabled = modal.readOnly || modal.busy;
  }
}

function bankSetupCardAccountRowText(account) {
  if (!account) return "";
  const parts = [account.label || account.alias || "account"];
  parts.push(`[acct:: ${account.alias || "?"}]`);
  if (account.kind) parts.push(account.kind);
  if (account.default === true) parts.push("default");
  if (account.sinceLabel) parts.push(account.sinceLabel);
  else if (account.start) parts.push(`since ${account.start}`);
  const statusWord = account.status || "unknown";
  const statusIcon = account.statusIcon || (statusWord === "balanced" ? "✓" : statusWord === "stale" ? "⚠" : statusWord === "delta" ? "✗" : "·");
  parts.push(`${statusIcon} ${statusWord}`);
  if (Number.isInteger(account.rows)) parts.push(`${account.rows} ${account.rows === 1 ? "row" : "rows"}`);
  return parts.join(" · ");
}

function bankSetupCardPaintAccounts(panel, modal, model) {
  bankSetupCardAppend(panel, "p", "bob-bank-setup-card-section-note", "Accounts hold money; categories file rows. Enter relabels; Ctrl+D removes an unused account. Alias, kind, start, order, and default stay in YAML — bob refuses them with counts.");
  const items = Array.isArray(model.accountItems) ? model.accountItems : [];
  if (!items.length) {
    bankSetupCardAppend(panel, "p", "bob-bank-setup-card-empty", "No accounts are configured.");
  } else {
    const list = bankSetupCardAppend(panel, "div", "bob-bank-setup-card-accounts", null, { role: "list", "aria-label": "Accounts" });
    for (const item of items) {
      const account = item.entry || {};
      const selected = modal.selection?.id === item.id;
      const row = bankSetupCardAppend(list, "button", `bob-bank-setup-card-account${selected ? " is-selected" : ""}`, null, {
        type: "button", role: "listitem",
        "data-setup-card-account": account.alias || "",
        "data-setup-card-focus": `account-${account.alias || ""}`,
        "aria-pressed": selected ? "true" : "false",
        "aria-label": bankSetupCardAccountRowText(account),
      });
      if (row) {
        bankSetupCardAppend(row, "strong", "", account.label || account.alias || "account");
        bankSetupCardAppend(row, "span", "bob-bank-setup-card-muted", `[acct:: ${account.alias || "?"}]`);
        const meta = [account.kind || null, account.default === true ? "default" : null, account.sinceLabel || (account.start ? `since ${account.start}` : null)].filter(Boolean).join(" · ");
        if (meta) bankSetupCardAppend(row, "span", "bob-bank-setup-card-muted", meta);
        const statusWord = account.status || "unknown";
        const statusIcon = account.statusIcon || (statusWord === "balanced" ? "✓" : statusWord === "stale" ? "⚠" : statusWord === "delta" ? "✗" : "·");
        bankSetupCardAppend(row, "span", `bob-bank-setup-card-status is-${account.statusTone || "muted"}`, `${statusIcon} ${statusWord}`);
        if (Number.isInteger(account.rows)) bankSetupCardAppend(row, "span", "bob-bank-setup-card-count", String(account.rows), { "aria-label": `${account.rows} rows` });
        bankSetupCardListen(row, () => modal.selectItem(item.id));
      }
    }
  }
  const add = bankSetupCardAppend(panel, "button", "bob-bank-setup-card-action", "＋ Add account", {
    type: "button", "data-setup-new-account": "true", "data-setup-card-focus": "new-account",
  });
  if (add) add.disabled = modal.readOnly || modal.busy;
  const stale = model.staleAfter || { days: 10, explicit: false, line: null };
  const staleText = stale.explicit === true
    ? `Balances go stale after ${stale.days} ${stale.days === 1 ? "day" : "days"}`
    : `Balances go stale after ${stale.days} ${stale.days === 1 ? "day" : "days"} (default)`;
  const staleRow = bankSetupCardAppend(panel, "div", "bob-bank-setup-card-stale", null, { role: "group", "aria-label": "Stale after setting" });
  if (staleRow) {
    bankSetupCardAppend(staleRow, "span", "", staleText);
    const change = bankSetupCardAppend(staleRow, "button", "bob-bank-setup-card-action", "Change", {
      type: "button", "data-setup-action": "stale-after", "data-setup-card-focus": "stale-after",
    });
    if (change) change.disabled = modal.readOnly || modal.busy;
    if (stale.explicit === true) {
      const unset = bankSetupCardAppend(staleRow, "button", "bob-bank-setup-card-action", "Unset to default", {
        type: "button", "data-setup-action": "stale-after-unset", "data-setup-card-focus": "stale-after-unset",
      });
      if (unset) unset.disabled = modal.readOnly || modal.busy;
    }
  }
}

function bankSetupCardRuleRowText(rule, position) {
  if (!rule) return "";
  const number = Number.isInteger(position) && position >= 0 ? `${position + 1} ` : "";
  const parts = [`${number}${rule.match || "?"} → ${rule.catLabel || rule.cat || "no category"}`];
  if (rule.payee) parts.push(`payee ${rule.payee}`);
  if (rule.link) parts.push(rule.link);
  if (rule.readTimeDead) parts.push("read-time-dead pattern");
  return parts.join(" · ");
}

function bankSetupCardPaintRules(panel, modal, model) {
  const arrange = bankSetupCardArrangeContext(modal);
  const items = bankSetupCardProjectedRules(model, arrange);
  if (!items.length) {
    bankSetupCardAppend(panel, "p", "bob-bank-setup-card-empty", "None yet. bob already learns each merchant's name and category from your last filing; add a rule only to override that.");
  } else {
    const list = bankSetupCardAppend(panel, "ol", "bob-bank-setup-card-rules", null, {
      "aria-label": "Rules",
      "data-drag-scope": "rules",
    });
    const gaps = bankSetupCardGapMap(modal, "rules");
    for (let position = 0; position <= items.length; position += 1) {
      if (gaps.has(position)) {
        const holder = bankSetupCardAppend(list, "li", "bob-bank-setup-card-rule-gap");
        bankSetupCardPaintGapButton(holder, modal, "rules", position, gaps.get(position));
      }
      if (position >= items.length) continue;
      const item = items[position];
      const rule = item.entry || {};
      const selected = modal.selection?.id === item.id;
      const row = bankSetupCardAppend(list, "li", `bob-bank-setup-card-rule${selected ? " is-selected" : ""}`);
      if (!row) continue;
      const button = bankSetupCardAppend(row, "button", "bob-bank-setup-card-rule-button", null, {
        type: "button",
        "data-setup-card-rule": String(rule.index),
        "data-setup-card-focus": `rule-${rule.index}`,
        "aria-pressed": selected ? "true" : "false",
        "aria-label": bankSetupCardRuleRowText(rule, position),
      });
      if (button) {
        if (!modal.readOnly) bankSetupCardPaintGrip(button, "rules", item.id);
        bankSetupCardDecorateArrange(button, `rules:${item.id}`, arrange);
        bankSetupCardAppend(button, "strong", "", `${position + 1} ${rule.match || "?"} → ${rule.catLabel || rule.cat || "no category"}`);
        if (rule.payee || rule.link) bankSetupCardAppend(button, "span", "bob-bank-setup-card-muted", [rule.payee ? `payee ${rule.payee}` : null, rule.link || null].filter(Boolean).join(" · "));
        if (rule.readTimeDead) bankSetupCardAppend(button, "span", "bob-bank-setup-card-muted", "read-time-dead pattern");
        bankSetupCardListen(button, () => modal.selectItem(item.id));
      }
    }
  }
  const add = bankSetupCardAppend(panel, "button", "bob-bank-setup-card-action", "＋ New rule", {
    type: "button", "data-setup-new-rule": "true", "data-setup-card-focus": "new-rule",
  });
  if (add) add.disabled = modal.readOnly || modal.busy;
}

function bankSetupCardPaintChecks(panel, modal, model) {
  const status = bankSetupCardStatus(modal.report);
  bankSetupCardAppend(panel, "p", `bob-bank-setup-card-check-status is-${status.state}`, status.label, {
    role: status.state === "invalid" ? "alert" : "status",
  });
  const items = Array.isArray(model.findingItems) ? model.findingItems : [];
  if (items.length) {
    const list = bankSetupCardAppend(panel, "ul", "bob-bank-setup-card-findings", null, { "aria-label": "Bank config findings" });
    for (const item of items) {
      const finding = item.entry || {};
      const selected = modal.selection?.id === item.id;
      const row = bankSetupCardAppend(list, "li", `bob-bank-setup-card-finding is-${finding.severity || "error"}${selected ? " is-selected" : ""}`);
      if (!row) continue;
      const label = finding.label || finding.message || "finding";
      if (finding.line) {
        const jump = bankSetupCardAppend(row, "button", "bob-bank-setup-card-finding-jump", label, {
          type: "button",
          "data-setup-card-finding": String(item.index),
          "data-setup-line": String(finding.line),
          "data-setup-card-focus": `finding-${item.index}`,
          "aria-pressed": selected ? "true" : "false",
          "aria-label": `Open bank setup line ${finding.line}: ${finding.message}`,
        });
        bankSetupCardListen(jump, () => { modal.selectItem(item.id); modal.openYaml(finding.line); });
      } else {
        const jump = bankSetupCardAppend(row, "button", "bob-bank-setup-card-finding-jump", label, {
          type: "button",
          "data-setup-card-finding": String(item.index),
          "data-setup-card-focus": `finding-${item.index}`,
          "aria-pressed": selected ? "true" : "false",
          "aria-label": label,
        });
        bankSetupCardListen(jump, () => modal.selectItem(item.id));
      }
      if (finding.hint) bankSetupCardAppend(row, "span", "bob-bank-setup-card-muted", finding.hint);
    }
  }
  bankSetupCardAppend(panel, "button", "bob-bank-setup-card-yaml", "↗ Open YAML", {
    type: "button", "data-setup-action": "yaml",
    "data-setup-line": String(model.findings[0]?.line || modal.report?.line || 1),
  });
}

function bankSetupCardPaintSelection(parent, modal, model) {
  const item = model.selectedItem;
  if (!item) {
    const empty = modal.section === "accounts" ? "No account selected."
      : modal.section === "rules" ? "No rule selected."
      : modal.section === "checks" ? "No finding selected."
      : "No category selected.";
    return bankSetupCardAppend(parent, "p", "bob-bank-setup-card-selection", empty);
  }
  let text = "";
  if (item.type === "group") {
    text = item.hidden ? `HIDDEN · ${item.count} categories` : `${item.group.toUpperCase()} · ${item.count} categories`;
  } else if (item.type === "account") {
    text = bankSetupCardAccountRowText(item.entry);
  } else if (item.type === "rule") {
    const position = (model.ruleItems || []).findIndex((candidate) => candidate.id === item.id);
    text = bankSetupCardRuleRowText(item.entry, position);
  } else if (item.type === "finding") {
    const finding = item.entry || {};
    text = finding.label || finding.message || "finding";
    if (finding.hint) text += ` — ${finding.hint}`;
  } else {
    const entry = item.entry || {};
    const tile = item.tile || {};
    const key = tile.hotkey ? `key ${tile.hotkey.toUpperCase()} ${entry.hotkey_source === "derived" ? "derived" : entry.hotkey_source === "builtin_default" ? "built-in default" : "pinned"}` : "no key";
    const rows = Number.isInteger(entry.rows) ? `${entry.rows} ${entry.rows === 1 ? "row" : "rows"}` : "usage unknown";
    text = `${tile.text || entry.label || item.key} · stored as ${item.key} · ${key} · ${rows} · ${entry.rule_refs || 0} rules`;
    if (entry.builtin) text += " · built in";
    if (entry.hidden) text += " · hidden";
  }
  bankSetupCardAppend(parent, "p", "bob-bank-setup-card-selection", text, { role: "status" });
  if (item.type === "category" && bankSetupCardRestoreOp(item.entry)) {
    const restore = bankSetupCardAppend(parent, "button", "bob-bank-setup-card-action", "Restore default", {
      type: "button", "data-setup-action": "restore-default", "data-setup-card-focus": "restore-default",
    });
    if (restore) restore.disabled = modal.readOnly || modal.busy || Boolean(modal.stage);
  }
}

function bankSetupCardPaintStage(parent, modal, doc) {
  const stage = modal.stage;
  if (!stage) return;
  const section = bankSetupCardAppend(parent, "section", "bob-bank-setup-card-stage", null, {
    "aria-label": stage.title || "Staged bank setup edit",
  });
  if (stage.title) bankSetupCardAppend(section, "h3", "", stage.title);
  if (stage.kind === "edit" || stage.kind === "new") {
    const form = bankSetupCardAppend(section, "form", "bob-bank-setup-card-form", null, { autocomplete: "off" });
    form?.addEventListener?.("submit", (event) => { bankCategoryUiConsume(event); void modal.applyStage(); });
    bankSetupCardInput(form, modal, "label", "Label", stage.label, { placeholder: "e.g. ☕ Coffee" });
    bankSetupCardInput(form, modal, "group", "Group", stage.group, { placeholder: "e.g. Everyday" });
    bankSetupCardInput(form, modal, "hotkey", "Key", stage.hotkey, { placeholder: "free key" });
    if (stage.kind === "edit") {
      const entry = stage.entry || {};
      bankSetupCardAppend(section, "p", "bob-bank-setup-card-muted", entry.hotkey_source === "derived"
        ? "This key is derived; changing it pins the key you type."
        : "This key is pinned. Clear it to let bob derive a key.");
    } else {
      const status = bankCategoryNewHotkeyStatus(modal.categories, stage.hotkey);
      if (status.text) bankSetupCardAppend(section, "p", "bob-bank-setup-card-owner", status.text, { role: "status" });
    }
  } else if (stage.kind === "rename-group") {
    const form = bankSetupCardAppend(section, "form", "bob-bank-setup-card-form", null, { autocomplete: "off" });
    form?.addEventListener?.("submit", (event) => { bankCategoryUiConsume(event); void modal.applyStage(); });
    bankSetupCardInput(form, modal, "group-name", "New group name", stage.to, { placeholder: stage.group });
  } else if (stage.kind === "new-account" || stage.kind === "edit-account") {
    const form = bankSetupCardAppend(section, "form", "bob-bank-setup-card-form", null, { autocomplete: "off" });
    form?.addEventListener?.("submit", (event) => { bankCategoryUiConsume(event); void modal.applyStage(); });
    bankSetupCardInput(form, modal, "label", "Label", stage.label, { placeholder: "e.g. WF Savings" });
    if (stage.kind === "new-account") {
      bankSetupCardInput(form, modal, "kind", "Kind", stage.kindValue, { placeholder: "checking, savings, cash, credit" });
      bankSetupCardInput(form, modal, "start", "Start", stage.start, { placeholder: "YYYY-MM-DD (cash needs none)" });
      bankSetupCardInput(form, modal, "alias", "Alias", stage.alias, { placeholder: "derived from the label" });
      const status = typeof bankSetupCardAccountAddStatus === "function"
        ? bankSetupCardAccountAddStatus(modal.report?.accounts, stage)
        : { text: "" };
      const aliasText = status.alias ? `stored as ${status.alias}` : "stored as …";
      bankSetupCardAppend(section, "p", "bob-bank-setup-card-muted", `${aliasText} · appears on rows as [acct:: ${status.alias || "…"}]`, { role: "status" });
      if (status.text) bankSetupCardAppend(section, "p", "bob-bank-setup-card-owner", status.text, { role: "status" });
    } else {
      const entry = stage.entry || {};
      bankSetupCardAppend(section, "p", "bob-bank-setup-card-muted", `[acct:: ${entry.alias}] · ${entry.kind || ""}${entry.default === true ? " · default" : ""} · alias, kind, start, order, and default stay in YAML`);
    }
  } else if (stage.kind === "new-rule" || stage.kind === "edit-rule") {
    const form = bankSetupCardAppend(section, "form", "bob-bank-setup-card-form", null, { autocomplete: "off" });
    form?.addEventListener?.("submit", (event) => { bankCategoryUiConsume(event); void modal.applyStage(); });
    bankSetupCardInput(form, modal, "match", "Match", stage.match, { placeholder: "e.g. VENMO" });
    bankSetupCardInput(form, modal, "cat", "Category", stage.cat, { placeholder: "category key from the Categories tab" });
    bankSetupCardInput(form, modal, "payee", "Payee", stage.payee, { placeholder: "optional" });
    bankSetupCardInput(form, modal, "link", "Link", stage.link, { placeholder: "optional" });
    bankSetupCardAppend(section, "p", "bob-bank-setup-card-muted", "Checked top to bottom; future imports and hints only.");
  } else if (stage.kind === "stale-after") {
    const form = bankSetupCardAppend(section, "form", "bob-bank-setup-card-form", null, { autocomplete: "off" });
    form?.addEventListener?.("submit", (event) => { bankCategoryUiConsume(event); void modal.applyStage(); });
    bankSetupCardInput(form, modal, "stale-after", "Days", stage.days, { placeholder: "10" });
    bankSetupCardAppend(section, "p", "bob-bank-setup-card-muted", "Unset returns to the default 10 days.");
  } else {
    bankSetupCardAppend(section, "p", "bob-bank-setup-card-confirm", stage.confirmation || "Review bob's consequence, then press Enter to apply.");
  }
  const status = modal.sessionState || {};
  if (status.busy || status.status === "preview-pending") {
    bankSetupCardAppend(section, "p", "bob-bank-setup-card-consequence is-pending", "Previewing with bob…", { role: "status", "aria-live": "polite" });
  } else if (status.consequence) {
    bankSetupCardAppend(section, "p", "bob-bank-setup-card-consequence", status.consequence, { role: "status", "aria-live": "polite" });
  }
  if (status.refusal) {
    bankSetupCardAppend(section, "p", "bob-bank-setup-card-refusal", status.refusal.message || "bob refused this edit.", { role: "alert" });
    if (status.refusal.hint) bankSetupCardAppend(section, "p", "bob-bank-setup-card-muted", status.refusal.hint);
  }
  if (modal.staleMessage) {
    bankSetupCardAppend(section, "p", "bob-bank-setup-card-refusal", modal.staleMessage, { role: "alert" });
    const repreview = bankSetupCardAppend(section, "button", "bob-bank-setup-card-action", "Re-preview", { type: "button", "data-setup-action": "repreview" });
    if (repreview) repreview.disabled = modal.busy;
  }
  if (modal.syncWarning) {
    bankSetupCardAppend(section, "p", "bob-bank-setup-card-refusal", "Saved locally; sync failed.", { role: "status" });
    bankSetupCardAppend(section, "button", "bob-bank-setup-card-action", "Retry sync", { type: "button", "data-setup-action": "retry-sync" });
  }
  const actions = bankSetupCardAppend(section, "div", "bob-bank-setup-card-actions");
  const apply = bankSetupCardAppend(actions, "button", "bob-bank-setup-card-action is-primary", stage.kind === "undo" ? "Undo" : "Apply", {
    type: "button", "data-setup-action": "apply", "data-setup-card-focus": "apply",
  });
  if (apply) {
    apply.disabled = modal.busy || modal.readOnly || status.canApply !== true;
  }
  bankSetupCardAppend(actions, "button", "bob-bank-setup-card-action", "Cancel", {
    type: "button", "data-setup-action": "cancel", "data-setup-card-focus": "cancel-stage",
  });
}

function bankSetupCardPaint(modal) {
  const content = modal && modal.contentEl;
  if (!content) return null;
  const doc = content.ownerDocument || modal.app?.document || (typeof document !== "undefined" ? document : null);
  let focusId = "";
  let selectionStart = null;
  let selectionEnd = null;
  try {
    const active = doc?.activeElement;
    focusId = active?.getAttribute?.("data-setup-card-focus") || "";
    selectionStart = Number.isInteger(active?.selectionStart) ? active.selectionStart : null;
    selectionEnd = Number.isInteger(active?.selectionEnd) ? active.selectionEnd : null;
  } catch (_) {}
  try { if (typeof content.empty === "function") content.empty(); else content.textContent = ""; } catch (_) {}
  const model = bankSetupCardModel(modal.report, modal.selection);
  modal.model = model;
  modal.readOnly = model.state !== "valid";
  modal.selection = model.selection;
  const root = bankSetupCardAppend(content, "div", "bob-bank-setup-card", null, {
    "data-bank-setup-card": "true",
    "data-state": model.state,
    role: "document",
    "aria-label": "Bank setup editor",
  });
  if (!root) return model;
  bankSetupCardAppend(root, "h2", "bob-bank-setup-card-title", "🏦 Bank setup");
  bankSetupCardPaintTabs(root, modal, model);
  const panel = bankSetupCardAppend(root, "div", "bob-bank-setup-card-panel", null, {
    id: "bob-bank-setup-card-panel",
    role: "tabpanel",
    "aria-label": BANK_SETUP_CARD_SECTION_LABELS[modal.section] || "Categories",
  });
  if (modal.section === "categories") bankSetupCardPaintCategories(panel, modal, model, doc);
  else if (modal.section === "accounts") bankSetupCardPaintAccounts(panel, modal, model);
  else if (modal.section === "rules") bankSetupCardPaintRules(panel, modal, model);
  else bankSetupCardPaintChecks(panel, modal, model);
  bankSetupCardPaintSelection(root, modal, model);
  if (modal.stage) bankSetupCardPaintStage(root, modal, doc);
  else if (modal.savedMessage) bankSetupCardAppend(root, "p", "bob-bank-setup-card-saved", modal.savedMessage, { role: "status", "aria-live": "polite" });
  if (modal.errorMessage) bankSetupCardAppend(root, "p", "bob-bank-setup-card-refusal", modal.errorMessage, { role: "alert" });
  bankSetupCardAppend(root, "p", "bob-bank-setup-card-footer", modal.footerText(), null);
  modal.liveRegion = bankSetupCardAppend(root, "div", "bob-bank-setup-card-live", modal.liveText || "", {
    role: "status", "aria-live": "polite", "aria-atomic": "true",
  });
  if (focusId) {
    try {
      const next = root.querySelector?.(`[data-setup-card-focus="${focusId}"]`);
      next?.focus?.();
      if (selectionStart !== null && typeof next?.setSelectionRange === "function") next.setSelectionRange(selectionStart, selectionEnd ?? selectionStart);
    } catch (_) {}
  }
  return model;
}
