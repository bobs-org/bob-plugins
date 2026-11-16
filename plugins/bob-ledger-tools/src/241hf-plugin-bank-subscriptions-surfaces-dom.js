// Presentation-only subscription chrome. Painting never mutates note
// bytes; cleanup restores wrapped native index text.

const SUBSCRIPTION_HEADER_CLASS = "bob-subscription-header";
const SUBSCRIPTION_TIMELINE_CLASS = "bob-subscription-timeline";
const SUBSCRIPTION_FINDING_CLASS = "bob-subscription-finding";
const RECORDS_PRETTY_CLASS = "bob-records-pretty";
const RECORDS_NEXT_CLASS = "bob-records-next";
const RECORDS_NATIVE_CLASS = "bob-records-native";

function bankSubscriptionCreateEl(doc, tag, className, text) {
  const node = typeof notebookCreateEl === "function"
    ? notebookCreateEl(doc, tag, className)
    : (doc && typeof doc.createElement === "function" ? doc.createElement(tag) : null);
  if (!node) return null;
  if (className && typeof node.setAttribute === "function" && !node.getAttribute("class")) {
    node.setAttribute("class", className);
  }
  if (text !== undefined && typeof notebookSetText === "function") notebookSetText(node, text);
  else if (text !== undefined) node.textContent = String(text);
  return node;
}

function bankSubscriptionAppend(parent, tag, className, text) {
  const doc = typeof notebookDomDoc === "function" ? notebookDomDoc(parent) : (parent && parent.ownerDocument);
  const node = bankSubscriptionCreateEl(doc, tag, className, text);
  if (node && parent && typeof parent.appendChild === "function") parent.appendChild(node);
  return node;
}

function bankSubscriptionPaintTimeline(parent, dots) {
  const list = bankSubscriptionAppend(parent, "ol", SUBSCRIPTION_TIMELINE_CLASS);
  if (!list) return null;
  list.setAttribute("aria-label", "Charge timeline");
  for (const dot of Array.isArray(dots) ? dots : []) {
    const item = bankSubscriptionAppend(list, "li", `bob-subscription-dot bob-subscription-dot-${dot.kind}`);
    if (!item) continue;
    item.setAttribute("title", dot.title || dot.state || "");
    item.setAttribute("aria-label", dot.title || dot.state || "timeline bucket");
    if (dot.amber) item.setAttribute("data-amber", "true");
  }
  return list;
}

function bankSubscriptionPaintHeader(parent, model, options = {}) {
  if (!parent || !model || model.kind !== "header") return null;
  const header = bankSubscriptionAppend(parent, "section", SUBSCRIPTION_HEADER_CLASS);
  if (!header) return null;
  header.setAttribute("role", "region");
  header.setAttribute("aria-label", model.title ? `${model.title} subscription ledger` : "Subscription ledger");
  if (options.hue) header.setAttribute("data-root-hue", options.hue);
  if (options.sourcePath) header.setAttribute("data-subscription-source", options.sourcePath);
  if (model.factsText) {
    bankSubscriptionAppend(header, "div", "bob-subscription-header-facts", model.factsText);
  }
  if (model.timeline && model.timeline.length) bankSubscriptionPaintTimeline(header, model.timeline);
  if (model.finding) {
    const finding = bankSubscriptionAppend(header, "p", SUBSCRIPTION_FINDING_CLASS, model.finding);
    if (finding) finding.setAttribute("role", "status");
  }
  return header;
}

function bankSubscriptionPaintTeaching(parent) {
  const empty = typeof bankCardAppend === "function"
    ? bankCardAppend(parent, "div", { class: "bob-bank-teaching" })
    : bankSubscriptionAppend(parent, "div", "bob-bank-teaching");
  if (!empty) return null;
  if (typeof bankCardAppend === "function") {
    bankCardAppend(empty, "h2", {}, "Start with a subscriptions album");
    bankCardAppend(empty, "p", {}, "Create a subscriptions album with bob albums create, then capture records as Name @subscriptions/.");
    bankCardAppend(empty, "code", {}, "bob albums create");
  } else {
    bankSubscriptionAppend(empty, "h2", "", "Start with a subscriptions album");
    bankSubscriptionAppend(empty, "p", "", "Create a subscriptions album with bob albums create, then capture records as Name @subscriptions/.");
    bankSubscriptionAppend(empty, "code", "", "bob albums create");
  }
  return empty;
}

function bankSubscriptionPaintCard(parent, model) {
  if (!parent || !model) return null;
  if (model.kind === "teaching-empty") return bankSubscriptionPaintTeaching(parent);
  if (model.kind === "invalid") {
    if (typeof bankCardAppend === "function") {
      bankCardAppend(parent, "p", { class: "bob-bank-card-error", role: "alert" }, model.message);
    } else {
      bankSubscriptionAppend(parent, "p", "bob-bank-card-error", model.message);
    }
    return parent;
  }
  if (model.kind !== "card") return null;
  const header = typeof bankCardAppend === "function"
    ? bankCardAppend(parent, "header", { class: "bob-bank-card-header" })
    : bankSubscriptionAppend(parent, "header", "bob-bank-card-header");
  if (header) {
    if (typeof bankCardAppend === "function") bankCardAppend(header, "h2", {}, "Subscriptions");
    else bankSubscriptionAppend(header, "h2", "", "Subscriptions");
  }
  const summary = bankSubscriptionAppend(parent, "div", "bob-subscription-card-summary");
  if (summary) {
    const monthly = model.monthly ? `≈ ${model.monthly} a month` : "≈ — a month";
    const yearly = model.yearly ? `≈ ${model.yearly} a year` : "≈ — a year";
    bankSubscriptionAppend(summary, "div", "bob-subscription-card-totals", `${monthly} · ${yearly}`);
    const note = bankSubscriptionAppend(summary, "p", "bob-subscription-card-note", model.estimateNote);
    if (note) note.setAttribute("aria-label", "an estimate of commitments, not bank spend");
  }
  if (model.statuses && model.statuses.length) {
    const counts = bankSubscriptionAppend(parent, "div", "bob-subscription-card-statuses");
    for (const status of model.statuses) {
      const chip = bankSubscriptionAppend(counts, "span", `bob-subscription-status bob-subscription-status-${status.key}`);
      if (chip) {
        chip.textContent = `${status.label} · ${status.count}`;
      }
    }
  }
  if (model.bars && model.bars.length) {
    const chart = bankSubscriptionAppend(parent, "div", "bob-subscription-card-bars");
    if (chart) chart.setAttribute("aria-label", "Top subscriptions by monthly equivalent");
    for (const bar of model.bars) {
      const row = bankSubscriptionAppend(chart, "div", "bob-subscription-bar");
      if (!row) continue;
      bankSubscriptionAppend(row, "span", "bob-subscription-bar-label", bar.title);
      const track = bankSubscriptionAppend(row, "span", "bob-subscription-bar-track");
      const fill = bankSubscriptionAppend(track, "span", "bob-subscription-bar-fill");
      if (fill && fill.style) fill.style.width = `${Math.max(0, Math.min(1, bar.share || 0)) * 100}%`;
      bankSubscriptionAppend(row, "span", "bob-subscription-bar-amount", bar.amount || "");
    }
  }
  const findings = model.findingsCount === 1
    ? "1 finding — bob bank check"
    : model.findingsCount > 1
      ? `${model.findingsCount} findings — bob bank check`
      : "no findings";
  bankSubscriptionAppend(parent, "p", "bob-subscription-card-findings", findings);
  return parent;
}

function albumRecordsIsChromeNode(node) {
  if (typeof albumRecordsChromeNode === "function" && albumRecordsChromeNode(node)) return true;
  return notebookDomHasClass(node, RECORDS_PRETTY_CLASS)
    || notebookDomHasClass(node, RECORDS_NEXT_CLASS)
    || notebookDomHasClass(node, SUBSCRIPTION_HEADER_CLASS);
}

function albumRecordsWrapNativeNodes(li, nodes) {
  if (!li || !nodes || !nodes.length) return null;
  const existing = Array.from(li.childNodes || []).find((node) => notebookDomHasClass(node, RECORDS_NATIVE_CLASS));
  if (existing) return existing;
  const doc = typeof notebookDomDoc === "function" ? notebookDomDoc(li) : li.ownerDocument;
  const wrap = bankSubscriptionCreateEl(doc, "span", RECORDS_NATIVE_CLASS);
  if (!wrap) return null;
  const first = nodes[0];
  if (first && first.parentNode && typeof first.parentNode.insertBefore === "function") {
    first.parentNode.insertBefore(wrap, first);
  } else if (typeof li.insertBefore === "function") {
    li.insertBefore(wrap, li.firstChild || null);
  } else {
    li.appendChild(wrap);
  }
  for (const node of nodes) {
    if (node && node.parentNode === wrap) continue;
    wrap.appendChild(node);
  }
  return wrap;
}

function albumRecordsUnwrapNative(li) {
  const wrap = Array.from(li.childNodes || li.children || []).find((node) => (
    notebookDomHasClass(node, RECORDS_NATIVE_CLASS)
  ));
  if (!wrap || !wrap.parentNode) return;
  const parent = wrap.parentNode;
  const children = Array.from(wrap.childNodes || []);
  for (const child of children) parent.insertBefore(child, wrap);
  if (typeof wrap.remove === "function") wrap.remove();
  else parent.removeChild(wrap);
}

function albumPaintSubscriptionHeading(li, heading, report) {
  const pretty = bankSubscriptionPrettyHeading(heading && heading.label, report);
  if (!pretty) {
    albumRecordsUnwrapNative(li);
    notebookRemovePainted(li, RECORDS_PRETTY_CLASS);
    if (typeof albumSetAttr === "function") albumSetAttr(li, "data-bob-records-pretty", null);
    return;
  }
  const own = (typeof notebookLiOwnNodes === "function" ? notebookLiOwnNodes(li) : Array.from(li.childNodes || []))
    .filter((node) => !albumRecordsIsChromeNode(node) && notebookDomTag(node) !== "UL" && notebookDomTag(node) !== "OL");
  albumRecordsWrapNativeNodes(li, own);
  if (typeof albumSetAttr === "function") albumSetAttr(li, "data-bob-records-pretty", "true");
  const key = JSON.stringify({ pretty: pretty.pretty, count: heading.count });
  albumRecordsPlaceChrome(li, RECORDS_PRETTY_CLASS, key, (host) => {
    notebookSetText(host, `${pretty.pretty} · ${heading.count}`);
    host.setAttribute("aria-label", `${pretty.pretty}, ${heading.count} records`);
  }, true);
}

function albumRecordsFacetText(li) {
  const wrap = Array.from(li.childNodes || []).find((node) => notebookDomHasClass(node, RECORDS_NATIVE_CLASS));
  let text = "";
  const walk = (node) => {
    if (!node || albumRecordsIsChromeNode(node)) return;
    if (notebookDomTag(node) === "A") return;
    if (node.nodeType === 3) {
      text += typeof node.nodeValue === "string" ? node.nodeValue : String(node.textContent || "");
      return;
    }
    const tag = notebookDomTag(node);
    if (tag === "UL" || tag === "OL") return;
    for (const child of node.childNodes || []) walk(child);
  };
  if (wrap) {
    for (const child of wrap.childNodes || []) walk(child);
  } else {
    for (const child of (typeof notebookLiOwnNodes === "function" ? notebookLiOwnNodes(li) : [])) {
      if (notebookDomTag(child) === "A") continue;
      walk(child);
    }
  }
  return typeof albumRecordsNormalizeLabel === "function"
    ? albumRecordsNormalizeLabel(text) : text.trim();
}

function albumPaintSubscriptionRow(li, link, report, options) {
  const path = typeof notebookLinkHref === "function" ? notebookLinkHref(link) : (link && link.getAttribute && link.getAttribute("href"));
  const file = typeof albumRecordFile === "function"
    ? albumRecordFile(path, options && options.sourcePath, options && options.metadataCache, options && options.vault)
    : null;
  const recordPath = (file && file.path) || (typeof path === "string" && path.endsWith(".md") ? path : (path ? `${path}.md` : ""));
  const entry = bankSubscriptionEntryByPath(report, recordPath);
  const own = (typeof notebookLiOwnNodes === "function" ? notebookLiOwnNodes(li) : Array.from(li.childNodes || []))
    .filter((node) => !albumRecordsIsChromeNode(node) && notebookDomTag(node) !== "A" && notebookDomTag(node) !== "UL" && notebookDomTag(node) !== "OL");
  if (own.length) albumRecordsWrapNativeNodes(li, own);
  const facets = albumRecordsFacetText(li);
  const model = bankSubscriptionIndexRowModel(entry, facets);
  if (model.amountText) {
    if (typeof albumSetAttr === "function") albumSetAttr(li, "data-bob-records-pretty", "true");
    albumRecordsPlaceChrome(li, RECORDS_PRETTY_CLASS, model.amountText, (host) => {
      notebookSetText(host, model.amountText);
    });
  } else {
    notebookRemovePainted(li, RECORDS_PRETTY_CLASS);
  }
  if (model.nextText) {
    albumRecordsPlaceChrome(li, RECORDS_NEXT_CLASS, model.nextText, (host) => {
      notebookSetText(host, model.nextText);
      host.setAttribute("title", model.nextDate ? `Next expected ${model.nextDate}` : model.nextText);
    });
  } else {
    notebookRemovePainted(li, RECORDS_NEXT_CLASS);
  }
}

function albumPaintSubscriptionRecords(callout, options) {
  const report = options && options.subscriptionReport;
  if (!callout || !report || report.teaching_empty === true) return;
  for (const li of callout.querySelectorAll?.("li") || []) {
    const heading = typeof albumRecordsParseGroupHeading === "function"
      ? albumRecordsParseGroupHeading(li) : null;
    if (heading) {
      albumPaintSubscriptionHeading(li, heading, report);
      continue;
    }
    const link = typeof notebookLiOwnLink === "function" ? notebookLiOwnLink(li) : null;
    if (link) albumPaintSubscriptionRow(li, link, report, options);
  }
}

function albumCleanSubscriptionRecords(root) {
  notebookRemovePainted(root, RECORDS_PRETTY_CLASS);
  notebookRemovePainted(root, RECORDS_NEXT_CLASS);
  for (const li of root.querySelectorAll?.("li[data-bob-records-pretty], li") || []) {
    albumRecordsUnwrapNative(li);
    if (typeof albumSetAttr === "function") albumSetAttr(li, "data-bob-records-pretty", null);
    else li.removeAttribute?.("data-bob-records-pretty");
  }
}

function albumCleanSubscriptionHeader(root) {
  notebookRemovePainted(root, SUBSCRIPTION_HEADER_CLASS);
  for (const node of root.querySelectorAll?.(`section.${SUBSCRIPTION_HEADER_CLASS}, .${SUBSCRIPTION_HEADER_CLASS}`) || []) {
    if (typeof node.remove === "function") node.remove();
    else node.parentNode && node.parentNode.removeChild(node);
  }
}
