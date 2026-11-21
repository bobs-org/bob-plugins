// One read-only answer for keys, repeats, card rails, and the links footer.
function navGroupRole(text) {
  const label = String(text || "").trim();
  if (/^(?:«|<<)/.test(label)) return "prev";
  if (/^(?:»|>>)|(?:»|>>)$/.test(label)) return "next";
  return null;
}

function authoredNavGroups(plugin, content) {
  const roles = { prev: [], next: [] };
  const lines = String(content).split(/\r?\n/);
  let frontmatter = startsWithFrontmatter(lines);
  let fence = null;
  for (let i = frontmatter ? 1 : 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (frontmatter) {
      if (FRONTMATTER_DELIMITER_RE.test(line)) frontmatter = false;
      continue;
    }
    if (fence) {
      if (isClosingFence(line, fence)) fence = null;
      continue;
    }
    fence = getFenceOpening(line);
    if (fence) continue;
    // Consume the entire line: prose, embeds, and inline code fail closed.
    const links = [];
    let index = 0;
    while (index < line.length) {
      const separators = line.slice(index).match(/^[\s·•|/,–—-]+/);
      if (separators) index += separators[0].length;
      if (index === line.length) break;
      const link = line.startsWith("[[", index)
        ? plugin.parseWikiLinkAt?.(line, index)
        : line[index] === "[" ? plugin.parseMarkdownLinkAt?.(line, index) : null;
      if (!link || link.endIndex <= index) break;
      links.push(link);
      index = link.endIndex;
    }
    if (index !== line.length || !links.length) continue;
    for (const link of links) {
      const role = navGroupRole(link.renderedText);
      if (role) roles[role].push(link);
    }
  }
  return roles;
}

function navLinkStop(plugin, path, link, derived = null) {
  if (!link) return null;
  let candidate = null;
  try { candidate = plugin.toLineLinkCandidate(link, path, 0); } catch (_) { /* unavailable */ }
  const exists = Boolean(candidate?.actionKind === "open" && candidate.resolvedFile);
  let state = exists ? "exists" : derived?.state === "creatable" ? "creatable" : "ghost";
  let ghostReason = derived?.ghostReason || null;
  if (!derived && !exists && candidate?.actionKind === "create") state = "creatable";
  if (!exists && candidate?.creation && plugin.isAlbumFolderCreationTarget?.(candidate.creation)) {
    state = "ghost";
    ghostReason = "Record walk is catching up — ⟳ syncing";
  }
  if (!exists && state === "ghost" && !ghostReason) ghostReason = "Note is not in the vault";
  return Object.freeze({
    ...(derived || {}),
    text: String(link.renderedText || derived?.landingLabel || link.target || ""),
    target: String(link.target || ""),
    path: candidate?.path || derived?.path || null,
    exists, createEligible: state === "creatable", state, ghostReason,
    groupLabel: derived?.groupLabel || String(link.renderedText || "").replace(/^(?:«|<<|»|>>)\s*|\s*(?:»|>>)$/g, ""),
    landingLabel: derived?.landingLabel || String(link.renderedText || link.target || ""),
    shortLabel: derived?.shortLabel || String(link.renderedText || link.target || ""),
    wraps: derived?.wraps === true,
    source: derived?.source || "authored",
  });
}

function resolveNavLinks(plugin, { path, content }) {
  let provider = null;
  try {
    const api = plugin.app?.plugins?.plugins?.["bob-ledger-tools"]?.api?.navGroups;
    if (api?.version >= 1 && typeof api.resolve === "function") {
      const answer = api.resolve({ path, content });
      if (answer?.ok === true) provider = answer;
    }
  } catch (_) { /* Authored links work without the provider. */ }
  const derived = (stop) => stop ? navLinkStop(plugin, path, {
    target: stop.target, renderedText: stop.landingLabel || stop.shortLabel || stop.target,
  }, stop) : null;
  const step = (role) => {
    const link = plugin.findFirstRenderedLink(content, role);
    return link ? navLinkStop(plugin, path, link) : derived(provider?.step?.[role]);
  };
  const authored = authoredNavGroups(plugin, content);
  const conflicts = [];
  const groupStop = (role) => {
    const stops = new Map();
    for (const link of authored[role]) {
      const stop = navLinkStop(plugin, path, link);
      // Resolve note identity, retaining a distinct heading/block destination.
      const subpath = getLinkSubpath(stop.target) || "";
      stops.set(`${stop.path || stop.target}${subpath}`, stop);
    }
    if (stops.size > 1) { conflicts.push(role); return null; }
    return stops.size ? stops.values().next().value : derived(provider?.[`${role}Group`]);
  };
  const prevGroup = groupStop("prev");
  const nextGroup = groupStop("next");
  let groupNone = provider?.none || null;
  if (!provider && /^(?:\d{4}(?:\/\d{8}|\/\d{4}-(?:W\d{2}|Q[1-4]))?|all_time)\.md$/.test(path)) {
    groupNone = { reason: "unavailable", message: "Day and period groups need Bob Ledger Tools" };
  }
  return Object.freeze({
    ok: true, prev: step("prev"), next: step("next"), prevGroup, nextGroup,
    group: provider?.group || null, groupNone,
    groupConflict: conflicts[0] || null,
    groupConflicts: Object.freeze(conflicts),
  });
}

class BobNavigationHotkeysGroupLinksMixin {
  async openGroupLink(direction, options = {}) {
    if (!options.viaRepeat) this.rememberBracketRepeatType("n");
    const role = direction === "prev" || direction === -1 ? "prev" : "next";
    const context = await this.getActiveMarkdownContext();
    if (!context) return false;
    const snapshot = resolveNavLinks(this, { path: context.file.path, content: context.content });
    if (snapshot.groupConflicts.includes(role)) {
      new Notice(`Two ${role === "prev" ? "«" : "»"} links on nav lines — keep one`);
      return false;
    }
    const stop = snapshot[`${role}Group`];
    if (!stop) {
      new Notice(snapshot.groupNone?.message || `No ${role === "prev" ? "«" : "»"} link on a nav line here`);
      return false;
    }
    return this.openNavLinkStop(stop, context.file.path, role, { ...options, group: true });
  }

  async openNavLinkStop(stop, sourcePath, role, options = {}) {
    if (stop.state === "ghost") {
      new Notice(stop.ghostReason || "Note is not in the vault");
      return false;
    }
    if (options.viaRepeat && stop.state !== "exists") {
      const key = `${role === "prev" ? "[" : "]"}${options.group ? "N" : "n"}`;
      new Notice(`${stop.text} isn't created yet — press ${key} to create it`);
      return false;
    }
    let jump = null;
    try { jump = this.beginVimLinkJump(); } catch (_) { /* History is best effort. */ }
    const opened = await this.openOrCreateLinkTarget(stop.target, sourcePath, "Note not found", stop.text);
    if (opened && jump && stop.path) {
      try { await this.finishVimLinkJump(jump, stop.path); } catch (_) { /* Keep the open. */ }
    }
    return opened;
  }
}
