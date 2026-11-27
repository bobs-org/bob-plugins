// Read-only intention card DOM. Markdown remains the only stored source.
function intentionCardDomEl(doc, tag, className) {
  if (!doc || typeof doc.createElement !== "function") return null;
  const el = doc.createElement(tag);
  if (className) el.className = className;
  return el;
}

function intentionCardDomText(el, value) {
  if (el) el.textContent = String(value === null || value === undefined ? "" : value);
}

function intentionCardDateShort(value) {
  const parts = intentionCardDateParts(value);
  return parts ? intentionCardDayLabel(value, false) : "";
}

function intentionCardDomHover(plugin, node, target, sourcePath) {
  node.addEventListener?.("mouseover", (event) => {
    try {
      plugin.app?.workspace?.trigger?.("hover-link", {
        event,
        source: "bob-intention-card",
        hoverParent: node,
        targetEl: node,
        linktext: String(target || ""),
        sourcePath: String(sourcePath || ""),
      });
    } catch (_) {}
  });
}

function intentionCardDomOpen(plugin, target, sourcePath, event) {
  try {
    const path = String(target || "").replace(/\.md$/i, "");
    if (!path) return;
    // One link helper for every card link (modifiers pick tab or split).
    if (typeof plugin?.intentionCardOpenLink === "function") {
      plugin.intentionCardOpenLink(path, sourcePath || "", event);
      return;
    }
    plugin.app?.workspace?.openLinkText?.(path, sourcePath || "", Boolean(event?.ctrlKey || event?.metaKey || event?.shiftKey));
  } catch (_) {}
}

function intentionCardDomTargetExists(plugin, target, sourcePath) {
  const text = String(target || "").trim();
  const targetWithoutAlias = text.split("|")[0].trim();
  const [linkPath, fragment = ""] = targetWithoutAlias.split("#", 2);
  let file = null;
  try {
    if (typeof notebookResolveLinkFile === "function") {
      file = notebookResolveLinkFile(linkPath, sourcePath,
        typeof propertyCardSettledMetadataCache === "function"
          ? propertyCardSettledMetadataCache(plugin.app) : plugin.app?.metadataCache,
        plugin.app?.vault);
    }
  } catch (_) {}
  try {
    const metadataCache = typeof propertyCardSettledMetadataCache === "function"
      ? propertyCardSettledMetadataCache(plugin.app) : plugin.app?.metadataCache;
    const actual = metadataCache?.getFirstLinkpathDest?.(linkPath, sourcePath);
    if (actual?.path) file = actual;
  } catch (_) {}
  if (!file?.path) return { ok: false, reason: "missing-file" };
  let actualFile = null;
  try { actualFile = plugin.app?.vault?.getAbstractFileByPath?.(file.path); } catch (_) {}
  if (!actualFile) return { ok: false, reason: "missing-file" };
  if (!fragment) return { ok: true, file: actualFile };
  let cache = null;
  try {
    cache = typeof propertyCardSettledFileCache === "function"
      ? propertyCardSettledFileCache(plugin.app, actualFile)
      : plugin.app?.metadataCache?.getFileCache?.(actualFile);
  } catch (_) {}
  if (!cache) return { ok: true, file: actualFile };
  if (fragment.startsWith("^")) {
    const block = fragment.slice(1);
    if (!cache.blocks || !Object.prototype.hasOwnProperty.call(cache.blocks, block)) {
      return { ok: false, reason: "missing-block" };
    }
  } else if (Array.isArray(cache.headings)) {
    const found = cache.headings.some((heading) =>
      String(heading?.heading || "").trim().toLowerCase() === fragment.trim().toLowerCase());
    if (!found) return { ok: false, reason: "missing-heading" };
  } else {
    return { ok: false, reason: "missing-heading" };
  }
  return { ok: true, file: actualFile };
}

function intentionCardDomDecorateLinks(plugin, root, sourcePath) {
  for (const anchor of Array.from(root?.querySelectorAll?.("a.internal-link, a[data-href]") || [])) {
    const target = anchor.getAttribute?.("data-href") || anchor.getAttribute?.("href") || "";
    const resolution = intentionCardDomTargetExists(plugin, target, sourcePath);
    if (!resolution.ok) {
      anchor.classList?.add?.("is-unresolved");
      anchor.setAttribute?.("title", INTENTION_CARD_LINK_HINT);
      anchor.setAttribute?.("aria-label", `${anchor.textContent || target}. ${INTENTION_CARD_LINK_HINT}`);
      continue;
    }
    anchor.classList?.add?.("internal-link", "bob-intention-card-link");
    anchor.addEventListener?.("click", (event) => {
      event.preventDefault?.();
      intentionCardDomOpen(plugin, target, sourcePath, event);
    });
    intentionCardDomHover(plugin, anchor, target, sourcePath);
  }
}

// Marks the card's own Markdown containers: MarkdownRenderer runs every
// Reading post-processor on them with the note's sourcePath, and the card's
// host must not mistake them for a new Reading mount (a repaint loop).
const INTENTION_CARD_RENDER_ATTR = "data-bob-intention-render";

// Each card owns one render component that unloads with the card, so a
// repaint never leaks rendered children onto the plugin.
function intentionCardDomComponent(card, plugin) {
  if (!card) return plugin;
  if (card.bobIntentionRender) return card.bobIntentionRender;
  let component = plugin;
  try {
    if (typeof MarkdownRenderChild === "function") {
      component = new MarkdownRenderChild(card);
      component.load?.();
    }
  } catch (_) { component = plugin; }
  card.bobIntentionRender = component;
  return component;
}

function intentionCardDomRelease(card) {
  const component = card && card.bobIntentionRender;
  if (!component) return;
  card.bobIntentionRender = null;
  try {
    if (typeof MarkdownRenderChild === "function" && component instanceof MarkdownRenderChild) component.unload?.();
  } catch (_) {}
}

function intentionCardDomRender(plugin, parent, markdown, sourcePath, component = plugin) {
  if (!parent) return;
  const value = String(markdown === null || markdown === undefined ? "" : markdown);
  try { parent.setAttribute?.(INTENTION_CARD_RENDER_ATTR, "true"); } catch (_) {}
  if (typeof MarkdownRenderer !== "undefined" && typeof MarkdownRenderer?.render === "function") {
    try {
      const rendered = MarkdownRenderer.render(plugin.app, value, parent, sourcePath, component || plugin);
      Promise.resolve(rendered).then(() => intentionCardDomDecorateLinks(plugin, parent, sourcePath)).catch(() => {});
      return;
    } catch (_) {}
  }
  intentionCardDomText(parent, value);
}

function intentionCardDomLink(doc, plugin, target, label, sourcePath, className) {
  const anchor = intentionCardDomEl(doc, "a", `internal-link ${className || ""}`.trim());
  if (!anchor) return null;
  const path = String(target || "");
  anchor.setAttribute("href", path);
  anchor.setAttribute("data-href", path);
  intentionCardDomText(anchor, label || path);
  anchor.addEventListener?.("click", (event) => {
    event.preventDefault?.();
    intentionCardDomOpen(plugin, path, sourcePath, event);
  });
  intentionCardDomHover(plugin, anchor, path, sourcePath);
  const resolution = intentionCardDomTargetExists(plugin, path, sourcePath);
  if (!resolution.ok) {
    anchor.classList?.add?.("is-unresolved");
    anchor.setAttribute?.("title", INTENTION_CARD_LINK_HINT);
  }
  return anchor;
}

function intentionCardDomUnresolved(plugin, target, sourcePath) {
  try { return intentionCardDomTargetExists(plugin, target, sourcePath).ok !== true; } catch (_) { return true; }
}

function intentionCardDomOpenLink(plugin, target, sourcePath, event) {
  if (typeof plugin?.intentionCardOpenLink === "function") return plugin.intentionCardOpenLink(target, sourcePath, event);
  return intentionCardDomOpen(plugin, target, sourcePath, event);
}

// The kit title block (tile, kicker, title, pill, subtitle). A missing kit
// falls back to the old `DAY · <label>` kicker so a card is never titleless.
function intentionCardDomTitleBlock(model, plugin, doc, identity) {
  if (identity && typeof propertyCardBuildTitleBlock === "function") {
    const kicker = identity.kicker.map((part) => (part.target
      ? { ...part, unresolved: intentionCardDomUnresolved(plugin, part.target, model.path) }
      : part));
    const block = propertyCardBuildTitleBlock(doc, {
      kind: identity.kind, title: identity.title, kicker, pill: identity.pill, subtitle: identity.subtitle,
      tile: { band: identity.tile.band, value: identity.tile.value },
      onLink: (target, event) => intentionCardDomOpenLink(plugin, target, model.path, event),
    });
    if (block?.element) {
      for (const link of Array.from(block.kicker?.querySelectorAll?.("a[data-href]") || [])) {
        intentionCardDomHover(plugin, link, link.getAttribute?.("data-href") || "", model.path);
      }
      return block.element;
    }
  }
  const kicker = intentionCardDomEl(doc, "div", "bob-intention-card-kicker");
  intentionCardDomText(kicker, `${model.kind.toUpperCase()} · ${model.label}`);
  return kicker;
}

// One quiet dashed row on current and future subjects with no intentions. A
// native button, so Enter and Space work; it owns no Properties rows.
function intentionCardDomGhost(model, plugin, doc) {
  const ghost = intentionCardDomEl(doc, "button", "bob-intention-card-ghost");
  if (!ghost) return null;
  ghost.setAttribute("type", "button");
  ghost.setAttribute("aria-label", "Set intentions");
  const label = intentionCardDomEl(doc, "span", "bob-intention-card-ghost-label");
  intentionCardDomText(label, "＋ Set intentions");
  const keys = intentionCardDomEl(doc, "kbd", "bob-intention-card-ghost-keys");
  keys.setAttribute("aria-hidden", "true");
  intentionCardDomText(keys, "=");
  ghost.appendChild(label);
  ghost.appendChild(keys);
  // CodeMirror must never take the click (or the caret) from the button.
  ghost.addEventListener?.("mousedown", (event) => { event?.preventDefault?.(); });
  ghost.addEventListener?.("click", (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    try {
      if (typeof plugin?.intentionCardOpenGhost === "function") void plugin.intentionCardOpenGhost(model.path);
      else if (typeof plugin?.openIntentionCard === "function") void plugin.openIntentionCard({ filePath: model.path, initialStage: "add" });
    } catch (_) {}
  });
  return ghost;
}

// The docked rail: the written rail (a recognized nav line) or, without
// one, the derived step row (296ca), plus the group row on day, week, and
// quarter cards. Items, chips, and arms carry exists / creatable / ghost.
function intentionCardDomRail(model, plugin, doc) {
  if (typeof propertyCardBuildRail !== "function") return null;
  const navRail = model.navRail || null;
  const rail = model.rail || (navRail && typeof intentionCardDerivedRailItems === "function"
    ? intentionCardDerivedRailItems(navRail, model.subject) : null);
  const group = navRail && typeof intentionCardGroupRowSpec === "function"
    ? intentionCardGroupRowSpec(navRail, {
      onActivate: (direction, arm, event) => {
        if (typeof plugin?.intentionCardGroupActivate === "function") {
          void plugin.intentionCardGroupActivate(direction, arm, model.path, event);
        }
      },
    })
    : null;
  if (!rail && !group) return null;
  const mark = (item) => (item
    ? (item.state ? item : { ...item, unresolved: intentionCardDomUnresolved(plugin, item.target, model.path) })
    : null);
  const word = typeof propertyCardSpecies === "function" ? propertyCardSpecies(model.kind)?.word : "";
  const built = propertyCardBuildRail(doc, {
    prev: mark(rail?.prev), parent: mark(rail?.parent), next: mark(rail?.next),
    children: (rail?.children || []).map(mark),
    group,
    label: `${word || "Note"} navigation`,
    onNavigate: (direction, item, event) => {
      if (typeof plugin?.intentionCardRailActivate === "function") {
        void plugin.intentionCardRailActivate(direction, item, model.path, event);
      } else if (typeof plugin?.intentionCardRailNavigate === "function") {
        void plugin.intentionCardRailNavigate(direction, item, model.path, event);
      } else intentionCardDomOpenLink(plugin, item?.target, model.path, event);
    },
  });
  if (!built?.element) return null;
  const arms = [built.group?.arms?.prev, built.group?.arms?.next];
  for (const link of [built.items?.prev, built.items?.parent, built.items?.next, ...(built.children || []), ...arms]) {
    const target = link?.getAttribute?.("data-href") || "";
    if (link && target) intentionCardDomHover(plugin, link, target, model.path);
  }
  return built.element;
}

// The day or period card: kit title block, then the content bands (each
// behind its existing gate), the set-intentions ghost, the cabinet stack,
// and the rail docked as the card's floor.
function intentionCardBuildDom(model, plugin, doc) {
  if (!model || !doc) return null;
  const card = intentionCardDomEl(doc, "section", "bob-property-card bob-intention-card");
  if (!card) return null;
  card.setAttribute("data-intention-source", model.path);
  card.setAttribute("data-intention-state", model.subject?.state || "unknown");
  const identity = model.identity || (typeof intentionCardIdentity === "function" ? intentionCardIdentity(model.subject) : null);
  const applied = identity && typeof propertyCardApplyIdentity === "function"
    && propertyCardApplyIdentity(card, { kind: identity.kind, title: identity.title });
  if (!applied) {
    card.setAttribute("role", "group");
    const word = String(model.kind || "").charAt(0).toUpperCase() + String(model.kind || "").slice(1);
    card.setAttribute("aria-label", `${word}: ${identity?.title || model.label}`);
  }
  if (model.intentions.length === 1) card.classList.add("is-single-intention");
  const component = intentionCardDomComponent(card, plugin);

  const title = intentionCardDomTitleBlock(model, plugin, doc, identity);
  if (title) card.appendChild(title);

  if (model.parentIntentions.length && model.subject.parent) {
    const parent = intentionCardDomEl(doc, "div", "bob-intention-card-parent");
    const href = model.subject.parent.path.replace(/\.md$/i, "");
    parent.appendChild(intentionCardDomLink(doc, plugin, href, `↑ ${model.subject.parent.label}`, model.path, "bob-intention-card-parent-link"));
    const summary = intentionCardDomEl(doc, "div", "bob-intention-card-parent-intentions");
    intentionCardDomRender(plugin, summary, model.parentIntentions.join(" · "), model.path, component);
    parent.appendChild(summary);
    card.appendChild(parent);
  }

  if (model.intentions.length) {
    const intentionSection = intentionCardDomEl(doc, "div", "bob-intention-card-intentions");
    for (const [index, text] of model.intentions.entries()) {
      const row = intentionCardDomEl(doc, "div", "bob-intention-card-intention");
      const chip = intentionCardDomEl(doc, "span", "bob-intention-card-chip");
      chip.setAttribute("aria-hidden", "true");
      intentionCardDomText(chip, INTENTION_CARD_CHIPS[index]);
      const body = intentionCardDomEl(doc, "div", "bob-intention-card-intention-body");
      intentionCardDomRender(plugin, body, text, model.path, component);
      row.appendChild(chip);
      row.appendChild(body);
      intentionSection.appendChild(row);
    }
    card.appendChild(intentionSection);
  }

  if (model.summary) {
    const section = intentionCardDomEl(doc, "section", "bob-intention-card-band bob-intention-card-summary");
    const header = intentionCardDomEl(doc, "div", "bob-intention-card-band-heading");
    const heading = intentionCardDomEl(doc, "h2", "bob-intention-card-band-title");
    intentionCardDomText(heading, "SUMMARY");
    const provenance = intentionCardDomEl(doc, "span", `bob-intention-card-provenance is-${model.summaryState}`);
    intentionCardDomText(provenance, model.summaryState === "agent"
      ? `✦ agent${model.summaryDrafted ? ` · ${intentionCardDateShort(model.summaryDrafted)}` : ""}`
      : "✎ edited");
    header.appendChild(heading);
    header.appendChild(provenance);
    const body = intentionCardDomEl(doc, "div", "bob-intention-card-summary-body");
    intentionCardDomRender(plugin, body, model.summary, model.path, component);
    section.appendChild(header);
    section.appendChild(body);
    card.appendChild(section);
  }

  if (model.reflection) {
    const section = intentionCardDomEl(doc, "section", "bob-intention-card-band bob-intention-card-reflection");
    const heading = intentionCardDomEl(doc, "h2", "bob-intention-card-band-title");
    intentionCardDomText(heading, "REFLECTION");
    const quote = intentionCardDomEl(doc, "div", "bob-intention-card-quote");
    intentionCardDomRender(plugin, quote, model.reflection, model.path, component);
    section.appendChild(heading);
    section.appendChild(quote);
    card.appendChild(section);
  }

  if (model.missingBands) {
    const missing = intentionCardDomEl(doc, "div", "bob-intention-card-missing");
    const labels = [];
    if (model.missingBands.summary) labels.push("✦ summary pending");
    if (model.missingBands.reflection) labels.push("＋ reflection r");
    intentionCardDomText(missing, labels.join(" · "));
    card.appendChild(missing);
  }

  const ghost = (model.ghost === undefined ? intentionCardShowsGhost(model) : model.ghost)
    ? intentionCardDomGhost(model, plugin, doc) : null;
  if (ghost) card.appendChild(ghost);

  if (plugin && typeof plugin.intentionCardAppendFoot === "function") {
    try { plugin.intentionCardAppendFoot(card, model, doc); } catch (_) {}
  }
  const rail = intentionCardDomRail(model, plugin, doc);
  if (rail) {
    try {
      if (typeof propertyCardFloorDock === "function") propertyCardFloorDock(card, rail);
      else card.appendChild(rail);
    } catch (_) {
      try { card.appendChild(rail); } catch (__) {}
    }
  }
  return card;
}

// Body fallback for a note without an H1: the first rendered content section
// of the Reading sizer (the card is prepended inside it, since Obsidian's
// renderer owns the sizer's direct children). Header, frontmatter, pusher,
// footer, and empty sections never host it.
function intentionCardDomFirstSection(root) {
  const skip = ["mod-header", "mod-frontmatter", "markdown-preview-pusher", "mod-footer", "bob-property-card"];
  for (const child of Array.from(root?.children || [])) {
    if (!child || child.nodeType === 3) continue;
    if (skip.some((name) => child.classList?.contains?.(name))) continue;
    const kids = Array.from(child.children || []).filter((node) => node && node.nodeType !== 3);
    if (!kids.length && !String(child.textContent || "").trim()) continue;
    return child;
  }
  return null;
}

function intentionCardDomAnchor(root, subject, today) {
  if (!root || !subject) return null;
  let heading = null;
  try {
    if (typeof root.querySelectorAll === "function") {
      const headings = Array.from(root.querySelectorAll("h1") || []);
      heading = headings.find((node) => !node.closest?.(".markdown-embed, .internal-embed, .hover-popover")
        && (typeof propertyCardNodeBelongs !== "function" || propertyCardNodeBelongs(node, root))) || null;
    } else {
      heading = root.querySelector?.("h1") || null;
    }
  } catch (_) {}
  if (!heading) return null;
  // Reading view wraps each block in a section div under the sizer; walk the
  // section siblings so the card lands after the H1 and navigation blocks.
  let last = heading;
  try {
    while (last.parentElement && last.parentElement !== root && root.contains?.(last.parentElement)) last = last.parentElement;
  } catch (_) { last = heading; }
  let sibling = last.nextElementSibling;
  while (sibling) {
    const links = Array.from(sibling.querySelectorAll?.("a.internal-link, a[data-href]") || []);
    if (!links.length) break;
    let remainder = String(sibling.textContent || "");
    for (const link of links) {
      const label = String(link.textContent || "");
      const at = remainder.indexOf(label);
      if (at >= 0) remainder = remainder.slice(0, at) + remainder.slice(at + label.length);
    }
    if (!/^[\s·|,;]*$/.test(remainder)) break;
    const targets = links.map((link) => link.getAttribute?.("data-href") || link.getAttribute?.("href") || "");
    const subjects = targets.map((target) => intentionCardLinkSubject(target, today));
    const resolvedAsNav = subject.kind === "day"
      ? (targets.length === 2 && subjects[0]?.path === subject.previous?.path && subjects[1]?.path === subject.next?.path)
        || (targets.length === 3 && subjects[0]?.path === subject.previous?.path && subjects[1]?.path === subject.parent?.path && subjects[2]?.path === subject.next?.path)
      : subject.kind === "year"
        ? targets.length === 3 && subjects[0]?.path === subject.previous?.path && subjects[1]?.kind === "all" && subjects[2]?.path === subject.next?.path
        : targets.length === 3 && subjects[0]?.path === subject.previous?.path && subjects[1]?.path === subject.parent?.path && subjects[2]?.path === subject.next?.path;
    const resolvedAsChildren = intentionCardIsChildLinksLine(targets.map((target) => `[[${target}]]`).join(" · "), subject, today);
    if (!resolvedAsNav && !resolvedAsChildren) break;
    last = sibling;
    sibling = sibling.nextElementSibling;
  }
  return last;
}
