// Keyboard-first, editable album Schema Card. It stages one gesture at a
// time, asks bob for a dry-run consequence, and applies only that preview.
class AlbumSchemaCardModal extends albumSchemaCardModalBase() {
  constructor(app, settings = {}) {
    super(app);
    this.schemaModel = settings.model || null;
    this.schemaSourcePath = settings.sourcePath || settings.model?.path || "";
    this.schemaPlugin = settings.plugin || null;
    this.selectedKey = "stats";
    this.selectedIndex = 0;
    this.stage = null;
    this.stageDraft = null;
    this.session = null;
    this.sessionState = null;
    this.schemaApplyPromise = null;
    this.schemaApplyNotice = "";
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
    if (!this.session || !this.schemaFresh() || this.sessionState?.busy) {
      this.paintSchemaCard();
      return false;
    }
    this.stage = { kind, targetKey };
    this.stageDraft = this.schemaCreateStageDraft(this.stage);
    this.paintSchemaCard();
    return true;
  }

  schemaCreateStageDraft(stage) {
    const target = albumSchemaTargetByKey(this.schemaModel, stage?.targetKey);
    const values = {};
    const initialChoices = null;
    let first = "";
    if (stage?.kind === "album") {
      Object.assign(values, {
        useLabel: this.schemaModel.storedLabel != null,
        albumLabel: this.schemaModel.storedLabel || "",
        usePlural: this.schemaModel.storedPlural != null,
        albumPlural: this.schemaModel.storedPlural || "",
        datedNotes: this.schemaModel.datedNotes === true,
      });
      first = "albumLabel";
    } else if (stage?.kind === "field") {
      const field = target?.field || {};
      const defaultValue = Array.isArray(field.default) ? JSON.stringify(field.default) : field.default;
      Object.assign(values, {
        fieldLabel: field.label || "",
        defaultPresent: field.defaultPresent === true,
        fieldDefault: field.defaultPresent ? (defaultValue == null ? "" : String(defaultValue)) : "",
        minPresent: field.min != null,
        fieldMin: field.min == null ? "" : String(field.min),
        maxPresent: field.max != null,
        fieldMax: field.max == null ? "" : String(field.max),
      });
      first = "fieldLabel";
    } else if (stage?.kind === "field-add") {
      Object.assign(values, { newFieldLabel: "", newFieldKind: "text", newFieldList: false, newFieldSuggest: false });
      first = "newFieldLabel";
    } else if (stage?.kind === "choice") {
      const parts = albumSchemaChoiceParts(target?.choice?.label);
      Object.assign(values, { choiceLabel: parts.label, choiceEmoji: parts.emoji });
      first = "choiceLabel";
    } else if (stage?.kind === "choice-add") {
      Object.assign(values, { choiceLabel: "", choiceEmoji: "" });
      first = "choiceLabel";
    }
    return {
      values,
      initialChoices: stage?.kind === "field-add" ? [{ label: "", emoji: "" }] : initialChoices,
      focusName: first,
      selectionStart: null,
      selectionEnd: null,
      selectionDirection: "none",
    };
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
      editingUnavailable: this.schemaUnavailable || (!this.schemaFresh()
        ? this.schemaApplyNotice || "Editing waits for a fresh album report."
        : ""),
      state,
      stage: this.stage,
      stageDraft: this.stageDraft,
      stageLocked: state.status === "applying" || !this.schemaFresh(),
      hasFreshReplacement: Boolean(this.latestSchemaModel?.schemaFingerprint),
      handlers: {
        jumpYaml: (line) => this.schemaPlugin?.albumHeaderJumpYaml?.(this.schemaSourcePath, line),
      },
    }, doc);
    if (card) host.appendChild(card);
    if (this.stage) {
      const wanted = this.stageDraft?.focusName;
      const input = wanted
        ? host.querySelector?.(`[data-schema-input="${wanted}"]`)
        : host.querySelector?.(".bob-album-schema-stage [data-schema-input]");
      try { input?.focus?.({ preventScroll: true }); } catch (_) {}
      if (input && this.stageDraft && Number.isInteger(this.stageDraft.selectionStart) &&
          typeof input.setSelectionRange === "function") {
        try { input.setSelectionRange(this.stageDraft.selectionStart, this.stageDraft.selectionEnd, this.stageDraft.selectionDirection || "none"); } catch (_) {}
      }
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

  schemaInputIsCheckbox(input) {
    return String(input?.type || input?.getAttribute?.("type") || "").toLowerCase() === "checkbox";
  }

  schemaStageRead(name) {
    const values = this.stageDraft?.values || {};
    if (Object.prototype.hasOwnProperty.call(values, name)) return values[name];
    const input = this.schemaInput(name);
    return this.schemaInputIsCheckbox(input) ? input.checked === true : input?.value;
  }

  schemaChecked(name) {
    return this.schemaStageRead(name) === true;
  }

  schemaString(name) {
    const value = this.schemaStageRead(name);
    return value == null ? "" : String(value);
  }

  schemaCaptureStageValuesFromDom() {
    if (!this.stage || !this.stageDraft) return;
    const panel = this.contentEl?.querySelector?.(".bob-album-schema-stage");
    const inputs = panel?.querySelectorAll?.("[data-schema-input]") || [];
    for (const input of Array.from(inputs)) {
      const name = input.getAttribute?.("data-schema-input");
      if (!name) continue;
      const value = this.schemaInputIsCheckbox(input) ? input.checked === true : String(input.value ?? "");
      this.stageDraft.values[name] = value;
      const label = /^choiceLabel(\d+)$/.exec(name);
      const emoji = /^choiceEmoji(\d+)$/.exec(name);
      if (label || emoji) {
        const index = Number((label || emoji)[1]);
        if (!Array.isArray(this.stageDraft.initialChoices)) this.stageDraft.initialChoices = [];
        while (this.stageDraft.initialChoices.length <= index) this.stageDraft.initialChoices.push({ label: "", emoji: "" });
        this.stageDraft.initialChoices[index][label ? "label" : "emoji"] = value;
      }
    }
    const active = this.contentEl?.ownerDocument?.activeElement;
    if (active?.getAttribute?.("data-schema-input")) this.schemaStageRememberFocus(active);
  }

  schemaStageRememberFocus(input) {
    if (!this.stageDraft || !input) return;
    const name = input.getAttribute?.("data-schema-input");
    if (!name) return;
    this.stageDraft.focusName = name;
    try {
      this.stageDraft.selectionStart = Number.isInteger(input.selectionStart) ? input.selectionStart : null;
      this.stageDraft.selectionEnd = Number.isInteger(input.selectionEnd) ? input.selectionEnd : null;
      this.stageDraft.selectionDirection = input.selectionDirection || "none";
    } catch (_) {
      this.stageDraft.selectionStart = null;
      this.stageDraft.selectionEnd = null;
      this.stageDraft.selectionDirection = "none";
    }
  }

  schemaStageInput(event) {
    if (!this.stage || !this.stageDraft || this.sessionState?.status === "applying" || this.schemaComposing) return;
    const input = event?.target;
    const name = input?.getAttribute?.("data-schema-input");
    if (!name) return;
    const value = this.schemaInputIsCheckbox(input) ? input.checked === true : String(input.value ?? "");
    const previous = this.stageDraft.values[name];
    this.stageDraft.values[name] = value;
    const label = /^choiceLabel(\d+)$/.exec(name);
    const emoji = /^choiceEmoji(\d+)$/.exec(name);
    if (label || emoji) {
      const index = Number((label || emoji)[1]);
      if (!Array.isArray(this.stageDraft.initialChoices)) this.stageDraft.initialChoices = [];
      while (this.stageDraft.initialChoices.length <= index) this.stageDraft.initialChoices.push({ label: "", emoji: "" });
      this.stageDraft.initialChoices[index][label ? "label" : "emoji"] = value;
    }
    this.schemaStageRememberFocus(input);
    if (Object.is(previous, value)) return;
    this.schemaQueueStagePreview(false);
  }

  schemaQueueStagePreview(immediate = false) {
    if (!this.stage || !this.stageDraft || !this.session || this.sessionState?.status === "applying") return;
    this.schemaCaptureStageValuesFromDom();
    const op = this.schemaBuildStageOp();
    const next = op ? [op] : [];
    const current = this.session.getState().draftOps || [];
    const changed = JSON.stringify(current) !== JSON.stringify(next);
    if (changed) this.sessionState = this.session.setDraft(next);
    if (immediate && next.length) void this.session.previewNow();
    if (!changed && !immediate) this.paintSchemaCard();
  }

  schemaStageAddInitialChoice() {
    if (!this.stageDraft || this.sessionState?.status === "applying") return;
    if (!Array.isArray(this.stageDraft.initialChoices)) this.stageDraft.initialChoices = [];
    this.stageDraft.initialChoices.push({ label: "", emoji: "" });
    const index = this.stageDraft.initialChoices.length - 1;
    this.stageDraft.focusName = `choiceLabel${index}`;
    this.stageDraft.selectionStart = null;
    this.stageDraft.selectionEnd = null;
    this.paintSchemaCard();
    this.schemaQueueStagePreview(false);
  }

  schemaStageRemoveInitialChoice(index) {
    if (!this.stageDraft || this.sessionState?.status === "applying" || !Array.isArray(this.stageDraft.initialChoices)) return;
    if (!Number.isInteger(index) || index < 0 || index >= this.stageDraft.initialChoices.length) return;
    this.stageDraft.initialChoices.splice(index, 1);
    this.stageDraft.values = Object.fromEntries(Object.entries(this.stageDraft.values || {}).filter(([name]) => !/^choice(?:Label|Emoji)\d+$/.test(name)));
    this.stageDraft.initialChoices.forEach((choice, next) => {
      this.stageDraft.values[`choiceLabel${next}`] = choice.label || "";
      this.stageDraft.values[`choiceEmoji${next}`] = choice.emoji || "";
    });
    const nextIndex = Math.min(index, this.stageDraft.initialChoices.length - 1);
    this.stageDraft.focusName = nextIndex >= 0 ? `choiceLabel${nextIndex}` : "newFieldLabel";
    this.stageDraft.selectionStart = null;
    this.stageDraft.selectionEnd = null;
    this.paintSchemaCard();
    this.schemaQueueStagePreview(false);
  }

  schemaStageEnter() {
    const state = this.session?.getState?.() || {};
    if (state.canApply === true) {
      void this.schemaApply();
    }
  }

  schemaBuildStageOp() {
    const stage = this.stage;
    const target = albumSchemaTargetByKey(this.schemaModel, stage?.targetKey);
    if (!stage) return null;
    this.schemaCaptureStageValuesFromDom();
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
        const value = albumSchemaTypedDefault(this.schemaString("fieldDefault"), field, this.schemaChecked("fieldDefault"));
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
      const kind = String(this.schemaStageRead("newFieldKind") || "text");
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
        const rows = Array.isArray(this.stageDraft?.initialChoices) ? this.stageDraft.initialChoices : [];
        op.choices = rows.map((row) => {
          const choice = { label: String(row?.label ?? "") };
          const emoji = String(row?.emoji || "");
          if (emoji.trim()) choice.emoji = emoji;
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
    if (!this.session || !this.schemaFresh() || this.sessionState?.status === "applying") {
      this.paintSchemaCard();
      return { ok: false, code: "editing-unavailable", message: "Editing waits for a fresh album report." };
    }
    this.stage = null;
    this.stageDraft = null;
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
    const state = this.schemaState();
    if (state.canApply || (state.status === "preview-ready" && !this.schemaFresh())) {
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

  schemaApply() {
    if (this.schemaApplyPromise) return this.schemaApplyPromise;
    const work = this.schemaApplyCurrentPreview();
    const guarded = work.finally(() => {
      if (this.schemaApplyPromise === guarded) this.schemaApplyPromise = null;
    });
    this.schemaApplyPromise = guarded;
    return guarded;
  }

  async schemaApplyCurrentPreview() {
    if (!this.session) return { ok: false, code: "unavailable" };
    let current = this.session.getState();
    this.sessionState = current;
    let fresh = this.schemaFresh();
    if (!fresh || (current.status === "preview-ready" && !current.canApply)) {
      current = this.session.noteGenerationChanged?.() || this.session.getState();
      this.sessionState = current;
      fresh = this.schemaFresh();
      this.schemaApplyNotice = current.refusal
        ? ""
        : "This preview is stale. Refresh the album report before applying.";
      void this.schemaRefreshAfterStale();
      this.paintSchemaCard();
      return { ok: false, code: "stale", message: current.refusal?.message || this.schemaApplyNotice };
    }
    this.schemaApplyNotice = "";
    if (!current.canApply || !fresh) {
      this.paintSchemaCard();
      return { ok: false, code: "not-previewed", message: "Enter is inert until a current preview succeeds." };
    }
    const result = await this.session.apply();
    this.sessionState = this.session.getState();
    if (result?.ok && result.changed) {
      this.stage = null;
      this.stageDraft = null;
      try { new Notice("Album schema saved. Press u to preview Undo."); } catch (_) {}
    }
    const state = this.schemaPlugin?.albumReportState?.();
    if (state) this.schemaAlbumState(state);
    if (this.sessionState.refusal?.kind === "stale") void this.schemaRefreshAfterStale();
    this.paintSchemaCard();
    return result;
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
    if (this.stage && this.session && (this.session.getState().draftOps || []).length) {
      this.sessionState = this.session.setDraft([]);
    }
    this.stage = null;
    this.stageDraft = null;
    if (!this.sessionState?.draftOps?.length && this.latestSchemaModel && this.schemaFresh()) {
      this.schemaModel = this.latestSchemaModel;
      this.latestSchemaModel = null;
      this.session?.rebase?.(this.schemaModel.schemaFingerprint);
      this.schemaRepairSelection();
    }
    this.paintSchemaCard();
  }

  schemaHandleEscape() {
    if (this.sessionState?.status === "applying") return "ignore";
    if (this.stage) {
      this.schemaCancelStage();
      return "stay";
    }
    const state = this.session?.getState?.() || this.sessionState || {};
    if ((state.draftOps || []).length) {
      try { this.session.setDraft([]); } catch (_) {}
      try { this.sessionState = this.session.getState(); } catch (_) {}
      this.paintSchemaCard();
      return "stay";
    }
    return "close";
  }

  schemaMarkEscapeHandled(event) {
    if (!event) return;
    try { event.preventDefault?.(); } catch (_) {}
    try { event.stopPropagation?.(); } catch (_) {}
    if (!event.defaultPrevented) {
      try { Object.defineProperty(event, "defaultPrevented", { value: true, configurable: true }); }
      catch (_) { try { event.defaultPrevented = true; } catch (_) {} }
    }
    try { event.__schemaEscapeHandled = true; } catch (_) {}
  }

  // Obsidian binds this scope's Escape to Modal's onEscapeKey at construction, and
  // the scope chain is first-registered-wins, so an appended contentEl keydown
  // handler can never preempt the default close. Overriding onEscapeKey instead:
  // a stage cancels and the modal stays open, a pending draft clears, otherwise
  // close exactly like Modal does. (The global key handler runs in the capture
  // phase, before the contentEl listener, so the contentEl Escape branch only
  // fires in tests unless onEscapeKey already handled it.)
  onEscapeKey(event) {
    const action = this.schemaHandleEscape();
    if (action === "ignore" || action === "stay") {
      this.schemaMarkEscapeHandled(event);
      return false;
    }
    if (event && (event.defaultPrevented || event.__schemaEscapeHandled)) return;
    this.schemaMarkEscapeHandled(event);
    this.close();
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
      if (this.stageDraft) this.stageDraft.values[name] = false;
      this.schemaQueueStagePreview(false);
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
    if (action === "submit-stage") { this.schemaQueueStagePreview(true); return; }
    if (action === "add-initial-choice") {
      this.schemaStageAddInitialChoice();
      return;
    }
    if (action.startsWith("remove-initial-choice:")) {
      const index = Number(action.split(":").pop());
      this.schemaStageRemoveInitialChoice(index);
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
    if (event.defaultPrevented || event.__schemaEscapeHandled) return;
    if (this.sessionState?.status === "applying") return;
    const target = event.target;
    const inInput = Boolean(target?.closest?.("input,select,textarea"));
    const targetButton = target?.closest?.("button[data-target-key]") || null;
    const inButton = Boolean(target?.closest?.("button"));
    if (inInput) {
      if (event.key === "Escape") {
        const action = this.schemaHandleEscape();
        if (action === "ignore") return;
        this.schemaMarkEscapeHandled(event);
        if (action === "close") this.close();
      }
      else if (event.key === "Enter" && target.tagName !== "TEXTAREA" && this.stage) {
        event.preventDefault?.();
        this.schemaStageEnter();
      }
      return;
    }
    if (targetButton) {
      this.selectedKey = targetButton.getAttribute("data-target-key") || this.selectedKey;
      this.selectedIndex = this.schemaTargets().findIndex((item) => item.key === this.selectedKey);
    } else if (inButton) return;
    if (this.stage) {
      if (event.key === "Escape") {
        const action = this.schemaHandleEscape();
        if (action === "ignore") return;
        this.schemaMarkEscapeHandled(event);
        if (action === "close") this.close();
      }
      else if (event.key === "Enter") { event.preventDefault?.(); this.schemaStageEnter(); }
      return;
    }
    if (event.key === "Escape") {
      const action = this.schemaHandleEscape();
      if (action === "ignore") return;
      this.schemaMarkEscapeHandled(event);
      if (action === "close") this.close();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault?.();
      this.schemaEditSelected();
      return;
    }
    if (event.altKey && (event.key === "j" || event.key === "J")) { event.preventDefault?.(); this.schemaMoveSelected(1); return; }
    if (event.altKey && (event.key === "k" || event.key === "K")) { event.preventDefault?.(); this.schemaMoveSelected(-1); return; }
    if (event.key === "ArrowUp" || event.key === "k") { event.preventDefault?.(); this.schemaMove(-1); return; }
    if (event.key === "ArrowDown" || event.key === "j") { event.preventDefault?.(); this.schemaMove(1); return; }
    if (event.key === "ArrowLeft") { event.preventDefault?.(); this.schemaMove(-1); return; }
    if (event.key === "ArrowRight") { event.preventDefault?.(); this.schemaMove(1); return; }
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
      const input = event?.target?.closest?.("[data-schema-input]");
      if (input) this.schemaStageRememberFocus(input);
      const target = event?.target?.closest?.("[data-target-key]");
      if (target) {
        this.selectedKey = target.getAttribute("data-target-key");
        this.selectedIndex = this.schemaTargets().findIndex((item) => item.key === this.selectedKey);
      }
    };
    this.contentEl?.addEventListener?.("click", this.schemaClickListener);
    this.contentEl?.addEventListener?.("keydown", this.schemaKeyListener);
    this.contentEl?.addEventListener?.("focusin", this.schemaFocusListener);
    this.contentEl?.addEventListener?.("input", (event) => this.schemaStageInput(event));
    this.contentEl?.addEventListener?.("change", (event) => this.schemaStageInput(event));
    this.contentEl?.addEventListener?.("compositionstart", () => { this.schemaComposing = true; });
    this.contentEl?.addEventListener?.("compositionend", (event) => {
      this.schemaComposing = false;
      this.schemaStageInput(event);
    });
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
