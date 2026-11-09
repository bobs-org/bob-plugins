// Rendered notebook catalog cards: hue, row chips, add-summary, and
// heading sync. Safe text nodes only; never HTML from the report, and
// never a vault write.

const NOTEBOOK_CHIP_CLASS = "bob-notebook-chips";
const NOTEBOOK_COUNT_CLASS = "bob-notebook-count";
const NOTEBOOK_AGE_CLASS = "bob-notebook-age";
const NOTEBOOK_ADD_CLASS = "bob-notebook-add-summary";
const NOTEBOOK_SYNC_CLASS = "bob-notebook-sync";
const NOTEBOOK_SUMMARY_CLASS = "bob-notebook-summary";
const NOTEBOOK_CALLOUT_CLASS = "bob-notebook-catalog";

function notebookDomDoc(node) {
  try {
    if (node && node.ownerDocument) {
      return node.ownerDocument;
    }
  } catch (error) {
    // Fall through.
  }
  return typeof document !== "undefined" ? document : null;
}

function notebookDomTag(node) {
  try {
    return String((node && (node.tagName || node.nodeName)) || "").toUpperCase();
  } catch (error) {
    return "";
  }
}

function notebookDomHasClass(node, name) {
  try {
    if (!node || !name) {
      return false;
    }
    if (node.classList && typeof node.classList.contains === "function") {
      return node.classList.contains(name);
    }
    const raw = typeof node.getAttribute === "function"
      ? node.getAttribute("class") || ""
      : typeof node.className === "string" ? node.className : "";
    return String(raw).split(/\s+/).indexOf(name) !== -1;
  } catch (error) {
    return false;
  }
}

function notebookDomAttr(node, name) {
  try {
    return node && typeof node.getAttribute === "function" ? node.getAttribute(name) : null;
  } catch (error) {
    return null;
  }
}

function notebookCreateEl(doc, tag, className) {
  if (!doc || typeof doc.createElement !== "function") {
    return null;
  }
  const el = doc.createElement(tag);
  if (className) {
    if (typeof el.setAttribute === "function") {
      el.setAttribute("class", className);
    }
    try {
      el.className = className;
    } catch (error) {
      // className is best-effort.
    }
  }
  return el;
}

function notebookSetText(el, text) {
  try {
    if (!el) {
      return;
    }
    el.textContent = String(text === null || text === undefined ? "" : text);
  } catch (error) {
    // Text assignment is best-effort.
  }
}

function notebookBindAction(el, run) {
  if (!el || typeof el.addEventListener !== "function" || typeof run !== "function") {
    return;
  }
  try {
    if (typeof el.setAttribute === "function") {
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.setAttribute("type", "button");
    }
  } catch (error) {
    // Attributes are best-effort.
  }
  const invoke = (event) => {
    try {
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      if (event && typeof event.stopPropagation === "function") {
        event.stopPropagation();
      }
    } catch (error) {
      // Event cancellation is best-effort.
    }
    run(event);
  };
  el.addEventListener("mousedown", (event) => {
    try {
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
    } catch (error) {
      // Keep the editor cursor still.
    }
  });
  el.addEventListener("click", invoke);
  el.addEventListener("keydown", (event) => {
    if (!event) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      invoke(event);
    }
  });
}

function notebookRemovePainted(root, className) {
  try {
    if (!root || typeof root.querySelectorAll !== "function") {
      return;
    }
    const nodes = Array.from(root.querySelectorAll(`.${className}`) || []);
    for (const node of nodes) {
      try {
        if (node && node.parentNode && typeof node.parentNode.removeChild === "function") {
          node.parentNode.removeChild(node);
        } else if (node && typeof node.remove === "function") {
          node.remove();
        }
      } catch (error) {
        // Cleanup is best-effort.
      }
    }
  } catch (error) {
    // Query cleanup is best-effort.
  }
}

function notebookLiOwnNodes(li) {
  const own = [];
  try {
    const children = li && li.childNodes ? li.childNodes : [];
    for (const child of children) {
      const tag = notebookDomTag(child);
      if (tag === "UL" || tag === "OL") {
        continue;
      }
      own.push(child);
    }
  } catch (error) {
    return [];
  }
  return own;
}

function notebookLiOwnText(li) {
  let text = "";
  const walk = (node) => {
    if (!node) {
      return;
    }
    try {
      if (node.nodeType === 3) {
        text += typeof node.nodeValue === "string" ? node.nodeValue : String(node.textContent || "");
        return;
      }
      if (node.nodeType && node.nodeType !== 1) {
        return;
      }
      const tag = notebookDomTag(node);
      if (tag === "UL" || tag === "OL") {
        return;
      }
      const children = node.childNodes || [];
      if (children.length === 0 && typeof node.textContent === "string" && node === li) {
        return;
      }
      for (const child of children) {
        walk(child);
      }
    } catch (error) {
      // Skip one node.
    }
  };
  for (const child of notebookLiOwnNodes(li)) {
    walk(child);
  }
  return text;
}

function notebookLiIsProjectGroup(li) {
  return notebookLiOwnText(li).indexOf("\u{1F9E9}") !== -1;
}

function notebookLiOwnLink(li) {
  const found = [];
  const walk = (node) => {
    if (!node) {
      return;
    }
    const tag = notebookDomTag(node);
    if (tag === "UL" || tag === "OL") {
      return;
    }
    if (tag === "A" && notebookDomHasClass(node, "internal-link")) {
      found.push(node);
      return;
    }
    const children = node.childNodes || node.children || [];
    for (const child of children) {
      walk(child);
    }
  };
  for (const child of notebookLiOwnNodes(li)) {
    walk(child);
  }
  return found[0] || null;
}

function notebookLinkHref(link) {
  const raw = notebookDomAttr(link, "data-href")
    || notebookDomAttr(link, "href")
    || notebookDomAttr(link, "data-path")
    || "";
  return notebookWikilinkTarget(String(raw).replace(/^app:\/\//, "").replace(/\.md$/i, "") || String(raw));
}

function notebookMuteSummary(li, doc) {
  if (!li || notebookDomHasClass(li, NOTEBOOK_SUMMARY_CLASS)) {
    return false;
  }
  try {
    if (typeof li.querySelector === "function" && li.querySelector(`.${NOTEBOOK_SUMMARY_CLASS}`)) {
      return false;
    }
  } catch (error) {
    // Dedup is best-effort.
  }
  const dash = NOTEBOOK_EM_DASH;
  const visit = (node) => {
    if (!node) {
      return false;
    }
    const tag = notebookDomTag(node);
    if (tag === "UL" || tag === "OL") {
      return false;
    }
    if (node.nodeType === 3) {
      const value = typeof node.nodeValue === "string" ? node.nodeValue : String(node.textContent || "");
      const at = value.indexOf(dash);
      if (at < 0) {
        return false;
      }
      const before = value.slice(0, at + dash.length);
      const after = value.slice(at + dash.length);
      const parent = node.parentNode;
      if (!parent || typeof parent.insertBefore !== "function") {
        return false;
      }
      const summary = notebookCreateEl(doc, "span", NOTEBOOK_SUMMARY_CLASS);
      if (!summary) {
        return false;
      }
      notebookSetText(summary, after);
      try {
        node.nodeValue = before;
      } catch (error) {
        try {
          node.textContent = before;
        } catch (inner) {
          return false;
        }
      }
      if (node.nextSibling) {
        parent.insertBefore(summary, node.nextSibling);
      } else if (typeof parent.appendChild === "function") {
        parent.appendChild(summary);
      }
      return true;
    }
    const children = Array.from(node.childNodes || []);
    for (const child of children) {
      if (visit(child)) {
        return true;
      }
    }
    return false;
  };
  return visit(li);
}

function notebookPaintRowChips(li, model, handlers, doc) {
  if (!li || !model) {
    return null;
  }
  notebookRemovePainted(li, NOTEBOOK_CHIP_CLASS);
  const parts = [];
  if (model.counts) {
    parts.push({ cls: NOTEBOOK_COUNT_CLASS, text: model.counts });
  }
  if (model.age) {
    parts.push({ cls: NOTEBOOK_AGE_CLASS, text: model.age });
  }
  if (model.addSummary) {
    parts.push({ cls: NOTEBOOK_ADD_CLASS, text: "add summary", action: "summary" });
  }
  if (parts.length === 0) {
    return null;
  }
  const host = notebookCreateEl(doc, "span", NOTEBOOK_CHIP_CLASS);
  if (!host) {
    return null;
  }
  try {
    if (typeof host.setAttribute === "function") {
      if (model.path) {
        host.setAttribute("data-notebook-path", model.path);
      }
      if (model.stem) {
        host.setAttribute("data-notebook-stem", model.stem);
      }
    }
  } catch (error) {
    // Identity attributes are best-effort.
  }
  for (const part of parts) {
    const tag = part.action ? "button" : "span";
    const el = notebookCreateEl(doc, tag, part.cls);
    if (!el) {
      continue;
    }
    notebookSetText(el, part.text);
    if (part.action === "summary" && handlers && typeof handlers.openSummary === "function") {
      try {
        if (typeof el.setAttribute === "function") {
          el.setAttribute("aria-label", "Add a summary to this notebook");
          el.setAttribute("title", "Open this notebook and edit its summary");
        }
      } catch (error) {
        // Labels are best-effort.
      }
      notebookBindAction(el, (event) => handlers.openSummary(model, event));
    }
    if (typeof host.appendChild === "function") {
      host.appendChild(el);
    }
  }
  if (typeof li.appendChild === "function") {
    li.appendChild(host);
  }
  return host;
}

function notebookPaintCallout(callout, options = {}) {
  if (!callout) {
    return false;
  }
  const doc = options.doc || notebookDomDoc(callout);
  const hue = options.hue || null;
  try {
    if (typeof callout.setAttribute === "function") {
      callout.setAttribute("class", `${notebookDomAttr(callout, "class") || "callout"} ${NOTEBOOK_CALLOUT_CLASS}`.trim());
      if (hue) {
        callout.setAttribute("data-root-hue", hue);
      } else if (typeof callout.removeAttribute === "function") {
        callout.removeAttribute("data-root-hue");
      }
    }
    if (callout.classList && typeof callout.classList.add === "function") {
      callout.classList.add(NOTEBOOK_CALLOUT_CLASS);
    }
  } catch (error) {
    // Callout chrome is best-effort.
  }
  let items = [];
  try {
    if (typeof callout.querySelectorAll === "function") {
      items = Array.from(callout.querySelectorAll("li") || []);
    }
  } catch (error) {
    items = [];
  }
  const report = options.report || null;
  const sourcePath = options.sourcePath || "";
  const today = options.today || "";
  const metadataCache = options.metadataCache || null;
  const vault = options.vault || null;
  const handlers = options.handlers || {};
  const chipsEnabled = options.chipsEnabled !== false;
  for (const li of items) {
    try {
      if (notebookLiIsProjectGroup(li)) {
        notebookRemovePainted(li, NOTEBOOK_CHIP_CLASS);
        continue;
      }
      const link = notebookLiOwnLink(li);
      if (!link) {
        continue;
      }
      const target = notebookLinkHref(link);
      const notebook = notebookLookupByTarget(report, target, sourcePath, metadataCache, vault);
      notebookMuteSummary(li, doc);
      if (!chipsEnabled || !notebook) {
        notebookRemovePainted(li, NOTEBOOK_CHIP_CLASS);
        continue;
      }
      notebookPaintRowChips(li, notebookRowModel(notebook, today), handlers, doc);
    } catch (error) {
      // One row never breaks the catalog.
    }
  }
  return true;
}

function notebookPaintSyncAction(host, model, handlers, doc) {
  if (!host || !model) {
    return null;
  }
  notebookRemovePainted(host, NOTEBOOK_SYNC_CLASS);
  const el = notebookCreateEl(doc, "button", NOTEBOOK_SYNC_CLASS);
  if (!el) {
    return null;
  }
  notebookSetText(el, model.label);
  try {
    if (typeof el.setAttribute === "function") {
      el.setAttribute("aria-label", model.hint);
      el.setAttribute("title", model.hint);
      el.setAttribute("data-catalog-state", model.state);
      if (model.busy) {
        el.setAttribute("aria-busy", "true");
        el.setAttribute("disabled", "true");
      }
    }
    el.disabled = Boolean(model.disabled);
  } catch (error) {
    // Sync chrome is best-effort.
  }
  if (handlers && typeof handlers.sync === "function") {
    notebookBindAction(el, (event) => {
      if (model.disabled) {
        return;
      }
      handlers.sync(event);
    });
  }
  if (typeof host.appendChild === "function") {
    host.appendChild(el);
  }
  return el;
}

function notebookCalloutSelector() {
  return '.callout[data-callout="notebooks"], .cm-callout[data-callout="notebooks"]';
}

function notebookFindCallouts(root) {
  const found = [];
  try {
    if (!root) {
      return found;
    }
    const matchesAttr = (node) =>
      notebookDomAttr(node, "data-callout") === "notebooks" &&
      (notebookDomHasClass(node, "callout") || notebookDomHasClass(node, "cm-callout") || notebookDomTag(node) === "DIV");
    if (matchesAttr(root)) {
      found.push(root);
    }
    if (typeof root.querySelectorAll === "function") {
      const nodes = Array.from(root.querySelectorAll(notebookCalloutSelector()) || []);
      for (const node of nodes) {
        if (found.indexOf(node) === -1) {
          found.push(node);
        }
      }
    }
  } catch (error) {
    return found;
  }
  return found;
}

function notebookInsideCode(node) {
  let current = node;
  let guard = 0;
  while (current && guard < 40) {
    guard += 1;
    const tag = notebookDomTag(current);
    if (tag === "PRE" || tag === "CODE") {
      return true;
    }
    if (notebookDomHasClass(current, "HyperMD-codeblock") || notebookDomHasClass(current, "cm-line") && notebookDomHasClass(current, "HyperMD-codeblock-bg")) {
      return true;
    }
    current = current.parentNode || current.parentElement || null;
  }
  return false;
}

function notebookHeadingIsNotebooks(head) {
  try {
    const text = String(head && head.textContent ? head.textContent : "").replace(/\s+/g, " ").trim();
    return /^Notebooks(?:\s.*)?$/i.test(text.replace(/\u21bb.*$/, "").trim());
  } catch (error) {
    return false;
  }
}

function notebookFindNotebooksHeading(root) {
  try {
    if (!root || typeof root.querySelectorAll !== "function") {
      return null;
    }
    const heads = Array.from(root.querySelectorAll("h2") || []);
    for (const head of heads) {
      if (notebookInsideCode(head)) {
        continue;
      }
      if (notebookHeadingIsNotebooks(head)) {
        return head;
      }
    }
  } catch (error) {
    return null;
  }
  return null;
}

function notebookFindHostTitle(root) {
  try {
    if (!root || typeof root.querySelectorAll !== "function") {
      return null;
    }
    const heads = Array.from(root.querySelectorAll("h1") || []);
    for (const head of heads) {
      if (!notebookInsideCode(head)) {
        return head;
      }
    }
  } catch (error) {
    return null;
  }
  return null;
}
