// Display-only Areas card chrome. Stored Markdown remains readable and is
// never rewritten here; only the explicit bob areas sync action writes.
const AREAS_HEADER_CLASS = "bob-areas-header";
const AREAS_STATUS_CLASS = "bob-areas-status";
const AREAS_STANDALONE_CLASS = "bob-areas-standalone";
const AREAS_ANCHOR_CLASS = "bob-areas-anchor";
const AREAS_DOT_CLASS = "bob-areas-dot";
const AREAS_TOGGLE_CLASS = "bob-areas-toggle";
const AREAS_CHIPS_CLASS = "bob-areas-chips";
const AREAS_ADD_CLASS = "bob-areas-add-summary";
const AREAS_ROW_CHROME = [AREAS_TOGGLE_CLASS, AREAS_DOT_CLASS, AREAS_CHIPS_CLASS, AREAS_ADD_CLASS];
const areasObsidianSetIcon = require("obsidian").setIcon;

function areasSetAttr(node, name, value) {
  if (value === null || value === undefined || value === false) node.removeAttribute?.(name);
  else if (node.getAttribute?.(name) !== String(value)) node.setAttribute?.(name, String(value));
}

function areasFindCallouts(root) {
  const selector = '.callout[data-callout="areas"], .cm-callout[data-callout="areas"], [data-callout="areas"]';
  const nodes = Array.from(root?.querySelectorAll?.(selector) || []);
  if (notebookDomAttr(root, "data-callout") === "areas") nodes.unshift(root);
  return Array.from(new Set(nodes)).filter((node) => !notebookInsideCode(node));
}

function areasContentHost(callout) {
  return callout?.querySelector?.(".callout-content") || callout;
}

function areasPlaceFirst(host, node) {
  if (!host || !node || node.parentNode !== host || host.firstChild === node) return;
  host.insertBefore?.(node, host.firstChild || null);
}

function areasPlaceAfter(host, node, previous) {
  if (!host || !node || !previous || node.parentNode !== host) return;
  const next = previous.nextSibling || null;
  if (next !== node) host.insertBefore?.(node, next);
}

function areasPaintHeader(host, options) {
  const catalog = options.catalog || areasCardHost(options.state, options.sourcePath);
  const rows = Array.isArray(catalog?.rows) ? catalog.rows.length : 0;
  const warning = areasCardUnplacedModel(options.state, options.sourcePath);
  const key = JSON.stringify([rows, warning]);
  const header = albumReplaceChrome(host, AREAS_HEADER_CLASS, key, (node, doc) => {
    node.setAttribute("role", "heading");
    node.setAttribute("aria-level", "3");
    if (typeof areasObsidianSetIcon === "function") {
      const icon = notebookCreateEl(doc, "span", "bob-areas-icon");
      icon.setAttribute("aria-hidden", "true");
      areasObsidianSetIcon(icon, "layers");
      node.appendChild(icon);
    }
    const title = notebookCreateEl(doc, "span", "bob-areas-title");
    notebookSetText(title, "Areas");
    node.appendChild(title);
    const count = notebookCreateEl(doc, "span", "bob-areas-count");
    notebookSetText(count, `${rows} ${rows === 1 ? "area" : "areas"}`);
    node.appendChild(count);
    if (warning) {
      const notice = notebookCreateEl(doc, "span", "bob-areas-unplaced");
      notebookSetText(notice, `⚠ ${warning.count} areas unplaced`);
      notice.setAttribute("title", warning.tooltip);
      notice.setAttribute("tabindex", "0");
      node.appendChild(notice);
    }
  });
  areasPlaceFirst(host, header);
  return header;
}

function areasPaintStatus(host, model, handlers, header = null) {
  const status = albumReplaceChrome(host, AREAS_STATUS_CLASS, model && (model.message || model.action) ? JSON.stringify(model) : "", (node, doc) => {
    node.setAttribute("role", "status");
    if (model.message) {
      const hint = notebookCreateEl(doc, "span", "bob-areas-status-hint");
      notebookSetText(hint, model.message);
      node.appendChild(hint);
    }
    if (model.health && model.health.label && model.health.label !== "damaged catalog") {
      const health = notebookCreateEl(doc, "span", "bob-areas-health");
      notebookSetText(health, "stale catalog");
      node.appendChild(health);
    }
    if (model.action) {
      const action = notebookCreateEl(doc, "button", "bob-areas-action");
      notebookSetText(action, model.action.label);
      action.setAttribute("type", "button");
      action.setAttribute("title", model.action.hint);
      action.setAttribute("aria-label", model.action.hint);
      action.disabled = Boolean(model.action.disabled);
      if (model.action.disabled) action.setAttribute("aria-busy", "true");
      notebookBindAction(action, () => {
        if (!action.disabled && typeof handlers?.[model.action.kind] === "function") handlers[model.action.kind]();
      });
      node.appendChild(action);
    }
  });
  if (header) areasPlaceAfter(host, status, header);
  return status;
}

function areasPlaceStart(li, node) {
  if (!li || !node || node.parentNode !== li) return;
  if (li.firstChild !== node) li.insertBefore(node, li.firstChild || null);
}

function areasNestedList(li) {
  return Array.from(li?.children || []).find((node) => notebookDomTag(node) === "UL") || null;
}

function areasPlaceBeforeNested(li, node) {
  if (!li || !node || node.parentNode !== li) return;
  const nested = areasNestedList(li);
  if (nested) {
    if (node.nextSibling !== nested) li.insertBefore(node, nested);
  } else if (li.lastChild !== node) {
    li.appendChild(node);
  }
}

function areasPaintDot(li, model, tooltip = "") {
  const existing = Array.from(li?.children || []).find((node) => notebookDomHasClass(node, AREAS_DOT_CLASS));
  if (!model) {
    existing?.remove?.();
    return null;
  }
  const link = notebookLiOwnLink(li);
  if (!link) {
    existing?.remove?.();
    return null;
  }
  const doc = notebookDomDoc(li);
  const dot = existing || notebookCreateEl(doc, "span", AREAS_DOT_CLASS);
  if (!dot) return null;
  dot.setAttribute("aria-hidden", "true");
  dot.setAttribute("data-area-path", model.path);
  areasSetAttr(dot, "data-hue", model.hue);
  areasSetAttr(dot, "data-muted", model.muted ? "true" : null);
  areasSetAttr(dot, "title", tooltip || null);
  let first = link;
  while (first.parentNode && first.parentNode !== li) first = first.parentNode;
  if (dot.parentNode !== li || dot.nextSibling !== first) li.insertBefore(dot, first);
  return dot;
}

function areasPaintToggle(li, model, expanded, options) {
  const key = model && model.childCount > 0 ? JSON.stringify([model.path, expanded, model.childCount]) : "";
  const node = albumReplaceChrome(li, AREAS_TOGGLE_CLASS, key, (host, doc) => {
    const open = expanded !== false;
    notebookSetText(host, open ? "▾" : "▸");
    host.setAttribute("data-focus-key", "fold");
    host.setAttribute("data-area-path", model.path);
    host.setAttribute("aria-expanded", open ? "true" : "false");
    const label = open
      ? `Hide ${model.childCount} nested ${model.childCount === 1 ? "area" : "areas"}.`
      : `Show ${model.childCount} nested ${model.childCount === 1 ? "area" : "areas"}.`;
    host.setAttribute("title", label);
    host.setAttribute("aria-label", label);
    notebookBindAction(host, () => options.handlers?.toggleFold?.(model.path, !open));
  });
  if (node) areasPlaceStart(li, node);
  return node;
}

function areasPaintChipDot(doc, hue, muted) {
  const dot = notebookCreateEl(doc, "span", "bob-areas-chip-dot");
  if (!dot) return null;
  dot.setAttribute("aria-hidden", "true");
  areasSetAttr(dot, "data-hue", hue);
  areasSetAttr(dot, "data-muted", muted ? "true" : null);
  return dot;
}

function areasPaintChips(li, model, expanded, tooltip) {
  const chips = areasCardChips(model, expanded);
  const key = chips.length ? JSON.stringify([model.path, expanded, chips]) : "";
  const node = albumReplaceChrome(li, AREAS_CHIPS_CLASS, key, (host, doc) => {
    host.setAttribute("data-area-path", model.path);
    for (const chip of chips) {
      const wrap = notebookCreateEl(doc, "span", `bob-areas-chip bob-areas-chip-${chip.kind}`);
      if (!wrap) continue;
      wrap.setAttribute("data-focus-key", chip.kind);
      if (chip.hint) {
        wrap.setAttribute("title", chip.hint);
        wrap.setAttribute("aria-label", chip.kind === "today"
          ? `${chip.compact} ${chip.compact === "1" ? "task" : "tasks"} today`
          : chip.text);
        wrap.setAttribute("tabindex", "0");
      }
      const full = notebookCreateEl(doc, "span", "bob-areas-chip-full");
      if (full) {
        if (chip.kind === "today") {
          const dot = areasPaintChipDot(doc, chip.hue, chip.muted);
          if (dot) full.appendChild(dot);
          const label = notebookCreateEl(doc, "span", "bob-areas-chip-label");
          if (label) {
            notebookSetText(label, chip.text);
            full.appendChild(label);
          }
        } else {
          notebookSetText(full, chip.text);
        }
        wrap.appendChild(full);
      }
      const compact = notebookCreateEl(doc, "span", "bob-areas-chip-compact");
      if (compact) {
        compact.setAttribute("aria-hidden", "true");
        const count = notebookCreateEl(doc, "span", "bob-areas-chip-count");
        if (count) {
          notebookSetText(count, chip.compact);
          compact.appendChild(count);
        }
        if (chip.kind === "today") {
          const dot = areasPaintChipDot(doc, chip.hue, chip.muted);
          if (dot) compact.appendChild(dot);
        } else {
          const icon = notebookCreateEl(doc, "span", "bob-areas-chip-icon");
          if (icon) {
            icon.setAttribute("data-kind", "projects");
            compact.appendChild(icon);
          }
        }
        wrap.appendChild(compact);
      }
      host.appendChild(wrap);
    }
  });
  if (node) areasPlaceBeforeNested(li, node);
  void tooltip;
  return node;
}

function areasPaintAddSummary(li, model, handlers) {
  const key = model && model.addSummary ? model.path : "";
  const node = albumReplaceChrome(li, AREAS_ADD_CLASS, key, (host) => {
    notebookSetText(host, "add summary");
    host.setAttribute("data-focus-key", "summary");
    host.setAttribute("data-area-path", model.path);
    host.setAttribute("aria-label", "Add a summary to this area");
    host.setAttribute("title", "Open this area and edit its summary");
    notebookBindAction(host, () => handlers?.openSummary?.(model));
  });
  if (node) areasPlaceBeforeNested(li, node);
  return node;
}

function areasOrderRow(li) {
  const kids = Array.from(li?.children || []);
  const toggle = kids.find((node) => notebookDomHasClass(node, AREAS_TOGGLE_CLASS));
  const dot = kids.find((node) => notebookDomHasClass(node, AREAS_DOT_CLASS));
  const add = kids.find((node) => notebookDomHasClass(node, AREAS_ADD_CLASS));
  const chips = kids.find((node) => notebookDomHasClass(node, AREAS_CHIPS_CLASS));
  if (toggle) areasPlaceStart(li, toggle);
  if (dot) {
    if (toggle) areasPlaceAfter(li, dot, toggle);
    else areasPlaceStart(li, dot);
  }
  if (add) areasPlaceBeforeNested(li, add);
  if (chips) areasPlaceBeforeNested(li, chips);
}

function areasPaintRow(li, model, options) {
  if (!model) {
    areasCleanRow(li);
    return false;
  }
  const expanded = areasCardIsExpanded(options.folds, options.sourcePath, model.path);
  const tooltip = areasCardTooltip(model);
  areasSetAttr(li, "data-folded", expanded ? null : "true");
  areasSetAttr(li, "data-area-path", model.path);
  areasPaintToggle(li, model, expanded, options);
  areasPaintDot(li, model, tooltip);
  areasPaintAddSummary(li, model, options.handlers);
  areasPaintChips(li, model, expanded, tooltip);
  const nested = areasNestedList(li);
  if (nested) areasSetAttr(nested, "hidden", expanded ? null : "true");
  areasOrderRow(li);
  return true;
}

function areasCleanRow(li) {
  for (const cls of AREAS_ROW_CHROME) {
    const node = Array.from(li?.children || []).find((child) => notebookDomHasClass(child, cls));
    node?.remove?.();
  }
  for (const name of ["data-folded", "data-area-path"]) li?.removeAttribute?.(name);
  const nested = areasNestedList(li);
  if (nested) nested.removeAttribute?.("hidden");
}

function areasPaintCallout(callout, options) {
  const catalog = areasCardHost(options.state, options.sourcePath);
  if (!catalog) {
    areasCleanCallout(callout);
    return false;
  }
  areasSetAttr(callout, "data-bob-areas-card", "true");
  areasSetAttr(callout, "data-root-hue", areasCardHostHue(options.state, options.sourcePath));
  areasSetAttr(callout, "data-stale", options.state.stale ? "true" : null);
  const report = options.state.report;
  const content = areasContentHost(callout);
  const header = areasPaintHeader(content, options);
  for (const li of callout.querySelectorAll?.("li") || []) {
    const link = notebookLiOwnLink(li);
    const resolved = link ? areasCardLookupByTarget(report, notebookLinkHref(link), options.sourcePath, options.metadataCache, options.vault) : null;
    areasPaintRow(li, resolved && resolved.entry ? areasCardRowModel(resolved.entry) : null, options);
  }
  areasPaintStatus(content, areasCardStatus(options.state, options.sourcePath), options.handlers, header);
  return true;
}

function areasPaintStandaloneRows(host, options) {
  const rows = areasCardRows(options.state, options.sourcePath);
  if (!rows.length) return;
  const doc = notebookDomDoc(host);
  const root = notebookCreateEl(doc, "ul", "bob-areas-list");
  if (!root) return;
  const lists = [root];
  const parents = [];
  let previousDepth = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const model = rows[index];
    const depth = Math.max(0, Math.min(Number.isInteger(model.depth) ? model.depth : 0, previousDepth + (parents.length ? 1 : 0)));
    const safeDepth = Math.min(depth, lists.length - 1);
    let list = lists[safeDepth] || root;
    const li = notebookCreateEl(doc, "li", "bob-areas-row");
    if (!li) continue;
    const link = notebookCreateEl(doc, "a", "internal-link");
    if (link) {
      link.setAttribute("data-href", model.link);
      notebookSetText(link, model.stem || model.link);
      li.appendChild(link);
    }
    if (model.summary) {
      const summary = notebookCreateEl(doc, "span", "bob-areas-summary");
      notebookSetText(summary, ` — ${model.summary}`);
      li.appendChild(summary);
    }
    list.appendChild(li);
    parents[safeDepth] = li;
    lists.length = safeDepth + 1;
    const next = rows[index + 1];
    if (next && next.depth > safeDepth) {
      const nested = notebookCreateEl(doc, "ul", "bob-areas-list");
      if (nested) {
        li.appendChild(nested);
        lists[safeDepth + 1] = nested;
      }
    }
    areasPaintRow(li, model, options);
    previousDepth = safeDepth;
  }
  host.appendChild(root);
}

function areasPaintStandalone(host, options) {
  if (!host || !areasCardHost(options.state, options.sourcePath)) return false;
  const catalog = areasCardHost(options.state, options.sourcePath);
  host.setAttribute?.("class", `${notebookDomAttr(host, "class") || ""} ${AREAS_STANDALONE_CLASS}`.trim());
  areasSetAttr(host, "data-bob-areas-card", "true");
  areasSetAttr(host, "data-root-hue", areasCardHostHue(options.state, options.sourcePath));
  areasSetAttr(host, "data-stale", options.state.stale ? "true" : null);
  const header = areasPaintHeader(host, options);
  let list = Array.from(host.children || []).find((node) => notebookDomHasClass(node, "bob-areas-list"));
  if (list) list.remove?.();
  areasPaintStandaloneRows(host, options);
  areasPaintStatus(host, areasCardStatus(options.state, options.sourcePath), options.handlers, header);
  void catalog;
  return true;
}

function areasCleanCallout(callout) {
  notebookRemovePainted(callout, AREAS_HEADER_CLASS);
  notebookRemovePainted(callout, AREAS_STATUS_CLASS);
  for (const li of callout?.querySelectorAll?.("li") || []) areasCleanRow(li);
  for (const name of ["data-bob-areas-card", "data-root-hue", "data-stale"]) callout?.removeAttribute?.(name);
}

function areasCleanCatalogDom(root) {
  for (const callout of areasFindCallouts(root)) areasCleanCallout(callout);
  for (const cls of [AREAS_HEADER_CLASS, AREAS_STATUS_CLASS, AREAS_ANCHOR_CLASS, AREAS_STANDALONE_CLASS]) notebookRemovePainted(root, cls);
  for (const li of root?.querySelectorAll?.("li") || []) areasCleanRow(li);
  for (const cls of AREAS_ROW_CHROME) notebookRemovePainted(root, cls);
}
