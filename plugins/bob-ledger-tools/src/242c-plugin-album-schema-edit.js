// Stable Schema Card targets and accessible typed stage controls. This
// fragment only collects user intent; bob remains the schema validator and
// the only writer.
function albumSchemaTargets(model) {
  const targets = [{ key: "stats", kind: "stats" }];
  const fields = Array.isArray(model?.fields) ? model.fields : [];
  for (const field of fields) {
    targets.push({ key: `field:${field.key}`, kind: "field", field });
    for (const choice of Array.isArray(field.choices) ? field.choices : []) {
      targets.push({
        key: `choice:${field.key}:${choice.value}`,
        kind: "choice",
        field,
        choice,
      });
    }
    if (field.kind === "choices") {
      targets.push({ key: `add-choice:${field.key}`, kind: "add-choice", field });
    }
  }
  targets.push({ key: "add-field", kind: "add-field" });
  for (const issue of Array.isArray(model?.issues) ? model.issues : []) {
    targets.push({
      key: `issue:${issue.code || "lint"}:${issue.line || ""}:${issue.keyPath || issue.key_path || ""}`,
      kind: "issue",
      issue,
    });
  }
  return targets;
}

function albumSchemaTargetByKey(model, key) {
  return albumSchemaTargets(model).find((target) => target.key === key) || null;
}

function albumSchemaChoiceParts(value) {
  const text = String(value || "");
  const match = /^(\p{Extended_Pictographic}(?:\uFE0F|\uFE0E|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic}\uFE0F?)*|(?:\p{Regional_Indicator}{2})|[0-9#*]\uFE0F?\u20E3)\s+(.+)$/u.exec(text);
  return match ? { emoji: match[1], label: match[2] } : { emoji: "", label: text };
}

function albumSchemaControl(doc, host, labelText, type, name, value, options = {}) {
  const row = notebookCreateEl(doc, "label", "bob-album-schema-control");
  const label = notebookCreateEl(doc, "span", "bob-album-schema-control-label");
  notebookSetText(label, labelText);
  row.appendChild(label);
  let input;
  if (type === "textarea") {
    input = notebookCreateEl(doc, "textarea", "bob-album-schema-input");
  } else if (type === "select") {
    input = notebookCreateEl(doc, "select", "bob-album-schema-input");
  } else {
    input = notebookCreateEl(doc, "input", "bob-album-schema-input");
    input.setAttribute("type", type);
  }
  input.setAttribute("data-schema-input", name);
  input.setAttribute("aria-label", labelText);
  if (type === "checkbox") {
    input.checked = value === true;
  } else {
    input.value = value == null ? "" : String(value);
  }
  if (options.required) input.setAttribute("required", "");
  if (options.step) input.setAttribute("step", options.step);
  if (options.disabled) input.disabled = true;
  row.appendChild(input);
  host.appendChild(row);
  return input;
}

function albumSchemaStageAction(doc, host, text, action, className = "") {
  const button = notebookCreateEl(doc, "button", `bob-album-schema-action ${className}`.trim());
  button.setAttribute("type", "button");
  button.setAttribute("data-schema-action", action);
  button.setAttribute("aria-label", text);
  notebookSetText(button, text);
  host.appendChild(button);
  return button;
}

function albumSchemaAddInitialChoiceRow(doc, host, index, draft = {}, options = {}) {
  const row = notebookCreateEl(doc, "div", "bob-album-schema-initial-choice");
  row.setAttribute("data-choice-index", String(index));
  albumSchemaControl(doc, row, `Choice ${index + 1} label`, "text", `choiceLabel${index}`, draft.label || "", { disabled: options.disabled });
  albumSchemaControl(doc, row, `Choice ${index + 1} emoji`, "text", `choiceEmoji${index}`, draft.emoji || "", { disabled: options.disabled });
  const remove = albumSchemaStageAction(doc, row, `Remove choice ${index + 1}`, `remove-initial-choice:${index}`, "is-quiet");
  if (options.disabled) remove.disabled = true;
  host.appendChild(row);
  return row;
}

function albumSchemaStageBuildEl(stage, model, options, doc) {
  if (!stage || !doc) return null;
  const panel = notebookCreateEl(doc, "section", "bob-album-schema-stage");
  panel.setAttribute("data-schema-stage", stage.kind);
  panel.setAttribute("aria-labelledby", "bob-album-schema-stage-title");
  const title = notebookCreateEl(doc, "h3", "bob-album-schema-stage-title");
  title.setAttribute("id", "bob-album-schema-stage-title");
  const target = albumSchemaTargetByKey(model, stage.targetKey);
  const values = options?.stageDraft?.values || {};
  const read = (name, fallback) => Object.prototype.hasOwnProperty.call(values, name) ? values[name] : fallback;
  const locked = options?.stageLocked === true;
  const heading = stage.kind === "album" ? "Edit album details"
    : stage.kind === "field" ? `Edit ${target?.field?.label || "field"}`
      : stage.kind === "field-add" ? "Add field"
        : stage.kind === "choice" ? `Edit ${target?.choice?.label || "choice"}`
          : "Add choice";
  notebookSetText(title, heading);
  panel.appendChild(title);

  if (stage.kind === "album") {
    const identity = notebookCreateEl(doc, "p", "bob-album-schema-identity-note");
    notebookSetText(identity, `Record type ${model.noun || ""} is a fixed identity; edit it in YAML (y) or wait for the migration flow.`);
    panel.appendChild(identity);
    albumSchemaControl(doc, panel, "Use explicit album label", "checkbox", "useLabel", read("useLabel", model.storedLabel != null), { disabled: locked });
    albumSchemaControl(doc, panel, "Album label", "text", "albumLabel", read("albumLabel", model.storedLabel || ""), { disabled: locked });
    albumSchemaControl(doc, panel, "Use explicit plural", "checkbox", "usePlural", read("usePlural", model.storedPlural != null), { disabled: locked });
    albumSchemaControl(doc, panel, "Plural", "text", "albumPlural", read("albumPlural", model.storedPlural || ""), { disabled: locked });
    albumSchemaControl(doc, panel, "Dated notes", "checkbox", "datedNotes", read("datedNotes", model.datedNotes === true), { disabled: locked });
  } else if (stage.kind === "field") {
    const field = target?.field || {};
    const identity = notebookCreateEl(doc, "p", "bob-album-schema-identity-note");
    notebookSetText(identity, `Stored key ${field.key} and kind ${field.kind || "text"} stay fixed. Edit keys or kinds in YAML (y) or wait for the migration flow.`);
    panel.appendChild(identity);
    albumSchemaControl(doc, panel, "Field label", "text", "fieldLabel", read("fieldLabel", field.label || ""), { disabled: locked });
    albumSchemaControl(doc, panel, "Use a default", "checkbox", "defaultPresent", read("defaultPresent", field.defaultPresent === true), { disabled: locked });
    const defaultValue = Array.isArray(field.default) ? JSON.stringify(field.default) : field.default;
    albumSchemaControl(doc, panel, "Default value (JSON list for list fields)",
      field.list ? "textarea" : typeof field.default === "boolean" ? "checkbox" : field.kind === "number" ? "number" : "text",
      "fieldDefault", read("fieldDefault", field.defaultPresent ? defaultValue : ""), { step: field.kind === "number" ? "any" : "", disabled: locked });
    const unsetDefault = albumSchemaStageAction(doc, panel, "Unset default", "unset-default", "is-quiet");
    if (locked) unsetDefault.disabled = true;
    albumSchemaControl(doc, panel, "Use minimum", "checkbox", "minPresent", read("minPresent", field.min != null), { disabled: locked });
    albumSchemaControl(doc, panel, "Minimum", "number", "fieldMin", read("fieldMin", field.min), { step: "any", disabled: locked });
    const unsetMinimum = albumSchemaStageAction(doc, panel, "Unset minimum", "unset-minimum", "is-quiet");
    if (locked) unsetMinimum.disabled = true;
    albumSchemaControl(doc, panel, "Use maximum", "checkbox", "maxPresent", read("maxPresent", field.max != null), { disabled: locked });
    albumSchemaControl(doc, panel, "Maximum", "number", "fieldMax", read("fieldMax", field.max), { step: "any", disabled: locked });
    const unsetMaximum = albumSchemaStageAction(doc, panel, "Unset maximum", "unset-maximum", "is-quiet");
    if (locked) unsetMaximum.disabled = true;
  } else if (stage.kind === "field-add") {
    albumSchemaControl(doc, panel, "Field label", "text", "newFieldLabel", read("newFieldLabel", ""), { required: true, disabled: locked });
    const kind = albumSchemaControl(doc, panel, "Field kind", "select", "newFieldKind", read("newFieldKind", "text"), { disabled: locked });
    // `select` uses the same element path as a normal input so the card
    // works with the small DOM harness and Obsidian's native controls.
    for (const value of ["text", "choices", "date", "link", "url", "number"]) {
      const option = notebookCreateEl(doc, "option", "");
      option.setAttribute("value", value);
      notebookSetText(option, value);
      kind.appendChild(option);
    }
    kind.value = read("newFieldKind", "text");
    albumSchemaControl(doc, panel, "List field", "checkbox", "newFieldList", read("newFieldList", false), { disabled: locked });
    albumSchemaControl(doc, panel, "Suggest existing values", "checkbox", "newFieldSuggest", read("newFieldSuggest", false), { disabled: locked });
    const choices = notebookCreateEl(doc, "div", "bob-album-schema-initial-choices");
    choices.setAttribute("data-schema-initial-choices", "");
    const initialChoices = Array.isArray(options?.stageDraft?.initialChoices) ? options.stageDraft.initialChoices : [{ label: "", emoji: "" }];
    initialChoices.forEach((choice, index) => albumSchemaAddInitialChoiceRow(doc, choices, index, choice, { disabled: locked }));
    panel.appendChild(choices);
    const addChoice = albumSchemaStageAction(doc, panel, "Add initial choice", "add-initial-choice", "is-quiet");
    if (locked) addChoice.disabled = true;
  } else if (stage.kind === "choice" || stage.kind === "choice-add") {
    const value = target?.choice || {};
    if (stage.kind === "choice") {
      const identity = notebookCreateEl(doc, "p", "bob-album-schema-identity-note");
      notebookSetText(identity, `Stored choice value ${value.value} stays fixed. Edit keys or merge values in YAML (y) or wait for the migration flow.`);
      panel.appendChild(identity);
    }
    const parts = albumSchemaChoiceParts(value.label);
    albumSchemaControl(doc, panel, "Choice label", "text", "choiceLabel", read("choiceLabel", stage.kind === "choice" ? parts.label : ""), { required: true, disabled: locked });
    albumSchemaControl(doc, panel, "Choice emoji", "text", "choiceEmoji", read("choiceEmoji", stage.kind === "choice" ? parts.emoji : ""), { disabled: locked });
  }

  const buttons = notebookCreateEl(doc, "div", "bob-album-schema-stage-actions");
  const preview = albumSchemaStageAction(doc, buttons, "Preview this edit", "submit-stage", "is-primary");
  const cancel = albumSchemaStageAction(doc, buttons, "Cancel stage", "cancel-stage");
  if (locked) { preview.disabled = true; cancel.disabled = true; }
  panel.appendChild(buttons);
  return panel;
}

function albumSchemaTypedDefault(text, field, checked = false) {
  if (typeof field?.default === "boolean") return checked === true;
  if (field?.list) {
    try { return JSON.parse(String(text)); } catch (_) { return String(text); }
  }
  if (field?.kind === "number") {
    return String(text) === "" ? Number.NaN : Number(text);
  }
  return String(text);
}

function albumSchemaSameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
