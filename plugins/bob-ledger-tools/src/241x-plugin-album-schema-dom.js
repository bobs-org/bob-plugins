// Collapsed schema summary, expandable chip view, and lint marks. All
// report strings are text nodes. Collapse is a view-state flag; this
// fragment never writes the vault.
function albumSchemaBindYaml(node, line, options) {
  if (!node || typeof node.addEventListener !== "function") return;
  node.addEventListener("keydown", (event) => {
    if (!event || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key !== "y" && event.key !== "Y") return;
    event.preventDefault?.();
    options?.handlers?.jumpYaml?.(line);
  });
}

function albumSchemaPaintChoice(doc, choice) {
  const chip = notebookCreateEl(doc, "span", "bob-album-schema-choice");
  notebookSetText(chip, choice.display || choice.label || "");
  return chip;
}

function albumSchemaPaintField(doc, field, options) {
  const row = notebookCreateEl(doc, "div", "bob-album-schema-field");
  if (!row) return null;
  row.setAttribute("tabindex", "0");
  row.setAttribute("data-album-header-focus", `field:${field.key}`);
  row.setAttribute("data-field-key", field.key);
  if (Number.isInteger(field.line)) row.setAttribute("data-yaml-line", String(field.line));
  const label = notebookCreateEl(doc, "span", "bob-album-schema-label");
  notebookSetText(label, field.label);
  row.appendChild(label);
  if (field.required) {
    const required = notebookCreateEl(doc, "span", "bob-album-schema-required");
    notebookSetText(required, "*");
    required.setAttribute("aria-label", "required");
    row.appendChild(required);
  }
  const detail = notebookCreateEl(doc, "span", "bob-album-schema-detail");
  if (field.kindText) {
    const kind = notebookCreateEl(doc, "span", "bob-album-schema-kind");
    notebookSetText(kind, field.kindText);
    detail.appendChild(kind);
  }
  for (const choice of field.choices || []) {
    if (!choice.display && !choice.label) continue;
    detail.appendChild(albumSchemaPaintChoice(doc, choice));
  }
  if (field.filledText) {
    const filled = notebookCreateEl(doc, "span", "bob-album-schema-filled");
    notebookSetText(filled, field.filledText);
    detail.appendChild(filled);
  }
  if (field.groupsIndex) {
    const note = notebookCreateEl(doc, "span", "bob-album-schema-group");
    notebookSetText(note, "groups the index");
    detail.appendChild(note);
  }
  if (field.subgroupsIndex) {
    const note = notebookCreateEl(doc, "span", "bob-album-schema-group");
    notebookSetText(note, "sub-groups the index");
    detail.appendChild(note);
  }
  row.appendChild(detail);
  albumSchemaBindYaml(row, field.line, options);
  return row;
}

function albumSchemaPaintIssue(doc, issue, options) {
  const item = notebookCreateEl(doc, "li", `bob-album-schema-issue is-${issue.severity}`);
  if (!item) return null;
  item.setAttribute("tabindex", "0");
  item.setAttribute("data-album-header-focus", `issue:${issue.code || issue.line || "lint"}`);
  if (Number.isInteger(issue.line)) item.setAttribute("data-yaml-line", String(issue.line));
  notebookSetText(item, issue.message || issue.code);
  if (issue.suggestions && issue.suggestions.length) {
    const tips = notebookCreateEl(doc, "span", "bob-album-schema-suggestions");
    notebookSetText(tips, issue.suggestions.join(" "));
    item.appendChild(tips);
  }
  albumSchemaBindYaml(item, issue.line, options);
  return item;
}

function albumSchemaPaintChips(doc, model, options) {
  const card = notebookCreateEl(doc, "div", "bob-album-schema-card");
  if (!card) return null;
  const stem = String(model.stem || "album");
  card.setAttribute("id", `bob-album-schema-chips-${stem}`);
  card.setAttribute("aria-label", "Record schema");
  if (options?.expanded !== true) card.setAttribute("hidden", "");
  if (model.emptySchema && !model.schemaInvalid) {
    const empty = notebookCreateEl(doc, "p", "bob-album-schema-empty");
    notebookSetText(empty, albumHeaderSummaryText(model));
    card.appendChild(empty);
  } else {
    for (const field of (model.fields || []).map((item) => albumHeaderPresentField(item, model))) {
      const row = albumSchemaPaintField(doc, field, options);
      if (row) card.appendChild(row);
    }
    for (const pattern of model.legacy || []) {
      const chip = notebookCreateEl(doc, "span", "bob-album-schema-legacy");
      notebookSetText(chip, pattern);
      card.appendChild(chip);
    }
  }
  if ((model.issues || []).length) {
    const issues = notebookCreateEl(doc, "ul", "bob-album-schema-issues");
    issues.setAttribute("aria-label", "Album schema issues");
    for (const issue of model.issues) {
      const item = albumSchemaPaintIssue(doc, issue, options);
      if (item) issues.appendChild(item);
    }
    card.appendChild(issues);
  }
  return card;
}

function albumSchemaPaintSummary(doc, model, options) {
  const summary = notebookCreateEl(doc, "button", "bob-album-schema-summary");
  if (!summary) return null;
  const expanded = options?.expanded === true;
  summary.setAttribute("type", "button");
  summary.setAttribute("aria-expanded", expanded ? "true" : "false");
  summary.setAttribute("data-album-header-focus", "summary");
  if (model.schemaInvalid) {
    const cls = `${summary.getAttribute("class") || ""} is-error`.trim();
    summary.setAttribute("class", cls);
  }
  notebookSetText(summary, `${expanded ? "▾" : "▸"} ${albumHeaderSummaryText(model)}`);
  summary.addEventListener("click", (event) => {
    event.preventDefault?.();
    options?.handlers?.toggleSchema?.(!expanded);
  });
  return summary;
}

function albumSchemaHeaderAppend(header, model, options, doc) {
  if (!header || !model || !doc) return;
  const summary = albumSchemaPaintSummary(doc, model, options);
  const chips = albumSchemaPaintChips(doc, model, options);
  if (summary && chips?.id) summary.setAttribute("aria-controls", chips.id);
  if (summary) header.appendChild(summary);
  if (chips) header.appendChild(chips);
  if (options?.desktop === false) {
    const hint = notebookCreateEl(doc, "p", "bob-album-schema-mobile-hint");
    notebookSetText(hint, "Edit this schema in YAML (Source mode).");
    header.appendChild(hint);
  }
}
