// Schema summary line (starts expanded; the toggle collapses it to one line),
// collapsible chip view, and lint marks. All report strings are text nodes.
// Collapse is a session view-state flag; this fragment never writes the vault.
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
  item.setAttribute("data-album-header-focus", albumHeaderIssueKey(issue));
  if (Number.isInteger(issue.line)) item.setAttribute("data-yaml-line", String(issue.line));
  notebookSetText(item, albumHeaderIssueText(issue));
  if (issue.suggestions && issue.suggestions.length) {
    const tips = notebookCreateEl(doc, "span", "bob-album-schema-suggestions");
    notebookSetText(tips, issue.suggestions.join(" "));
    item.appendChild(tips);
  }
  albumSchemaBindYaml(item, issue.line, options);
  return item;
}

function albumSchemaPaintChips(doc, model, options, bodyId) {
  const card = notebookCreateEl(doc, "div", "bob-album-schema-card");
  if (!card) return null;
  card.setAttribute("id", bodyId || propertyCardFoldNextId());
  card.setAttribute("aria-label", "Record schema");
  if (options?.expanded !== true) {
    card.setAttribute("hidden", "");
    return card;
  }
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

// Display-only `· walks by Section` on the folded line: the album's record
// walk follows that field's groups, then titles.
function albumSchemaPaintWalksBy(doc, model) {
  const label = String(model?.walkByLabel || model?.walkBy || "").trim();
  if (!label || !doc || typeof doc.createTextNode !== "function") return null;
  const pill = notebookCreateEl(doc, "span", "bob-album-schema-walks-by");
  if (!pill) return null;
  pill.setAttribute("title", `Record walk: grouped by ${label}, then title`);
  notebookSetText(pill, `walks by ${label}`);
  return pill;
}

function albumSchemaPaintSummary(doc, model, options) {
  const expanded = options?.expanded === true;
  const healthy = !model.schemaInvalid && !model.emptySchema;
  const foldText = albumHeaderFoldText(model);
  const summaryText = healthy
    ? foldText.replace(/^Schema\s*·\s*/, "")
    : albumHeaderSummaryText(model);
  const extras = healthy && model.walkBy ? albumSchemaPaintWalksBy(doc, model) : null;
  const className = `bob-album-schema-summary${model.schemaInvalid ? " is-error" : ""}`;
  const fold = propertyCardBuildFoldRow(doc, {
    kind: "album",
    path: options?.sourcePath,
    noun: "Schema",
    summary: summaryText,
    open: expanded,
    bodyId: propertyCardFoldNextId(),
    className,
    attention: albumHeaderFoldAttention(model),
    extras,
    keyLive: options?.keyLive === true,
    tooltip: "Toggle album schema (_)",
    onToggle: (next) => options?.handlers?.toggleSchema?.(next),
  });
  const summary = fold?.element;
  if (!summary) return null;
  summary.setAttribute("data-album-header-focus", "summary");
  summary.setAttribute("data-schema-fold", expanded ? "open" : "folded");
  return { element: summary, bodyId: fold.bodyId };
}

function albumSchemaHeaderAppend(header, model, options, doc) {
  if (!header || !model || !doc) return;
  const fold = albumSchemaPaintSummary(doc, model, options);
  const chips = albumSchemaPaintChips(doc, model, options, fold?.bodyId);
  if (fold?.element) header.appendChild(fold.element);
  if (chips) header.appendChild(chips);
  if (options?.desktop === false) {
    const hint = notebookCreateEl(doc, "p", "bob-album-schema-mobile-hint");
    notebookSetText(hint, "Edit this schema in YAML (Source mode).");
    header.appendChild(hint);
  }
}
