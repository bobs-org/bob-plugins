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

function albumSchemaAddInitialChoiceRow(doc, host, index, draft = {}) {
  const row = notebookCreateEl(doc, "div", "bob-album-schema-initial-choice");
  row.setAttribute("data-choice-index", String(index));
  albumSchemaControl(doc, row, `Choice ${index + 1} label`, "text", `choiceLabel${index}`, draft.label || "");
  albumSchemaControl(doc, row, `Choice ${index + 1} emoji`, "text", `choiceEmoji${index}`, draft.emoji || "");
  albumSchemaStageAction(doc, row, `Remove choice ${index + 1}`, `remove-initial-choice:${index}`, "is-quiet");
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
    albumSchemaControl(doc, panel, "Use explicit album label", "checkbox", "useLabel", model.storedLabel != null);
    albumSchemaControl(doc, panel, "Album label", "text", "albumLabel", model.storedLabel || "");
    albumSchemaControl(doc, panel, "Use explicit plural", "checkbox", "usePlural", model.storedPlural != null);
    albumSchemaControl(doc, panel, "Plural", "text", "albumPlural", model.storedPlural || "");
    albumSchemaControl(doc, panel, "Dated notes", "checkbox", "datedNotes", model.datedNotes === true);
  } else if (stage.kind === "field") {
    const field = target?.field || {};
    const identity = notebookCreateEl(doc, "p", "bob-album-schema-identity-note");
    notebookSetText(identity, `Stored key ${field.key} and kind ${field.kind || "text"} stay fixed. Edit keys or kinds in YAML (y) or wait for the migration flow.`);
    panel.appendChild(identity);
    albumSchemaControl(doc, panel, "Field label", "text", "fieldLabel", field.label || "");
    albumSchemaControl(doc, panel, "Use a default", "checkbox", "defaultPresent", field.defaultPresent === true);
    const defaultValue = Array.isArray(field.default) ? JSON.stringify(field.default) : field.default;
    albumSchemaControl(doc, panel, "Default value (JSON list for list fields)",
      field.list ? "textarea" : typeof field.default === "boolean" ? "checkbox" : field.kind === "number" ? "number" : "text",
      "fieldDefault", field.defaultPresent ? defaultValue : "", { step: field.kind === "number" ? "any" : "" });
    albumSchemaStageAction(doc, panel, "Unset default", "unset-default", "is-quiet");
    albumSchemaControl(doc, panel, "Use minimum", "checkbox", "minPresent", field.min != null);
    albumSchemaControl(doc, panel, "Minimum", "number", "fieldMin", field.min, { step: "any" });
    albumSchemaStageAction(doc, panel, "Unset minimum", "unset-minimum", "is-quiet");
    albumSchemaControl(doc, panel, "Use maximum", "checkbox", "maxPresent", field.max != null);
    albumSchemaControl(doc, panel, "Maximum", "number", "fieldMax", field.max, { step: "any" });
    albumSchemaStageAction(doc, panel, "Unset maximum", "unset-maximum", "is-quiet");
  } else if (stage.kind === "field-add") {
    albumSchemaControl(doc, panel, "Field label", "text", "newFieldLabel", "", { required: true });
    const kind = albumSchemaControl(doc, panel, "Field kind", "select", "newFieldKind", "text");
    // `select` uses the same element path as a normal input so the card
    // works with the small DOM harness and Obsidian's native controls.
    for (const value of ["text", "choices", "date", "link", "url", "number"]) {
      const option = notebookCreateEl(doc, "option", "");
      option.setAttribute("value", value);
      notebookSetText(option, value);
      kind.appendChild(option);
    }
    kind.value = "text";
    albumSchemaControl(doc, panel, "List field", "checkbox", "newFieldList", false);
    albumSchemaControl(doc, panel, "Suggest existing values", "checkbox", "newFieldSuggest", false);
    const choices = notebookCreateEl(doc, "div", "bob-album-schema-initial-choices");
    choices.setAttribute("data-schema-initial-choices", "");
    albumSchemaAddInitialChoiceRow(doc, choices, 0);
    panel.appendChild(choices);
    albumSchemaStageAction(doc, panel, "Add initial choice", "add-initial-choice", "is-quiet");
  } else if (stage.kind === "choice" || stage.kind === "choice-add") {
    const value = target?.choice || {};
    if (stage.kind === "choice") {
      const identity = notebookCreateEl(doc, "p", "bob-album-schema-identity-note");
      notebookSetText(identity, `Stored choice value ${value.value} stays fixed. Edit keys or merge values in YAML (y) or wait for the migration flow.`);
      panel.appendChild(identity);
    }
    const parts = albumSchemaChoiceParts(value.label);
    albumSchemaControl(doc, panel, "Choice label", "text", "choiceLabel", stage.kind === "choice" ? parts.label : "", { required: true });
    albumSchemaControl(doc, panel, "Choice emoji", "text", "choiceEmoji", stage.kind === "choice" ? parts.emoji : "");
  }

  const buttons = notebookCreateEl(doc, "div", "bob-album-schema-stage-actions");
  albumSchemaStageAction(doc, buttons, "Preview this edit", "submit-stage", "is-primary");
  albumSchemaStageAction(doc, buttons, "Cancel stage", "cancel-stage");
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
