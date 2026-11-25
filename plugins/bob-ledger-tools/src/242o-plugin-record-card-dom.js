// Record Card DOM: bob-key-card chrome, sheet value renderers, choices
// stage, status, hints, All actions, and a polite live region.
function recordCardDomDoc(root) {
  try {
    if (typeof notebookDomDoc === "function") return notebookDomDoc(root);
  } catch (_) {}
  try {
    if (root && root.ownerDocument) return root.ownerDocument;
  } catch (_) {}
  try {
    if (typeof document !== "undefined") return document;
  } catch (_) {}
  return null;
}

function recordCardEl(doc, tag, className) {
  return typeof notebookCreateEl === "function"
    ? notebookCreateEl(doc, tag, className)
    : (doc && typeof doc.createElement === "function"
      ? (() => {
        const node = doc.createElement(tag);
        if (className && typeof node.setAttribute === "function") node.setAttribute("class", className);
        return node;
      })()
      : null);
}

function recordCardText(el, text) {
  if (typeof notebookSetText === "function") notebookSetText(el, text);
  else if (el) el.textContent = String(text == null ? "" : text);
}

function recordCardRegionEmpty(node) {
  if (typeof albumSchemaRegionEmpty === "function") {
    albumSchemaRegionEmpty(node);
    return;
  }
  if (!node) return;
  try {
    if (typeof node.empty === "function") { node.empty(); return; }
  } catch (_) {}
  try {
    while (node.firstChild) node.removeChild(node.firstChild);
  } catch (_) {}
}

function recordCardRegion(card, name) {
  if (!card || !name) return null;
  const nodes = card.querySelectorAll?.("[data-record-card-region]") || [];
  for (const node of nodes) {
    if (node.getAttribute?.("data-record-card-region") === name) return node;
  }
  return null;
}

function recordCardButton(doc, host, text, options = {}) {
  const button = recordCardEl(doc, "button", options.className || "bob-record-card-action");
  if (!button) return null;
  button.setAttribute("type", "button");
  if (options.action) button.setAttribute("data-record-action", options.action);
  if (options.targetKey) button.setAttribute("data-target-key", options.targetKey);
  if (options.choice) button.setAttribute("data-choice-value", options.choice);
  button.setAttribute("aria-label", options.ariaLabel || text);
  if (options.current) {
    const cls = `${button.getAttribute("class") || ""} is-selected`.trim();
    button.setAttribute("class", cls);
    button.setAttribute("aria-current", "true");
  }
  if (options.disabled) {
    button.disabled = true;
    if (options.reason) button.setAttribute("title", options.reason);
  }
  recordCardText(button, text);
  if (host) host.appendChild(button);
  return button;
}

function recordCardPaintValue(host, doc, target, options) {
  if (!host) return;
  if (target && target.ghost) {
    const ghost = recordCardEl(doc, "span", "bob-record-sheet-ghost bob-record-card-ghost");
    recordCardText(ghost, `＋ ${target.label || target.key}`);
    host.appendChild(ghost);
    return;
  }
  if (target && target.state === "missing") {
    const missing = recordCardEl(doc, "span", "bob-record-sheet-missing bob-record-card-missing");
    recordCardText(missing, "missing");
    host.appendChild(missing);
    return;
  }
  const row = target && target.row;
  if (row && typeof recordSheetRenderSpans === "function") {
    recordSheetRenderSpans(host, doc, row.spans, options);
    if (row.lint && row.state === "invalid") {
      const lint = recordCardEl(doc, "span", "bob-record-sheet-lint");
      recordCardText(lint, row.lint);
      host.appendChild(lint);
    }
    return;
  }
  recordCardText(host, (target && (target.display || target.value)) || "—");
}

function recordCardPaintHeader(card, sheetModel, options, doc) {
  const host = recordCardRegion(card, "header");
  if (!host || !doc) return;
  recordCardRegionEmpty(host);
  // Species identity: the sheet tile (album emoji, else file-text) and the
  // word Record lead the header, so the = climb to the album card editor
  // visibly changes species. The tile carries the emoji, so the h2 drops it;
  // without a badge the h2 keeps today's emoji-prefixed title.
  const badge = typeof propertyCardBuildIdentityBadge === "function"
    ? propertyCardBuildIdentityBadge(doc, { kind: "record", emoji: String((sheetModel && sheetModel.emoji) || "").trim() })
    : null;
  if (badge) host.appendChild(badge);
  const title = recordCardEl(doc, "h2", "bob-record-card-title bob-key-card-title");
  recordCardText(title, badge ? recordCardHeadingText(sheetModel) : recordCardTitle(sheetModel));
  host.appendChild(title);
  const subtitle = recordCardEl(doc, "p", "bob-record-card-subtitle bob-key-card-subtitle");
  recordCardText(subtitle, recordCardSubtitle(sheetModel));
  host.appendChild(subtitle);
  if (options && options.warning) {
    const warning = recordCardEl(doc, "p", "bob-record-card-warning");
    recordCardText(warning, options.warning);
    host.appendChild(warning);
  }
}

function recordCardPaintRow(doc, target, selectedKey, options) {
  const editing = Boolean(options && options.stage && options.stage.field === target.key && options.stage.kind !== "choices");
  const row = recordCardEl(doc, "button", `bob-record-card-row${target.ghost ? " is-ghost" : ""}${editing ? " is-editing" : ""}`);
  row.setAttribute("type", "button");
  row.setAttribute("role", "option");
  row.setAttribute("data-target-key", target.key);
  row.setAttribute("aria-label", `${target.label}${target.required ? ", required" : ""}`);
  if (target.key === selectedKey) {
    row.setAttribute("class", `${row.getAttribute("class") || ""} is-selected`.trim());
    row.setAttribute("aria-selected", "true");
    row.setAttribute("aria-current", "true");
  } else {
    row.setAttribute("aria-selected", "false");
  }
  const label = recordCardEl(doc, "span", "bob-record-card-label");
  recordCardText(label, target.label || target.key);
  if (target.required) {
    const mark = recordCardEl(doc, "span", "bob-record-card-required");
    recordCardText(mark, "*");
    label.appendChild(mark);
  }
  row.appendChild(label);
  const value = recordCardEl(doc, "span", "bob-record-card-value");
  recordCardPaintValue(value, doc, target, options);
  row.appendChild(value);
  return row;
}

// An open typed stage keeps its inline container (and so its live input)
// in the document while the rows around it repaint; removing a focused
// input would drop focus, IME state, and its native undo history.
function recordCardKeptStageEl(host, stage, targets) {
  try {
    if (!host || !stage || !stage.kind || stage.kind === "choices" || !stage.field) return null;
    if (!(Array.isArray(targets) && targets.some((target) => target && target.key === stage.field))) return null;
    const el = host.querySelector?.("[data-record-card-stage]");
    const list = el && el.parentNode;
    if (!list || list.parentNode !== host || typeof list.insertBefore !== "function") return null;
    if (el.getAttribute?.("data-record-card-stage") !== stage.kind) return null;
    if (el.getAttribute?.("data-record-card-stage-field") !== stage.field) return null;
    return el;
  } catch (_) {
    return null;
  }
}

function recordCardPaintBody(card, targets, options, doc) {
  const host = recordCardRegion(card, "body");
  if (!host || !doc) return;
  const selectedKey = options && options.selectedKey;
  const kept = recordCardKeptStageEl(host, options && options.stage, targets);
  if (kept) {
    const list = kept.parentNode;
    for (const child of recordCardNodeChildren(host)) {
      if (child !== list) host.removeChild(child);
    }
    for (const child of recordCardNodeChildren(list)) {
      if (child !== kept) list.removeChild(child);
    }
    let beforeStage = true;
    for (const target of targets) {
      const row = recordCardPaintRow(doc, target, selectedKey, options);
      if (beforeStage) list.insertBefore(row, kept);
      else list.appendChild(row);
      if (target.key === options.stage.field) beforeStage = false;
    }
    return;
  }
  recordCardRegionEmpty(host);
  const list = recordCardEl(doc, "div", "bob-record-card-fields");
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Record fields");
  for (const target of Array.isArray(targets) ? targets : []) {
    list.appendChild(recordCardPaintRow(doc, target, selectedKey, options));
    if (options && options.stage && options.stage.field === target.key) {
      const stage = recordCardEl(doc, "div", "bob-record-card-stage");
      stage.setAttribute("data-record-card-stage", options.stage.kind || "");
      stage.setAttribute("data-record-card-stage-field", target.key);
      list.appendChild(stage);
    }
  }
  if (!(Array.isArray(targets) && targets.length)) {
    const empty = recordCardEl(doc, "p", "bob-record-card-empty");
    recordCardText(empty, "This album declares no fields.");
    list.appendChild(empty);
  }
  host.appendChild(list);
}

function recordCardPaintChoices(host, choices, options, doc) {
  if (!host || !doc) return;
  recordCardRegionEmpty(host);
  // bob-text: literal Record Card choice filter
  const filter = recordCardEl(doc, "input", "bob-record-card-choice-filter");
  filter.setAttribute("type", "text");
  filter.setAttribute("data-record-input", "choice-filter");
  filter.setAttribute("aria-label", "Filter choices");
  filter.setAttribute("placeholder", "Filter choices");
  filter.value = (options && options.filter) || "";
  const filterRow = recordCardEl(doc, "div", "bob-record-card-choice-filter-row");
  filterRow.appendChild(filter);
  const prefix = String((options && options.choiceDigitPrefix) || "");
  if (prefix) {
    const pending = recordCardEl(doc, "span", "bob-record-card-choice-pending");
    pending.setAttribute("aria-label", `Pending choice code ${prefix}; type the next digit`);
    recordCardText(pending, `${prefix}…`);
    filterRow.appendChild(pending);
  }
  host.appendChild(filterRow);
  const list = recordCardEl(doc, "div", "bob-record-card-choice-list");
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Choices");
  const visible = Array.isArray(choices) ? choices : [];
  if (!visible.length) {
    const empty = recordCardEl(doc, "p", "bob-record-card-choice-empty");
    recordCardText(empty, options && options.filter ? "No matching choices." : "No choices.");
    list.appendChild(empty);
  }
  const currentValue = options && options.currentValue != null ? String(options.currentValue) : "";
  const selectedChoice = options && options.selectedChoice;
  for (const choice of visible) {
    const row = recordCardEl(doc, "button", "bob-record-card-choice");
    row.setAttribute("type", "button");
    row.setAttribute("role", "option");
    row.setAttribute("data-record-action", "pick-choice");
    row.setAttribute("data-choice-value", choice.value);
    const parts = [choice.label || choice.value];
    if (Number.isInteger(choice.count)) parts.push(`${choice.count} records`);
    if (choice.value === currentValue) parts.push("current");
    row.setAttribute("aria-label", parts.join(", "));
    if (choice.value === currentValue) {
      row.setAttribute("class", `${row.getAttribute("class") || ""} is-current`.trim());
    }
    if (choice.value === selectedChoice || (!selectedChoice && choice.value === currentValue)) {
      row.setAttribute("class", `${row.getAttribute("class") || ""} is-selected`.trim());
      row.setAttribute("aria-selected", "true");
    } else {
      row.setAttribute("aria-selected", "false");
    }
    if (choice.code) {
      const badge = recordCardEl(doc, "kbd", "bob-record-card-choice-badge");
      const typed = prefix && String(choice.code).startsWith(prefix) ? prefix : "";
      if (typed) {
        const emphasis = recordCardEl(doc, "span", "bob-record-card-choice-badge-typed");
        recordCardText(emphasis, typed);
        badge.appendChild(emphasis);
        if (typeof doc.createTextNode === "function") badge.appendChild(doc.createTextNode(String(choice.code).slice(typed.length)));
      } else {
        recordCardText(badge, String(choice.code));
      }
      row.appendChild(badge);
    }
    const label = recordCardEl(doc, "span", "bob-record-card-choice-label");
    recordCardText(label, choice.label || choice.value);
    row.appendChild(label);
    if (Number.isInteger(choice.count)) {
      const count = recordCardEl(doc, "span", "bob-record-card-choice-count");
      recordCardText(count, String(choice.count));
      row.appendChild(count);
    }
    list.appendChild(row);
  }
  host.appendChild(list);
}

function recordCardPaintStage(card, options, doc) {
  const host = recordCardRegion(card, "stage");
  if (!host || !doc) return;
  const inline = card.querySelector?.("[data-record-card-stage]") || null;
  const target = inline || host;
  if (!options || !options.stage) {
    recordCardRegionEmpty(host);
    host.setAttribute("hidden", "");
    if (inline) recordCardRegionEmpty(inline);
    return;
  }
  host.removeAttribute("hidden");
  if (options.stage.kind === "choices") {
    recordCardPaintChoices(inline || host, options.visibleChoices || [], options, doc);
    if (inline && host !== inline) recordCardRegionEmpty(host);
    return;
  }
  if (options.stage.kind && options.stage.kind !== "choices") {
    const stageTarget = (options.targets || []).find((row) => row.key === options.stage.field)
      || options.status?.target
      || null;
    if (stageTarget && typeof recordCardPaintTypedStage === "function") {
      const inlineHost = inline || host;
      recordCardPaintTypedStage(doc, inlineHost, {
        kind: options.stage.kind,
        target: stageTarget,
        draft: {
          text: options.stageDraftText ?? options.draftText ?? "",
          list: options.stageList || options.draftList || [],
          itemDraft: options.stageItemDraft ?? options.draftItemDraft ?? "",
          selectedChoice: options.selectedChoice || "",
        },
        reportField: options.reportField || null,
        preview: options.stagePreview || null,
        stageNote: options.stageNote || "",
        softLine: options.softLine || null,
        plugin: options.plugin || null,
        recordPath: options.recordPath || "",
        applying: options.status?.pendingApply === true,
        bandOpen: options.linkBandOpen === true,
        composing: options.composing === true,
      });
      if (inline && host !== inline) recordCardRegionEmpty(host);
      try {
        const input = inlineHost.querySelector?.("[data-record-input^='stage-']");
        if (input && options.focusStage !== false && typeof input.focus === "function") {
          const active = recordCardDomDoc(inlineHost)?.activeElement;
          const isComposing = options.composing === true;
          if (!isComposing && active !== input) {
            const caret = options.stageCaret;
            input.focus();
            if (caret && typeof input.setSelectionRange === "function"
              && Number.isInteger(caret.start) && input.value != null) {
              try { input.setSelectionRange(caret.start, caret.end ?? caret.start); } catch (_) {}
            }
          }
        }
      } catch (_) {}
      return;
    }
  }
  recordCardRegionEmpty(target);
  const note = recordCardEl(doc, "p", "bob-record-card-stage-note");
  recordCardText(note, RECORD_CARD_TYPED_STAGE_HINT);
  target.appendChild(note);
}

function recordCardPaintStatus(card, options, doc) {
  const host = recordCardRegion(card, "status");
  if (!host || !doc) return;
  recordCardRegionEmpty(host);
  const text = recordCardStatusText(options && options.status);
  if (!text) {
    host.setAttribute("hidden", "");
    return;
  }
  host.removeAttribute("hidden");
  host.setAttribute("class", `bob-record-card-status is-${(options && options.status && options.status.statusKind) || "idle"}`);
  recordCardText(host, text);
}

function recordCardPaintHints(card, options, doc) {
  const host = recordCardRegion(card, "hints");
  if (!host || !doc) return;
  recordCardRegionEmpty(host);
  host.setAttribute("class", "bob-record-card-hints bob-key-card-footer");
  const strip = recordCardEl(doc, "div", "bob-record-card-hint-strip");
  for (const item of recordCardHintItems(options && options.status)) {
    const row = recordCardEl(doc, "span", "bob-record-card-hint");
    const keys = Array.isArray(item.keys) ? item.keys : [item.keys];
    for (const text of keys) {
      if (text == null || text === "") continue;
      const key = recordCardEl(doc, "kbd", "");
      recordCardText(key, String(text));
      row.appendChild(key);
    }
    if (typeof doc.createTextNode === "function") row.appendChild(doc.createTextNode(" "));
    const label = recordCardEl(doc, "span", "bob-record-card-hint-label");
    recordCardText(label, item.label);
    row.appendChild(label);
    strip.appendChild(row);
  }
  const more = recordCardButton(doc, strip, "⋯", {
    action: "more",
    className: "bob-record-card-more-toggle is-quiet",
    ariaLabel: "All actions",
  });
  if (more) more.setAttribute("aria-expanded", options && options.menuOpen === true ? "true" : "false");
  host.appendChild(strip);
  const list = recordCardEl(doc, "div", "bob-record-card-more");
  list.setAttribute("role", "group");
  list.setAttribute("aria-label", "All actions");
  if (!options || options.menuOpen !== true) list.setAttribute("hidden", "");
  const heading = recordCardEl(doc, "p", "bob-record-card-more-title");
  recordCardText(heading, "All actions");
  list.appendChild(heading);
  for (const item of recordCardAllActions(options && options.status)) {
    recordCardButton(doc, list, item.text, {
      action: item.action,
      className: "bob-record-card-action",
      ariaLabel: item.text,
      disabled: item.enabled === false,
      reason: item.reason || "",
    });
  }
  host.appendChild(list);
}

function recordCardPaintLive(card, announcement, doc) {
  const host = recordCardRegion(card, "live");
  if (!host || !doc) return;
  if (!announcement) return;
  recordCardRegionEmpty(host);
  recordCardText(host, announcement);
}

function recordCardPaintAll(card, sheetModel, options, doc) {
  if (!card || !doc) return;
  recordCardPaintHeader(card, sheetModel, options, doc);
  recordCardPaintBody(card, options && options.targets, options, doc);
  recordCardPaintStage(card, options, doc);
  recordCardPaintStatus(card, options, doc);
  recordCardPaintHints(card, options, doc);
  if (options && options.announce) recordCardPaintLive(card, options.announce, doc);
}

function recordCardBuildEl(sheetModel, options, doc) {
  const card = recordCardEl(doc, "div", `${RECORD_CARD_CLASS} bob-key-card`);
  if (!card) return null;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", "Edit record");
  const regions = [
    ["header", "bob-record-card-header"],
    ["body", "bob-record-card-body"],
    ["stage", "bob-record-card-stage-host"],
    ["status", "bob-record-card-status"],
    ["hints", "bob-record-card-hints bob-key-card-footer"],
    ["live", "bob-record-card-live"],
  ];
  for (const [name, className] of regions) {
    const region = recordCardEl(doc, "div", className);
    if (!region) continue;
    region.setAttribute("data-record-card-region", name);
    if (name === "status") region.setAttribute("role", "status");
    if (name === "live") {
      region.setAttribute("aria-live", "polite");
      region.setAttribute("aria-atomic", "true");
      region.setAttribute("class", `${className} sr-only`);
    }
    card.appendChild(region);
  }
  recordCardPaintAll(card, sheetModel, options, doc);
  return card;
}
