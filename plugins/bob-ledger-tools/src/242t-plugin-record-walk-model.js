// Pure read-only model for Bob-owned record walk lines. Membership and order
// come from Obsidian's immediate album-folder Markdown children; the stored
// links are cross-checked before a position is shown.
const RECORD_WALK_CAPABILITY = "record_walk_v1";
const RECORD_WALK_LABEL_DROP = new Set(["|", "[", "]", "#", "^"]);

function recordWalkPath(value) {
  const path = typeof value === "string"
    ? value
    : value && typeof value.path === "string" ? value.path : "";
  return String(path || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function recordWalkStem(path) {
  return recordWalkPath(path).split("/").pop().replace(/\.md$/i, "");
}

function recordWalkDirname(path) {
  const normalized = recordWalkPath(path);
  const slash = normalized.lastIndexOf("/");
  return slash < 0 ? "" : normalized.slice(0, slash);
}

function recordWalkHumanizeStem(stem) {
  let title = "";
  let lastSpace = true;
  for (const character of String(stem || "")) {
    if (/^[A-Za-z0-9]$/.test(character)) {
      title += character;
      lastSpace = false;
    } else if (!lastSpace) {
      title += " ";
      lastSpace = true;
    }
  }
  return title.trim();
}

function recordWalkCompareCodePoints(left, right) {
  const a = Array.from(String(left));
  const b = Array.from(String(right));
  const count = Math.min(a.length, b.length);
  for (let index = 0; index < count; index += 1) {
    const delta = a[index].codePointAt(0) - b[index].codePointAt(0);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

function recordWalkOrder(records) {
  const rows = Array.isArray(records) ? records.slice() : [];
  return rows.sort((left, right) => {
    const titleOrder = recordWalkCompareCodePoints(
      recordWalkMemberTitle(left).toLowerCase(),
      recordWalkMemberTitle(right).toLowerCase(),
    );
    return titleOrder || recordWalkCompareCodePoints(left?.path || "", right?.path || "");
  });
}

function recordWalkInertText(value) {
  const collapsed = String(value || "").split(/\s+/).filter(Boolean).join(" ");
  const characters = Array.from(collapsed);
  let result = "";
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const previous = index > 0 ? characters[index - 1] : undefined;
    const next = characters[index + 1];
    let escape = "\\`*[]<>|^$~".includes(character);
    if (character === "_") {
      escape = !(previous && next && /[\p{L}\p{N}]/u.test(previous) && /[\p{L}\p{N}]/u.test(next));
    } else if (character === "#") {
      escape = (!previous || /\s/.test(previous)) && Boolean(next && !/\s/.test(next));
    } else if (character === "=" || character === "%") {
      escape = previous === character || next === character;
    } else if (character === ":") {
      escape = previous === ":";
    } else if (character === "&") {
      const rest = characters.slice(index + 1);
      let run = 0;
      while (run < rest.length && /[A-Za-z0-9#]/.test(rest[run])) run += 1;
      escape = run > 0 && rest[run] === ";";
    }
    if (escape) result += "\\";
    result += character;
  }
  return result;
}

function recordWalkSanitizeCandidate(value) {
  let cleaned = Array.from(String(value || ""))
    .filter((character) => !RECORD_WALK_LABEL_DROP.has(character))
    .join("")
    .trim();
  while (true) {
    const next = cleaned.replace(/^[‹<]+/, "").replace(/[›>]+$/, "").trim();
    if (next === cleaned) return cleaned;
    cleaned = next;
  }
}

function recordWalkLabel(title, stem) {
  const clean = recordWalkSanitizeCandidate(title);
  if (clean) return recordWalkInertText(clean);
  const humanized = recordWalkSanitizeCandidate(recordWalkHumanizeStem(stem));
  if (humanized) return recordWalkInertText(humanized);
  return recordWalkInertText(recordWalkSanitizeCandidate(stem));
}

function recordWalkMemberTitle(record) {
  const title = record && typeof record.title === "string" ? record.title.trim() : "";
  return title || recordWalkHumanizeStem(record && record.stem);
}

function recordWalkRenderLines(album, records) {
  const ordered = recordWalkOrder(records).map((record) => ({
    ...record,
    stem: String(record.stem || recordWalkStem(record.path)),
    title: recordWalkMemberTitle(record),
  }));
  const albumStem = String(album && album.stem || "");
  const albumLabel = recordWalkLabel(album && album.title, albumStem);
  return ordered.map((record, index) => {
    if (ordered.length < 2) return `[[${albumStem}|↑ ${albumLabel}]]`;
    const previous = ordered[(index + ordered.length - 1) % ordered.length];
    const next = ordered[(index + 1) % ordered.length];
    return `[[${albumStem}/${previous.stem}|‹ ${recordWalkLabel(previous.title, previous.stem)}]] · [[${albumStem}|↑ ${albumLabel}]] · [[${albumStem}/${next.stem}|${recordWalkLabel(next.title, next.stem)} ›]]`;
  });
}

function recordWalkFrontmatterClose(lines) {
  const first = String(lines[0] || "").replace(/^\uFEFF/, "");
  if (first.trimEnd() !== "---") return null;
  for (let index = 1; index < lines.length; index += 1) {
    if (String(lines[index]).trimEnd() === "---") return index;
  }
  return null;
}

function recordWalkFenceStart(line) {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(String(line));
  if (!match || (match[1][0] === "`" && match[2].includes("`"))) return null;
  return { character: match[1][0], length: match[1].length };
}

function recordWalkFenceEnd(line, fence) {
  if (!fence) return false;
  const match = /^ {0,3}(`+|~+)\s*$/.exec(String(line));
  return Boolean(match && match[1][0] === fence.character && match[1].length >= fence.length);
}

function recordWalkParseLinkInner(inner) {
  const pieces = String(inner).split("|");
  if (pieces.length > 2 || !pieces[0]) return null;
  const target = pieces[0];
  return {
    target,
    label: pieces.length === 2 ? pieces[1] : (target.split("/").pop() || target),
  };
}

function recordWalkAllowedTarget(target, albumStem) {
  const value = String(target || "").replace(/\.md$/, "");
  if (value === albumStem) return { root: true, stem: "" };
  const prefix = `${albumStem}/`;
  if (!value.startsWith(prefix)) return null;
  const stem = value.slice(prefix.length);
  return stem && !stem.includes("/") ? { root: false, stem } : null;
}

function recordWalkParseLinkRun(line, albumStem) {
  let remaining = String(line || "").trim();
  const links = [];
  while (remaining) {
    if (!remaining.startsWith("[[")) return null;
    const rest = remaining.slice(2);
    const close = rest.indexOf("]]");
    if (close < 0) return null;
    const inner = rest.slice(0, close);
    if (inner.includes("[[")) return null;
    const parsed = recordWalkParseLinkInner(inner);
    const allowed = parsed && recordWalkAllowedTarget(parsed.target, albumStem);
    if (!parsed || !allowed) return null;
    links.push({ ...parsed, ...allowed });
    if (links.length > 3) return null;
    remaining = rest.slice(close + 2).trimStart();
    if (!remaining) return links;
    if (!remaining.startsWith("·")) return null;
    remaining = remaining.slice(1).trimStart();
    if (!remaining) return null;
  }
  return null;
}

function recordWalkIsWalkLine(links) {
  if (!Array.isArray(links)) return false;
  let roots = 0;
  for (const link of links) {
    if (link.root) {
      roots += 1;
      if (!String(link.label || "").startsWith("↑")) return false;
    }
  }
  return roots === 1;
}

function recordWalkHasNavLikeLink(line, albumStem) {
  let remaining = String(line || "");
  while (true) {
    const open = remaining.indexOf("[[");
    if (open < 0) return false;
    const rest = remaining.slice(open + 2);
    const close = rest.indexOf("]]");
    if (close < 0) return false;
    const link = recordWalkParseLinkInner(rest.slice(0, close));
    const allowed = link && recordWalkAllowedTarget(link.target, albumStem);
    if (allowed?.root && String(link.label || "").startsWith("↑")) return true;
    remaining = rest.slice(close + 2);
  }
}

function recordWalkClassify(markdown, albumStem, canonical) {
  const lines = String(markdown == null ? "" : markdown).split(/\r?\n/);
  const frontmatterEnd = recordWalkFrontmatterClose(lines);
  const bodyStart = frontmatterEnd === null ? 0 : frontmatterEnd + 1;
  let fence = null;
  const walkLines = [];
  let navLike = false;
  for (let index = bodyStart; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      if (recordWalkFenceEnd(line, fence)) fence = null;
      continue;
    }
    fence = recordWalkFenceStart(line);
    if (fence) continue;
    const links = recordWalkParseLinkRun(line.trim(), albumStem);
    if (recordWalkIsWalkLine(links)) {
      walkLines.push({ index, line, links, rootIndex: links.findIndex((link) => link.root) });
    } else if (recordWalkHasNavLikeLink(line, albumStem)) {
      navLike = true;
    }
  }
  if (walkLines.length > 1) return { state: "damaged", reason: "duplicate_lines" };
  if (navLike) return { state: "damaged", reason: "extra_text" };
  if (frontmatterEnd === null) return { state: "damaged", reason: "no_frontmatter" };
  if (!walkLines.length) return { state: "missing", reason: null };
  const found = walkLines[0];
  const childrenBefore = found.links.slice(0, found.rootIndex).filter((link) => !link.root);
  const childrenAfter = found.links.slice(found.rootIndex + 1).filter((link) => !link.root);
  return {
    state: found.line === canonical ? "current" : "stale",
    reason: null,
    lineIndex: found.index,
    links: found.links,
    writtenPrev: childrenBefore.length ? childrenBefore[childrenBefore.length - 1] : null,
    writtenNext: childrenAfter.length ? childrenAfter[0] : null,
  };
}

function recordWalkCachedFrontmatter(file, metadataCache) {
  try {
    const value = metadataCache?.getFileCache?.(file)?.frontmatter;
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (_) {
    return {};
  }
}

function recordWalkTypeNames(value) {
  if (typeof albumTypeNames === "function") return albumTypeNames(value);
  const text = String(value || "").trim().replace(/^\[\[|\]\]$/g, "").replace(/\.md$/i, "");
  return text ? [text.toLowerCase()] : [];
}

function recordWalkIsType(frontmatter, name) {
  return recordWalkTypeNames(frontmatter && frontmatter.type).includes(name);
}

function recordWalkFileTitle(file, metadataCache, frontmatterOverride = null) {
  const frontmatter = frontmatterOverride || recordWalkCachedFrontmatter(file, metadataCache);
  const title = typeof frontmatter.title === "string" ? frontmatter.title.trim() : "";
  const stem = recordWalkStem(file && file.path);
  return title || recordWalkHumanizeStem(stem);
}

function recordWalkFiles(vault) {
  try {
    if (typeof vault?.getMarkdownFiles === "function") return vault.getMarkdownFiles() || [];
    if (typeof vault?.getFiles === "function") return (vault.getFiles() || []).filter((file) => /\.md$/i.test(file?.path || ""));
  } catch (_) {}
  return [];
}

function recordWalkReportAlbum(report, albumPath) {
  if (!report || !albumPath) return null;
  if (report.albumsByPath instanceof Map) return report.albumsByPath.get(albumPath) || null;
  return (Array.isArray(report.albums) ? report.albums : [])
    .find((album) => recordWalkPath(album?.path) === albumPath) || null;
}

function recordWalkModel(input = {}) {
  const path = recordWalkPath(input.path);
  if (!path || !/\.md$/i.test(path)) return null;
  const folder = recordWalkDirname(path);
  if (!folder || folder.includes("/")) return null;
  const albumPath = `${folder}.md`;
  let activeFile = null;
  let albumFile = null;
  try {
    activeFile = input.vault?.getAbstractFileByPath?.(path) || null;
    albumFile = input.vault?.getAbstractFileByPath?.(albumPath) || null;
  } catch (_) {}
  if (!activeFile || !albumFile) return null;
  const activeFrontmatter = input.frontmatter && typeof input.frontmatter === "object"
    ? input.frontmatter : recordWalkCachedFrontmatter(activeFile, input.metadataCache);
  const albumFrontmatter = recordWalkCachedFrontmatter(albumFile, input.metadataCache);
  if (!recordWalkIsType(activeFrontmatter, "record") || !recordWalkIsType(albumFrontmatter, "album")) return null;

  const members = recordWalkFiles(input.vault)
    .filter((file) => {
      const memberPath = recordWalkPath(file && file.path);
      return /\.md$/i.test(memberPath) && recordWalkDirname(memberPath) === folder;
    })
    .map((file) => {
      const memberPath = recordWalkPath(file.path);
      const override = memberPath === path ? activeFrontmatter : null;
      const stem = recordWalkStem(memberPath);
      return { path: memberPath, stem, title: recordWalkFileTitle(file, input.metadataCache, override) };
    });
  const ordered = recordWalkOrder(members);
  const positionIndex = ordered.findIndex((member) => member.path === path);
  if (positionIndex < 0 || ordered.length === 0) return null;
  const position = positionIndex + 1;
  const total = ordered.length;
  const albumReport = recordWalkReportAlbum(input.report, albumPath);
  const albumTitle = String(albumReport?.title || albumFrontmatter.title || recordWalkHumanizeStem(folder)).trim();
  const album = {
    stem: folder,
    path: albumPath,
    title: albumTitle || folder,
    emoji: albumReport?.emoji == null ? String(albumFrontmatter.emoji || "") : String(albumReport.emoji),
    hue: typeof notebookHostHueName === "function"
      ? notebookHostHueName(path, input.metadataCache, input.vault)
      : "",
  };
  const previous = total > 1 ? ordered[(positionIndex + total - 1) % total] : null;
  const next = total > 1 ? ordered[(positionIndex + 1) % total] : null;
  const slot = { path, stem: recordWalkStem(path), title: recordWalkFileTitle(activeFile, input.metadataCache, activeFrontmatter) };
  const slotIndex = ordered.findIndex((member) => member.path === path);
  const canonical = recordWalkRenderLines(album, ordered)[slotIndex];
  const sourceText = typeof input.sourceText === "string" ? input.sourceText : null;
  let classification = null;
  let state = "syncing";
  let reason = "source_unavailable";
  if (sourceText !== null) {
    classification = recordWalkClassify(sourceText, folder, canonical);
    if (classification.state === "missing") {
      state = "absent";
      reason = null;
    } else if (classification.state === "damaged") {
      state = "syncing";
      reason = classification.reason;
    } else {
      const writtenPrev = classification.writtenPrev;
      const writtenNext = classification.writtenNext;
      const matches = total === 1
        ? !writtenPrev && !writtenNext
        : writtenPrev?.stem === previous?.stem && writtenNext?.stem === next?.stem;
      state = matches ? "ok" : "syncing";
      reason = matches ? null : "neighbors_mismatch";
    }
  }
  return {
    state,
    reason,
    path,
    title: slot.title,
    albumPath,
    position,
    total,
    prev: previous ? { ...previous } : null,
    next: next ? { ...next } : null,
    writtenPrev: classification?.writtenPrev ? { stem: classification.writtenPrev.stem, target: classification.writtenPrev.target, label: classification.writtenPrev.label } : null,
    writtenNext: classification?.writtenNext ? { stem: classification.writtenNext.stem, target: classification.writtenNext.target, label: classification.writtenNext.label } : null,
    wrapsPrev: Boolean(previous && position === 1),
    wrapsNext: Boolean(next && position === total),
    album,
    lineState: classification?.state || null,
  };
}

function recordWalkClearSyncedEpisodes(plugin, reportState) {
  const episodes = plugin && plugin.recordWalkSyncEpisodes;
  const state = reportState || plugin?.albumReportState?.();
  const report = state?.report;
  if (!(episodes instanceof Map) || !report || state?.stale === true) return;
  for (const [albumPath, episode] of episodes) {
    const album = recordWalkReportAlbum(report, albumPath);
    const walkState = album?.walk?.state;
    if (!album || !["current", "empty"].includes(walkState)) continue;
    const generationAdvanced = Number(state.reportGeneration) > Number(episode.reportGeneration);
    const reportChanged = state.report !== episode.report;
    if (generationAdvanced || reportChanged) episodes.delete(albumPath);
  }
}

function recordWalkRequestSync(plugin, model) {
  if (!plugin || !model || model.state !== "syncing" || model.reason !== "neighbors_mismatch") return false;
  const state = typeof plugin.albumReportState === "function" ? plugin.albumReportState() : null;
  const report = state && state.report;
  const capabilities = Array.isArray(report?.capabilities) ? report.capabilities : [];
  if (!capabilities.includes(RECORD_WALK_CAPABILITY) || typeof plugin.albumScheduleSync !== "function") return false;
  const albumPath = recordWalkPath(model.albumPath || model.album?.path);
  if (!albumPath) return false;
  recordWalkClearSyncedEpisodes(plugin, state);
  if (!(plugin.recordWalkSyncEpisodes instanceof Map)) plugin.recordWalkSyncEpisodes = new Map();
  if (plugin.recordWalkSyncEpisodes.has(albumPath)) return false;
  plugin.recordWalkSyncEpisodes.set(albumPath, {
    reportGeneration: state.reportGeneration,
    report,
  });
  plugin.albumScheduleSync("record-walk-mismatch");
  return true;
}
