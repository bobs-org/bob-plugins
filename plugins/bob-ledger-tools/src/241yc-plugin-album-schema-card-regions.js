// Stable Schema Card regions, visual language, and hint-strip catalog.
// Painters refill one region at a time so session previews never rebuild
// the shell, body, or open stage inputs.

function albumSchemaRegionEmpty(node) {
  if (!node) return;
  try {
    if (typeof node.empty === "function") {
      node.empty();
      return;
    }
  } catch (_) {}
  try {
    while (node.firstChild) node.removeChild(node.firstChild);
  } catch (_) {}
}

function albumSchemaCardRegion(card, name) {
  if (!card || !name) return null;
  const nodes = card.querySelectorAll?.("[data-schema-region]") || [];
  for (const node of nodes) {
    if (node.getAttribute?.("data-schema-region") === name) return node;
  }
  return null;
}

function albumSchemaCardTrail(model) {
  const crumbs = (model?.crumbs || []).map((crumb) => crumb.title || crumb.stem).filter(Boolean);
  if (crumbs.length <= 1) return "";
  return crumbs.slice(0, -1).join(" › ");
}

function albumSchemaCardStageKey(stage) {
  return stage ? `${stage.kind}:${stage.targetKey || ""}` : "";
}

function albumSchemaCardAppendPill(doc, host, text, className) {
  if (!host || !text) return null;
  const pill = notebookCreateEl(doc, "span", `bob-album-schema-pill ${className || ""}`.trim());
  notebookSetText(pill, text);
  host.appendChild(pill);
  return pill;
}

function albumSchemaCardPaintGrip(doc, host, scope, id, label) {
  if (!doc || !host || !scope) return null;
  const grip = notebookCreateEl(doc, "span", "bob-album-schema-grip");
  if (!grip) return null;
  notebookSetText(grip, "⠿");
  grip.setAttribute("data-drag-scope", String(scope));
  grip.setAttribute("data-drag-id", String(id ?? ""));
  grip.setAttribute("aria-hidden", "true");
  grip.setAttribute("title", `Drag ${label || "item"} to reorder`);
  try {
    if (typeof host.insertBefore === "function") host.insertBefore(grip, host.firstChild || null);
    else host.appendChild(grip);
  } catch (_) {
    try { host.appendChild(grip); } catch (_) {}
  }
  return grip;
}

function albumSchemaCardPaintGhostNode(doc, ghost) {
  if (!doc || !ghost) return null;
  if (ghost.kind === "choice") {
    const chip = notebookCreateEl(doc, "span", "bob-album-schema-choice is-ghost");
    if (!chip) return null;
    chip.setAttribute("data-schema-ghost", "true");
    chip.setAttribute("aria-label", "New choice lands here");
    const text = `${ghost.emoji ? `${ghost.emoji} ` : ""}${String(ghost.label || "").trim() || "New choice"}`;
    notebookSetText(chip, text);
    return chip;
  }
  const row = notebookCreateEl(doc, "div", "bob-album-schema-field is-ghost");
  if (!row) return null;
  row.setAttribute("data-schema-ghost", "true");
  row.setAttribute("aria-label", "New field lands here");
  notebookSetText(row, `+ ${String(ghost.label || "").trim() || "New field"}`);
  return row;
}

function albumSchemaCardInsertGhost(doc, host, scope, ghost) {
  if (!doc || !host || !ghost || ghost.scope !== scope) return null;
  const node = albumSchemaCardPaintGhostNode(doc, ghost);
  if (!node) return null;
  const prefix = `${scope}:`;
  let items = [];
  try {
    items = Array.from(host.children || []).filter((child) =>
      String(child.getAttribute?.("data-arrange-id") || "").startsWith(prefix));
  } catch (_) {
    items = [];
  }
  const before = items[Math.min(Math.max(Number(ghost.gap) || 0, 0), items.length)] || null;
  try {
    if (typeof host.insertBefore === "function") host.insertBefore(node, before);
    else host.appendChild(node);
  } catch (_) {
    try { host.appendChild(node); } catch (_) {}
  }
  return node;
}

function albumSchemaCardPaintChoiceChip(doc, host, field, choice, options) {
  const selectedKey = options?.selectedKey || "";
  const key = `choice:${field.key}:${choice.value}`;
  const parts = albumSchemaChoiceParts(choice.label || choice.display || "");
  const label = parts.label || String(choice.label || choice.value || "");
  const count = Number.isInteger(choice.count) ? choice.count : null;
  const ariaCount = count == null ? "" : `, used by ${count} records`;
  const chip = albumSchemaCardButton(doc, host, "", {
    targetKey: key,
    className: "bob-album-schema-choice bob-album-schema-choice-button",
    ariaLabel: `Choice ${label} on ${field.label || field.key}${ariaCount}`,
    current: selectedKey === key,
  });
  chip.setAttribute("data-field-key", field.key);
  chip.setAttribute("data-choice-value", choice.value);
  if (options?.grip) albumSchemaCardPaintGrip(doc, chip, `choices:${field.key}`, choice.value, label);
  if (parts.emoji) {
    const glyph = notebookCreateEl(doc, "span", "bob-album-schema-choice-glyph");
    notebookSetText(glyph, parts.emoji);
    chip.appendChild(glyph);
    if (label) chip.appendChild(doc.createTextNode(" "));
  }
  const name = notebookCreateEl(doc, "span", "bob-album-schema-choice-label");
  notebookSetText(name, label);
  chip.appendChild(name);
  if (count != null) {
    chip.appendChild(doc.createTextNode(" "));
    const pill = notebookCreateEl(doc, "span", `bob-album-schema-count-pill${count === 0 ? " is-zero" : ""}`);
    notebookSetText(pill, String(count));
    chip.appendChild(pill);
  }
  return chip;
}

function albumSchemaCardPaintFieldPills(doc, host, field) {
  const pills = notebookCreateEl(doc, "span", "bob-album-schema-pills");
  if (field.required) albumSchemaCardAppendPill(doc, pills, "required", "is-required");
  if (field.kindText) albumSchemaCardAppendPill(doc, pills, field.kindText, "is-kind");
  if (field.groupsIndex) albumSchemaCardAppendPill(doc, pills, "groups index", "is-index");
  if (field.subgroupsIndex) albumSchemaCardAppendPill(doc, pills, "sub-groups index", "is-index");
  if (pills.children.length) host.appendChild(pills);
  return pills;
}

function albumSchemaCardPaintFieldRow(doc, host, field, options) {
  const selectedKey = options?.selectedKey || "";
  const editable = options?.editable === true;
  const key = `field:${field.key}`;
  const aria = `Field ${field.label}${field.required ? ", required" : ""}${field.kindText ? `, ${field.kindText}` : ""}`;
  let row;
  if (editable) {
    row = albumSchemaCardButton(doc, host, "", {
      targetKey: key,
      className: "bob-album-schema-field",
      ariaLabel: aria,
      current: selectedKey === key,
    });
  } else {
    row = notebookCreateEl(doc, "div", `bob-album-schema-field${selectedKey === key ? " is-selected" : ""}`);
    if (selectedKey === key) row.setAttribute("aria-current", "true");
    host.appendChild(row);
  }
  row.setAttribute("data-field-key", field.key);
  if (field.line != null) row.setAttribute("data-yaml-line", String(field.line));
  row.setAttribute("data-drag-scope", "fields");
  if (options?.grip) albumSchemaCardPaintGrip(doc, row, "fields", field.key, field.label);
  const main = notebookCreateEl(doc, "span", "bob-album-schema-field-main");
  const label = notebookCreateEl(doc, "span", "bob-album-schema-label");
  notebookSetText(label, field.label);
  main.appendChild(label);
  albumSchemaCardPaintFieldPills(doc, main, field);
  row.appendChild(main);
  if (field.filledText) {
    const filled = notebookCreateEl(doc, "span", "bob-album-schema-filled");
    notebookSetText(filled, field.filledText);
    row.appendChild(filled);
  }
  return row;
}

function albumSchemaCardPaintHeader(card, model, options, doc) {
  const host = albumSchemaCardRegion(card, "header");
  if (!host || !doc) return;
  albumSchemaRegionEmpty(host);
  const title = notebookCreateEl(doc, "h2", "bob-album-schema-dialog-title bob-key-card-title");
  notebookSetText(title, albumSchemaCardTitle(model));
  host.appendChild(title);
  const trail = albumSchemaCardTrail(model);
  if (trail) {
    const crumb = notebookCreateEl(doc, "p", "bob-album-schema-dialog-crumb");
    crumb.setAttribute("title", trail);
    notebookSetText(crumb, trail);
    host.appendChild(crumb);
  }
  const statsText = albumHeaderStatsText(model);
  if (options?.editable === true) {
    albumSchemaCardButton(doc, host, statsText, {
      targetKey: "stats",
      className: "bob-album-schema-stats-target bob-album-schema-dialog-subtitle",
      ariaLabel: "Album details",
      current: (options.selectedKey || "stats") === "stats",
    });
  } else if (statsText) {
    const stats = notebookCreateEl(doc, "p", "bob-album-schema-dialog-subtitle bob-album-schema-dialog-stats");
    notebookSetText(stats, statsText);
    host.appendChild(stats);
  }
}

function albumSchemaCardPaintLint(card, model, options, doc) {
  const host = albumSchemaCardRegion(card, "lint");
  if (!host || !doc) return;
  albumSchemaRegionEmpty(host);
  const issues = Array.isArray(model?.issues) ? model.issues : [];
  if (!issues.length) {
    host.setAttribute("hidden", "");
    return;
  }
  host.removeAttribute("hidden");
  host.setAttribute("class", "bob-album-schema-dialog-lint");
  host.setAttribute("role", "status");
  const list = notebookCreateEl(doc, "ul", "bob-album-schema-issues");
  list.setAttribute("aria-label", "Album schema issues");
  for (const issue of issues) {
    const item = albumSchemaPaintIssue(doc, issue, options);
    if (item) list.appendChild(item);
  }
  host.appendChild(list);
}

function albumSchemaCardArrangeGapButton(doc, host, label, gapIndex, scope) {
  if (!doc || !host) return null;
  const button = notebookCreateEl(doc, "button", "bob-album-schema-gap-hint");
  button.setAttribute("type", "button");
  button.setAttribute("data-gap-index", String(gapIndex));
  button.setAttribute("data-gap-scope", String(scope || ""));
  button.setAttribute("aria-label", `Place here (gap ${label})`);
  notebookSetText(button, label);
  host.appendChild(button);
  return button;
}

function albumSchemaCardDecorateArrangeNode(node, arrangeId, deltas, saving) {
  if (!node || !arrangeId) return;
  try { node.setAttribute("data-arrange-id", String(arrangeId)); } catch (_) {}
  try {
    const cls = String(node.getAttribute?.("class") || "");
    if (deltas && Object.prototype.hasOwnProperty.call(deltas, arrangeId)) {
      if (!cls.includes("is-arrange-moved")) node.setAttribute("class", `${cls} is-arrange-moved`.trim());
    }
    if (saving && deltas && Object.prototype.hasOwnProperty.call(deltas, arrangeId)) {
      const next = String(node.getAttribute?.("class") || "");
      if (!next.includes("is-arrange-saving")) node.setAttribute("class", `${next} is-arrange-saving`.trim());
    }
  } catch (_) {}
  try {
    if (deltas && Object.prototype.hasOwnProperty.call(deltas, arrangeId)) {
      const badge = node.ownerDocument?.createElement
        ? node.ownerDocument.createElement("span")
        : null;
      const text = typeof schemaArrangeDeltaBadge === "function"
        ? schemaArrangeDeltaBadge(deltas[arrangeId])
        : "";
      if (badge && text) {
        badge.setAttribute("class", "bob-album-schema-delta-badge");
        if (typeof notebookSetText === "function") notebookSetText(badge, text);
        else badge.textContent = text;
        node.appendChild(badge);
      } else if (text && typeof notebookCreateEl === "function" && node.ownerDocument) {
        const fallback = notebookCreateEl(node.ownerDocument, "span", "bob-album-schema-delta-badge");
        notebookSetText(fallback, text);
        node.appendChild(fallback);
      }
    }
  } catch (_) {}
}

function albumSchemaCardPaintBody(card, model, options, doc) {
  const host = albumSchemaCardRegion(card, "body");
  if (!host || !doc) return;
  albumSchemaRegionEmpty(host);
  const editable = options?.editable === true;
  const selectedKey = options?.selectedKey || "stats";
  const arrange = options?.arrange || null;
  const projected = arrange?.dirty && arrange?.projected ? arrange.projected : null;
  const deltas = arrange?.deltas || {};
  const saving = arrange?.saving === true;
  const hintMode = arrange?.hintMode || null;
  const ghost = options?.ghost || null;
  const itemOptions = editable && !options?.stage ? Object.assign({}, options, { grip: true }) : options;
  if (model.emptySchema && !model.schemaInvalid) {
    const empty = notebookCreateEl(doc, "p", "bob-album-schema-empty");
    notebookSetText(empty, albumHeaderSummaryText(model));
    host.appendChild(empty);
  }
  if (editable) {
    const fieldsByKey = new Map((model.fields || []).map((field) => [String(field?.key || ""), field]));
    const fieldOrder = projected && Array.isArray(projected.fields)
      ? projected.fields.map(String).filter((key) => fieldsByKey.has(key))
      : (model.fields || []).map((field) => String(field?.key || ""));
    if (hintMode && hintMode.scope === "fields" && Array.isArray(hintMode.gaps)) {
      const labels = Array.isArray(hintMode.labels) ? hintMode.labels : [];
      for (let gap = 0; gap <= fieldOrder.length; gap += 1) {
        const hintIndex = (hintMode.gaps || []).indexOf(gap);
        if (hintIndex >= 0) {
          albumSchemaCardArrangeGapButton(doc, host, labels[hintIndex] || String(gap), gap, "fields");
        }
        if (gap >= fieldOrder.length) break;
        const key = fieldOrder[gap];
        const field = fieldsByKey.get(key);
        if (!field) continue;
        const presented = albumHeaderPresentField(field, model);
        albumSchemaCardPaintFieldRow(doc, host, presented, itemOptions);
        const row = host.children?.[host.children.length - 1] || null;
        if (row) albumSchemaCardDecorateArrangeNode(row, `fields:${key}`, deltas, saving);
        const scope = `choices:${key}`;
        const wantsChoices = presented.choices?.length || field.kind === "choices";
        if (!wantsChoices) continue;
        const cloud = notebookCreateEl(doc, "div", "bob-album-schema-choice-cloud");
        cloud.setAttribute("data-drag-scope", scope);
        for (const choice of presented.choices || []) {
          albumSchemaCardPaintChoiceChip(doc, cloud, presented, choice, itemOptions);
          const chip = cloud.children?.[cloud.children.length - 1] || null;
          if (chip) {
            const value = String(choice?.value ?? "");
            albumSchemaCardDecorateArrangeNode(chip, `${scope}:${value}`, deltas, saving);
          }
        }
        albumSchemaCardInsertGhost(doc, cloud, scope, ghost);
        if (field.kind === "choices") {
          const addKey = `add-choice:${field.key}`;
          albumSchemaCardButton(doc, cloud, "+ choice", {
            targetKey: addKey,
            className: "bob-album-schema-add-choice is-dashed",
            ariaLabel: `Add choice to ${presented.label}`,
            current: selectedKey === addKey,
          });
        }
        host.appendChild(cloud);
      }
      albumSchemaCardInsertGhost(doc, host, "fields", ghost);
    } else {
      for (const key of fieldOrder) {
        const field = fieldsByKey.get(key);
        if (!field) continue;
        const presented = albumHeaderPresentField(field, model);
        albumSchemaCardPaintFieldRow(doc, host, presented, itemOptions);
        const row = host.children?.[host.children.length - 1] || null;
        if (row) albumSchemaCardDecorateArrangeNode(row, `fields:${key}`, deltas, saving);
        const scope = `choices:${key}`;
        const wantsChoices = presented.choices?.length || field.kind === "choices";
        if (!wantsChoices) continue;
        const cloud = notebookCreateEl(doc, "div", "bob-album-schema-choice-cloud");
        cloud.setAttribute("data-drag-scope", scope);
        const choicesByValue = new Map((presented.choices || []).map((choice) => [String(choice?.value ?? ""), choice]));
        let choiceOrder = (presented.choices || []).map((choice) => String(choice?.value ?? ""));
        if (projected && Array.isArray(projected[scope])) {
          const wanted = projected[scope].map(String).filter((value) => choicesByValue.has(value));
          if (wanted.length === choiceOrder.length) choiceOrder = wanted;
        }
        if (hintMode && hintMode.scope === scope && Array.isArray(hintMode.gaps)) {
          const labels = Array.isArray(hintMode.labels) ? hintMode.labels : [];
          for (let gap = 0; gap <= choiceOrder.length; gap += 1) {
            const hintIndex = (hintMode.gaps || []).indexOf(gap);
            if (hintIndex >= 0) {
              albumSchemaCardArrangeGapButton(doc, cloud, labels[hintIndex] || String(gap), gap, scope);
            }
            if (gap >= choiceOrder.length) break;
            const value = choiceOrder[gap];
            const choice = choicesByValue.get(value);
            if (!choice) continue;
            const beforeCount = cloud.children?.length || 0;
            albumSchemaCardPaintChoiceChip(doc, cloud, presented, choice, itemOptions);
            const chip = cloud.children?.[cloud.children.length - 1] || null;
            if (chip) albumSchemaCardDecorateArrangeNode(chip, `${scope}:${value}`, deltas, saving);
            void beforeCount;
          }
        } else {
          for (const value of choiceOrder) {
            const choice = choicesByValue.get(value);
            if (!choice) continue;
            albumSchemaCardPaintChoiceChip(doc, cloud, presented, choice, itemOptions);
            const chip = cloud.children?.[cloud.children.length - 1] || null;
            if (chip) albumSchemaCardDecorateArrangeNode(chip, `${scope}:${value}`, deltas, saving);
          }
        }
        albumSchemaCardInsertGhost(doc, cloud, scope, ghost);
        if (field.kind === "choices") {
          const addKey = `add-choice:${field.key}`;
          albumSchemaCardButton(doc, cloud, "+ choice", {
            targetKey: addKey,
            className: "bob-album-schema-add-choice is-dashed",
            ariaLabel: `Add choice to ${presented.label}`,
            current: selectedKey === addKey,
          });
        }
        host.appendChild(cloud);
      }
      albumSchemaCardInsertGhost(doc, host, "fields", ghost);
    }
    for (const pattern of model.legacy || []) {
      const chip = notebookCreateEl(doc, "span", "bob-album-schema-legacy");
      notebookSetText(chip, pattern);
      host.appendChild(chip);
    }
    for (const issue of model.issues || []) {
      albumSchemaCardButton(doc, host, albumHeaderIssueText(issue), {
        targetKey: albumHeaderIssueKey(issue),
        className: `bob-album-schema-issue is-${issue.severity}`,
        ariaLabel: `Schema issue: ${albumHeaderIssueText(issue)}`,
        current: selectedKey === albumHeaderIssueKey(issue),
      });
    }
    albumSchemaCardButton(doc, host, "+ field", {
      targetKey: "add-field",
      className: "bob-album-schema-add-field is-dashed",
      ariaLabel: "Add field",
      current: selectedKey === "add-field",
    });
    return;
  }
  if (!model.emptySchema || model.schemaInvalid) {
    const presented = (model.fields || []).map((field) => albumHeaderPresentField(field, model));
    presented.forEach((field, index) => {
      const selected = index === (options?.selectedIndex || 0);
      albumSchemaCardPaintFieldRow(doc, host, field, {
        selectedKey: selected ? `field:${field.key}` : "",
      });
      if (field.choices?.length) {
        const cloud = notebookCreateEl(doc, "div", "bob-album-schema-choice-cloud");
        for (const choice of field.choices) {
          const chip = notebookCreateEl(doc, "span", "bob-album-schema-choice");
          const parts = albumSchemaChoiceParts(choice.label || choice.display || "");
          if (parts.emoji) {
            const glyph = notebookCreateEl(doc, "span", "bob-album-schema-choice-glyph");
            notebookSetText(glyph, parts.emoji);
            chip.appendChild(glyph);
            if (parts.label) chip.appendChild(doc.createTextNode(" "));
          }
          const name = notebookCreateEl(doc, "span", "bob-album-schema-choice-label");
          notebookSetText(name, parts.label || choice.label || "");
          chip.appendChild(name);
          if (Number.isInteger(choice.count)) {
            chip.appendChild(doc.createTextNode(" "));
            const pill = notebookCreateEl(doc, "span", `bob-album-schema-count-pill${choice.count === 0 ? " is-zero" : ""}`);
            notebookSetText(pill, String(choice.count));
            chip.appendChild(pill);
          }
          cloud.appendChild(chip);
        }
        host.appendChild(cloud);
      }
    });
    for (const pattern of model.legacy || []) {
      const chip = notebookCreateEl(doc, "span", "bob-album-schema-legacy");
      notebookSetText(chip, pattern);
      host.appendChild(chip);
    }
  }
}

function albumSchemaCardPaintSelection(card, selectedKey) {
  if (!card) return;
  const targets = card.querySelectorAll?.("[data-target-key]") || [];
  for (const target of targets) {
    const current = target.getAttribute?.("data-target-key") === selectedKey;
    if (current) {
      target.classList?.add?.("is-selected");
      target.setAttribute("aria-current", "true");
    } else {
      target.classList?.remove?.("is-selected");
      target.removeAttribute("aria-current");
    }
  }
}

function albumSchemaCardPaintStage(card, model, options, doc) {
  const host = albumSchemaCardRegion(card, "stage");
  if (!host || !doc) return;
  const key = albumSchemaCardStageKey(options?.stage);
  const current = host.getAttribute("data-stage-key") || "";
  if (!options?.stageForce && key === current && (key === "" || host.firstChild)) {
    albumSchemaCardPaintStageStatus(card, options);
    return;
  }
  albumSchemaRegionEmpty(host);
  if (key) host.setAttribute("data-stage-key", key);
  else host.removeAttribute("data-stage-key");
  if (!options?.stage) return;
  const panel = albumSchemaStageBuildEl(options.stage, model, options, doc);
  if (panel) host.appendChild(panel);
  albumSchemaCardPaintStageStatus(card, options);
}

function albumSchemaCardPaintStageStatus(card, options) {
  const host = albumSchemaCardRegion(card, "stage");
  if (!host) return;
  const state = options?.state || {};
  const locked = options?.stageLocked === true;
  const latched = options?.enterLatched === true;
  const save = host.querySelector?.('[data-schema-action="apply"]')
    || host.querySelector?.('[data-schema-action="submit-stage"]');
  if (save) {
    save.disabled = locked || (!(state.canApply === true) && !latched);
    const label = latched ? "Saving as soon as bob confirms…" : "Save ⏎";
    notebookSetText(save, label);
    save.setAttribute("aria-label", label);
  }
  const cancel = host.querySelector?.('[data-schema-action="cancel-stage"]');
  if (cancel) cancel.disabled = locked;
  const inputs = host.querySelectorAll?.("[data-schema-input]") || [];
  for (const input of inputs) input.disabled = locked;
  const actions = host.querySelectorAll?.("[data-schema-action]") || [];
  for (const action of actions) {
    const name = action.getAttribute?.("data-schema-action") || "";
    if (name === "apply" || name === "submit-stage" || name === "cancel-stage") continue;
    if (name.startsWith("remove-initial-choice") || name === "add-initial-choice" || name.startsWith("unset-")) {
      action.disabled = locked;
    }
  }
}

function albumSchemaCardStatusTone(state, options) {
  if (options?.enterLatched) return "is-previewing";
  if (state?.lockWait || state?.lockNotice) return "is-previewing";
  if (options?.arrange?.saving || state?.status === "applying") {
    return state?.refusal ? "is-refused" : "is-previewing";
  }
  if (state?.status === "preview-pending" || state?.busy) return "is-previewing";
  if (state?.refusal) return "is-refused";
  if (options?.arrange?.savedFlash) return "is-saved";
  if (options?.arrange?.dirty && options.arrange.loud && state?.canApply) return "is-confirm";
  if (state?.status === "saved-with-sync-warning" || state?.syncWarning) return "is-confirm";
  if (state?.canApply) return "is-ready";
  if (state?.status === "saved") return "is-saved";
  if (options?.editingUnavailable) return "is-idle";
  return "";
}

function albumSchemaCardPaintStatus(card, options, doc) {
  const host = albumSchemaCardRegion(card, "status");
  if (!host || !doc) return;
  const state = options?.state || {};
  const report = state.preview || null;
  albumSchemaRegionEmpty(host);
  host.setAttribute("class", "bob-album-schema-consequence bob-album-schema-status");
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");
  const tone = albumSchemaCardStatusTone(state, options);
  if (tone) {
    const cls = `${host.getAttribute("class") || ""} ${tone}`.trim();
    host.setAttribute("class", cls);
  }
  let filled = false;
  const lockWaitText = typeof guardedUpdateLockWaitText === "function"
    ? guardedUpdateLockWaitText(state.lockWait)
    : "";
  if (lockWaitText) {
    notebookSetText(host, lockWaitText);
    filled = true;
  } else if (options?.enterLatched) {
    notebookSetText(host, "Saving as soon as bob confirms…");
    filled = true;
  } else if (state.lockNotice && (state.lockNotice.message || state.lockNotice.hint)) {
    const message = notebookCreateEl(doc, "p", "bob-album-schema-lock-notice");
    notebookSetText(message, state.lockNotice.message || "Stopped waiting for another Bob vault maintenance run.");
    host.appendChild(message);
    filled = true;
    if (state.lockNotice.hint) {
      const hint = notebookCreateEl(doc, "p", "bob-album-schema-lock-notice-hint");
      notebookSetText(hint, state.lockNotice.hint);
      host.appendChild(hint);
    }
  } else if (options?.arrange?.saving) {
    const pending = options.arrange.pendingText || "Saving…";
    notebookSetText(host, `Saving… · ${pending}`);
    filled = true;
  } else if (options?.arrange?.savedFlash && !report && !state.refusal) {
    notebookSetText(host, "Saved · u undo");
    filled = true;
  } else if (report) {
    const consequence = notebookCreateEl(doc, "p", "bob-album-schema-consequence-text");
    notebookSetText(consequence, state.consequence || report.consequence || "No schema changes.");
    host.appendChild(consequence);
    filled = true;
    for (const op of Array.isArray(report.per_op) ? report.per_op : []) {
      const details = [];
      if (Number.isInteger(op.filled)) details.push(`${op.filled} filled`);
      if (Number.isInteger(op.count)) details.push(`${op.count} affected`);
      if (Number.isInteger(op.newly_invalid) && op.newly_invalid > 0) details.push(`${op.newly_invalid} newly invalid`);
      if (!details.length) continue;
      const line = notebookCreateEl(doc, "p", "bob-album-schema-consequence-counts");
      notebookSetText(line, `${op.summary}: ${details.join(" · ")}`);
      host.appendChild(line);
    }
    const derivedKeys = Array.isArray(report.derived_keys) ? report.derived_keys.filter((key) => typeof key === "string" && key) : [];
    const perOpKeys = (Array.isArray(report.per_op) ? report.per_op : [])
      .map((op) => op?.derived_key).filter((key) => typeof key === "string" && key);
    const keys = [...new Set(derivedKeys.concat(perOpKeys))];
    if (keys.length) {
      const derived = notebookCreateEl(doc, "p", "bob-album-schema-derived-keys");
      notebookSetText(derived, `bob will use key${keys.length === 1 ? "" : "s"}: ${keys.join(", ")}`);
      host.appendChild(derived);
    }
    if (options?.arrange?.dirty && options.arrange.loud && state?.canApply) {
      albumSchemaCardButton(doc, host, options.arrange.confirm ? "Confirm save ⏎" : "Confirm save", {
        action: "apply",
        className: "bob-album-schema-action is-primary",
        ariaLabel: "Confirm save",
        disabled: Boolean(state.busy),
      });
      filled = true;
    }
    if (options?.arrange?.dirty && options.arrange.pendingText && !options.arrange.saving) {
      const pending = notebookCreateEl(doc, "p", "bob-album-schema-pending-bar");
      notebookSetText(pending, options.arrange.pendingText);
      host.appendChild(pending);
      filled = true;
    }
  } else if (state.busy) {
    notebookSetText(host, state.status === "applying" ? "Saving the schema edit…" : "Previewing this edit…");
    filled = true;
  } else if (state.refusal) {
    const message = notebookCreateEl(doc, "p", "bob-album-schema-refusal");
    notebookSetText(message, state.refusal.message || "The schema edit was refused.");
    host.appendChild(message);
    filled = true;
    const identity = [
      state.refusal.field ? `field ${state.refusal.field}` : "",
      state.refusal.choice ? `choice ${state.refusal.choice}` : "",
      state.refusal.keyPath ? `at ${state.refusal.keyPath}` : "",
      state.refusal.path ? `${state.refusal.path}${Number.isInteger(state.refusal.line) ? `:${state.refusal.line}` : ""}` : "",
    ].filter(Boolean);
    if (identity.length) {
      const detail = notebookCreateEl(doc, "p", "bob-album-schema-refusal-identity");
      notebookSetText(detail, identity.join(" · "));
      host.appendChild(detail);
    }
    if (state.refusal.hint) {
      const hint = notebookCreateEl(doc, "p", "bob-album-schema-refusal-hint");
      notebookSetText(hint, state.refusal.hint);
      host.appendChild(hint);
    }
    if (Number.isInteger(state.refusal.affected)) {
      const count = notebookCreateEl(doc, "p", "bob-album-schema-refusal-count");
      notebookSetText(count, `${state.refusal.affected} records are affected.`);
      host.appendChild(count);
    }
  } else if (options?.editingUnavailable) {
    notebookSetText(host, options.editingUnavailable);
    filled = true;
  }
  if (state.syncWarning) {
    const warning = notebookCreateEl(doc, "p", "bob-album-schema-sync-warning");
    notebookSetText(warning, state.syncWarning.message || "Saved locally; sync failed.");
    host.appendChild(warning);
    filled = true;
    if (state.syncWarning.hint) {
      const hint = notebookCreateEl(doc, "p", "bob-album-schema-refusal-hint");
      notebookSetText(hint, state.syncWarning.hint);
      host.appendChild(hint);
    }
    albumSchemaCardButton(doc, host, "Retry sync", {
      action: "retry-sync",
      className: "bob-album-schema-action",
      ariaLabel: "Retry sync",
      disabled: Boolean(state.busy),
    });
  }
  if (state.refusal?.kind === "stale") {
    const label = options?.hasFreshReplacement
      ? "Preview retained edit against updated schema"
      : "Refresh schema";
    albumSchemaCardButton(doc, host, label, {
      action: "rebase-preview",
      className: "bob-album-schema-action",
      ariaLabel: label,
      disabled: Boolean(state.busy),
    });
    filled = true;
  } else if (state.refusal?.kind === "timeout-unknown") {
    const hasFresh = Boolean(options?.hasFreshReplacement);
    const label = hasFresh ? "Preview retained edit after refresh" : "Refresh to reconcile outcome";
    albumSchemaCardButton(doc, host, label, {
      action: hasFresh ? "rebase-preview" : "refresh-schema",
      className: "bob-album-schema-action",
      ariaLabel: label,
      disabled: Boolean(state.busy),
    });
    filled = true;
  } else if (state.status === "refused" && state.draftOps?.length && options?.fresh) {
    albumSchemaCardButton(doc, host, "Preview again", {
      action: "preview",
      className: "bob-album-schema-action",
      ariaLabel: "Preview again",
      disabled: Boolean(state.busy),
    });
    filled = true;
  }
  if (filled) host.removeAttribute("hidden");
  else host.setAttribute("hidden", "");
}

function albumSchemaCardHintItems(model, options) {
  const editable = options?.editable === true;
  const state = options?.state || {};
  const fresh = options?.fresh === true;
  const busy = Boolean(state.busy);
  const stage = options?.stage;
  const arrange = options?.arrange || null;
  const gated = !fresh || busy || Boolean(stage);
  const target = albumSchemaTargetByKey(model, options?.selectedKey);
  const items = [];
  if (!editable) {
    return [
      { keys: "↑/↓", label: "navigate" },
      { keys: "y", label: "YAML", action: "yaml" },
      { keys: "esc/q", label: "close", action: "close" },
    ];
  }
  if (state.lockWait) {
    return [{
      keys: "esc",
      label: state.lockWait.stopping ? "stopping" : "stop waiting",
      action: "stop-wait",
      enabled: true,
    }];
  }
  if (arrange?.saving) {
    return [{ keys: "Saving…", label: (arrange.pendingText || "Saving…").slice(0, 80) }];
  }
  if (arrange?.dirty && !stage) {
    items.push({ keys: "⏎", label: arrange.confirm ? "confirm save" : "save", action: "apply", enabled: !busy && fresh });
    items.push({ keys: "esc", label: "revert", action: "revert-arrange", enabled: !busy });
    items.push({ keys: "u", label: "step back", action: "undo", enabled: !busy });
    if (["field", "choice"].includes(target?.kind)) {
      items.push({ keys: "m", label: "move to…", action: "move-to", enabled: !busy && fresh });
    }
    return items.filter((item) => item.enabled !== false);
  }
  if (arrange?.hintMode && !stage) {
    items.push({ keys: "a–z", label: "pick gap", enabled: true });
    items.push({ keys: "esc", label: "leave hint mode", action: "revert-arrange", enabled: !busy });
    return items.filter((item) => item.enabled !== false);
  }
  if (stage) {
    items.push({
      keys: "⏎",
      label: options?.enterLatched ? "saving" : "save",
      action: "apply",
      enabled: state.canApply === true || options?.enterLatched === true,
    });
    items.push({ keys: "esc", label: "cancel", action: "cancel-stage", enabled: !busy });
    items.push({ keys: "y", label: "YAML", action: "yaml" });
    return items;
  }
  if (state.canApply && fresh) {
    items.push({ keys: "⏎", label: "apply", action: "apply", enabled: !busy && fresh });
  } else if (["stats", "field", "choice"].includes(target?.kind)) {
    items.push({ keys: "⏎", label: "edit", action: "edit", enabled: !gated });
  } else if (target?.kind === "add-field") {
    items.push({ keys: "⏎", label: "add field", action: "add-field", enabled: !gated });
  } else if (target?.kind === "add-choice") {
    items.push({ keys: "⏎", label: "add choice", action: "add-choice", enabled: !gated });
  } else if (target?.kind === "issue") {
    items.push({ keys: "⏎", label: "YAML", action: "yaml" });
  }
  items.push({ keys: "a", label: "add field", action: "add-field", enabled: !gated });
  if (["field", "choice", "add-choice"].includes(target?.kind)) {
    items.push({ keys: "c", label: "add choice", action: "add-choice", enabled: !gated });
  }
  if (target?.kind === "field") {
    items.push({ keys: "!", label: "required", action: "toggle-required", enabled: !gated });
    items.push({ keys: "s", label: "suggest", action: "toggle-suggest", enabled: !gated });
  }
  if (["field", "choice"].includes(target?.kind)) {
    items.push({ keys: "⌥J/K", label: "move", action: "move-down", enabled: !gated });
    items.push({ keys: "⌃D", label: "remove", action: "remove", enabled: !gated });
  }
  items.push({ keys: "y", label: "YAML", action: "yaml" });
  if (state.undoAvailable) items.push({ keys: "u", label: "undo", action: "undo", enabled: !gated });
  items.push({ keys: "esc/q", label: "close", action: "close" });
  return items.filter((item) => item.enabled !== false);
}

function albumSchemaCardAllActions(model, options) {
  const target = albumSchemaTargetByKey(model, options?.selectedKey);
  const state = options?.state || {};
  const fresh = options?.fresh === true;
  const busy = Boolean(state.busy);
  const stage = Boolean(options?.stage);
  const gated = !fresh || busy || stage;
  const field = target?.kind === "field";
  const choice = target?.kind === "choice";
  const editableRow = ["stats", "field", "choice"].includes(target?.kind);
  const addChoiceOk = ["field", "choice", "add-choice"].includes(target?.kind);
  const stale = state.refusal?.kind === "stale";
  const timeout = state.refusal?.kind === "timeout-unknown";
  const hasFresh = Boolean(options?.hasFreshReplacement);
  const arrange = options?.arrange || null;
  const arrangeGated = Boolean(arrange?.dirty) || Boolean(arrange?.hintMode);
  const actions = [
    { action: "edit", text: "Edit", enabled: !gated && !arrangeGated && editableRow },
    { action: "add-field", text: "Add field", enabled: !gated && !arrangeGated },
    { action: "add-choice", text: "Add choice", enabled: !gated && !arrangeGated && addChoiceOk },
    { action: "toggle-required", text: "Toggle required", enabled: !gated && !arrangeGated && field },
    { action: "toggle-suggest", text: "Toggle suggest", enabled: !gated && !arrangeGated && field },
    { action: "move-up", text: "Move up", enabled: !gated && (field || choice) },
    { action: "move-down", text: "Move down", enabled: !gated && (field || choice) },
    { action: "move-first", text: "Move to first", enabled: !gated && (field || choice) },
    { action: "move-last", text: "Move to last", enabled: !gated && (field || choice) },
    { action: "move-to", text: "Move to…", enabled: !gated && (field || choice) },
    { action: "revert-arrange", text: "Revert moves", enabled: !gated && Boolean(arrange?.dirty) },
    { action: "remove", text: "Remove", enabled: !gated && !arrangeGated && (field || choice) },
    { action: "yaml", text: "YAML", enabled: true },
    { action: "undo", text: "Undo", enabled: !gated && Boolean(state.undoAvailable) },
    { action: "apply", text: arrange?.confirm ? "Confirm save" : "Save", enabled: Boolean(state.canApply) && fresh && !busy },
    { action: "close", text: "Close", enabled: true },
  ];
  if (state.syncWarning) {
    actions.push({ action: "retry-sync", text: "Retry sync", enabled: !busy });
  }
  if (stale) {
    actions.push({
      action: "rebase-preview",
      text: hasFresh ? "Preview retained edit against updated schema" : "Refresh schema",
      enabled: !busy,
    });
  } else if (timeout) {
    actions.push({
      action: hasFresh ? "rebase-preview" : "refresh-schema",
      text: hasFresh ? "Preview retained edit after refresh" : "Refresh to reconcile outcome",
      enabled: !busy,
    });
  } else if (state.status === "refused" && state.draftOps?.length && fresh) {
    actions.push({ action: "preview", text: "Preview again", enabled: !busy });
  }
  if (stage) actions.push({ action: "cancel-stage", text: "Cancel", enabled: !busy });
  return actions;
}

function albumSchemaCardPaintHints(card, model, options, doc) {
  const host = albumSchemaCardRegion(card, "hints");
  if (!host || !doc) return;
  albumSchemaRegionEmpty(host);
  host.setAttribute("class", "bob-album-schema-hints bob-album-schema-dialog-footer bob-key-card-footer");
  const strip = notebookCreateEl(doc, "div", "bob-album-schema-hint-strip");
  for (const item of albumSchemaCardHintItems(model, options)) {
    const row = notebookCreateEl(doc, "span", "bob-album-schema-hint");
    const key = notebookCreateEl(doc, "kbd", "");
    notebookSetText(key, item.keys);
    row.appendChild(key);
    if (typeof doc.createTextNode === "function") row.appendChild(doc.createTextNode(" "));
    const label = notebookCreateEl(doc, "span", "bob-album-schema-hint-label");
    notebookSetText(label, item.label);
    row.appendChild(label);
    strip.appendChild(row);
  }
  if (options?.editable === true) {
    const more = albumSchemaCardButton(doc, strip, "⋯", {
      action: "more",
      className: "bob-album-schema-more-toggle is-quiet",
      ariaLabel: "All actions",
    });
    more.setAttribute("aria-expanded", options.moreOpen === true ? "true" : "false");
  }
  host.appendChild(strip);
  if (options?.editable === true) {
    const list = notebookCreateEl(doc, "div", "bob-album-schema-more");
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", "All actions");
    if (options.moreOpen !== true) list.setAttribute("hidden", "");
    const heading = notebookCreateEl(doc, "p", "bob-album-schema-more-title");
    notebookSetText(heading, "All actions");
    list.appendChild(heading);
    for (const item of albumSchemaCardAllActions(model, options)) {
      albumSchemaCardButton(doc, list, item.text, {
        action: item.action,
        className: "bob-album-schema-action",
        ariaLabel: item.text,
        disabled: item.enabled === false,
      });
    }
    host.appendChild(list);
  }
}

function albumSchemaCardPaintAll(card, model, options, doc) {
  if (!card || !doc) return;
  albumSchemaCardPaintHeader(card, model, options, doc);
  albumSchemaCardPaintLint(card, model, options, doc);
  albumSchemaCardPaintBody(card, model, options, doc);
  albumSchemaCardPaintStage(card, model, { ...options, stageForce: true }, doc);
  albumSchemaCardPaintStatus(card, options, doc);
  albumSchemaCardPaintHints(card, model, options, doc);
}

function albumSchemaCardBuildEl(model, options, doc) {
  const card = notebookCreateEl(doc, "div", "bob-album-schema-dialog bob-key-card");
  if (!card) return null;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", "Album schema editor");
  const regions = [
    ["header", "bob-album-schema-dialog-header"],
    ["lint", "bob-album-schema-dialog-lint"],
    ["body", "bob-album-schema-dialog-body"],
    ["stage", "bob-album-schema-stage-host"],
    ["status", "bob-album-schema-consequence bob-album-schema-status"],
    ["hints", "bob-album-schema-hints bob-album-schema-dialog-footer bob-key-card-footer"],
  ];
  for (const [name, className] of regions) {
    const region = notebookCreateEl(doc, "div", className);
    region.setAttribute("data-schema-region", name);
    if (name === "status") {
      region.setAttribute("role", "status");
      region.setAttribute("aria-live", "polite");
      region.setAttribute("hidden", "");
    }
    if (name === "lint") region.setAttribute("hidden", "");
    card.appendChild(region);
  }
  albumSchemaCardPaintAll(card, model, options || {}, doc);
  return card;
}
