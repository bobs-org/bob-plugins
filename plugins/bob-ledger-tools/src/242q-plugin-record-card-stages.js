// Record Card typed stages: model seeds, op builders, and DOM painters for
// text, suggest, date, number, URL, link, and list kinds. Pure helpers stay
// presentation-only; bob remains the validation authority.
function recordCardSuggestValues(reportField, albumField) {
  const fromReport = reportField && Array.isArray(reportField.values) ? reportField.values : null;
  if (fromReport) return fromReport;
  const fromAlbum = albumField && Array.isArray(albumField.values) ? albumField.values : null;
  if (fromAlbum) return fromAlbum;
  return [];
}

function recordCardFilterSuggest(values, filter) {
  const rows = Array.isArray(values) ? values : [];
  const text = String(filter || "").trim().toLowerCase();
  if (!text) return rows.slice();
  return rows.filter((row) => {
    const value = String((row && row.value) || "");
    return value.toLowerCase().includes(text);
  });
}

function recordCardSuggestByValue(values, value) {
  const want = String(value == null ? "" : value);
  return (Array.isArray(values) ? values : []).find((row) => String((row && row.value) || "") === want) || null;
}

function recordCardLinkCandidates(plugin, recordPath, filter) {
  const text = String(filter || "").trim().toLowerCase();
  let files = [];
  try {
    const vault = plugin && plugin.app && plugin.app.vault;
    if (vault && typeof vault.getMarkdownFiles === "function") {
      files = vault.getMarkdownFiles() || [];
    } else if (vault && typeof vault.getFiles === "function") {
      files = (vault.getFiles() || []).filter((file) => file && /\.md$/i.test(file.path || file));
    }
  } catch (_) {
    files = [];
  }
  let paths = files.map((file) => (typeof file === "string" ? file : file.path)).filter(Boolean);
  if (!paths.length) {
    try {
      const cache = plugin && plugin.app && plugin.app.metadataCache;
      if (cache && typeof cache.getCache === "function") { paths = []; }
    } catch (_) {}
  }
  const seen = new Set();
  const ranked = [];
  for (const path of paths) {
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const base = String(path).split("/").pop().replace(/\.md$/i, "");
    if (text && !(String(path).toLowerCase().includes(text) || base.toLowerCase().includes(text))) continue;
    ranked.push({ path, base });
    if (ranked.length >= 30) break;
  }
  return ranked;
}

function recordCardParseLinkDraft(text) {
  const raw = String(text || "").trim();
  if (!raw) return { kind: "empty", value: "" };
  const match = /^\[\[([^\]]+)\]\]$/.exec(raw);
  if (match) return { kind: "wikilink", value: raw, target: match[1] };
  return { kind: "bare", value: raw };
}

function recordCardNumberHint(field) {
  const min = field && field.min != null ? String(field.min) : "";
  const max = field && field.max != null ? String(field.max) : "";
  if (min !== "" && max !== "") return `Range ${min}–${max}`;
  if (min !== "") return `Min ${min}`;
  if (max !== "") return `Max ${max}`;
  return "";
}

function recordCardStageInputAttrs(kind) {
  if (kind === "number") return { type: "text", inputmode: "numeric" };
  if (kind === "url") return { type: "url", inputmode: "url" };
  if (kind === "date") return { type: "text", inputmode: "text" };
  return { type: "text", inputmode: "text" };
}

function recordCardStageLabel(kind, target) {
  const label = (target && (target.label || target.key)) || "Field";
  if (kind === "text") return `${label} text`;
  if (kind === "suggest") return `${label} suggestion`;
  if (kind === "date") return `${label} date`;
  if (kind === "number") return `${label} number`;
  if (kind === "url") return `${label} URL`;
  if (kind === "link") return `${label} link`;
  if (kind === "list") return `${label} list`;
  return label;
}

function recordCardStageHintText(kind, field, reportField) {
  if (kind === "text") return "Enter saves; newlines are refused.";
  if (kind === "suggest") {
    const count = recordCardSuggestValues(reportField, field).length;
    return count ? `Pick a suggestion or type freely · ${count} ranked` : "Type freely; bob validates.";
  }
  if (kind === "date") return "today, t, yesterday, or YYYY-MM-DD";
  if (kind === "number") {
    const hint = recordCardNumberHint(field);
    return hint ? `${hint} · invalid entries are refused` : "Invalid entries are refused";
  }
  if (kind === "url") return "Full http(s) URL; bob validates";
  if (kind === "link") return "Bare name or [[wikilink]]; preview before save";
  if (kind === "list") return "Enter adds · empty Enter saves · empty Backspace removes last";
  return "";
}

function recordCardPaintStageInput(doc, host, options) {
  const kind = options.kind;
  const target = options.target;
  const draft = options.draft || {};
  const attrs = recordCardStageInputAttrs(kind);
  const labelText = recordCardStageLabel(kind, target);
  const label = recordCardEl(doc, "label", "bob-record-card-stage-label");
  recordCardText(label, labelText);
  label.setAttribute("for", `bob-record-card-input-${target.key}`);
  host.appendChild(label);
  let input;
  if (kind === "text") {
    input = recordCardEl(doc, "textarea", "bob-record-card-stage-input bob-record-card-text");
    input.setAttribute("rows", "3");
    input.value = String(draft.text || "");
  } else {
    input = recordCardEl(doc, "input", `bob-record-card-stage-input bob-record-card-${kind}`);
    input.setAttribute("type", attrs.type);
    if (attrs.inputmode) input.setAttribute("inputmode", attrs.inputmode);
    if (kind === "url") input.setAttribute("autocomplete", "url");
    input.value = String(draft.text || "");
  }
  input.setAttribute("id", `bob-record-card-input-${target.key}`);
  input.setAttribute("data-record-input", `stage-${kind}`);
  input.setAttribute("data-target-key", target.key);
  input.setAttribute("aria-label", labelText);
  if (kind === "suggest") {
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", `bob-record-card-suggest-${target.key}`);
  }
  host.appendChild(input);
  const hint = recordCardEl(doc, "p", "bob-record-card-stage-hint");
  recordCardText(hint, recordCardStageHintText(kind, target.field, options.reportField));
  host.appendChild(hint);
  if (kind === "suggest") {
    const values = recordCardSuggestValues(options.reportField, target.field);
    const visible = recordCardFilterSuggest(values, draft.text || "");
    const list = recordCardEl(doc, "div", "bob-record-card-suggest-list");
    list.setAttribute("id", `bob-record-card-suggest-${target.key}`);
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Suggestions");
    if (!visible.length) {
      const empty = recordCardEl(doc, "p", "bob-record-card-suggest-empty");
      recordCardText(empty, String(draft.text || "").trim() ? "No matching suggestions — Enter previews free text." : "No suggestions.");
      list.appendChild(empty);
    }
    for (const row of visible.slice(0, 30)) {
      const value = String((row && row.value) || "");
      if (!value) continue;
      const item = recordCardEl(doc, "button", "bob-record-card-suggest-row");
      item.setAttribute("type", "button");
      item.setAttribute("role", "option");
      item.setAttribute("data-record-action", "pick-suggest");
      item.setAttribute("data-choice-value", value);
      item.setAttribute("data-target-key", target.key);
      const exact = String(draft.text || "") === value;
      item.setAttribute("aria-selected", exact ? "true" : "false");
      if (exact) item.setAttribute("class", `${item.getAttribute("class") || ""} is-selected`.trim());
      const labelNode = recordCardEl(doc, "span", "bob-record-card-suggest-label");
      recordCardText(labelNode, value);
      item.appendChild(labelNode);
      if (Number.isInteger(row && row.count)) {
        const count = recordCardEl(doc, "span", "bob-record-card-suggest-count");
        recordCardText(count, String(row.count));
        item.appendChild(count);
      }
      list.appendChild(item);
    }
    host.appendChild(list);
  }
  if (kind === "link") {
    const candidates = recordCardLinkCandidates(options.plugin, options.recordPath, draft.text || "");
    const list = recordCardEl(doc, "div", "bob-record-card-link-list");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Note suggestions");
    for (const candidate of candidates.slice(0, 12)) {
      const item = recordCardEl(doc, "button", "bob-record-card-link-row");
      item.setAttribute("type", "button");
      item.setAttribute("role", "option");
      item.setAttribute("data-record-action", "pick-link");
      item.setAttribute("data-choice-value", candidate.path);
      item.setAttribute("data-target-key", target.key);
      item.setAttribute("aria-label", candidate.path);
      recordCardText(item, candidate.base || candidate.path);
      list.appendChild(item);
    }
    if (candidates.length) host.appendChild(list);
  }
  return input;
}

function recordCardPaintStageList(doc, host, options) {
  const target = options.target;
  const draft = options.draft || {};
  const labelText = recordCardStageLabel("list", target);
  const label = recordCardEl(doc, "span", "bob-record-card-stage-label");
  label.setAttribute("id", `bob-record-card-list-${target.key}`);
  recordCardText(label, `${labelText} · ${recordCardStageHintText("list")}`);
  host.appendChild(label);
  const chips = recordCardEl(doc, "div", "bob-record-card-chip-list");
  chips.setAttribute("role", "list");
  chips.setAttribute("aria-labelledby", `bob-record-card-list-${target.key}`);
  const items = Array.isArray(draft.list) ? draft.list : [];
  items.forEach((item, index) => {
    const chip = recordCardEl(doc, "span", "bob-record-card-chip");
    chip.setAttribute("role", "listitem");
    const text = recordCardEl(doc, "span", "bob-record-card-chip-text");
    recordCardText(text, String(item));
    chip.appendChild(text);
    const edit = recordCardEl(doc, "button", "bob-record-card-chip-edit");
    edit.setAttribute("type", "button");
    edit.setAttribute("data-record-action", "edit-chip");
    edit.setAttribute("data-chip-index", String(index));
    edit.setAttribute("data-target-key", target.key);
    edit.setAttribute("aria-label", `Edit item ${index + 1}`);
    recordCardText(edit, "Edit");
    chip.appendChild(edit);
    const remove = recordCardEl(doc, "button", "bob-record-card-chip-remove");
    remove.setAttribute("type", "button");
    remove.setAttribute("data-record-action", "remove-chip");
    remove.setAttribute("data-chip-index", String(index));
    remove.setAttribute("data-target-key", target.key);
    remove.setAttribute("aria-label", `Remove item ${index + 1}`);
    recordCardText(remove, "×");
    chip.appendChild(remove);
    chips.appendChild(chip);
  });
  host.appendChild(chips);
  const itemLabel = recordCardEl(doc, "label", "bob-record-card-stage-label");
  recordCardText(itemLabel, "Add item");
  itemLabel.setAttribute("for", `bob-record-card-item-${target.key}`);
  host.appendChild(itemLabel);
  const input = recordCardEl(doc, "input", "bob-record-card-stage-input bob-record-card-list-input");
  input.setAttribute("type", "text");
  input.setAttribute("id", `bob-record-card-item-${target.key}`);
  input.setAttribute("data-record-input", "stage-list-item");
  input.setAttribute("data-target-key", target.key);
  input.setAttribute("aria-label", "Add item");
  input.value = String(draft.itemDraft || "");
  host.appendChild(input);
  return input;
}

function recordCardPaintStageActions(doc, host, options) {
  const target = options.target;
  const bar = recordCardEl(doc, "div", "bob-record-card-stage-actions");
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Stage actions");
  const defs = [
    { action: "save-stage", text: "Save", ariaLabel: "Save" },
    { action: "save-next", text: "Save + next", ariaLabel: "Save and open next field" },
    { action: "save-prev", text: "Save + prev", ariaLabel: "Save and open previous field" },
    { action: "cancel-stage", text: "Cancel", ariaLabel: "Cancel" },
  ];
  for (const def of defs) {
    const button = recordCardButton(doc, bar, def.text, {
      action: def.action,
      targetKey: target && target.key,
      className: "bob-record-card-action",
      ariaLabel: def.ariaLabel,
      disabled: options.applying === true && def.action !== "cancel-stage",
    });
    if (button && def.action === "save-stage") button.setAttribute("data-record-input", "stage-save");
  }
  return bar;
}

function recordCardPaintTypedStage(doc, host, options) {
  if (!host || !doc || !options || !options.target) return null;
  recordCardRegionEmpty(host);
  const kind = options.kind;
  let input = null;
  if (kind === "list") {
    input = recordCardPaintStageList(doc, host, options);
  } else {
    input = recordCardPaintStageInput(doc, host, options);
  }
  const preview = options.preview;
  if (preview && preview.consequence) {
    const echo = recordCardEl(doc, "p", "bob-record-card-stage-preview");
    recordCardText(echo, String(preview.consequence));
    host.appendChild(echo);
  }
  if (preview && Array.isArray(preview.warnings) && preview.warnings.length) {
    for (const warning of preview.warnings) {
      const node = recordCardEl(doc, "p", "bob-record-card-stage-warning");
      recordCardText(node, String((warning && warning.message) || warning));
      host.appendChild(node);
    }
  }
  recordCardPaintStageActions(doc, host, options);
  return input;
}
