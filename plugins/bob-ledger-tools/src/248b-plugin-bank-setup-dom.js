// Bank Setup header painter (bob-cli-lt setup-header). The header reuses the
// Category card's tile component tile-for-tile: `bankSharedCategoryTile`
// paints both, with the card's look and tests unchanged. Header tiles use
// their own `data-bank-setup-category` attribute, never the card's
// `button[data-category-key]` selector. Every report string is inserted as
// text, never HTML.

function bankSetupEl(doc, tag, className, text, attrs) {
  if (typeof notebookCreateEl === "function") {
    const node = notebookCreateEl(doc, tag, className);
    if (!node) {
      return null;
    }
    if (text !== null && text !== undefined) {
      if (typeof notebookSetText === "function") {
        notebookSetText(node, String(text));
      } else {
        node.textContent = String(text);
      }
    }
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) {
        continue;
      }
      try {
        if (key === "disabled") {
          node.disabled = value === true;
        } else if (typeof node.setAttribute === "function") {
          node.setAttribute(key, String(value));
        }
      } catch (error) {}
    }
    return node;
  }
  if (!doc || typeof doc.createElement !== "function") {
    return null;
  }
  const node = doc.createElement(tag);
  if (!node) {
    return null;
  }
  if (className) {
    node.className = className;
  }
  if (text !== null && text !== undefined) {
    node.textContent = String(text);
  }
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    try {
      if (key === "disabled") {
        node.disabled = value === true;
      } else if (typeof node.setAttribute === "function") {
        node.setAttribute(key, String(value));
      }
    } catch (error) {}
  }
  return node;
}

function bankSetupAppend(parent, tag, className, text, attrs) {
  const doc = parent && parent.ownerDocument;
  const node = bankSetupEl(doc, tag, className, text, attrs);
  if (node && parent && typeof parent.appendChild === "function") {
    parent.appendChild(node);
  }
  return node;
}

function bankSetupListen(node, run) {
  if (!node || typeof run !== "function") {
    return;
  }
  try {
    if (typeof notebookBindAction === "function") {
      notebookBindAction(node, run);
    } else if (typeof node.addEventListener === "function") {
      node.addEventListener("click", (event) => {
        try {
          if (event && typeof event.preventDefault === "function") {
            event.preventDefault();
          }
        } catch (error) {}
        run();
      });
    }
  } catch (error) {}
}

// Shared bank tile component. The Category card keeps its exact look: pass
// `{ card: true }` (keyed by `data-category-key`, pressed state, Enter
// marker). The Setup header passes header options (keyed by
// `data-bank-setup-category`, tooltip, accessible name, usage count).
function bankSharedCategoryTile(doc, tile, options = {}) {
  if (!tile || typeof tile.key !== "string" || !tile.key) {
    return null;
  }
  const card = options.card === true;
  const attrs = { type: "button" };
  if (card) {
    attrs["data-category-key"] = tile.key;
    attrs["aria-pressed"] = options.selected === true ? "true" : "false";
    if (tile.hotkey) {
      attrs["aria-keyshortcuts"] = tile.hotkey;
    }
  } else {
    attrs["data-bank-setup-category"] = tile.key;
    attrs["aria-label"] = tile.ariaLabel || tile.text || tile.label || tile.key;
    if (tile.tooltip) {
      attrs.title = tile.tooltip;
    }
    if (Number.isInteger(tile.line) && tile.line > 0) {
      attrs["data-bank-setup-line"] = String(tile.line);
    }
  }
  const classes = ["bob-bank-category-tile"];
  if (card && options.selected === true) {
    classes.push("is-highlighted");
  }
  if (tile.dimmed) {
    classes.push("is-dimmed");
  }
  if (!card && tile.hidden === true) {
    classes.push("is-hidden");
  }
  const button = bankSetupEl(doc, "button", classes.join(" "), null, attrs);
  if (!button) {
    return null;
  }
  try {
    button.disabled = card ? options.disabled === true : true;
  } catch (error) {}
  if (tile.keycap) {
    const keycapClasses = ["bob-bank-category-keycap"];
    if (!card && tile.keycapStyle === "dashed") {
      keycapClasses.push("is-derived");
    }
    const keycap = bankSetupEl(doc, "kbd", keycapClasses.join(" "), tile.keycap, null);
    if (keycap && typeof button.appendChild === "function") {
      button.appendChild(keycap);
    }
  } else if (!card) {
    const dot = bankSetupEl(doc, "span", "bob-bank-category-keydot", "·", { "aria-hidden": "true" });
    if (dot && typeof button.appendChild === "function") {
      button.appendChild(dot);
    }
  }
  const label = `${tile.emoji ? `${tile.emoji} ` : ""}${tile.label || tile.key}`;
  const labelEl = bankSetupEl(doc, "span", "bob-bank-category-tile-label", label, null);
  if (labelEl && typeof button.appendChild === "function") {
    button.appendChild(labelEl);
  }
  if (!card && Number.isInteger(tile.rows) && tile.rows > 0) {
    const count = bankSetupEl(doc, "span", "bob-bank-setup-tile-count", String(tile.rows), null);
    if (count && typeof button.appendChild === "function") {
      button.appendChild(count);
    }
  }
  if (card && options.selected === true) {
    const enter = bankSetupEl(doc, "span", "bob-bank-category-enter", "↵", null);
    if (enter && typeof button.appendChild === "function") {
      button.appendChild(enter);
    }
  }
  return button;
}

function bankSetupYamlButton(doc, handlers) {
  const yaml = bankSetupEl(doc, "button", "bob-bank-setup-yaml", "↗ YAML", {
    type: "button",
    "data-bank-setup-focus": "yaml",
    "aria-label": "Open bank setup in Source mode",
  });
  bankSetupListen(yaml, () => {
    if (handlers && typeof handlers.onYaml === "function") {
      handlers.onYaml();
    }
  });
  return yaml;
}

function bankSetupJumpButton(doc, label, line, handlers, extraClass) {
  const button = bankSetupEl(doc, "button", extraClass || "bob-bank-setup-jump", label, {
    type: "button",
    "data-bank-setup-line": line !== null && line !== undefined ? String(line) : "",
  });
  bankSetupListen(button, () => {
    if (handlers && typeof handlers.onJump === "function") {
      handlers.onJump(line);
    }
  });
  return button;
}

function bankSetupSectionLabel(parent, text, note) {
  const row = bankSetupAppend(parent, "div", "bob-bank-setup-section-head", null, null);
  if (!row) {
    return;
  }
  bankSetupAppend(row, "span", "bob-bank-setup-section-label", text, null);
  if (note) {
    bankSetupAppend(row, "span", "bob-bank-setup-section-note", note, null);
  }
}

function bankSetupPaintAccounts(body, model, doc, handlers) {
  const accounts = Array.isArray(model.accounts) ? model.accounts : [];
  if (accounts.length === 0) {
    return;
  }
  const staleNote = model.staleAfterDays !== null && model.staleAfterDays !== undefined
    ? `balances go stale after ${model.staleAfterDays} day${model.staleAfterDays === 1 ? "" : "s"}`
    : null;
  bankSetupSectionLabel(body, "ACCOUNTS", staleNote);
  const list = bankSetupAppend(body, "div", "bob-bank-setup-accounts", null, { role: "list" });
  if (!list) {
    return;
  }
  for (const account of accounts) {
    const row = bankSetupAppend(list, "div", "bob-bank-setup-account", null, { role: "listitem" });
    if (!row) {
      continue;
    }
    const name = `🏦 ${account.label}`;
    if (account.line !== null) {
      const jump = bankSetupJumpButton(doc, name, account.line, handlers, "bob-bank-setup-account-name");
      if (jump && typeof row.appendChild === "function") {
        row.appendChild(jump);
      }
    } else {
      bankSetupAppend(row, "span", "bob-bank-setup-account-name", name, null);
    }
    const meta = [
      account.kind,
      account.default ? "default" : null,
      account.sinceLabel,
    ].filter(Boolean).join(" · ");
    if (meta) {
      bankSetupAppend(row, "span", "bob-bank-setup-account-meta", meta, null);
    }
    const status = bankSetupAppend(row, "span", `bob-bank-setup-status is-${account.statusTone}`, null, null);
    if (status) {
      bankSetupAppend(status, "span", "bob-bank-setup-status-icon", account.statusIcon, { "aria-hidden": "true" });
      bankSetupAppend(status, "span", "bob-bank-setup-status-word", account.status, null);
      if (account.hint) {
        try {
          status.setAttribute("title", account.hint);
        } catch (error) {}
      }
    }
  }
}

function bankSetupPaintCategories(body, model, doc, handlers) {
  bankSetupSectionLabel(body, "CATEGORIES", "what Ctrl+Enter offers, in order");
  const sections = Array.isArray(model.sections) ? model.sections : [];
  const hidden = Array.isArray(model.hiddenTiles) ? model.hiddenTiles : [];
  if (sections.length === 0 && hidden.length === 0) {
    bankSetupAppend(body, "p", "bob-bank-setup-empty", "No categories yet.", null);
    return;
  }
  for (const section of sections) {
    const wrap = bankSetupAppend(body, "div", "bob-bank-setup-group", null, null);
    if (!wrap) {
      continue;
    }
    if (section.group) {
      bankSetupAppend(wrap, "span", "bob-bank-setup-group-label", section.group, null);
    }
    if (section.group === "Money moves") {
      bankSetupAppend(wrap, "p", "bob-bank-setup-hidden-note", "built in · shown first for money in", null);
    }
    const tiles = bankSetupAppend(wrap, "div", "bob-bank-setup-tiles", null, { role: "group" });
    if (!tiles) {
      continue;
    }
    for (const tile of section.tiles || []) {
      const button = bankSharedCategoryTile(doc, tile, {});
      if (!button) {
        continue;
      }
      bankSetupListen(button, () => {
        if (handlers && typeof handlers.onJump === "function") {
          handlers.onJump(tile.line);
        }
      });
      if (typeof tiles.appendChild === "function") {
        tiles.appendChild(button);
      }
    }
  }
  if (hidden.length > 0) {
    const wrap = bankSetupAppend(body, "div", "bob-bank-setup-group is-hidden-group", null, null);
    if (wrap) {
      bankSetupAppend(wrap, "span", "bob-bank-setup-group-label", "HIDDEN", null);
      const tiles = bankSetupAppend(wrap, "div", "bob-bank-setup-tiles", null, { role: "group" });
      if (tiles) {
        for (const tile of hidden) {
          const button = bankSharedCategoryTile(doc, { ...tile, hidden: true }, {});
          if (!button) {
            continue;
          }
          bankSetupListen(button, () => {
            if (handlers && typeof handlers.onJump === "function") {
              handlers.onJump(tile.line);
            }
          });
          if (typeof tiles.appendChild === "function") {
            tiles.appendChild(button);
          }
        }
        bankSetupAppend(wrap, "p", "bob-bank-setup-hidden-note", "still valid on rows, never offered", null);
      }
    }
  }
  const free = Array.isArray(model.freeKeys) ? model.freeKeys : [];
  if (free.length > 0) {
    const row = bankSetupAppend(body, "div", "bob-bank-setup-free", null, null);
    if (row) {
      bankSetupAppend(row, "span", "bob-bank-setup-group-label", "free keys", null);
      bankSetupAppend(row, "span", "bob-bank-setup-free-keys", free.join(" ").toUpperCase(), null);
    }
  }
}

function bankSetupPaintRules(body, model, doc, handlers) {
  bankSetupSectionLabel(body, "RULES", "checked top to bottom on import and hints");
  const rules = Array.isArray(model.rules) ? model.rules : [];
  if (rules.length === 0) {
    bankSetupAppend(body, "p", "bob-bank-setup-rules-empty", "None yet. bob already learns each merchant's name and category from your last filing; add a rule only to override that.", null);
    return;
  }
  const list = bankSetupAppend(body, "ol", "bob-bank-setup-rules", null, null);
  if (!list) {
    return;
  }
  for (const rule of rules) {
    const item = bankSetupAppend(list, "li", "bob-bank-setup-rule", null, null);
    if (!item) {
      continue;
    }
    if (Number.isInteger(rule.index)) {
      bankSetupAppend(item, "span", "bob-bank-setup-rule-index", String(rule.index + 1), null);
    }
    const text = [rule.match, "→", rule.catLabel || rule.cat || ""].filter(Boolean).join(" ");
    if (rule.line !== null) {
      const jump = bankSetupJumpButton(doc, text, rule.line, handlers, "bob-bank-setup-rule-text");
      if (jump && typeof item.appendChild === "function") {
        item.appendChild(jump);
      }
    } else {
      bankSetupAppend(item, "span", "bob-bank-setup-rule-text", text, null);
    }
    if (rule.payee) {
      bankSetupAppend(item, "span", "bob-bank-setup-rule-payee", `payee ${rule.payee}`, null);
    }
    if (rule.readTimeDead) {
      bankSetupAppend(item, "span", "bob-bank-setup-rule-warning", "read-time dead: journal text is digit-masked", { role: "note" });
    }
  }
}

function bankSetupPaintFindings(body, model, doc, handlers) {
  const findings = Array.isArray(model.findings) ? model.findings : [];
  if (findings.length === 0) {
    return;
  }
  const banner = bankSetupAppend(body, "div", "bob-bank-setup-banner is-invalid", null, { role: "alert" });
  if (banner) {
    const errors = findings.filter((entry) => entry.severity === "error").length;
    const warnings = findings.length - errors;
    const summary = errors > 0
      ? `✗ ${errors} problem${errors === 1 ? "" : "s"} in bank: — the bank pauses until they're fixed`
      : `⚠ ${warnings} warning${warnings === 1 ? "" : "s"} in bank:`;
    bankSetupAppend(banner, "p", "bob-bank-setup-banner-text", summary, null);
    const list = bankSetupAppend(banner, "ul", "bob-bank-setup-findings", null, null);
    if (list) {
      for (const finding of findings) {
        const item = bankSetupAppend(list, "li", `bob-bank-setup-finding is-${finding.severity}`, null, null);
        if (!item) {
          continue;
        }
        if (finding.line !== null) {
          const jump = bankSetupJumpButton(doc, finding.label, finding.line, handlers, "bob-bank-setup-finding-text");
          if (jump && typeof item.appendChild === "function") {
            item.appendChild(jump);
          }
        } else {
          bankSetupAppend(item, "span", "bob-bank-setup-finding-text", finding.label, null);
        }
        if (finding.hint) {
          bankSetupAppend(item, "span", "bob-bank-setup-finding-hint", finding.hint, null);
        }
      }
    }
  }
  if (model.lastGoodLabel) {
    bankSetupAppend(body, "p", "bob-bank-setup-lastgood", `last good · ${model.lastGoodLabel}`, null);
  } else if (model.partial) {
    bankSetupAppend(body, "p", "bob-bank-setup-lastgood", "partly read", null);
  }
}

// Fallback identity when the host passes no identity (older callers, offline
// previews): the hub title with no crumbs or subtitle.
function bankSetupFallbackIdentity(model) {
  const path = (model && model.path) || BANK_SETUP_HUB_PATH;
  const stem = String(path.split("/").pop() || "bank.md").replace(/\.md$/i, "") || "bank";
  return {
    kind: "bank",
    path,
    stem,
    title: "Bank",
    emoji: "🏦",
    heading: "🏦 Bank",
    summary: "",
    owners: [],
    ancestryBroken: false,
    ancestryMessage: "",
  };
}

// The title block: kit tile/kicker/title/subtitle with the Setup and YAML
// actions in the kicker row. Pure: kicker navigation arrives as
// handlers.onKicker(target, event). A click on Setup never toggles the fold:
// it is a separate button from the fold row below.
function bankSetupTitleBlock(doc, identity, spec = {}) {
  try {
    if (!identity || !doc) return null;
    const handlers = spec.handlers || {};
    const block = propertyCardBuildTitleBlock(doc, {
      kind: "bank",
      title: identity.title,
      subtitle: identity.summary || "",
      tile: { emoji: identity.emoji || "🏦" },
      kicker: (identity.owners || []).map((owner) => ({
        text: owner.title || owner.stem || "",
        target: owner.path,
      })),
      onLink: (target, event) => {
        if (typeof handlers.onKicker === "function") handlers.onKicker(target, event);
      },
    });
    if (!block) return null;
    for (const link of Array.from(block.element.querySelectorAll?.(".bob-property-card-kicker-link") || [])) {
      try {
        link.setAttribute("data-bank-setup-focus", `crumb:${link.getAttribute?.("data-href") || ""}`);
      } catch (_) {}
    }
    if (spec.showSetup === true) {
      const setup = bankSetupEl(doc, "button", "bob-bank-setup-edit", "⊞ Setup", {
        type: "button",
        "data-bank-setup-focus": "edit",
        "aria-label": "Edit bank setup",
      });
      if (setup) {
        bankSetupListen(setup, () => {
          if (typeof handlers.onSetup === "function") handlers.onSetup();
        });
        block.actions.appendChild(setup);
      }
    }
    if (spec.showYaml === true) {
      const yaml = bankSetupYamlButton(doc, handlers);
      if (yaml && block.actions.appendChild) block.actions.appendChild(yaml);
    }
    if (identity.ancestryMessage) {
      const note = bankSetupEl(doc, "p", "bob-bank-setup-ancestry-note", identity.ancestryMessage, { role: "note" });
      if (note && block.element.appendChild) block.element.appendChild(note);
    }
    return block.element;
  } catch (_) {
    return null;
  }
}

// `bankSetupBuildEl(model, options, doc)`: the whole Setup card. `model`
// is a `bankSetupModel`; `options` carries sourcePath, keyLive, identity,
// and `handlers` (onToggle, onSetup, onYaml, onKicker, onJump(line),
// onCopyStarter, onRetry). Older callers pass handlers directly; they get
// bank.md with the fallback identity and no keycap. Every state paints the
// kit title block first (demoted until the host's adoption owns the title);
// foldable states (valid, invalid, missing with a starter) render the
// shared fold row; bodyless states render a static row without fold
// attributes so `_` falls through to Vim. All report strings enter as text.
function bankSetupBuildEl(model, optionsOrHandlers, doc) {
  if (!model) {
    return null;
  }
  const options = optionsOrHandlers && typeof optionsOrHandlers === "object" && optionsOrHandlers.handlers
    ? optionsOrHandlers
    : { handlers: optionsOrHandlers || {}, sourcePath: BANK_SETUP_HUB_PATH, keyLive: false };
  const handlers = options.handlers || {};
  const sourcePath = typeof options.sourcePath === "string" && options.sourcePath
    ? options.sourcePath
    : (model.path || BANK_SETUP_HUB_PATH);
  const keyLive = options.keyLive === true;
  const identity = options.identity && typeof options.identity === "object" && options.identity.title
    ? options.identity
    : bankSetupFallbackIdentity(model);
  const showSetup = model.desktop === true && (model.state === "valid" || model.state === "invalid");
  const showYaml = model.state === "invalid" || model.state === "missing"
    || model.state === "unsupported" || model.state === "mobile";
  const root = bankSetupEl(doc, "section", `${BANK_SETUP_CLASS} bob-property-card is-${model.state}`, null, {
    "data-bank-setup": "true",
    "data-bank-setup-state": model.state,
  });
  if (!root || typeof root.appendChild !== "function") {
    return root;
  }
  try {
    propertyCardApplyIdentity(root, { kind: "bank", title: identity.title });
  } catch (_) {}
  const title = bankSetupTitleBlock(doc, identity, { showSetup, showYaml, handlers });
  if (title) {
    root.appendChild(title);
  }
  try {
    propertyCardDemoteTitleHeading(root);
  } catch (_) {}
  const foldable = typeof model.foldable === "boolean" ? model.foldable : bankSetupIsFoldable(model);
  const paintStatic = (text, attrs, withRetry) => {
    const wrap = bankSetupEl(doc, "div", "bob-bank-setup-static", null, null);
    if (!wrap) {
      return;
    }
    root.appendChild(wrap);
    bankSetupAppend(wrap, "span", "bob-bank-setup-collapsed", text, attrs || null);
    if (withRetry) {
      const retry = bankSetupEl(doc, "button", "bob-bank-retry", "Retry", { type: "button" });
      if (retry) {
        bankSetupListen(retry, () => {
          if (handlers && typeof handlers.onRetry === "function") {
            handlers.onRetry();
          }
        });
        wrap.appendChild(retry);
      }
    }
  };
  if (!foldable) {
    if (model.state === "mobile") {
      paintStatic("drawn by bob on desktop", null, false);
      return root;
    }
    if (model.state === "loading") {
      paintStatic("Setup · loading…", { role: "status" }, false);
      return root;
    }
    if (model.state === "unsupported") {
      paintStatic("Setup needs a newer bob — run bob update", { role: "status" }, false);
      return root;
    }
    if (model.state === "missing") {
      paintStatic("Setup · no bank: mapping yet", null, false);
      return root;
    }
    if (model.state === "refresh-failed") {
      paintStatic(model.errorMessage || "Setup · refresh failed", { role: "alert" }, true);
      return root;
    }
    paintStatic(model.collapsedLine || "Setup", null, false);
    return root;
  }
  const summary = model.state === "missing" ? "no bank: mapping yet" : (model.collapsedLine || "Setup");
  let bodyId = null;
  try {
    bodyId = typeof propertyCardFoldNextId === "function" ? propertyCardFoldNextId() : "bob-bank-setup-body";
  } catch (_) {
    bodyId = "bob-bank-setup-body";
  }
  let fold = null;
  try {
    fold = typeof propertyCardBuildFoldRow === "function"
      ? propertyCardBuildFoldRow(doc, {
        kind: "bank",
        path: sourcePath,
        noun: "Setup",
        summary,
        open: model.expanded === true,
        bodyId,
        className: "bob-bank-setup-toggle",
        attention: model.attention || null,
        keyLive,
        tooltip: "Toggle bank setup (_)",
        onToggle: () => {
          if (handlers && typeof handlers.onToggle === "function") {
            handlers.onToggle();
          }
        },
      })
      : null;
  } catch (_) {
    fold = null;
  }
  if (!fold || !fold.element) {
    const fallback = bankSetupEl(doc, "button", "bob-bank-setup-toggle", model.expanded ? "▾ Setup" : "▸ Setup", {
      type: "button",
      "data-bank-setup-focus": "toggle",
      "aria-expanded": model.expanded ? "true" : "false",
      "aria-controls": bodyId,
    });
    if (fallback) {
      bankSetupListen(fallback, () => {
        if (handlers && typeof handlers.onToggle === "function") {
          handlers.onToggle();
        }
      });
      root.appendChild(fallback);
    }
  } else {
    try {
      fold.element.setAttribute("data-bank-setup-focus", "toggle");
    } catch (_) {}
    root.appendChild(fold.element);
    if (fold.bodyId) {
      bodyId = fold.bodyId;
    }
  }
  if (model.stale) {
    const staleText = model.lastGoodLabel
      ? `Updating · last good values from ${model.lastGoodLabel}`
      : "Updating · last good values shown";
    const note = bankSetupAppend(root, "div", "bob-bank-setup-status", staleText, { role: "status" });
    if (note && model.errorMessage) {
      const retry = bankSetupEl(doc, "button", "bob-bank-retry", "Retry", { type: "button" });
      if (retry) {
        bankSetupListen(retry, () => {
          if (handlers && typeof handlers.onRetry === "function") {
            handlers.onRetry();
          }
        });
        note.appendChild(retry);
      }
    }
  }
  const body = bankSetupEl(doc, "div", "bob-bank-setup-body", null, { id: bodyId });
  if (!body) {
    return root;
  }
  root.appendChild(body);
  if (model.expanded !== true) {
    try {
      body.setAttribute("hidden", "");
    } catch (_) {}
    return root;
  }
  if (model.state === "missing") {
    bankSetupAppend(body, "p", "bob-bank-setup-empty", "Copy the starter block into bank.md frontmatter, then edit it in Source mode.", null);
    const copy = bankSetupEl(doc, "button", "bob-bank-setup-copy", "Copy starter", { type: "button" });
    if (copy) {
      bankSetupListen(copy, () => {
        if (handlers && typeof handlers.onCopyStarter === "function") {
          handlers.onCopyStarter();
        }
      });
      body.appendChild(copy);
    }
    return root;
  }
  bankSetupPaintFindings(body, model, doc, handlers);
  bankSetupPaintAccounts(body, model, doc, handlers);
  bankSetupPaintCategories(body, model, doc, handlers);
  bankSetupPaintRules(body, model, doc, handlers);
  return root;
}
