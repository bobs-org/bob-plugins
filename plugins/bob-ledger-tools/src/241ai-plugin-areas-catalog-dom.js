// Display-only Areas card chrome. Stored Markdown remains readable and is
// never rewritten here; only the explicit bob areas sync action writes.
const AREAS_HEADER_CLASS = "bob-areas-header";
const AREAS_STATUS_CLASS = "bob-areas-status";
const AREAS_STANDALONE_CLASS = "bob-areas-standalone";
const AREAS_ANCHOR_CLASS = "bob-areas-anchor";
const AREAS_DOT_CLASS = "bob-areas-dot";

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

function areasPaintDot(li, model) {
  const existing = Array.from(li?.children || []).find((node) => notebookDomHasClass(node, AREAS_DOT_CLASS));
  if (!model) {
    existing?.remove?.();
    return null;
  }
  if (existing) existing.remove?.();
  const link = notebookLiOwnLink(li);
  if (!link) return null;
  const doc = notebookDomDoc(li);
  const dot = notebookCreateEl(doc, "span", AREAS_DOT_CLASS);
  if (!dot) return null;
  dot.setAttribute("aria-hidden", "true");
  dot.setAttribute("data-area-path", model.path);
  areasSetAttr(dot, "data-hue", model.hue);
  areasSetAttr(dot, "data-muted", model.muted ? "true" : null);
  let first = link;
  while (first.parentNode && first.parentNode !== li) first = first.parentNode;
  li.insertBefore(dot, first);
  return dot;
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
    areasPaintDot(li, resolved && resolved.entry ? areasCardRowModel(resolved.entry) : null);
  }
  areasPaintStatus(content, areasCardStatus(options.state, options.sourcePath), options.handlers, header);
  return true;
}

function areasPaintStandaloneDot(parent, doc, model) {
  const dot = notebookCreateEl(doc, "span", AREAS_DOT_CLASS);
  if (!dot) return;
  dot.setAttribute("aria-hidden", "true");
  dot.setAttribute("data-area-path", model.path);
  areasSetAttr(dot, "data-hue", model.hue);
  areasSetAttr(dot, "data-muted", model.muted ? "true" : null);
  parent.appendChild(dot);
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
    areasPaintStandaloneDot(li, doc, model);
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
  for (const li of callout?.querySelectorAll?.("li") || []) areasPaintDot(li, null);
  for (const name of ["data-bob-areas-card", "data-root-hue", "data-stale"]) callout?.removeAttribute?.(name);
}

function areasCleanCatalogDom(root) {
  for (const callout of areasFindCallouts(root)) areasCleanCallout(callout);
  for (const cls of [AREAS_HEADER_CLASS, AREAS_STATUS_CLASS, AREAS_ANCHOR_CLASS, AREAS_STANDALONE_CLASS]) notebookRemovePainted(root, cls);
  for (const dot of root?.querySelectorAll?.(`.${AREAS_DOT_CLASS}`) || []) dot.remove?.();
}
