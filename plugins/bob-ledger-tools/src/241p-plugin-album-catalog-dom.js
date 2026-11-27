// Keyed, presentation-only DOM. Keeping unchanged buttons alive preserves
// focus/hover through service notifications and editor selection updates.
const ALBUM_CHIPS = "bob-album-chips";
const ALBUM_STATUS = "bob-album-status";

// Reading postprocessors can run on detached subsections of Tasks, Dataview,
// embeds, and hover previews. Those surfaces never own a standalone catalog
// anchor, even when the postprocessor later attaches its element elsewhere.
const NOTEBOOK_CATALOG_ANCHOR_EXCLUSIONS = [
  ".callout", ".cm-callout", ".markdown-embed", ".internal-embed",
  ".hover-popover", ".popover", ".plugin-tasks-list-item", ".tasks-list-text",
  ".block-language-tasks", ".dataview", ".block-language-dataview",
  ".block-language-dataviewjs",
].join(",");

function notebookCatalogAnchorExcluded(node) {
  try { return Boolean(node?.closest?.(NOTEBOOK_CATALOG_ANCHOR_EXCLUSIONS)); }
  catch (_error) { return false; }
}

// Fragment renders (block embeds and hover previews) never own a standalone
// catalog anchor. Obsidian post-processes the embedded fragment on a detached
// section node, so `el.closest()` cannot see the live embed container: check
// `ctx.containerEl` too, and treat a section without the host's frontmatter
// as a fragment when the metadata cache says the host has frontmatter.
function notebookCatalogFragmentRender(el, ctx, sectionText, metadataCache) {
  try {
    if (notebookCatalogAnchorExcluded(el)) return true;
  } catch (_error) { /* exclusion is best-effort */ }
  try {
    const container = ctx && ctx.containerEl ? ctx.containerEl : null;
    if (container && notebookCatalogAnchorExcluded(container)) return true;
  } catch (_error) { /* container check is best-effort */ }
  try {
    const sourcePath = ctx && typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
    if (!sourcePath || !sectionText) return false;
    if (!metadataCache || typeof metadataCache.getCache !== "function") return false;
    let cache = null;
    try { cache = metadataCache.getCache(sourcePath); }
    catch (_error) { return false; }
    if (!cache) return false;
    const hasFrontmatter = Boolean(cache.frontmatterPosition || cache.frontmatter);
    if (!hasFrontmatter) return false;
    const lines = String(sectionText).split("\n");
    if (typeof notebookFrontmatterEnd === "function") {
      return notebookFrontmatterEnd(lines) === 0;
    }
    const first = lines.length > 0 ? String(lines[0]).replace(/^\uFEFF/, "") : "";
    return first !== "---";
  } catch (_error) {
    return false;
  }
}

function albumFindCallouts(root) {
  const selector = '[data-callout="albums"]';
  const nodes = Array.from(root?.querySelectorAll?.(selector) || []);
  if (notebookDomAttr(root, "data-callout") === "albums") nodes.unshift(root);
  return nodes.filter((node) => !notebookInsideCode(node));
}

function albumSetAttr(node, name, value) {
  if (value == null || value === false) node.removeAttribute?.(name);
  else if (node.getAttribute?.(name) !== String(value)) node.setAttribute?.(name, String(value));
}

function albumAppendText(doc, parent, tag, cls, text, hint) {
  const node = notebookCreateEl(doc, tag, cls);
  if (!node) return null;
  notebookSetText(node, text);
  if (hint) {
    node.setAttribute("title", hint);
    node.setAttribute("aria-label", hint);
    if (tag !== "button") node.setAttribute("tabindex", "0");
  }
  parent.appendChild(node);
  return node;
}

function albumReplaceChrome(host, cls, key, build) {
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
  host.appendChild(node);
  if (focus) {
    Array.from(node.querySelectorAll("[data-focus-key]")).find((item) => item.getAttribute("data-focus-key") === focus)?.focus?.({ preventScroll: true });
  }
  return node;
}

function albumPaintRow(li, model, handlers) {
  const key = model ? JSON.stringify(model) : "";
  albumReplaceChrome(li, ALBUM_CHIPS, key, (host, doc) => {
    host.setAttribute("data-album-path", model.path);
    albumAppendText(doc, host, "span", "bob-album-count", model.count);
    if (model.lead) {
      const hint = [`Open ${model.title}: ${model.lead.label}`, ...model.lead.peek].join("\n");
      const lead = albumAppendText(doc, host, "button", "bob-album-lead", model.lead.tally, hint);
      lead.setAttribute("data-focus-key", "lead");
      notebookBindAction(lead, (event) => handlers.openGroup(model.path, model.lead.value, event));
      lead.addEventListener("auxclick", (event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        event.stopPropagation();
        handlers.openGroup(model.path, model.lead.value, event);
      });
      // Native title + accessible name work on focus; the CSS peek also makes
      // all three titles visible without a tooltip delay. Text nodes only.
      const peek = albumAppendText(doc, lead, "span", "bob-album-peek", model.lead.peek.join("\n"));
      peek.setAttribute("aria-hidden", "true");
    }
    if (model.age) {
      const age = albumAppendText(doc, host, "span", "bob-album-age", model.age, `Last added: ${model.lastAdded}`);
      age.setAttribute("data-focus-key", "age");
    }
    if (model.health) {
      const health = albumAppendText(doc, host, "span", "bob-album-health", model.health.label, model.health.hint);
      health.setAttribute("data-focus-key", "health");
    }
  });
}

function albumPaintStatus(host, model, handlers) {
  return albumReplaceChrome(host, ALBUM_STATUS, model.message || model.action ? JSON.stringify(model) : "", (node, doc) => {
    node.setAttribute("role", "status");
    if (model.message) albumAppendText(doc, node, "span", "bob-album-status-hint", model.message);
    if (model.action) {
      const action = model.action;
      const button = albumAppendText(doc, node, "button", "bob-album-action", action.label, action.hint);
      button.setAttribute("data-focus-key", action.kind);
      button.disabled = Boolean(action.disabled);
      albumSetAttr(button, "aria-busy", action.disabled ? "true" : null);
      notebookBindAction(button, () => { if (!button.disabled) handlers[action.kind](); });
    }
  });
}

function albumPaintCallout(callout, options) {
  if (!options?.cabinetBody && propertyCardCabinetStandDown?.(callout, options?.view, options?.sourcePath, "albums")) return false;
  albumSetAttr(callout, "data-bob-album-card", "true");
  albumSetAttr(callout, "data-root-hue", options.hue);
  albumSetAttr(callout, "data-stale", options.state.stale ? "true" : null);
  for (const li of callout.querySelectorAll("li")) {
    const link = notebookLiOwnLink(li);
    const target = link ? notebookLinkHref(link) : "";
    const group = /^\s*🧩/u.test(notebookLiOwnText(li));
    const album = !group && target ? albumLookupByTarget(options.state.report, target,
      options.sourcePath, options.metadataCache, options.vault) : null;
    albumPaintRow(li, albumRowModel(album, options.state.today), options.handlers);
  }
  const title = callout.querySelector(".callout-title") || callout;
  const model = albumCatalogStatus(options.state, options.sourcePath);
  // An index can need repair even when its owner's path is qualified. Resolve
  // rows exactly as above rather than relying on owner display labels.
  if (!model.action && !options.state.syncBusy) {
    const repairable = Array.from(callout.querySelectorAll("li")).some((li) => {
      const link = notebookLiOwnLink(li);
      const album = link && albumLookupByTarget(options.state.report, notebookLinkHref(link),
        options.sourcePath, options.metadataCache, options.vault);
      return albumHealthModel(album)?.repairable;
    });
    if (repairable) model.action = { kind: "sync", label: "Sync albums", hint: "Refresh generated album catalogs and record indexes.", disabled: false };
  }
  albumPaintStatus(title, model, options.handlers);
}

function albumCleanCatalogDom(root) {
  notebookRemovePainted(root, ALBUM_CHIPS);
  notebookRemovePainted(root, ALBUM_STATUS);
  notebookRemovePainted(root, "bob-album-anchor");
  for (const callout of albumFindCallouts(root)) {
    if (notebookDomAttr(callout, "data-bob-album-card")) {
      for (const name of ["data-bob-album-card", "data-root-hue", "data-stale"]) callout.removeAttribute(name);
    }
  }
}
