// Keyboard-first, editable album Schema Card. It stages one gesture at a
// time, asks bob for a dry-run consequence, and applies only that preview.
function albumSchemaCardModalBase() {
  if (typeof Modal === "function") return Modal;
  return class AlbumSchemaCardFallback {
    constructor(app) {
      this.app = app;
      const doc = app?.document || (typeof document !== "undefined" ? document : null);
      this.contentEl = {
        ownerDocument: doc,
        children: [],
        listeners: new Map(),
        empty() { this.children = []; },
        addClass() {},
        setAttribute() {},
        appendChild(node) { node.parentNode = this; this.children.push(node); return node; },
        addEventListener(type, callback) {
          const listeners = this.listeners.get(type) || [];
          listeners.push(callback);
          this.listeners.set(type, listeners);
        },
        dispatchEvent(event) {
          const payload = event || {};
          if (!payload.target) payload.target = this;
          for (const callback of this.listeners.get(payload.type) || []) callback(payload);
          return true;
        },
        querySelector(sel) {
          const walk = (nodes) => {
            for (const node of nodes || []) {
              if (node.matches?.(sel)) return node;
              const found = walk(node.children);
              if (found) return found;
            }
            return null;
          };
          return walk(this.children);
        },
        querySelectorAll(sel) {
          const found = [];
          const walk = (nodes) => {
            for (const node of nodes || []) {
              if (node.matches?.(sel)) found.push(node);
              walk(node.children);
            }
          };
          walk(this.children);
          return found;
        },
      };
      this.modalEl = this.contentEl;
      this.containerEl = this.contentEl;
    }
    open() { this.onOpen?.(); }
    close() { this.onClose?.(); }
  };
}

function albumSchemaCardTitle(model) {
  const crumbs = (model?.crumbs || []).map((crumb) => crumb.title || crumb.stem).filter(Boolean);
  const trail = crumbs.join(" › ");
  const label = model?.schemaLabel || model?.title || "Album";
  const emoji = String(model?.emoji || "").trim();
  const head = emoji ? `${emoji} ${label}` : label;
  return trail ? `${head} · ${trail}` : head;
}

function albumSchemaCardButton(doc, host, text, options = {}) {
  const button = notebookCreateEl(doc, "button", options.className || "bob-album-schema-target");
  button.setAttribute("type", "button");
  if (options.targetKey) button.setAttribute("data-target-key", options.targetKey);
  if (options.action) button.setAttribute("data-schema-action", options.action);
  button.setAttribute("aria-label", options.ariaLabel || text);
  if (options.current) {
    const cls = `${button.getAttribute("class") || ""} is-selected`.trim();
    button.setAttribute("class", cls);
    button.setAttribute("aria-current", "true");
  }
  if (options.disabled) button.disabled = true;
  notebookSetText(button, text);
  host.appendChild(button);
  return button;
}

function albumSchemaCardBuildEl(model, options, doc) {
  const card = notebookCreateEl(doc, "div", "bob-album-schema-dialog bob-key-card");
  if (!card) return null;
  const state = options?.state || {};
  const editable = options?.editable === true;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", "Album schema editor");

  const header = notebookCreateEl(doc, "div", "bob-album-schema-dialog-header");
  const title = notebookCreateEl(doc, "h2", "bob-album-schema-dialog-title bob-key-card-title");
  notebookSetText(title, albumSchemaCardTitle(model));
  header.appendChild(title);
  const stats = notebookCreateEl(doc, "p", "bob-album-schema-dialog-stats");
  notebookSetText(stats, albumHeaderStatsText(model));
  header.appendChild(stats);
  card.appendChild(header);

  if ((model.issues || []).length) {
    const banner = notebookCreateEl(doc, "div", "bob-album-schema-dialog-lint");
    banner.setAttribute("role", "status");
    const issues = notebookCreateEl(doc, "ul", "bob-album-schema-issues");
    issues.setAttribute("aria-label", "Album schema issues");
    for (const issue of model.issues) {
      const item = albumSchemaPaintIssue(doc, issue, options);
      if (item) issues.appendChild(item);
    }
    banner.appendChild(issues);
    card.appendChild(banner);
  }

  const body = notebookCreateEl(doc, "div", "bob-album-schema-dialog-body");
  if (model.emptySchema && !model.schemaInvalid) {
    const empty = notebookCreateEl(doc, "p", "bob-album-schema-empty");
    notebookSetText(empty, albumHeaderSummaryText(model));
    body.appendChild(empty);
  }

  if (editable) {
    const selectedKey = options.selectedKey || "stats";
    albumSchemaCardButton(doc, body, albumHeaderStatsText(model), {
      targetKey: "stats", className: "bob-album-schema-stats-target",
      ariaLabel: "Album details", current: selectedKey === "stats",
    });
    for (const field of model.fields || []) {
      const presented = albumHeaderPresentField(field, model);
      const fieldText = [presented.label, presented.required ? "*" : "", presented.kindText]
        .filter(Boolean).join(" · ");
      const fieldRow = albumSchemaCardButton(doc, body, fieldText, {
        targetKey: `field:${field.key}`, className: "bob-album-schema-field",
        ariaLabel: `Field ${presented.label}${presented.required ? ", required" : ""}${presented.kindText ? `, ${presented.kindText}` : ""}`,
        current: selectedKey === `field:${field.key}`,
      });
      fieldRow.setAttribute("data-field-key", field.key);
      if (field.line != null) fieldRow.setAttribute("data-yaml-line", String(field.line));
      const fieldDetails = [];
      if (presented.filledText) fieldDetails.push(presented.filledText);
      if (presented.groupsIndex) fieldDetails.push("groups the index");
      if (presented.subgroupsIndex) fieldDetails.push("sub-groups the index");
      if (fieldDetails.length) {
        const detail = notebookCreateEl(doc, "span", "bob-album-schema-target-detail");
        notebookSetText(detail, fieldDetails.join(" · "));
        fieldRow.appendChild(detail);
      }
      for (const choice of presented.choices || []) {
        const key = `choice:${field.key}:${choice.value}`;
        const chip = albumSchemaCardButton(doc, body, choice.display || choice.label, {
          targetKey: key, className: "bob-album-schema-choice bob-album-schema-choice-button",
          ariaLabel: `Choice ${choice.label} on ${presented.label}${Number.isInteger(choice.count) ? `, used by ${choice.count} records` : ""}`,
          current: selectedKey === key,
        });
        chip.setAttribute("data-field-key", field.key);
        chip.setAttribute("data-choice-value", choice.value);
      }
      if (field.kind === "choices") {
        const key = `add-choice:${field.key}`;
        albumSchemaCardButton(doc, body, "+ Add choice", {
          targetKey: key, className: "bob-album-schema-add-choice",
          ariaLabel: `Add choice to ${presented.label}`, current: selectedKey === key,
        });
      }
    }
    for (const pattern of model.legacy || []) {
      const chip = notebookCreateEl(doc, "span", "bob-album-schema-legacy");
      notebookSetText(chip, pattern);
      body.appendChild(chip);
    }
    for (const issue of model.issues || []) {
      albumSchemaCardButton(doc, body, issue.message || issue.code, {
        targetKey: `issue:${issue.code || "lint"}:${issue.line || ""}:${issue.keyPath || issue.key_path || ""}`,
        className: `bob-album-schema-issue is-${issue.severity}`,
        ariaLabel: `Schema issue: ${issue.message || issue.code}`,
        current: selectedKey === `issue:${issue.code || "lint"}:${issue.line || ""}:${issue.keyPath || issue.key_path || ""}`,
      });
    }
    albumSchemaCardButton(doc, body, "+ Add field", {
      targetKey: "add-field", className: "bob-album-schema-add-field",
      ariaLabel: "Add field", current: selectedKey === "add-field",
    });
  } else if (!model.emptySchema || model.schemaInvalid) {
    const presented = (model.fields || []).map((field) => albumHeaderPresentField(field, model));
    presented.forEach((field, index) => {
      const row = albumSchemaPaintField(doc, field, options);
      if (!row) return;
      if (index === (options?.selectedIndex || 0)) {
        const cls = `${row.getAttribute("class") || ""} is-selected`.trim();
        row.setAttribute("class", cls);
        row.setAttribute("aria-current", "true");
      }
      body.appendChild(row);
    });
    for (const pattern of model.legacy || []) {
      const chip = notebookCreateEl(doc, "span", "bob-album-schema-legacy");
      notebookSetText(chip, pattern);
      body.appendChild(chip);
    }
  }
  card.appendChild(body);

  if (editable && options.stage) {
    const panel = albumSchemaStageBuildEl(options.stage, model, options, doc);
    if (panel) card.appendChild(panel);
  }

  const status = notebookCreateEl(doc, "div", "bob-album-schema-consequence");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const report = state.preview || null;
  if (report) {
    const consequence = notebookCreateEl(doc, "p", "bob-album-schema-consequence-text");
    notebookSetText(consequence, state.consequence || report.consequence || "No schema changes.");
    status.appendChild(consequence);
    for (const op of Array.isArray(report.per_op) ? report.per_op : []) {
      const details = [];
      if (Number.isInteger(op.filled)) details.push(`${op.filled} filled`);
      if (Number.isInteger(op.count)) details.push(`${op.count} affected`);
      if (Number.isInteger(op.newly_invalid) && op.newly_invalid > 0) details.push(`${op.newly_invalid} newly invalid`);
      if (!details.length) continue;
      const line = notebookCreateEl(doc, "p", "bob-album-schema-consequence-counts");
      notebookSetText(line, `${op.summary}: ${details.join(" · ")}`);
      status.appendChild(line);
    }
    const derivedKeys = Array.isArray(report.derived_keys) ? report.derived_keys.filter((key) => typeof key === "string" && key) : [];
    const perOpKeys = (Array.isArray(report.per_op) ? report.per_op : [])
      .map((op) => op?.derived_key).filter((key) => typeof key === "string" && key);
    const keys = [...new Set(derivedKeys.concat(perOpKeys))];
    if (keys.length) {
      const derived = notebookCreateEl(doc, "p", "bob-album-schema-derived-keys");
      notebookSetText(derived, `bob will use key${keys.length === 1 ? "" : "s"}: ${keys.join(", ")}`);
      status.appendChild(derived);
    }
  } else if (state.busy) {
    notebookSetText(status, state.status === "applying" ? "Saving the schema edit…" : "Previewing this edit…");
  } else if (state.refusal) {
    const message = notebookCreateEl(doc, "p", "bob-album-schema-refusal");
    notebookSetText(message, state.refusal.message || "The schema edit was refused.");
    status.appendChild(message);
    const identity = [
      state.refusal.field ? `field ${state.refusal.field}` : "",
      state.refusal.choice ? `choice ${state.refusal.choice}` : "",
      state.refusal.keyPath ? `at ${state.refusal.keyPath}` : "",
      state.refusal.path ? `${state.refusal.path}${Number.isInteger(state.refusal.line) ? `:${state.refusal.line}` : ""}` : "",
    ].filter(Boolean);
    if (identity.length) {
      const detail = notebookCreateEl(doc, "p", "bob-album-schema-refusal-identity");
      notebookSetText(detail, identity.join(" · "));
      status.appendChild(detail);
    }
    if (state.refusal.hint) {
      const hint = notebookCreateEl(doc, "p", "bob-album-schema-refusal-hint");
      notebookSetText(hint, state.refusal.hint);
      status.appendChild(hint);
    }
    if (Number.isInteger(state.refusal.affected)) {
      const count = notebookCreateEl(doc, "p", "bob-album-schema-refusal-count");
      notebookSetText(count, `${state.refusal.affected} records are affected.`);
      status.appendChild(count);
    }
  } else if (options.editingUnavailable) {
    notebookSetText(status, options.editingUnavailable);
  }
  if (state.syncWarning) {
    const warning = notebookCreateEl(doc, "p", "bob-album-schema-sync-warning");
    notebookSetText(warning, state.syncWarning.message || "Saved locally; sync failed.");
    status.appendChild(warning);
    if (state.syncWarning.hint) {
      const hint = notebookCreateEl(doc, "p", "bob-album-schema-refusal-hint");
      notebookSetText(hint, state.syncWarning.hint);
      status.appendChild(hint);
    }
  }
  card.appendChild(status);

  if (editable) {
    const actions = notebookCreateEl(doc, "div", "bob-album-schema-toolbar");
    const target = albumSchemaTargetByKey(model, options.selectedKey);
    const fresh = options.fresh === true;
    const disabled = !fresh || Boolean(state.busy) || Boolean(options.stage);
    const action = (text, name, blocked = disabled) => albumSchemaCardButton(doc, actions, text, {
      action: name, className: "bob-album-schema-action", ariaLabel: text,
      disabled: blocked,
    });
    action("Edit", "edit", disabled || !["stats", "field", "choice"].includes(target?.kind));
    action("Add field", "add-field", disabled);
    action("Add choice", "add-choice", disabled || !["field", "choice", "add-choice"].includes(target?.kind));
    action("Toggle required", "toggle-required", disabled || target?.kind !== "field");
    action("Toggle suggest", "toggle-suggest", disabled || target?.kind !== "field");
    action("Move up", "move-up", disabled || !["field", "choice"].includes(target?.kind));
    action("Move down", "move-down", disabled || !["field", "choice"].includes(target?.kind));
    action("Remove", "remove", disabled || !["field", "choice"].includes(target?.kind));
    action("YAML", "yaml", false);
    action("Undo", "undo", disabled || !state.undoAvailable);
    if (state.syncWarning) action("Retry sync", "retry-sync", Boolean(state.busy));
    if (state.canApply && fresh) action("Apply", "apply", Boolean(state.busy) || !fresh);
    if (state.refusal?.kind === "stale") {
      action(options.hasFreshReplacement ? "Preview retained edit against updated schema" : "Refresh schema", "rebase-preview", Boolean(state.busy));
    } else if (state.refusal?.kind === "timeout-unknown") {
      action(options.hasFreshReplacement ? "Preview retained edit after refresh" : "Refresh to reconcile outcome", options.hasFreshReplacement ? "rebase-preview" : "refresh-schema", Boolean(state.busy));
    } else if (state.status === "refused" && state.draftOps?.length && fresh) {
      action("Preview again", "preview", Boolean(state.busy));
    }
    if (options.stage) action("Cancel stage", "cancel-stage", Boolean(state.busy));
    action("Close", "close", false);
    card.appendChild(actions);
  }

  const footer = notebookCreateEl(doc, "p", "bob-album-schema-dialog-footer bob-key-card-footer");
  notebookSetText(footer, editable
    ? "⏎ edit / apply   a add field   c add choice   ! required   s suggest   ⌥J/K move   ⌃D remove   y YAML   u undo   esc cancel / close"
    : "↑/↓ navigate   y YAML   esc close");
  card.appendChild(footer);
  return card;
}

function albumSchemaSaveOpenEditors(plugin, paths) {
  const wanted = new Set((Array.isArray(paths) ? paths : []).map(albumReportPath));
  const workspace = plugin?.app?.workspace;
  if (!workspace || typeof workspace.getLeavesOfType !== "function") {
    return Promise.resolve({
      ok: false, code: "save-unsupported",
      message: "Obsidian could not confirm whether the album is open in Markdown panes.",
    });
  }
  let leaves;
  try { leaves = workspace.getLeavesOfType("markdown") || []; }
  catch (_) { leaves = null; }
  if (!Array.isArray(leaves)) {
    return Promise.resolve({ ok: false, code: "save-unsupported", message: "Obsidian could not list open Markdown panes." });
  }
  const views = leaves.map((leaf) => leaf?.view).filter((view) => wanted.has(albumReportPath(view?.file?.path)));
  if (views.some((view) => typeof view.save !== "function")) {
    return Promise.resolve({
      ok: false, code: "save-unsupported",
      message: "An open Markdown pane for this album has no supported save method.",
    });
  }
  return (async () => {
    try {
      for (const view of views) await view.save();
      return { ok: true };
    } catch (error) {
      return {
        ok: false, code: "save-failed",
        message: error && error.message ? String(error.message) : "Saving an open album pane failed.",
      };
    }
  })();
}

