// Projects catalog card: keyed, presentation-only DOM. Keeping unchanged
// buttons alive preserves focus/hover through service notifications and
// editor selection updates. Never writes note bytes; generated chrome only.

const PROJECTS_CHIPS_CLASS = "bob-projects-chips";
const PROJECTS_STATUS_CLASS = "bob-projects-status";
const PROJECTS_HEADER_CLASS = "bob-projects-header";
const PROJECTS_CLOSED_CLASS = "bob-projects-closed";
const PROJECTS_CHILDREN_CLASS = "bob-projects-children";
const PROJECTS_ANCHOR_CLASS = "bob-projects-anchor";
const PROJECTS_CRITERION_CLASS = "bob-projects-criterion";

function projectsFindCallouts(root) {
  const selector = '[data-callout="projects"]';
  const nodes = Array.from(root?.querySelectorAll?.(selector) || []);
  if (notebookDomAttr(root, "data-callout") === "projects") {
    nodes.unshift(root);
  }
  return nodes.filter((node) => !notebookInsideCode(node));
}

function projectsPaintMarker(doc, host, marker) {
  const node = notebookCreateEl(doc, "span", "bob-projects-marker");
  if (!node) {
    return null;
  }
  node.setAttribute("data-state", marker && marker.kind === "ring" ? "open" : "other");
  node.setAttribute("data-focus-key", "marker");
  if (marker && marker.kind === "ring") {
    node.setAttribute("aria-hidden", "true");
  } else {
    notebookSetText(node, (marker && marker.glyph) || "?");
    const label = (marker && marker.label) || "unknown state";
    node.setAttribute("title", label);
    node.setAttribute("aria-label", `state: ${label}`);
  }
  host.appendChild(node);
  return node;
}

function projectsPaintChip(doc, host, chip) {
  const node = notebookCreateEl(doc, "span", `bob-projects-chip bob-projects-chip-${chip.kind}`);
  if (!node) {
    return null;
  }
  notebookSetText(node, chip.text);
  if (chip.hint) {
    node.setAttribute("title", chip.hint);
  }
  host.appendChild(node);
  return node;
}

function projectsPaintMiniRow(doc, host, model) {
  const li = notebookCreateEl(doc, "li", "bob-projects-mini");
  if (!li) {
    return null;
  }
  projectsPaintMarker(doc, li, model.marker);
  const link = notebookCreateEl(doc, "a", "internal-link");
  if (link) {
    link.setAttribute("data-href", model.path);
    notebookSetText(link, model.stem || model.path);
    if (model.tooltip) {
      link.setAttribute("title", model.tooltip);
    }
    li.appendChild(link);
  }
  host.appendChild(li);
  return li;
}

function projectsPaintRow(li, model, context) {
  const expanded = projectsCardIsChildExpanded(context.folds, context.hostPath, model.path);
  const key = JSON.stringify([model, expanded]);
  albumReplaceChrome(li, PROJECTS_CHIPS_CLASS, key, (host, doc) => {
    host.setAttribute("data-projects-path", model.path);
    projectsPaintMarker(doc, host, model.marker);
    for (const chip of model.chips) {
      projectsPaintChip(doc, host, chip);
    }
    if (model.childCount > 0) {
      const toggle = albumAppendText(doc, host, "button",
        "bob-projects-children-toggle", `${expanded ? "▾" : "▸"} ${model.childCount}`,
        expanded ? `Hide ${model.childCount} child projects.` : `Show ${model.childCount} child projects.`);
      if (toggle) {
        toggle.setAttribute("data-focus-key", "children");
        toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
        notebookBindAction(toggle, () => context.handlers.toggleChild(model.path, !expanded));
      }
    }
  });
  // The stored criterion stays readable: wrap the li's own trailing text
  // verbatim in a clamped span with the full text on hover and keyboard
  // focus. Report text never overwrites stored words.
  projectsPaintCriterion(li);
  if (model.childCount > 0 && expanded) {
    projectsPaintChildList(li, model, context);
  } else {
    notebookRemovePainted(li, PROJECTS_CHILDREN_CLASS);
  }
}

function projectsPaintCriterion(li) {
  const doc = notebookDomDoc(li);
  if (!doc) {
    return;
  }
  const existing = Array.from(li.children || []).find((node) => notebookDomHasClass(node, PROJECTS_CRITERION_CLASS));
  if (existing) {
    return;
  }
  // Collect the li's own trailing text nodes (never nested lists or chrome).
  const trailing = [];
  for (const child of Array.from(li.childNodes || [])) {
    if (child.nodeType !== 3) {
      continue;
    }
    if (!child.nodeValue || !child.nodeValue.trim()) {
      continue;
    }
    trailing.push(child);
  }
  if (!trailing.length) {
    return;
  }
  const text = trailing.map((node) => node.nodeValue).join("");
  if (!text.trim()) {
    return;
  }
  const wrap = notebookCreateEl(doc, "span", PROJECTS_CRITERION_CLASS);
  if (!wrap) {
    return;
  }
  notebookSetText(wrap, text);
  wrap.setAttribute("title", text.trim());
  wrap.setAttribute("tabindex", "0");
  li.insertBefore(wrap, trailing[0]);
  for (const node of trailing) {
    node.remove();
  }
}

function projectsPaintChildList(li, model, context) {
  const key = JSON.stringify(model.children);
  albumReplaceChrome(li, PROJECTS_CHILDREN_CLASS, key, (host, doc) => {
    const list = notebookCreateEl(doc, "ul", "bob-projects-child-list");
    if (!list) {
      return;
    }
    host.appendChild(list);
    for (const childPath of model.children) {
      const entry = context.state.report && context.state.report.projectsByPath
        ? context.state.report.projectsByPath.get(projectsReportPath(childPath))
        : null;
      if (!entry) {
        continue;
      }
      const child = projectsCardRowModel(entry, context.state.today);
      if (!child) {
        continue;
      }
      child.tooltip = projectsCardChildTooltip(context.metadataCache, projectsCardResolveFile(child.path, context));
      projectsPaintMiniRow(doc, list, child);
    }
  });
}

function projectsCardResolveFile(path, context) {
  try {
    return context.vault?.getAbstractFileByPath?.(path) || null;
  } catch (error) {
    return null;
  }
}

function projectsPaintHeader(host, tally, health) {
  const key = JSON.stringify([tally, health ? health.label : ""]);
  albumReplaceChrome(host, PROJECTS_HEADER_CLASS, key, (node, doc) => {
    node.setAttribute("role", "heading");
    node.setAttribute("aria-level", "2");
    const title = notebookCreateEl(doc, "span", "bob-projects-title");
    if (title) {
      notebookSetText(title, "Projects");
      node.appendChild(title);
    }
    const full = albumAppendText(doc, node, "span", "bob-projects-tally bob-projects-tally-full", tally.full, tally.hint);
    if (full) {
      full.setAttribute("aria-hidden", "false");
    }
    const short = albumAppendText(doc, node, "span", "bob-projects-tally bob-projects-tally-short", tally.short, tally.hint);
    if (short) {
      short.setAttribute("aria-hidden", "false");
    }
    if (health) {
      albumAppendText(doc, node, "span", "bob-projects-health", health.label, health.hint);
    }
  });
}

function projectsPaintClosed(host, closedRows, context) {
  const folded = projectsCardIsClosedFolded(context.folds, context.hostPath);
  const newest = closedRows.slice(0, PROJECTS_CLOSED_PEEK_COUNT);
  const key = JSON.stringify([closedRows.map((row) => row.path), folded, context.state.today]);
  albumReplaceChrome(host, PROJECTS_CLOSED_CLASS, key, (node, doc) => {
    const button = albumAppendText(doc, node, "button", "bob-projects-closed-toggle",
      `Closed · ${closedRows.length}`,
      folded ? `Show ${closedRows.length} closed projects.` : `Hide closed projects.`);
    if (button) {
      button.setAttribute("data-focus-key", "closed");
      button.setAttribute("aria-expanded", folded ? "false" : "true");
      notebookBindAction(button, () => context.handlers.toggleClosed(!folded));
    }
    const list = notebookCreateEl(doc, "ul", "bob-projects-closed-list");
    if (!list) {
      return;
    }
    node.appendChild(list);
    const shown = folded ? newest : closedRows;
    for (const entry of shown) {
      const model = projectsCardRowModel(entry, context.state.today);
      if (!model) {
        continue;
      }
      model.tooltip = projectsCardChildTooltip(context.metadataCache, projectsCardResolveFile(model.path, context));
      projectsPaintMiniRow(doc, list, model);
    }
  });
}

function projectsPaintStatus(host, model, handlers) {
  return albumReplaceChrome(host, PROJECTS_STATUS_CLASS, model.message || model.action ? JSON.stringify(model) : "", (node, doc) => {
    node.setAttribute("role", "status");
    if (model.message) {
      albumAppendText(doc, node, "span", "bob-projects-status-hint", model.message);
    }
    if (model.action) {
      const action = model.action;
      const button = albumAppendText(doc, node, "button", "bob-projects-action", action.label, action.hint);
      if (button) {
        button.setAttribute("data-focus-key", action.kind);
        button.disabled = Boolean(action.disabled);
        albumSetAttr(button, "aria-busy", action.disabled ? "true" : null);
        notebookBindAction(button, () => {
          if (!button.disabled) {
            handlers[action.kind]();
          }
        });
      }
    }
  });
}

function projectsContentHost(callout) {
  return callout.querySelector?.(".callout-content") || callout;
}

function projectsOrderChrome(host) {
  // The painted header and status stay ahead of the stored rows. Moving live
  // nodes never drops focus, and keyed repaints keep this order stable.
  try {
    const kids = Array.from(host.children || []);
    const header = kids.find((node) => notebookDomHasClass(node, PROJECTS_HEADER_CLASS));
    const status = kids.find((node) => notebookDomHasClass(node, PROJECTS_STATUS_CLASS));
    if (header && host.firstChild !== header) {
      host.insertBefore(header, host.firstChild);
    }
    if (status && header && status.previousSibling !== header) {
      host.insertBefore(status, header.nextSibling);
    }
  } catch (error) {
    // Order is best-effort.
  }
}

function projectsPaintCallout(callout, context) {
  albumSetAttr(callout, "data-bob-projects-card", "true");
  albumSetAttr(callout, "data-root-hue", context.hue);
  albumSetAttr(callout, "data-stale", context.state.stale ? "true" : null);
  const rows = projectsCardRowEntries(context.state, context.sourcePath);
  const partition = projectsCardPartition(rows);
  const tally = projectsCardTally(partition);
  const catalog = projectsCardHost(context.state, context.sourcePath);
  const health = catalog ? projectsCardHealthModel(catalog) : null;
  const content = projectsContentHost(callout);
  projectsPaintHeader(content, tally, health);
  const seen = new Set();
  for (const li of callout.querySelectorAll("li")) {
    // Generated mini rows (Closed peek, nested children) carry real links
    // but are never stored rows: repainting them would paint row chrome into
    // the peek and hide them from their own group.
    if (notebookDomHasClass(li, "bob-projects-mini")) {
      continue;
    }
    const link = notebookLiOwnLink(li);
    const target = link ? notebookLinkHref(link) : "";
    const group = /^\s*🧩/u.test(notebookLiOwnText(li));
    // Notebook/album 🧩 groups and ordinary same-stem notes are never
    // painted as project rows.
    if (group || !target) {
      notebookRemovePainted(li, PROJECTS_CHIPS_CLASS);
      notebookRemovePainted(li, PROJECTS_CHILDREN_CLASS);
      continue;
    }
    const resolved = projectsCardLookupByTarget(context.state.report, target,
      context.sourcePath, context.metadataCache, context.vault);
    const entry = resolved && resolved.entry;
    if (!entry) {
      notebookRemovePainted(li, PROJECTS_CHIPS_CLASS);
      notebookRemovePainted(li, PROJECTS_CHILDREN_CLASS);
      continue;
    }
    seen.add(projectsReportPath(entry.path));
    const model = projectsCardRowModel(entry, context.state.today);
    if (!model) {
      continue;
    }
    if (resolved.file) {
      const tooltip = projectsCardChildTooltip(context.metadataCache, resolved.file);
      if (tooltip && !link.getAttribute("title")) {
        link.setAttribute("title", tooltip);
      }
    }
    projectsPaintRow(li, model, context);
  }
  const unlisted = partition.closed.filter((entry) => !seen.has(projectsReportPath(entry.path)));
  const closedHost = content;
  if (unlisted.length) {
    projectsPaintClosed(closedHost, unlisted, context);
  } else {
    notebookRemovePainted(closedHost, PROJECTS_CLOSED_CLASS);
  }
  // The redundant native callout title stays hidden (see styles.css); the
  // painted header below carries the accessible heading instead.
  projectsPaintStatus(content, projectsCardStatus(context.state, context.sourcePath), context.handlers);
  projectsOrderChrome(content);
}

function projectsPaintStandalone(host, context) {
  // Hosts without a stored callout still get a header, status, and Closed
  // group. With no children at all, no empty card remains: only the repair
  // status survives, so a missing catalog stays actionable.
  const rows = projectsCardRowEntries(context.state, context.sourcePath);
  const partition = projectsCardPartition(rows);
  if (!partition.open.length && !partition.closed.length) {
    notebookRemovePainted(host, PROJECTS_HEADER_CLASS);
    notebookRemovePainted(host, PROJECTS_CLOSED_CLASS);
    projectsPaintStatus(host, projectsCardStatus(context.state, context.sourcePath), context.handlers);
    return;
  }
  projectsPaintHeader(host, projectsCardTally(partition),
    context.catalog ? projectsCardHealthModel(context.catalog) : null);
  if (partition.closed.length) {
    projectsPaintClosed(host, partition.closed, context);
  } else {
    notebookRemovePainted(host, PROJECTS_CLOSED_CLASS);
  }
  projectsPaintStatus(host, projectsCardStatus(context.state, context.sourcePath), context.handlers);
  projectsOrderChrome(host);
}

function projectsCleanCatalogDom(root) {
  notebookRemovePainted(root, PROJECTS_CHIPS_CLASS);
  notebookRemovePainted(root, PROJECTS_STATUS_CLASS);
  notebookRemovePainted(root, PROJECTS_HEADER_CLASS);
  notebookRemovePainted(root, PROJECTS_CLOSED_CLASS);
  notebookRemovePainted(root, PROJECTS_CHILDREN_CLASS);
  notebookRemovePainted(root, PROJECTS_ANCHOR_CLASS);
  for (const callout of projectsFindCallouts(root)) {
    if (notebookDomAttr(callout, "data-bob-projects-card")) {
      for (const name of ["data-bob-projects-card", "data-root-hue", "data-stale"]) {
        callout.removeAttribute(name);
      }
    }
  }
  for (const li of root.querySelectorAll?.("li") || []) {
    for (const wrap of Array.from(li.children || []).filter((node) => notebookDomHasClass(node, PROJECTS_CRITERION_CLASS))) {
      const doc = notebookDomDoc(li);
      const text = doc && typeof doc.createTextNode === "function"
        ? doc.createTextNode(wrap.textContent || "")
        : null;
      if (text && wrap.parentNode === li) {
        li.insertBefore(text, wrap);
      }
      wrap.remove();
    }
  }
}
