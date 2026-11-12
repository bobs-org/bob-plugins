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
        appendChild(node) { this.children.push(node); return node; },
        addEventListener(type, callback) {
          const listeners = this.listeners.get(type) || [];
          listeners.push(callback);
          this.listeners.set(type, listeners);
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
    if (state.canApply && fresh && !options.stage) action("Apply", "apply", false);
    if (state.refusal?.kind === "stale") {
      action(options.hasFreshReplacement ? "Preview retained edit against updated schema" : "Refresh schema", "rebase-preview", Boolean(state.busy));
    } else if (state.refusal?.kind === "timeout-unknown") {
      action(options.hasFreshReplacement ? "Preview retained edit after refresh" : "Refresh to reconcile outcome", options.hasFreshReplacement ? "rebase-preview" : "refresh-schema", Boolean(state.busy));
    } else if (state.status === "refused" && state.draftOps?.length && fresh) {
      action("Preview again", "preview", Boolean(state.busy));
    }
    if (options.stage) action("Cancel stage", "cancel-stage", false);
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

class AlbumSchemaCardModal extends albumSchemaCardModalBase() {
  constructor(app, settings = {}) {
    super(app);
    this.schemaModel = settings.model || null;
    this.schemaSourcePath = settings.sourcePath || settings.model?.path || "";
    this.schemaPlugin = settings.plugin || null;
    this.selectedKey = "stats";
    this.selectedIndex = 0;
    this.stage = null;
    this.session = null;
    this.sessionState = null;
    this.latestSchemaModel = null;
    this.schemaUnsubscribe = null;
    this.schemaStaleRefresh = null;
  }

  schemaFresh(state = null) {
    const current = state || this.schemaPlugin?.albumReportState?.() || {};
    if (!current.report || current.stale === true || current.unavailable === true || current.refreshing === true) return false;
    const generation = Number.isInteger(current.generation) ? current.generation : 0;
    const reportGeneration = Number.isInteger(current.reportGeneration) ? current.reportGeneration : generation;
    return generation === reportGeneration;
  }

  schemaTargets() {
    return albumSchemaTargets(this.schemaModel);
  }

  schemaSelectedTarget() {
    return albumSchemaTargetByKey(this.schemaModel, this.selectedKey);
  }

  schemaJump() {
    const refusal = this.sessionState?.refusal;
    if (Number.isInteger(refusal?.line) && refusal.line > 0 &&
        (!refusal.path || albumHeaderPath(refusal.path) === albumHeaderPath(this.schemaSourcePath))) {
      return this.schemaPlugin?.albumHeaderJumpYaml?.(this.schemaSourcePath, refusal.line);
    }
    const target = this.schemaSelectedTarget();
    const line = target?.kind === "field" ? albumHeaderYamlLine(this.schemaModel, { fieldKey: target.field.key })
      : target?.kind === "choice" ? albumHeaderYamlLine(this.schemaModel, { fieldKey: target.field.key })
        : target?.kind === "issue" ? albumHeaderYamlLine(this.schemaModel, { issue: target.issue })
          : albumHeaderYamlLine(this.schemaModel, {});
    return this.schemaPlugin?.albumHeaderJumpYaml?.(this.schemaSourcePath, line);
  }

  schemaSelect(key) {
    const targets = this.schemaTargets();
    const index = targets.findIndex((target) => target.key === key);
    if (index < 0) return;
    this.selectedKey = key;
    this.selectedIndex = index;
    this.paintSchemaCard();
  }

  schemaMove(delta) {
    const targets = this.schemaTargets();
    if (!targets.length) return;
    let index = targets.findIndex((target) => target.key === this.selectedKey);
    if (index < 0) index = Math.min(this.selectedIndex || 0, targets.length - 1);
    index = (index + delta + targets.length) % targets.length;
    this.selectedIndex = index;
    this.selectedKey = targets[index].key;
    this.paintSchemaCard();
  }

  schemaStage(kind, targetKey = this.selectedKey) {
    if (!this.session || !this.schemaFresh()) {
      this.paintSchemaCard();
      return false;
    }
    this.stage = { kind, targetKey };
    this.paintSchemaCard();
    const input = this.contentEl?.querySelector?.(".bob-album-schema-stage [data-schema-input]");
    try { input?.focus?.(); } catch (_) {}
    return true;
  }

  schemaEditable() {
    return Boolean(this.session && this.schemaFresh());
  }

  schemaState() {
    if (this.session) this.sessionState = this.session.getState();
    return this.sessionState || {};
  }

  paintSchemaCard() {
    const host = this.contentEl;
    if (!host) return;
    const targets = this.schemaTargets();
    if (targets.length && !targets.some((target) => target.key === this.selectedKey)) {
      const index = Math.min(this.selectedIndex || 0, targets.length - 1);
      this.selectedKey = targets[index].key;
      this.selectedIndex = index;
    }
    try { host.empty?.(); } catch (_) { while (host.firstChild) host.removeChild(host.firstChild); }
    const doc = notebookDomDoc(host) || host.ownerDocument || (typeof document !== "undefined" ? document : null);
    const state = this.schemaState();
    const card = albumSchemaCardBuildEl(this.schemaModel, {
      selectedKey: this.selectedKey,
      selectedIndex: this.selectedIndex,
      desktop: true,
      editable: Boolean(this.session),
      fresh: this.schemaFresh(),
      editingUnavailable: this.schemaUnavailable || (!this.schemaFresh() ? "Editing waits for a fresh album report." : ""),
      state,
      stage: this.stage,
      hasFreshReplacement: Boolean(this.latestSchemaModel?.schemaFingerprint),
      handlers: {
        jumpYaml: (line) => this.schemaPlugin?.albumHeaderJumpYaml?.(this.schemaSourcePath, line),
      },
    }, doc);
    if (card) host.appendChild(card);
    if (this.stage) {
      const input = host.querySelector?.(".bob-album-schema-stage [data-schema-input]");
      try { input?.focus?.({ preventScroll: true }); } catch (_) {}
    } else {
      const selected = host.querySelector?.(`[data-target-key="${this.selectedKey}"]`)
        || host.querySelector?.(".bob-album-schema-field.is-selected")
        || host.querySelector?.(".bob-album-schema-issue");
      try { selected?.focus?.({ preventScroll: true }); } catch (_) {}
    }
  }

  schemaStartSession() {
    const plugin = this.schemaPlugin;
    const model = this.schemaModel;
    if (!plugin || !model?.schemaFingerprint ||
        typeof plugin.apiAlbumUpdatePreview !== "function" ||
        typeof plugin.apiAlbumUpdateApply !== "function") {
      this.schemaUnavailable = "Schema editing is unavailable until bob-cli and the album report are current.";
      return;
    }
    if (!this.schemaFresh()) {
      this.schemaUnavailable = "Editing waits for a fresh album report.";
      return;
    }
    this.session = createAlbumUpdateSession({
      stem: model.stem,
      albumPath: model.path,
      expect: model.schemaFingerprint,
    }, albumUpdateServiceDeps(plugin, {
      saveEditors: (paths) => albumSchemaSaveOpenEditors(plugin, paths),
      onChange: (state) => {
        this.sessionState = state;
        this.paintSchemaCard();
        if (["stale", "timeout-unknown"].includes(state.refusal?.kind)) void this.schemaRefreshAfterStale();
      },
    }));
    this.sessionState = this.session.getState();
  }

  async schemaRefreshAfterStale() {
    if (this.schemaStaleRefresh || typeof this.schemaPlugin?.apiAlbumReport !== "function") return this.schemaStaleRefresh;
    this.schemaStaleRefresh = Promise.resolve()
      .then(() => this.schemaPlugin.apiAlbumReport({ force: true, wait: true }))
      .then((state) => this.schemaAlbumState(state))
      .catch(() => null)
      .finally(() => { this.schemaStaleRefresh = null; });
    return this.schemaStaleRefresh;
  }

  schemaAlbumState(state) {
    if (!state || !this.schemaModel) return;
    this.session?.noteGenerationChanged?.();
    if (state.report) {
      const next = albumHeaderModel(state.report, this.schemaSourcePath, {
        sourcePath: this.schemaSourcePath,
        metadataCache: this.schemaPlugin?.app?.metadataCache,
        vault: this.schemaPlugin?.app?.vault,
      });
      if (next) {
        const session = this.session?.getState?.() || {};
        if (this.schemaFresh(state) && !session.draftOps?.length && !this.stage &&
            ["browsing", "saved-with-sync-warning"].includes(session.status)) {
          this.schemaModel = next;
          this.latestSchemaModel = null;
          if (next.schemaFingerprint && next.schemaFingerprint !== session.expect) this.session?.rebase?.(next.schemaFingerprint);
          this.schemaRepairSelection();
        } else if (next.schemaFingerprint && (
          next.schemaFingerprint !== this.schemaModel.schemaFingerprint ||
          ["stale", "timeout-unknown"].includes(session.refusal?.kind)
        )) {
          this.latestSchemaModel = next;
        }
      }
    }
    this.paintSchemaCard();
  }

  schemaRepairSelection() {
    const targets = this.schemaTargets();
    if (!targets.some((target) => target.key === this.selectedKey) && targets.length) {
      const index = Math.min(this.selectedIndex || 0, targets.length - 1);
      this.selectedIndex = index;
      this.selectedKey = targets[index].key;
    }
  }

  schemaInput(name) {
    return this.contentEl?.querySelector?.(`[data-schema-input="${name}"]`) || null;
  }

  schemaChecked(name) {
    return this.schemaInput(name)?.checked === true;
  }

  schemaString(name) {
    const value = this.schemaInput(name)?.value;
    return value == null ? "" : String(value);
  }

  schemaBuildStageOp() {
    const stage = this.stage;
    const target = albumSchemaTargetByKey(this.schemaModel, stage?.targetKey);
    if (!stage) return null;
    if (stage.kind === "album") {
      const set = {};
      const unset = [];
      const useLabel = this.schemaChecked("useLabel");
      const label = this.schemaString("albumLabel");
      if (useLabel && (this.schemaModel.storedLabel == null || label !== this.schemaModel.storedLabel)) set.label = label;
      else if (!useLabel && this.schemaModel.storedLabel != null) unset.push("label");
      const usePlural = this.schemaChecked("usePlural");
      const plural = this.schemaString("albumPlural");
      if (usePlural && (this.schemaModel.storedPlural == null || plural !== this.schemaModel.storedPlural)) set.plural = plural;
      else if (!usePlural && this.schemaModel.storedPlural != null) unset.push("plural");
      const datedNotes = this.schemaChecked("datedNotes");
      if (datedNotes !== (this.schemaModel.datedNotes === true)) set.dated_notes = datedNotes;
      return Object.keys(set).length || unset.length ? { op: "album.set", set, unset } : null;
    }
    if (stage.kind === "field") {
      const field = target?.field;
      if (!field) return null;
      const set = {};
      const unset = [];
      const label = this.schemaString("fieldLabel");
      if (label !== field.label) set.label = label;
      const useDefault = this.schemaChecked("defaultPresent");
      if (useDefault) {
        const defaultInput = this.schemaInput("fieldDefault");
        const value = albumSchemaTypedDefault(defaultInput?.value, field, defaultInput?.checked);
        if (!field.defaultPresent || !albumSchemaSameValue(value, field.default)) set.default = value;
      } else if (field.defaultPresent) unset.push("default");
      for (const [flag, input, key, current] of [
        ["minPresent", "fieldMin", "min", field.min],
        ["maxPresent", "fieldMax", "max", field.max],
      ]) {
        const enabled = this.schemaChecked(flag);
        if (enabled) {
          const raw = this.schemaString(input);
          const value = raw === "" ? Number.NaN : Number(raw);
          if (current == null || value !== current) set[key] = value;
        } else if (current != null) unset.push(key);
      }
      return Object.keys(set).length || unset.length
        ? { op: "field.set", field: field.key, set, unset }
        : null;
    }
    if (stage.kind === "field-add") {
      const kindInput = this.schemaInput("newFieldKind");
      const kind = String(kindInput?.value || "text");
      const selectedField = target?.field || null;
      const fields = Array.isArray(this.schemaModel.fields) ? this.schemaModel.fields : [];
      const fieldIndex = selectedField ? fields.findIndex((field) => field.key === selectedField.key) : -1;
      const op = {
        op: "field.add",
        label: this.schemaString("newFieldLabel"),
        kind,
        list: this.schemaChecked("newFieldList"),
        suggest: this.schemaChecked("newFieldSuggest"),
        position: fieldIndex < 0 ? fields.length : fieldIndex + 1,
      };
      if (kind === "choices") {
        const rows = this.contentEl?.querySelectorAll?.(".bob-album-schema-initial-choice") || [];
        op.choices = Array.from(rows).map((row, index) => {
          const label = row.querySelector?.(`[data-schema-input="choiceLabel${index}"]`);
          const emoji = row.querySelector?.(`[data-schema-input="choiceEmoji${index}"]`);
          const choice = { label: String(label?.value ?? "") };
          if (String(emoji?.value || "").trim()) choice.emoji = String(emoji.value);
          return choice;
        });
      }
      return op;
    }
    if (stage.kind === "choice" && target?.choice && target.field) {
      const oldParts = albumSchemaChoiceParts(target.choice.label);
      const label = this.schemaString("choiceLabel");
      const emoji = this.schemaString("choiceEmoji");
      const set = {};
      if (label !== oldParts.label) set.label = label;
      if (emoji !== oldParts.emoji) set.emoji = emoji;
      return Object.keys(set).length
        ? { op: "choice.set", field: target.field.key, value: target.choice.value, set }
        : null;
    }
    if (stage.kind === "choice-add") {
      const field = target?.kind === "field" || target?.kind === "choice" || target?.kind === "add-choice"
        ? target.field
        : null;
      if (!field) return null;
      let position = (field.choices || []).length;
      if (target.kind === "choice") {
        const index = (field.choices || []).findIndex((choice) => choice.value === target.choice?.value);
        if (index >= 0) position = index + 1;
      }
      const op = {
        op: "choice.add", field: field.key,
        label: this.schemaString("choiceLabel"), position,
      };
      const emoji = this.schemaString("choiceEmoji");
      if (emoji.trim()) op.emoji = emoji;
      return op;
    }
    return null;
  }

  schemaQueueOp(op, selectedKey = this.selectedKey) {
    if (!this.session || !this.schemaFresh()) {
      this.paintSchemaCard();
      return { ok: false, code: "editing-unavailable", message: "Editing waits for a fresh album report." };
    }
    this.stage = null;
    if (!op) {
      this.paintSchemaCard();
      return { ok: false, code: "empty-stage", message: "No schema values changed." };
    }
    const targetIndex = this.schemaTargets().findIndex((target) => target.key === selectedKey);
    if (targetIndex >= 0) this.selectedIndex = targetIndex;
    this.selectedKey = selectedKey;
    this.sessionState = this.session.setDraft([op]);
    this.paintSchemaCard();
    return { ok: true, op };
  }

  schemaStartAddChoice() {
    const target = this.schemaSelectedTarget();
    if (!["field", "choice", "add-choice"].includes(target?.kind)) return false;
    const field = target.field;
    if (!field || field.kind !== "choices") return false;
    const selectedKey = target.kind === "add-choice" ? target.key : target.key;
    return this.schemaStage("choice-add", selectedKey);
  }

  schemaEditSelected() {
    if (this.sessionState?.canApply && this.schemaFresh()) {
      void this.schemaApply();
      return;
    }
    const target = this.schemaSelectedTarget();
    if (target?.kind === "stats") this.schemaStage("album", target.key);
    else if (target?.kind === "field") this.schemaStage("field", target.key);
    else if (target?.kind === "choice") this.schemaStage("choice", target.key);
    else if (target?.kind === "add-field") this.schemaStage("field-add", target.key);
    else if (target?.kind === "add-choice") this.schemaStage("choice-add", target.key);
    else if (target?.kind === "issue") void this.schemaJump();
  }

  schemaMoveSelected(direction) {
    const target = this.schemaSelectedTarget();
    if (!target || !["field", "choice"].includes(target.kind)) return;
    if (target.kind === "field") {
      const fields = this.schemaModel.fields || [];
      const index = fields.findIndex((field) => field.key === target.field.key);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= fields.length) return;
      this.schemaQueueOp({ op: "field.move", field: target.field.key, position: next }, target.key);
    } else {
      const choices = target.field.choices || [];
      const index = choices.findIndex((choice) => choice.value === target.choice.value);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= choices.length) return;
      this.schemaQueueOp({ op: "choice.move", field: target.field.key, value: target.choice.value, position: next }, target.key);
    }
  }

  schemaRemoveSelected() {
    const target = this.schemaSelectedTarget();
    if (target?.kind === "field") this.schemaQueueOp({ op: "field.remove", field: target.field.key }, target.key);
    else if (target?.kind === "choice") this.schemaQueueOp({ op: "choice.remove", field: target.field.key, value: target.choice.value }, target.key);
  }

  schemaToggleSelected(property) {
    const target = this.schemaSelectedTarget();
    if (target?.kind !== "field") return;
    const field = target.field;
    this.schemaQueueOp({ op: "field.set", field: field.key, set: { [property]: field[property] !== true } }, target.key);
  }

  async schemaApply() {
    if (!this.session || !this.sessionState?.canApply || !this.schemaFresh()) return;
    const result = await this.session.apply();
    this.sessionState = this.session.getState();
    if (result?.ok && result.changed) {
      try { new Notice("Album schema saved. Press u to preview Undo."); } catch (_) {}
    }
    const state = this.schemaPlugin?.albumReportState?.();
    if (state) this.schemaAlbumState(state);
    if (this.sessionState.refusal?.kind === "stale") void this.schemaRefreshAfterStale();
    this.paintSchemaCard();
  }

  async schemaRetrySync() {
    if (!this.session) return;
    await this.session.retrySync();
    this.sessionState = this.session.getState();
    this.paintSchemaCard();
  }

  async schemaRebaseAndPreview() {
    if (!this.latestSchemaModel?.schemaFingerprint || !this.session) {
      await this.schemaRefreshAfterStale();
      return;
    }
    this.schemaModel = this.latestSchemaModel;
    this.latestSchemaModel = null;
    this.session.rebase(this.schemaModel.schemaFingerprint);
    this.schemaRepairSelection();
    this.paintSchemaCard();
    await this.session.previewNow();
  }

  async schemaRefresh() {
    if (typeof this.schemaPlugin?.apiAlbumReport !== "function") return;
    const state = await this.schemaPlugin.apiAlbumReport({ force: true, wait: true });
    this.schemaAlbumState(state);
  }

  schemaCancelStage() {
    this.stage = null;
    if (!this.sessionState?.draftOps?.length && this.latestSchemaModel && this.schemaFresh()) {
      this.schemaModel = this.latestSchemaModel;
      this.latestSchemaModel = null;
      this.session?.rebase?.(this.schemaModel.schemaFingerprint);
      this.schemaRepairSelection();
    }
    this.paintSchemaCard();
  }

  async schemaAction(action) {
    if (!action) return;
    if (action === "close") { this.close(); return; }
    if (action === "yaml") { void this.schemaJump(); return; }
    if (action === "cancel-stage") { this.schemaCancelStage(); return; }
    if (["unset-default", "unset-minimum", "unset-maximum"].includes(action)) {
      const name = action === "unset-default" ? "defaultPresent" : action === "unset-minimum" ? "minPresent" : "maxPresent";
      const input = this.schemaInput(name);
      if (input) input.checked = false;
      return;
    }
    if (action === "edit") { this.schemaEditSelected(); return; }
    if (action === "add-field") { this.schemaStage("field-add", this.selectedKey); return; }
    if (action === "add-choice") { this.schemaStartAddChoice(); return; }
    if (action === "toggle-required") { this.schemaToggleSelected("required"); return; }
    if (action === "toggle-suggest") { this.schemaToggleSelected("suggest"); return; }
    if (action === "move-up") { this.schemaMoveSelected(-1); return; }
    if (action === "move-down") { this.schemaMoveSelected(1); return; }
    if (action === "remove") { this.schemaRemoveSelected(); return; }
    if (action === "apply") { await this.schemaApply(); return; }
    if (action === "undo") {
      const result = this.session?.stageUndo?.();
      if (result?.ok) { this.sessionState = this.session.getState(); this.paintSchemaCard(); }
      return;
    }
    if (action === "retry-sync") { await this.schemaRetrySync(); return; }
    if (action === "preview") { await this.session?.previewNow?.(); return; }
    if (action === "refresh-schema") { await this.schemaRefresh(); return; }
    if (action === "rebase-preview") { await this.schemaRebaseAndPreview(); return; }
    if (action === "submit-stage") { this.schemaQueueOp(this.schemaBuildStageOp(), this.stage?.targetKey); return; }
    if (action === "add-initial-choice") {
      const host = this.contentEl?.querySelector?.("[data-schema-initial-choices]");
      const rows = host?.querySelectorAll?.(".bob-album-schema-initial-choice") || [];
      albumSchemaAddInitialChoiceRow(notebookDomDoc(host) || host?.ownerDocument, host, rows.length);
      return;
    }
    if (action.startsWith("remove-initial-choice:")) {
      const index = Number(action.split(":").pop());
      const rows = this.contentEl?.querySelectorAll?.(".bob-album-schema-initial-choice") || [];
      rows[index]?.remove?.();
      rows.forEach((row, rowIndex) => {
        const oldIndex = Number(row.getAttribute("data-choice-index"));
        row.setAttribute("data-choice-index", String(rowIndex));
        const label = row.querySelector?.(`[data-schema-input="choiceLabel${oldIndex}"]`);
        const emoji = row.querySelector?.(`[data-schema-input="choiceEmoji${oldIndex}"]`);
        if (label) label.setAttribute("data-schema-input", `choiceLabel${rowIndex}`);
        if (emoji) emoji.setAttribute("data-schema-input", `choiceEmoji${rowIndex}`);
      });
    }
  }

  schemaOnClick(event) {
    const button = event?.target?.closest?.("button[data-schema-action], button[data-target-key]");
    if (!button) return;
    const action = button.getAttribute("data-schema-action");
    if (action) {
      event.preventDefault?.();
      void this.schemaAction(action);
      return;
    }
    const key = button.getAttribute("data-target-key");
    if (key) this.schemaSelect(key);
  }

  schemaOnKeyDown(event) {
    if (!event || event.isComposing || event.keyCode === 229) return;
    const target = event.target;
    const inInput = Boolean(target?.closest?.("input,select,textarea"));
    const targetButton = target?.closest?.("button[data-target-key]") || null;
    const inButton = Boolean(target?.closest?.("button"));
    if (inInput) {
      if (event.key === "Escape") { event.preventDefault?.(); this.schemaCancelStage(); }
      else if (event.key === "Enter" && target.tagName !== "TEXTAREA" && this.stage) {
        event.preventDefault?.();
        void this.schemaAction("submit-stage");
      }
      return;
    }
    if (targetButton) {
      this.selectedKey = targetButton.getAttribute("data-target-key") || this.selectedKey;
      this.selectedIndex = this.schemaTargets().findIndex((item) => item.key === this.selectedKey);
    } else if (inButton) return;
    if (this.stage) {
      if (event.key === "Escape") { event.preventDefault?.(); this.schemaCancelStage(); }
      else if (event.key === "Enter") { event.preventDefault?.(); void this.schemaAction("submit-stage"); }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault?.();
      const state = this.session?.getState?.() || {};
      if (state.draftOps?.length) {
        this.session.setDraft([]);
        this.sessionState = this.session.getState();
        this.paintSchemaCard();
      } else this.close();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault?.();
      this.schemaEditSelected();
      return;
    }
    if (event.key === "ArrowUp" || event.key === "k") { event.preventDefault?.(); this.schemaMove(-1); return; }
    if (event.key === "ArrowDown" || event.key === "j") { event.preventDefault?.(); this.schemaMove(1); return; }
    if (event.key === "ArrowLeft") { event.preventDefault?.(); this.schemaMove(-1); return; }
    if (event.key === "ArrowRight") { event.preventDefault?.(); this.schemaMove(1); return; }
    if (event.altKey && (event.key === "j" || event.key === "J")) { event.preventDefault?.(); this.schemaMoveSelected(1); return; }
    if (event.altKey && (event.key === "k" || event.key === "K")) { event.preventDefault?.(); this.schemaMoveSelected(-1); return; }
    if (event.ctrlKey && event.key.toLowerCase() === "d") { event.preventDefault?.(); this.schemaRemoveSelected(); return; }
    if (!event.altKey && !event.ctrlKey && !event.metaKey) {
      if (event.key === "a") { event.preventDefault?.(); void this.schemaAction("add-field"); return; }
      if (event.key === "c") { event.preventDefault?.(); void this.schemaAction("add-choice"); return; }
      if (event.key === "!") { event.preventDefault?.(); this.schemaToggleSelected("required"); return; }
      if (event.key === "s") { event.preventDefault?.(); this.schemaToggleSelected("suggest"); return; }
      if (event.key === "y" || event.key === "Y") { event.preventDefault?.(); void this.schemaJump(); return; }
      if (event.key === "u") { event.preventDefault?.(); void this.schemaAction("undo"); return; }
    }
  }

  onOpen() {
    try {
      this.modalEl?.addClass?.("bob-album-schema-modal");
      this.modalEl?.setAttribute?.("role", "dialog");
      this.modalEl?.setAttribute?.("aria-modal", "true");
      this.modalEl?.setAttribute?.("aria-label", "Album schema editor");
      this.contentEl?.addClass?.("bob-album-schema-dialog");
      this.contentEl?.addClass?.("bob-key-card");
    } catch (_) {}
    this.schemaStartSession();
    this.paintSchemaCard();
    this.schemaClickListener = (event) => this.schemaOnClick(event);
    this.schemaKeyListener = (event) => this.schemaOnKeyDown(event);
    this.schemaFocusListener = (event) => {
      const target = event?.target?.closest?.("[data-target-key]");
      if (target) {
        this.selectedKey = target.getAttribute("data-target-key");
        this.selectedIndex = this.schemaTargets().findIndex((item) => item.key === this.selectedKey);
      }
    };
    this.contentEl?.addEventListener?.("click", this.schemaClickListener);
    this.contentEl?.addEventListener?.("keydown", this.schemaKeyListener);
    this.contentEl?.addEventListener?.("focusin", this.schemaFocusListener);
    this.schemaUnsubscribe = this.schemaPlugin?.apiAlbumSubscribe?.((state) => this.schemaAlbumState(state)) || null;
  }

  onClose() {
    this.session?.close?.();
    this.session = null;
    try { this.schemaUnsubscribe?.(); } catch (_) {}
    this.schemaUnsubscribe = null;
    try { this.contentEl?.empty?.(); } catch (_) {}
    if (this.schemaPlugin && this.schemaPlugin.albumSchemaCardModal === this) {
      this.schemaPlugin.albumSchemaCardModal = null;
    }
  }
}

class BobLedgerToolsAlbumSchemaCardMixin {
  openAlbumSchemaCard(model, sourcePath) {
    if (!this.albumHeaderDesktop()) return { ok: false, reason: "mobile" };
    if (!model) return { ok: false, reason: "missing model" };
    try { this.albumSchemaCardModal?.close?.(); } catch (_) {}
    const modal = new AlbumSchemaCardModal(this.app, {
      model,
      sourcePath: sourcePath || model.path,
      plugin: this,
    });
    this.albumSchemaCardModal = modal;
    try { modal.open(); } catch (_) {}
    return { ok: true, modal };
  }
}
