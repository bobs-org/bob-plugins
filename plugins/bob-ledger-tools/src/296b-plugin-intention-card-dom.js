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
      file = notebookResolveLinkFile(linkPath, sourcePath, plugin.app?.metadataCache, plugin.app?.vault);
    }
  } catch (_) {}
  try {
    const actual = plugin.app?.metadataCache?.getFirstLinkpathDest?.(linkPath, sourcePath);
    if (actual?.path) file = actual;
  } catch (_) {}
  if (!file?.path) return { ok: false, reason: "missing-file" };
  let actualFile = null;
  try { actualFile = plugin.app?.vault?.getAbstractFileByPath?.(file.path); } catch (_) {}
  if (!actualFile) return { ok: false, reason: "missing-file" };
  if (!fragment) return { ok: true, file: actualFile };
  let cache = null;
  try { cache = plugin.app?.metadataCache?.getFileCache?.(actualFile); } catch (_) {}
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

function intentionCardDomRender(plugin, parent, markdown, sourcePath) {
  if (!parent) return;
  const value = String(markdown === null || markdown === undefined ? "" : markdown);
  if (typeof MarkdownRenderer !== "undefined" && typeof MarkdownRenderer?.render === "function") {
    try {
      const rendered = MarkdownRenderer.render(plugin.app, value, parent, sourcePath, plugin);
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

function intentionCardBuildDom(model, plugin, doc) {
  if (!model || !doc) return null;
  const card = intentionCardDomEl(doc, "section", "bob-property-card bob-intention-card");
  if (!card) return null;
  card.setAttribute("data-intention-source", model.path);
  card.setAttribute("role", "group");
  card.setAttribute("aria-label", `${model.kind} intention card`);
  if (model.intentions.length === 1) card.classList.add("is-single-intention");

  const kicker = intentionCardDomEl(doc, "div", "bob-intention-card-kicker");
  intentionCardDomText(kicker, `${model.kind.toUpperCase()} · ${model.label}`);
  card.appendChild(kicker);

  if (model.parentIntentions.length && model.subject.parent) {
    const parent = intentionCardDomEl(doc, "div", "bob-intention-card-parent");
    const href = model.subject.parent.path.replace(/\.md$/i, "");
    parent.appendChild(intentionCardDomLink(doc, plugin, href, `↑ ${model.subject.parent.label}`, model.path, "bob-intention-card-parent-link"));
    const summary = intentionCardDomEl(doc, "div", "bob-intention-card-parent-intentions");
    intentionCardDomRender(plugin, summary, model.parentIntentions.join(" · "), model.path);
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
      intentionCardDomRender(plugin, body, text, model.path);
      row.appendChild(chip);
      row.appendChild(body);
      intentionSection.appendChild(row);
    }
    card.appendChild(intentionSection);
  }

  if (model.summary) {
    const section = intentionCardDomEl(doc, "section", "bob-intention-card-band bob-intention-card-summary");
    const header = intentionCardDomEl(doc, "div", "bob-intention-card-band-heading");
    const title = intentionCardDomEl(doc, "h2", "bob-intention-card-band-title");
    intentionCardDomText(title, "SUMMARY");
    const provenance = intentionCardDomEl(doc, "span", `bob-intention-card-provenance is-${model.summaryState}`);
    intentionCardDomText(provenance, model.summaryState === "agent"
      ? `✦ agent${model.summaryDrafted ? ` · ${intentionCardDateShort(model.summaryDrafted)}` : ""}`
      : "✎ edited");
    header.appendChild(title);
    header.appendChild(provenance);
    const body = intentionCardDomEl(doc, "div", "bob-intention-card-summary-body");
    intentionCardDomRender(plugin, body, model.summary, model.path);
    section.appendChild(header);
    section.appendChild(body);
    card.appendChild(section);
  }

  if (model.reflection) {
    const section = intentionCardDomEl(doc, "section", "bob-intention-card-band bob-intention-card-reflection");
    const title = intentionCardDomEl(doc, "h2", "bob-intention-card-band-title");
    intentionCardDomText(title, "REFLECTION");
    const quote = intentionCardDomEl(doc, "div", "bob-intention-card-quote");
    intentionCardDomRender(plugin, quote, model.reflection, model.path);
    section.appendChild(title);
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
  return card;
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
  let sibling = heading.nextElementSibling;
  let last = heading;
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
