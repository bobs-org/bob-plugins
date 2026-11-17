// Read-only record sheet DOM. Report and frontmatter strings always enter
// as text nodes; never interpolate into HTML.
function recordSheetDomDoc(root) {
  try {
    if (typeof notebookDomDoc === "function") return notebookDomDoc(root);
  } catch (_) {}
  try {
    if (root && root.ownerDocument) return root.ownerDocument;
  } catch (_) {}
  try {
    if (typeof document !== "undefined") return document;
  } catch (_) {}
  return null;
}

function recordSheetEl(doc, tag, className) {
  return typeof notebookCreateEl === "function"
    ? notebookCreateEl(doc, tag, className)
    : (doc && typeof doc.createElement === "function"
      ? (() => {
        const node = doc.createElement(tag);
        if (className && typeof node.setAttribute === "function") node.setAttribute("class", className);
        return node;
      })()
      : null);
}

function recordSheetText(el, text) {
  if (typeof notebookSetText === "function") notebookSetText(el, text);
  else if (el) el.textContent = String(text === null || text === undefined ? "" : text);
}

function recordSheetAppendText(parent, doc, text) {
  if (!parent || text === null || text === undefined || text === "") return null;
  const node = doc && typeof doc.createTextNode === "function"
    ? doc.createTextNode(String(text))
    : recordSheetEl(doc, "span");
  if (!node) return null;
  if (node.nodeType !== 3) recordSheetText(node, text);
  parent.appendChild(node);
  return node;
}

function recordSheetBindHover(node, options, linktext) {
  if (!node || !linktext) return;
  node.addEventListener?.("mouseover", (event) => {
    try {
      options?.handlers?.hoverLink?.(event, node, linktext);
    } catch (_) {}
  });
}

function recordSheetRenderLink(parent, doc, span, options) {
  const href = span.link ? (span.link.href || span.link.target) : span.href;
  const node = doc && typeof doc.createElement === "function" ? doc.createElement("a") : recordSheetEl(doc, "a", "internal-link");
  if (!node || !parent) return null;
  node.setAttribute?.("class", "internal-link bob-record-sheet-link");
  node.setAttribute?.("href", href || "");
  node.setAttribute?.("data-href", href || "");
  recordSheetText(node, span.text || href || "");
  const open = (event) => options?.handlers?.openPath?.(href, event);
  node.addEventListener?.("click", (event) => {
    event.preventDefault?.();
    open(event);
  });
  recordSheetBindHover(node, options, href);
  parent.appendChild(node);
  return node;
}

function recordSheetRenderUrl(parent, doc, span) {
  const node = doc && typeof doc.createElement === "function" ? doc.createElement("a") : recordSheetEl(doc, "a");
  if (!node || !parent) return null;
  node.setAttribute?.("class", "bob-record-sheet-url external-link");
  node.setAttribute?.("href", span.href);
  node.setAttribute?.("rel", "noopener noreferrer");
  node.setAttribute?.("target", "_blank");
  if (span.title) node.setAttribute?.("title", span.title);
  recordSheetText(node, span.text || span.href);
  parent.appendChild(node);
  return node;
}

function recordSheetRenderSpans(parent, doc, spans, options) {
  if (!parent) return;
  for (const span of Array.isArray(spans) ? spans : []) {
    if (!span) continue;
    if (span.kind === "link" && span.link) {
      recordSheetRenderLink(parent, doc, span, options);
      continue;
    }
    if (span.kind === "url" && span.href) {
      recordSheetRenderUrl(parent, doc, span);
      continue;
    }
    const cls = span.kind === "mono" ? "bob-record-sheet-raw"
      : span.kind === "number" ? "bob-record-sheet-number"
        : span.kind === "chip" ? "bob-record-sheet-chip"
          : span.kind === "date" ? "bob-record-sheet-date"
            : "";
    if (span.kind === "chip" || span.kind === "number" || span.kind === "mono" || span.kind === "date") {
      const node = recordSheetEl(doc, "span", cls);
      recordSheetText(node, span.text || "");
      if (node) parent.appendChild(node);
      continue;
    }
    recordSheetAppendText(parent, doc, span.text || "");
  }
}

function recordSheetRenderChips(parent, doc, chips, options) {
  for (const chip of Array.isArray(chips) ? chips : []) {
    const node = recordSheetEl(doc, "span", chip.valid === false
      ? "bob-record-sheet-chip is-invalid"
      : "bob-record-sheet-chip");
    if (!node) continue;
    if (chip.link) {
      recordSheetRenderLink(node, doc, { text: chip.text, link: chip.link }, options);
    } else {
      recordSheetText(node, chip.text || "");
    }
    parent.appendChild(node);
  }
}

function recordSheetBindYamlJump(node, handler, key) {
  if (!node || typeof node.addEventListener !== "function") return;
  node.setAttribute?.("tabindex", "0");
  node.addEventListener("keydown", (event) => {
    if (!event) return;
    if (event.isComposing || event.repeat) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const keyName = event.key || "";
    if (keyName !== "y" && keyName !== "Y") return;
    event.preventDefault?.();
    handler?.(key);
  });
}

function recordSheetRenderCrumbs(header, model, options, doc) {
  const nav = recordSheetEl(doc, "nav", "bob-record-sheet-nav");
  if (!nav) return null;
  nav.setAttribute?.("aria-label", "Album location");
  const crumbs = Array.isArray(model.crumbs) ? model.crumbs : [];
  crumbs.forEach((crumb, index) => {
    if (index > 0) recordSheetAppendText(nav, doc, " › ");
    const resolved = recordSheetPath(crumb.path);
    const current = crumb.current === true;
    const node = !current && resolved && doc?.createElement ? doc.createElement("a") : recordSheetEl(doc, "span");
    if (!node) return;
    if (!current && resolved) {
      node.setAttribute("class", "internal-link bob-record-sheet-crumb");
      node.setAttribute("data-href", resolved);
      node.setAttribute("href", resolved);
      const open = (event) => options?.handlers?.openPath?.(resolved, event);
      if (typeof notebookBindAction === "function") notebookBindAction(node, open);
      else node.addEventListener?.("click", (event) => { event.preventDefault?.(); open(event); });
      recordSheetBindHover(node, options, resolved);
    } else {
      node.setAttribute?.("class", "bob-record-sheet-crumb bob-record-sheet-current");
    }
    recordSheetText(node, crumb.title || crumb.stem || "");
    nav.appendChild(node);
  });
  if (model.noun) {
    recordSheetAppendText(nav, doc, " › ");
    const noun = recordSheetEl(doc, "span", "bob-record-sheet-noun");
    recordSheetText(noun, model.noun);
    if (noun) nav.appendChild(noun);
  }
  header.appendChild(nav);
  return nav;
}

function recordSheetRenderToolbar(header, model, options, doc) {
  const tools = recordSheetEl(doc, "div", "bob-record-sheet-tools");
  if (!tools) return null;
  const collapse = recordSheetEl(doc, "button", "bob-record-sheet-collapse");
  if (collapse) {
    collapse.setAttribute("type", "button");
    collapse.setAttribute("data-record-sheet-focus", "collapse");
    collapse.setAttribute("aria-expanded", model.collapsed ? "false" : "true");
    collapse.setAttribute("aria-label", model.collapsed ? "Expand record details" : "Collapse record details");
    recordSheetText(collapse, model.collapsed ? "▸" : "▾");
    collapse.addEventListener?.("click", (event) => {
      event.preventDefault?.();
      options?.handlers?.toggleCollapsed?.(!model.collapsed);
    });
    tools.appendChild(collapse);
  }
  header.appendChild(tools);
  return tools;
}

function recordSheetRenderRow(list, row, options, doc) {
  const wrap = recordSheetEl(doc, "div", row.changed
    ? "bob-record-sheet-row is-changed"
    : "bob-record-sheet-row");
  if (!wrap) return null;
  wrap.setAttribute("data-record-key", row.key);
  recordSheetBindYamlJump(wrap, options?.handlers?.jumpYaml, row.key);
  const dt = recordSheetEl(doc, "dt", "bob-record-sheet-label");
  recordSheetText(dt, row.label || row.key);
  if (dt) wrap.appendChild(dt);
  const dd = recordSheetEl(doc, "dd", "bob-record-sheet-value");
  if (!dd) {
    list.appendChild(wrap);
    return wrap;
  }
  if (row.state === "missing") {
    const pill = recordSheetEl(doc, "span", "bob-record-sheet-missing");
    recordSheetText(pill, "missing");
    if (pill) {
      pill.setAttribute("title", `${row.label || row.key} is required`);
      dd.appendChild(pill);
    }
  } else if (row.chips && row.chips.length && (row.list || recordSheetIsChoiceField(row))) {
    recordSheetRenderChips(dd, doc, row.chips, options);
  } else {
    recordSheetRenderSpans(dd, doc, row.spans, options);
  }
  if (row.lint && row.state !== "missing") {
    const lint = recordSheetEl(doc, "span", "bob-record-sheet-lint");
    recordSheetText(lint, row.lint);
    if (lint) dd.appendChild(lint);
  }
  wrap.appendChild(dd);
  list.appendChild(wrap);
  return wrap;
}

function recordSheetRenderGhosts(sheet, model, options, doc) {
  if (!model.ghosts || !model.ghosts.length) return null;
  const row = recordSheetEl(doc, "div", "bob-record-sheet-ghosts");
  if (!row) return null;
  row.setAttribute("aria-label", "Empty optional fields");
  for (const ghost of model.ghosts) {
    const chip = recordSheetEl(doc, "span", "bob-record-sheet-ghost");
    if (!chip) continue;
    chip.setAttribute("data-record-key", ghost.key);
    recordSheetText(chip, `＋ ${ghost.label || ghost.key}`);
    recordSheetBindYamlJump(chip, options?.handlers?.jumpYaml, ghost.key);
    row.appendChild(chip);
  }
  sheet.appendChild(row);
  return row;
}

function recordSheetRenderFold(sheet, model, options, doc) {
  if (!model.fold || !model.fold.length) return null;
  const details = recordSheetEl(doc, "div", "bob-record-sheet-fold");
  if (!details) return null;
  const toggle = recordSheetEl(doc, "button", "bob-record-sheet-fold-toggle");
  const count = model.fold.length;
  const label = `${count} other ${count === 1 ? "property" : "properties"}`;
  if (toggle) {
    toggle.setAttribute("type", "button");
    toggle.setAttribute("data-record-sheet-focus", "fold");
    toggle.setAttribute("aria-expanded", model.foldOpen ? "true" : "false");
    toggle.setAttribute("aria-label", model.foldOpen ? `Hide ${label}` : `Show ${label}`);
    recordSheetText(toggle, `${model.foldOpen ? "▾" : "▸"} ${label}`);
    toggle.addEventListener?.("click", (event) => {
      event.preventDefault?.();
      options?.handlers?.toggleFold?.(!model.foldOpen);
    });
    details.appendChild(toggle);
  }
  if (model.foldOpen) {
    const body = recordSheetEl(doc, "div", "bob-record-sheet-fold-body");
    for (const item of model.fold) {
      const row = recordSheetEl(doc, "div", "bob-record-sheet-fold-row");
      if (!row) continue;
      row.setAttribute("data-record-key", item.key);
      recordSheetBindYamlJump(row, options?.handlers?.jumpYaml, item.key);
      const labelNode = recordSheetEl(doc, "span", "bob-record-sheet-fold-label");
      recordSheetText(labelNode, item.label || item.key);
      if (labelNode) row.appendChild(labelNode);
      if (item.legacy) {
        const legacy = recordSheetEl(doc, "span", "bob-record-sheet-legacy");
        recordSheetText(legacy, "legacy");
        if (legacy) row.appendChild(legacy);
      }
      const value = recordSheetEl(doc, "span", "bob-record-sheet-fold-value");
      if (value) {
        recordSheetRenderSpans(value, doc, item.spans, options);
        row.appendChild(value);
      }
      if (item.lint) {
        const lint = recordSheetEl(doc, "span", "bob-record-sheet-lint");
        recordSheetText(lint, item.lint);
        if (lint) row.appendChild(lint);
      }
      if (body) body.appendChild(row);
    }
    if (body) details.appendChild(body);
  }
  sheet.appendChild(details);
  return details;
}

function recordSheetBuildEl(model, options = {}, doc) {
  if (!model) return null;
  const host = doc || recordSheetDomDoc(options.root);
  const sheet = recordSheetEl(host, "section", RECORD_SHEET_CLASS);
  if (!sheet) return null;
  sheet.setAttribute("role", "group");
  sheet.setAttribute("aria-label", `${model.title || "Record"} record details`);
  sheet.setAttribute("data-record-sheet", "true");
  sheet.setAttribute("data-record-source", model.path || "");
  if (model.hue) sheet.setAttribute("data-root-hue", model.hue);
  if (model.state) sheet.setAttribute("data-record-state", model.state);
  const header = recordSheetEl(host, "header", "bob-record-sheet-header");
  if (header) {
    recordSheetRenderCrumbs(header, model, options, host);
    recordSheetRenderToolbar(header, model, options, host);
    sheet.appendChild(header);
  }
  if (model.broken) {
    const warning = recordSheetEl(host, "p", "bob-record-sheet-warning");
    if (warning) {
      warning.setAttribute("role", "status");
      recordSheetText(warning, model.warning || "The album schema is invalid.");
      sheet.appendChild(warning);
    }
    const jump = recordSheetEl(host, "button", "bob-record-sheet-yaml");
    if (jump) {
      jump.setAttribute("type", "button");
      jump.setAttribute("aria-label", "Open album YAML");
      recordSheetText(jump, "Open album YAML");
      jump.addEventListener?.("click", (event) => {
        event.preventDefault?.();
        options?.handlers?.jumpAlbumYaml?.(model.warningLine);
      });
      recordSheetBindYamlJump(jump, () => options?.handlers?.jumpAlbumYaml?.(model.warningLine), "schema");
      sheet.appendChild(jump);
    }
    return sheet;
  }
  if (model.collapsed) {
    const summary = recordSheetEl(host, "div", "bob-record-sheet-summary");
    if (summary) {
      recordSheetRenderChips(summary, host, model.choiceChips, options);
      if (Number.isInteger(model.fieldCount)) {
        const count = recordSheetEl(host, "span", "bob-record-sheet-field-count");
        recordSheetText(count, `· ${model.fieldCount} ${model.fieldCount === 1 ? "field" : "fields"}`);
        if (count) summary.appendChild(count);
      }
      sheet.appendChild(summary);
    }
  } else {
    if (model.rows && model.rows.length) {
      const list = recordSheetEl(host, "dl", "bob-record-sheet-fields");
      if (list) {
        for (const row of model.rows) recordSheetRenderRow(list, row, options, host);
        sheet.appendChild(list);
      }
    }
    recordSheetRenderGhosts(sheet, model, options, host);
    if (model.createdFooter) {
      const footer = recordSheetEl(host, "p", "bob-record-sheet-created");
      recordSheetText(footer, model.createdFooter);
      if (footer) sheet.appendChild(footer);
    }
    recordSheetRenderFold(sheet, model, options, host);
  }
  return sheet;
}

function recordSheetAppendSubscriptionBand(sheet, model, options = {}) {
  if (!sheet || !model || !model.subscription || model.subscription.kind !== "header") return null;
  if (typeof bankSubscriptionPaintHeader !== "function") return null;
  const band = bankSubscriptionPaintHeader(sheet, model.subscription, {
    hue: options.hue || model.hue,
    sourcePath: model.path,
  });
  if (!band) return null;
  try {
    band.setAttribute?.(RECORD_SHEET_BAND_ATTR, "true");
    band.setAttribute?.("data-bob-record-sheet-owned", "true");
  } catch (_) {}
  return band;
}
