// Pure Record Card helpers: targets, opening selection, navigation, choices
// filtering, status/hint/All-actions models, Esc ladder, and YAML line.
// Field identity is the schema key. Choices are the only typed stage here;
// other kinds keep discrete actions and teach YAML until ms.6.
const RECORD_CARD_CLASS = "bob-record-card";
const RECORD_CARD_READING_TEXT = "Reading record…";
const RECORD_CARD_SAVING_TEXT = "Saving…";
const RECORD_CARD_SAVED_TEXT = "✓ Saved · u undo";
const RECORD_CARD_STALE_TEXT = "This record changed elsewhere — refreshed; your draft is kept · ↵ retry";
const RECORD_CARD_CAPABILITY_TEXT = "Update bob to edit here";
const RECORD_CARD_TYPED_STAGE_HINT = "YAML is the available edit route until this field's typed stage exists.";
const RECORD_CARD_DIGIT_TEACH = "Digits pick a choice on choice fields";
const RECORD_CARD_NON_RECORD_NOTICE = "Open a record note to edit its fields.";
const RECORD_CARD_MOBILE_NOTICE = "Record editing needs desktop Obsidian.";
const RECORD_CARD_NO_REPORT_NOTICE = "This record is not in the album report — run Sync albums and retry.";

function recordCardPath(value) {
  if (typeof recordSheetPath === "function") return recordSheetPath(value);
  if (typeof albumHeaderPath === "function") return albumHeaderPath(value);
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function recordCardIsChoiceField(field) {
  if (typeof recordSheetIsChoiceField === "function") return recordSheetIsChoiceField(field);
  const kind = String(field?.kind || "").toLowerCase();
  if (kind === "choice" || kind === "choices") return true;
  return Array.isArray(field?.choices) && field.choices.length > 0 && kind !== "text";
}

function recordCardFieldKind(field) {
  if (recordCardIsChoiceField(field)) return "choices";
  const kind = String(field?.kind || "text").toLowerCase();
  if (kind === "choice") return "choices";
  return kind || "text";
}

function recordCardStageKindFor(field) {
  if (!field) return "text";
  if (field.list === true) return "list";
  if (recordCardIsChoiceField(field)) return "choices";
  const kind = String(field.kind || "text").toLowerCase();
  if (kind === "choice" || kind === "choices") return "choices";
  if (kind === "text" && field.suggest === true) return "suggest";
  if (kind === "date") return "date";
  if (kind === "number") return "number";
  if (kind === "url") return "url";
  if (kind === "link") return "link";
  return "text";
}

function recordCardAlbumFields(sheetModel) {
  const album = sheetModel && sheetModel.gate && sheetModel.gate.album;
  const raw = Array.isArray(album && album.fields) ? album.fields : [];
  return raw.map((field) => (
    typeof albumHeaderFieldModel === "function" ? albumHeaderFieldModel(field) : field
  )).filter((field) => field && field.key);
}

function recordCardShowRecord(report) {
  return report && report.record && typeof report.record === "object" ? report.record : null;
}

function recordCardPropertyFromReport(report, key) {
  const record = recordCardShowRecord(report);
  const properties = record && Array.isArray(record.properties) ? record.properties : [];
  return properties.find((row) => row && row.key === key) || null;
}

function recordCardFieldFromReport(report, key) {
  const fields = report && Array.isArray(report.fields) ? report.fields : [];
  return fields.find((field) => field && field.key === key) || null;
}

function recordCardTargets(sheetModel, report) {
  const albumFields = recordCardAlbumFields(sheetModel);
  const rowsByKey = new Map();
  for (const row of Array.isArray(sheetModel && sheetModel.rows) ? sheetModel.rows : []) {
    if (row && row.key) rowsByKey.set(row.key, row);
  }
  const ghostKeys = new Set(
    (Array.isArray(sheetModel && sheetModel.ghosts) ? sheetModel.ghosts : [])
      .map((ghost) => ghost && ghost.key)
      .filter(Boolean),
  );
  return albumFields.map((field, index) => {
    const row = rowsByKey.get(field.key) || null;
    const property = recordCardPropertyFromReport(report, field.key);
    let state = property && typeof property.state === "string" ? property.state : "";
    if (!state) {
      if (row && row.state === "missing") state = "missing";
      else if (row && (row.state === "empty" || ghostKeys.has(field.key))) state = "none";
      else if (row && row.state === "invalid") state = "invalid";
      else if (row) state = "set";
      else if (ghostKeys.has(field.key)) state = "none";
      else if (field.required) state = "missing";
      else state = "none";
    }
    const ghost = state === "none" || (ghostKeys.has(field.key) && !row);
    const value = property && Object.prototype.hasOwnProperty.call(property, "value")
      ? property.value
      : (row && row.state !== "missing" && row.state !== "empty" ? row.raw : null);
    return {
      key: field.key,
      index,
      field,
      row,
      property,
      ghost: Boolean(ghost),
      required: field.required === true,
      kind: recordCardFieldKind(field),
      stageKind: recordCardStageKindFor(field),
      label: field.label || field.key,
      state,
      value: value === undefined ? null : value,
      display: (property && property.display) || (row && row.text) || "",
      line: Number.isInteger(property && property.line) && property.line > 0 ? property.line : null,
      readOnly: false,
    };
  });
}

function recordCardTargetByKey(targets, key) {
  if (!key) return null;
  return (Array.isArray(targets) ? targets : []).find((target) => target.key === key) || null;
}

function recordCardOpeningSelection(targets, requestedField) {
  const rows = Array.isArray(targets) ? targets : [];
  const want = typeof requestedField === "string" ? requestedField : "";
  if (want && rows.some((target) => target.key === want)) return want;
  const missing = rows.find((target) => target.required && (target.state === "missing" || target.ghost));
  if (missing) return missing.key;
  return rows[0] ? rows[0].key : "";
}

function recordCardPreserveSelection(targets, selectedKey, formerIndex) {
  const rows = Array.isArray(targets) ? targets : [];
  if (selectedKey && rows.some((target) => target.key === selectedKey)) return selectedKey;
  if (!rows.length) return "";
  const index = Number.isInteger(formerIndex) ? formerIndex : 0;
  const clamped = Math.max(0, Math.min(index, rows.length - 1));
  return rows[clamped].key;
}

function recordCardNavigate(targets, selectedKey, delta) {
  const rows = Array.isArray(targets) ? targets : [];
  if (!rows.length) return "";
  let index = rows.findIndex((target) => target.key === selectedKey);
  if (index < 0) index = 0;
  const next = ((index + Number(delta || 0)) % rows.length + rows.length) % rows.length;
  return rows[next].key;
}

function recordCardHomeEnd(targets, which) {
  const rows = Array.isArray(targets) ? targets : [];
  if (!rows.length) return "";
  return which === "end" ? rows[rows.length - 1].key : rows[0].key;
}

// Return the navigation delta for the exact Ctrl+N / Ctrl+P chord.
function recordCardCtrlNavDelta(event) {
  if (!event || event.isComposing || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return 0;
  const key = String(event.key || "").toLowerCase();
  const code = String(event.code || "");
  if (key === "n" || code === "KeyN") return 1;
  if (key === "p" || code === "KeyP") return -1;
  return 0;
}

function recordCardChoiceList(field, reportField) {
  const source = reportField && Array.isArray(reportField.choices) && reportField.choices.length
    ? reportField.choices
    : (Array.isArray(field && field.choices) ? field.choices : []);
  return source.map((choice, index) => {
    const modeled = typeof albumHeaderChoiceModel === "function" ? albumHeaderChoiceModel(choice) : choice;
    const value = String((modeled && modeled.value) || (choice && choice.value) || "");
    const label = String((modeled && modeled.label) || (choice && (choice.label || choice.value)) || value);
    const count = modeled && modeled.count != null
      ? modeled.count
      : (choice && Number.isInteger(choice.count) ? choice.count : null);
    return {
      value,
      label,
      count,
      schemaIndex: index,
      digit: index < 9 ? index + 1 : null,
    };
  }).filter((choice) => choice.value);
}

function recordCardFilterChoices(choices, filter) {
  const rows = Array.isArray(choices) ? choices : [];
  const text = String(filter || "").trim().toLowerCase();
  if (!text) return rows.slice();
  return rows.filter((choice) => (
    String(choice.label || "").toLowerCase().includes(text)
    || String(choice.value || "").toLowerCase().includes(text)
  ));
}

function recordCardChoiceByDigit(choices, digit) {
  const number = Number(digit);
  if (!Number.isInteger(number) || number < 1 || number > 9) return null;
  return (Array.isArray(choices) ? choices : []).find((choice) => choice.digit === number) || null;
}

function recordCardTodayValue(clock) {
  if (clock && typeof clock.today === "string" && clock.today) return clock.today;
  const now = clock && clock.now instanceof Date ? clock.now : new Date();
  if (typeof albumLocalDate === "function") return albumLocalDate(now);
  try {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  } catch (_) {
    return "";
  }
}

function recordCardRequiredClearMessage(target) {
  const label = (target && (target.label || target.key)) || "Field";
  if (target && target.kind === "choices") {
    const count = Array.isArray(target.field && target.field.choices) ? target.field.choices.length : 0;
    return `${label} is required — pick one of ${count} choices`;
  }
  return `${label} is required`;
}

function recordCardEscLadder(state) {
  if (state && state.pendingApply) return "ignore";
  if (state && state.menuOpen) return "close-menu";
  if (state && state.stage) return "cancel-stage";
  return "close-card";
}

function recordCardStatusText(state) {
  const kind = state && state.statusKind;
  if (kind === "reading") return RECORD_CARD_READING_TEXT;
  if (kind === "previewing") return "Checking value…";
  if (kind === "saving") return RECORD_CARD_SAVING_TEXT;
  if (kind === "saved") return RECORD_CARD_SAVED_TEXT;
  if (kind === "stale") return RECORD_CARD_STALE_TEXT;
  if (kind === "typed-stage") return RECORD_CARD_TYPED_STAGE_HINT;
  if (kind === "capability") return RECORD_CARD_CAPABILITY_TEXT;
  if (kind === "broken") return (state && state.warning) || "The album schema is invalid.";
  if (kind === "refusal") {
    const message = (state && state.refusalMessage) || "";
    const hint = (state && state.refusalHint) || "";
    return hint ? `${message} ${hint}`.trim() : message;
  }
  if (kind === "consequence") return (state && state.consequence) || "";
  if (state && state.writable === false && state.capabilityOk === false) return RECORD_CARD_CAPABILITY_TEXT;
  return (state && state.statusText) || "";
}

function recordCardHintItems(state) {
  const target = state && state.target;
  const writable = state && state.writable === true;
  if (state && state.menuOpen) {
    return [{ keys: "esc/q", label: "close menu", action: "close-menu" }];
  }
  if (state && state.stage && state.stage.kind === "choices") {
    return [
      { keys: "⏎", label: "pick", action: "apply-choice" },
      { keys: "esc/q", label: "cancel", action: "cancel-stage" },
      { keys: "y", label: "YAML", action: "yaml" },
    ];
  }
  if (state && state.stage) {
    return [
      { keys: "⏎", label: "save", action: "save-stage" },
      { keys: "⇥", label: "save+next", action: "save-next" },
      { keys: "esc/q", label: "cancel", action: "cancel-stage" },
      { keys: "y", label: "YAML", action: "yaml" },
    ];
  }
  const items = [{ keys: "j/k", label: "fields" }];
  if (target && target.kind === "choices" && writable) {
    items.push({ keys: "⏎", label: "choices", action: "open-stage" });
    const count = Math.min(Array.isArray(target.field && target.field.choices) ? target.field.choices.length : 0, 9);
    if (count > 0) items.push({ keys: count === 1 ? "1" : `1–${count}`, label: "pick" });
  } else if (target && writable && target.stageKind) {
    items.push({ keys: "⏎", label: "edit", action: "open-stage" });
  } else if (target) {
    items.push({ keys: "⏎", label: "YAML", action: "open-stage" });
  }
  if (target && target.kind === "date" && writable) {
    items.push({ keys: "t", label: "today", action: "today" });
  }
  if (target && writable && !target.required && !target.ghost) {
    items.push({ keys: "⌃D", label: "clear", action: "clear" });
  }
  if (state && state.undoAvailable && writable) {
    items.push({ keys: "u", label: "undo", action: "undo" });
  }
  items.push({ keys: "y", label: "YAML", action: "yaml" });
  items.push({ keys: "=", label: "schema", action: "schema" });
  items.push({ keys: "esc/q", label: "close", action: "close" });
  return items;
}

function recordCardAllActions(state) {
  const target = state && state.target;
  const writable = state && state.writable === true;
  const applying = state && state.pendingApply === true;
  const actions = [];
  actions.push({ action: "prev-field", text: "Previous field", enabled: !applying });
  actions.push({ action: "next-field", text: "Next field", enabled: !applying });
  if (target && target.stageKind) {
    const names = {
      choices: "Open choices", text: "Edit text", suggest: "Edit suggestion",
      date: "Edit date", number: "Edit number", url: "Edit URL",
      link: "Edit link", list: "Edit list",
    };
    actions.push({
      action: "open-stage",
      text: names[target.stageKind] || "Edit field",
      enabled: writable && !applying,
    });
  } else if (target) {
    actions.push({
      action: "open-stage",
      text: "Edit in YAML",
      enabled: !applying,
      reason: RECORD_CARD_TYPED_STAGE_HINT,
    });
  }
  if (target && target.kind === "date") {
    actions.push({ action: "today", text: "Set today", enabled: writable && !applying });
  }
  actions.push({
    action: "clear",
    text: "Clear field",
    enabled: writable && !applying && Boolean(target) && !target.required && !target.ghost,
    reason: target && target.required ? recordCardRequiredClearMessage(target) : "",
  });
  actions.push({
    action: "undo",
    text: "Undo",
    enabled: writable && !applying && Boolean(state && state.undoAvailable),
  });
  actions.push({ action: "yaml", text: "YAML", enabled: !applying });
  actions.push({ action: "schema", text: "Album schema", enabled: !applying });
  if (state && state.statusKind === "stale") {
    actions.push({ action: "retry", text: "Retry", enabled: writable && !applying });
  }
  if (state && state.stage && state.stage.kind !== "choices") {
    actions.push({ action: "save-stage", text: "Save", enabled: writable && !applying });
    actions.push({ action: "save-next", text: "Save + next", enabled: writable && !applying });
    actions.push({ action: "save-prev", text: "Save + prev", enabled: writable && !applying });
  }
  if (state && state.stage) {
    actions.push({ action: "cancel-stage", text: "Cancel", enabled: !applying });
  }
  actions.push({ action: "close", text: "Close", enabled: true });
  return actions;
}

function recordCardYamlLine(target, report, sourceText) {
  if (Number.isInteger(target && target.line) && target.line > 0) return target.line;
  const property = recordCardPropertyFromReport(report, target && target.key);
  if (Number.isInteger(property && property.line) && property.line > 0) return property.line;
  if (typeof recordSheetYamlKeyLine === "function" && sourceText && target && target.key) {
    const line = recordSheetYamlKeyLine(sourceText, target.key);
    if (Number.isInteger(line) && line > 1) return line;
  }
  const record = recordCardShowRecord(report);
  const end = record && record.frontmatter_end_line;
  if (Number.isInteger(end) && end > 0) return end;
  return 1;
}

function recordCardTitle(sheetModel) {
  const emoji = String((sheetModel && sheetModel.emoji) || "").trim();
  const title = (sheetModel && sheetModel.title) || "Record";
  return emoji ? `${emoji} ${title}` : title;
}

function recordCardSubtitle(sheetModel) {
  const album = (sheetModel && sheetModel.albumTitle) || "Album";
  const noun = String((sheetModel && sheetModel.noun) || "record");
  const path = (sheetModel && sheetModel.path) || "";
  const nounTitle = noun ? noun.charAt(0).toUpperCase() + noun.slice(1) : "Record";
  return `${album} › ${nounTitle} · ${path}`;
}

function recordCardCaptureStage(state) {
  if (!state || !state.stage) return null;
  return {
    kind: state.stage.kind || "",
    field: state.stage.field || "",
    filter: state.choiceFilter || "",
    selectedChoice: state.selectedChoice || "",
    draft: state.stageDraft || "",
    caret: state.stageCaret || null,
    text: state.stageDraftText != null ? String(state.stageDraftText) : "",
    list: Array.isArray(state.stageList) ? state.stageList.slice() : [],
    itemDraft: state.stageItemDraft != null ? String(state.stageItemDraft) : "",
  };
}

function recordCardRestoreStage(captured, targets) {
  if (!captured || !captured.kind || !captured.field) return null;
  if (!(Array.isArray(targets) ? targets : []).some((target) => target.key === captured.field)) return null;
  return captured;
}

function recordCardLiveAnnouncement(kind, payload) {
  if (kind === "select") return String((payload && (payload.label || payload.key)) || "");
  if (kind === "saved") return "Saved";
  if (kind === "refusal") return String((payload && payload.message) || "Refused");
  if (kind === "stale") return "This record changed elsewhere";
  return "";
}

function recordCardGateNotice(gate) {
  if (!gate) return { reason: "missing-path", message: RECORD_CARD_NON_RECORD_NOTICE };
  if (gate.mount === true) return null;
  const reason = String(gate.reason || "");
  if (reason === "mobile") return { reason, message: RECORD_CARD_MOBILE_NOTICE };
  if (reason === "no-report") return { reason, message: RECORD_CARD_NO_REPORT_NOTICE };
  if (reason === "not-record" || reason === "other-type" || reason === "mixed-type" || reason === "bank-month") {
    return { reason, message: RECORD_CARD_NON_RECORD_NOTICE };
  }
  const resolution = gate.resolution;
  if (resolution && typeof resolution.message === "string" && resolution.message) {
    return { reason, message: resolution.message };
  }
  if (reason === "no-metadata" || reason === "missing-path") {
    return { reason, message: RECORD_CARD_NON_RECORD_NOTICE };
  }
  return { reason, message: RECORD_CARD_NON_RECORD_NOTICE };
}

function recordCardWritable(gate) {
  return Boolean(gate && gate.mount === true && gate.editable === true && gate.state === "ready");
}

function recordCardShiftStep(targets, selectedKey, delta) {
  const rows = Array.isArray(targets) ? targets : [];
  if (!rows.length) return null;
  let index = rows.findIndex((target) => target.key === selectedKey);
  if (index < 0) index = Number(delta) < 0 ? rows.length : -1;
  const next = index + (Number(delta) < 0 ? -1 : 1);
  if (next < 0 || next >= rows.length) return null;
  return rows[next].key;
}

function recordCardShiftAnnouncement(target, index, total) {
  const label = (target && (target.label || target.key)) || "Field";
  return `${label}, field ${index + 1} of ${total}`;
}

function recordCardSeedText(target) {
  const property = target && target.property;
  if (property && typeof property.raw === "string" && property.state === "invalid") return property.raw;
  if (property && property.value !== null && property.value !== undefined) {
    if (typeof property.value === "string") return property.value;
    if (typeof property.value === "number") return String(property.value);
    return "";
  }
  if (target && typeof target.raw === "string") return target.raw;
  const value = target && target.value;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function recordCardSeedList(target) {
  const property = target && target.property;
  const value = property && property.value !== undefined ? property.value : (target && target.value);
  if (Array.isArray(value)) return value.map((item) => String(item == null ? "" : item));
  if (typeof value === "string" && value) return [value];
  if (property && typeof property.raw === "string" && property.raw) return [property.raw];
  return [];
}

function recordCardSeedStage(target) {
  if (!target) return { text: "", list: [], filter: "", itemDraft: "", selectedChoice: "" };
  const kind = target.stageKind || recordCardStageKindFor(target.field);
  if (kind === "list") return { text: "", list: recordCardSeedList(target), filter: "", itemDraft: "", selectedChoice: "" };
  if (kind === "choices") {
    const value = target.value != null ? String(target.value) : "";
    return { text: "", list: [], filter: "", itemDraft: "", selectedChoice: value };
  }
  return { text: recordCardSeedText(target), list: [], filter: "", itemDraft: "", selectedChoice: "" };
}

function recordCardIsEmptyScalarText(text) {
  return String(text == null ? "" : text) === "";
}

function recordCardBuildOps(target, draft) {
  if (!target || !target.key) return { ok: false, code: "missing-target", message: "No field is selected." };
  const key = target.key;
  const kind = target.stageKind || recordCardStageKindFor(target.field);
  const required = target.required === true;
  const list = target.field && target.field.list === true;
  if (list || kind === "list") {
    const items = Array.isArray(draft && draft.list) ? draft.list : [];
    const pending = String((draft && draft.itemDraft) || "");
    const full = pending ? [...items, pending] : items.slice();
    if (!full.length) {
      if (required) {
        return { ok: false, code: "required", message: `${target.label || key} is required`, hint: "", emptyList: true };
      }
      return { ok: true, ops: [{ op: "field.unset", field: key }], empty: true };
    }
    return { ok: true, ops: [{ op: "field.set", field: key, value: full.map((item) => String(item)) }] };
  }
  let text = draft && draft.text !== undefined ? String(draft.text) : recordCardSeedText(target);
  if (kind === "choices" && draft && draft.selectedChoice !== undefined) {
    text = String(draft.selectedChoice || "");
  }
  if (recordCardIsEmptyScalarText(text)) {
    if (required) {
      const count = Array.isArray(target.field && target.field.choices) ? target.field.choices.length : 0;
      const message = target.kind === "choices" && count
        ? `${target.label || key} is required — pick one of ${count} choices`
        : `${target.label || key} is required`;
      return { ok: false, code: "required", message, hint: "" };
    }
    return { ok: true, ops: [{ op: "field.unset", field: key }], empty: true };
  }
  return { ok: true, ops: [{ op: "field.set", field: key, value: text }] };
}

function recordCardDraftEqualsSeed(target, draft) {
  if (!target) return true;
  const kind = target.stageKind || recordCardStageKindFor(target.field);
  if (kind === "list" || (target.field && target.field.list === true)) {
    const seed = recordCardSeedList(target);
    const items = Array.isArray(draft && draft.list) ? draft.list : [];
    const pending = String((draft && draft.itemDraft) || "");
    if (pending) return false;
    if (seed.length !== items.length) return false;
    return seed.every((item, index) => String(item) === String(items[index]));
  }
  if (kind === "choices") {
    const seed = target.value != null ? String(target.value) : "";
    const current = draft && draft.selectedChoice !== undefined ? String(draft.selectedChoice || "") : seed;
    return current === seed;
  }
  return String((draft && draft.text) ?? "") === recordCardSeedText(target);
}
