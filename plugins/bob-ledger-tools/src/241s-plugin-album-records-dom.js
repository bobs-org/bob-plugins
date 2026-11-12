// Keyed, presentation-only records chrome. Fold choices live in view
// state; painting never mutates the note or hides rows after cleanup.
const ALBUM_RECORDS_FOLD = "bob-records-fold";
const ALBUM_RECORDS_AGES = "bob-records-ages";

function albumFindRecordCallouts(root) {
  const selector = '[data-callout="records"]';
  const nodes = Array.from(root?.querySelectorAll?.(selector) || []);
  if (notebookDomAttr(root, "data-callout") === "records") nodes.unshift(root);
  return nodes.filter((node) => !notebookInsideCode(node));
}

function albumRecordsPlaceChrome(host, cls, key, build, start) {
  const old = Array.from(host?.children || []).find((node) => notebookDomHasClass(node, cls));
  if (old && old.getAttribute("data-paint-key") === key) return old;
  const doc = notebookDomDoc(host);
  const focus = old && doc?.activeElement && old.contains?.(doc.activeElement)
    ? doc.activeElement.getAttribute("data-focus-key") : null;
  old?.remove();
  if (!key) return null;
  const node = notebookCreateEl(doc, "span", cls);
  if (!node) return null;
  node.setAttribute("data-paint-key", key);
  build(node, doc);
  if (start && host.firstChild) host.insertBefore(node, host.firstChild);
  else host.appendChild(node);
  if (focus) {
    Array.from(node.querySelectorAll("[data-focus-key]")).find((item) => item.getAttribute("data-focus-key") === focus)?.focus?.({ preventScroll: true });
  }
  return node;
}

function albumRecordsRootList(callout) {
  const content = callout.querySelector?.(".callout-content") || callout;
  for (const child of content.children || []) {
    const tag = notebookDomTag(child);
    if (tag === "UL" || tag === "OL") return child;
  }
  return null;
}

function albumRecordsTopGroups(callout) {
  const root = albumRecordsRootList(callout);
  if (!root) return [];
  const groups = [];
  for (const child of root.children || []) {
    if (notebookDomTag(child) !== "LI") continue;
    const heading = albumRecordsParseGroupHeading(child);
    if (heading) groups.push({ li: child, ...heading });
  }
  return groups;
}

function albumRecordsRecordRows(callout) {
  const rows = [];
  for (const li of callout.querySelectorAll?.("li") || []) {
    if (albumRecordsParseGroupHeading(li)) continue;
    const link = notebookLiOwnLink(li);
    if (link) rows.push({ li, link });
  }
  return rows;
}

function albumPaintRecordsFold(li, model, handlers) {
  albumRecordsPlaceChrome(li, ALBUM_RECORDS_FOLD, model.key, (host) => {
    host.setAttribute("data-focus-key", "fold");
    host.setAttribute("aria-expanded", model.folded ? "false" : "true");
    host.setAttribute("aria-label", model.folded
      ? `Expand ${model.label}, ${model.count} records`
      : `Collapse ${model.label}, ${model.count} records`);
    notebookSetText(host, model.folded ? "▸" : "▾");
    notebookBindAction(host, () => handlers.toggleFold(model.identity, !model.folded));
  }, true);
  albumSetAttr(li, "data-bob-records-folded", model.folded ? "true" : null);
  albumSetAttr(li, "data-bob-records-group", model.identity);
}

function albumPaintRecordAges(li, chips) {
  const key = chips.length ? JSON.stringify(chips) : "";
  albumRecordsPlaceChrome(li, ALBUM_RECORDS_AGES, key, (host, doc) => {
    for (const chip of chips) {
      const node = albumAppendText(doc, host, "span", `bob-records-age bob-records-age-${chip.kind}`, chip.age, chip.title);
      if (node) node.setAttribute("data-kind", chip.kind);
    }
  });
}

function albumPaintRecordsCallout(callout, options) {
  albumSetAttr(callout, "data-bob-records-card", "true");
  albumSetAttr(callout, "data-root-hue", options.hue);
  const groups = albumRecordsTopGroups(callout);
  groups.forEach((group, index) => {
    const identity = albumRecordsGroupIdentity(options.album, group.label, index);
    const folded = albumRecordsIsFolded(options.folds, options.sourcePath, identity, index, group.count);
    albumPaintRecordsFold(group.li, {
      key: JSON.stringify({ identity, folded, label: group.label, count: group.count }),
      identity,
      folded,
      label: group.label,
      count: group.count,
    }, options.handlers);
  });
  for (const row of albumRecordsRecordRows(callout)) {
    const file = albumRecordFile(notebookLinkHref(row.link), options.sourcePath, options.metadataCache, options.vault);
    const frontmatter = file ? albumRecordCachedFrontmatter(file, options.metadataCache) : {};
    albumPaintRecordAges(row.li, albumRecordsAgeChips(frontmatter, options.today));
  }
}

function albumCleanRecordsDom(root) {
  notebookRemovePainted(root, ALBUM_RECORDS_FOLD);
  notebookRemovePainted(root, ALBUM_RECORDS_AGES);
  for (const callout of albumFindRecordCallouts(root)) {
    if (notebookDomAttr(callout, "data-bob-records-card")) {
      for (const name of ["data-bob-records-card", "data-root-hue"]) callout.removeAttribute(name);
    }
  }
  for (const li of root.querySelectorAll?.("li[data-bob-records-folded], li[data-bob-records-group]") || []) {
    li.removeAttribute("data-bob-records-folded");
    li.removeAttribute("data-bob-records-group");
  }
}
