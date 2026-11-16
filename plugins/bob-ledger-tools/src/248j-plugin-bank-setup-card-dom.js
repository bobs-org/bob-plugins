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
  bankSetupCardListen(button, () => modal.selectItem(item.id));
  parent.appendChild?.(button);
  return button;
}

function bankSetupCardPaintCategories(panel, modal, model, doc) {
  bankSetupCardAppend(panel, "p", "bob-bank-setup-card-section-note", "Letters select a category. Enter edits it; all changes preview through bob.");
  if (!model.categories.length) {
    bankSetupCardAppend(panel, "p", "bob-bank-setup-card-empty", "No categories are available.");
  }
  for (const section of model.sections) {
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
      bankSetupCardListen(label, () => groupItem && modal.selectItem(groupItem.id));
      if (section.group === BANK_SETUP_MONEY_GROUP) bankSetupCardAppend(wrap, "span", "bob-bank-setup-card-group-note", "built in · shown first for money in");
    }
    const tiles = bankSetupCardAppend(wrap, "div", "bob-bank-setup-card-tiles", null, { role: "group", "aria-label": section.group || "Ungrouped categories" });
    for (const tile of section.tiles || []) {
      const item = model.items.find((candidate) => candidate.type === "category" && candidate.key === tile.key);
      if (item) bankSetupCardPaintTile(tiles, modal, item, doc);
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

function bankSetupCardPaintAccounts(panel, model) {
  bankSetupCardAppend(panel, "p", "bob-bank-setup-card-section-note", "Accounts are shown from bob's current report.");
  if (!model.accounts.length) return bankSetupCardAppend(panel, "p", "bob-bank-setup-card-empty", "No accounts are configured.");
  const list = bankSetupCardAppend(panel, "div", "bob-bank-setup-card-readonly-list", null, { role: "list", "aria-label": "Accounts" });
  for (const account of model.accounts) {
    const row = bankSetupCardAppend(list, "div", "bob-bank-setup-card-readonly-row", null, { role: "listitem" });
    bankSetupCardAppend(row, "strong", "", account.label);
    bankSetupCardAppend(row, "span", "", [account.kind, account.default ? "default" : "", account.status].filter(Boolean).join(" · "));
  }
}

function bankSetupCardPaintRules(panel, model) {
  bankSetupCardAppend(panel, "p", "bob-bank-setup-card-section-note", "Rules are checked top to bottom on imports and hints.");
  if (!model.rules.length) return bankSetupCardAppend(panel, "p", "bob-bank-setup-card-empty", "No rules are configured.");
  const list = bankSetupCardAppend(panel, "ol", "bob-bank-setup-card-readonly-list", null, { "aria-label": "Rules" });
  for (const rule of model.rules) {
    const row = bankSetupCardAppend(list, "li", "bob-bank-setup-card-readonly-row");
    bankSetupCardAppend(row, "strong", "", `${rule.match} → ${rule.catLabel || "no category"}`);
    if (rule.payee || rule.link) bankSetupCardAppend(row, "span", "", [rule.payee, rule.link].filter(Boolean).join(" · "));
    if (rule.readTimeDead) bankSetupCardAppend(row, "span", "bob-bank-setup-card-muted", "read-time-dead pattern");
  }
}

function bankSetupCardPaintChecks(panel, modal, model) {
  const status = bankSetupCardStatus(modal.report);
  bankSetupCardAppend(panel, "p", `bob-bank-setup-card-check-status is-${status.state}`, status.label, {
    role: status.state === "invalid" ? "alert" : "status",
  });
  if (model.findings.length) {
    const list = bankSetupCardAppend(panel, "ul", "bob-bank-setup-card-findings", null, { "aria-label": "Bank config findings" });
    for (const finding of model.findings) {
      const row = bankSetupCardAppend(list, "li", `bob-bank-setup-card-finding is-${finding.severity}`);
      if (finding.line) {
        const jump = bankSetupCardAppend(row, "button", "bob-bank-setup-card-finding-jump", finding.label, {
          type: "button", "data-setup-line": String(finding.line), "aria-label": `Open bank setup line ${finding.line}: ${finding.message}`,
        });
        bankSetupCardListen(jump, () => modal.openYaml(finding.line));
      } else {
        bankSetupCardAppend(row, "span", "", finding.label);
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
  if (!item) return bankSetupCardAppend(parent, "p", "bob-bank-setup-card-selection", "No category selected.");
  let text = "";
  if (item.type === "group") {
    text = item.hidden ? `HIDDEN · ${item.count} categories` : `${item.group.toUpperCase()} · ${item.count} categories`;
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
    restore.disabled = modal.readOnly || modal.busy || Boolean(modal.stage);
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
    bankSetupCardAppend(section, "button", "bob-bank-setup-card-action", "Re-preview", { type: "button", "data-setup-action": "repreview" });
    preview.disabled = modal.busy;
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
  else if (modal.section === "accounts") bankSetupCardPaintAccounts(panel, model);
  else if (modal.section === "rules") bankSetupCardPaintRules(panel, model);
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
