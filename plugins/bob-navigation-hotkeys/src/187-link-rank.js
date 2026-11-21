// Prose `[[` link ranking (phase bob-cli-om.2 link-engine).
//
// Pure JS port of bob-cli's `capture_links` candidate ranking plus the
// `note_catalog::tiers` path tiers: ASCII-only match tiers (exact,
// prefix, word-boundary, acronym, substring), component order (alias,
// stem, path; prefix ties alias with stem), then path depth, inbound
// links, and normalized path order. Headings and blocks reuse the same
// note-level order, then the line ordinal. Notes arrive as plain objects
// so tests and the lazy LinkIndex share one code path:
//
//   {
//     path: "plans/sase_plan.md", tier: "living" | "archive" | "hidden",
//     insertTarget: "plans/sase_plan", stem: "sase_plan",
//     aliases: ["Old"], headings: [{ title, level, ordinal }],
//     blocks: [{ id, ordinal }], inbound: 5,
//   }
//
// `linkFieldAt` fields (fragment 186) drive the rank entry points; the
// result cap mirrors bob's `RESULT_LIMIT` (20). The plan text names 50,
// but bob truncates at 20, and the engine replays bob exactly.

const LINK_RESULT_LIMIT = 20;
const LINK_NEARBY_LIMIT = 8;

const LINK_EMPTY_MATCH_RANK = 9;

function linkAsciiLower(value) {
  return String(value).replace(/[A-Z]/g, (letter) =>
    String.fromCharCode(letter.charCodeAt(0) + 32),
  );
}

function linkCompareNormalized(left, right) {
  const loweredLeft = linkAsciiLower(left);
  const loweredRight = linkAsciiLower(right);
  if (loweredLeft < loweredRight) return -1;
  if (loweredLeft > loweredRight) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function linkEqualsNormalized(left, right) {
  return linkAsciiLower(left) === linkAsciiLower(right);
}

function linkPathDepth(path) {
  const matches = String(path).match(/\//g);
  return matches ? matches.length : 0;
}

// Rust's `words()`: split on anything that is not ASCII-alphanumeric or
// `_`, dropping empties.
function linkWords(value) {
  return String(value).split(/[^A-Za-z0-9_]+/).filter(Boolean);
}

function linkWordBoundaryMatch(value, query) {
  return linkWords(value).some((word) => word.startsWith(query));
}

function linkAcronym(value) {
  let result = "";
  for (const word of linkWords(value)) {
    const first = Array.from(word)[0];
    if (first !== undefined) result += first;
  }
  return result;
}

function linkTierOrder(tier) {
  if (tier === "living") return 0;
  if (tier === "archive") return 1;
  return 2;
}

function linkComponentRankForTier(component, tier) {
  if (tier === "prefix") {
    return component === "path" ? 1 : 0;
  }
  if (component === "alias") return 0;
  if (component === "stem") return 1;
  return 2;
}

function linkEmptyComponentRank(component) {
  if (component === "stem") return 0;
  if (component === "path") return 1;
  return 2;
}

function linkMatchKind(tier, component) {
  if (tier === "empty") return "empty";
  const tierName =
    tier === "word-boundary" ? "word_boundary" : tier;
  return `${tierName}_${component}`;
}

function linkMatchScore(query, value, component) {
  if (query === "") {
    return {
      tier: LINK_EMPTY_MATCH_RANK,
      component: linkEmptyComponentRank(component),
      value,
      kind: "empty",
    };
  }
  const loweredQuery = linkAsciiLower(query);
  const loweredValue = linkAsciiLower(value);
  let tier = null;
  if (loweredValue === loweredQuery) {
    tier = "exact";
  } else if (loweredValue.startsWith(loweredQuery)) {
    tier = "prefix";
  } else if (linkWordBoundaryMatch(loweredValue, loweredQuery)) {
    tier = "word-boundary";
  } else if (linkAcronym(loweredValue).startsWith(loweredQuery)) {
    tier = "acronym";
  } else if (loweredValue.includes(loweredQuery)) {
    tier = "substring";
  } else {
    return null;
  }
  return {
    tier: tier === "exact" ? 0 : tier === "prefix" ? 1 : tier === "word-boundary" ? 2 : tier === "acronym" ? 3 : 4,
    component: linkComponentRankForTier(component, tier),
    value,
    kind: linkMatchKind(tier, component),
  };
}

function linkCompareScoreRank(left, right) {
  if (left.tier !== right.tier) return left.tier - right.tier;
  return left.component - right.component;
}

function linkBestMatch(query, items) {
  let best = null;
  for (const item of items) {
    const score = linkMatchScore(query, item.value, item.component);
    if (!score) continue;
    if (
      !best ||
      linkCompareScoreRank(score, best) < 0 ||
      (linkCompareScoreRank(score, best) === 0 &&
        linkCompareNormalized(score.value, best.value) < 0)
    ) {
      best = score;
    }
  }
  return best;
}

function linkBestNoteMatch(note, query) {
  const items = [
    { value: note.stem, component: "stem" },
    { value: note.insertTarget, component: "path" },
    { value: note.path, component: "path" },
  ];
  for (const alias of note.aliases || []) {
    items.push({ value: alias, component: "alias" });
  }
  return linkBestMatch(query, items);
}

function linkIsAliasMatchKind(kind) {
  return (
    kind === "exact_alias" ||
    kind === "prefix_alias" ||
    kind === "word_boundary_alias" ||
    kind === "acronym_alias" ||
    kind === "substring_alias"
  );
}

function rankLinkNoteCandidates(field, notes) {
  const ranked = [];
  for (const note of notes) {
    const score = linkBestNoteMatch(note, field.query);
    if (score) ranked.push({ score, note });
  }
  ranked.sort((left, right) => {
    const tier = linkTierOrder(left.note.tier) - linkTierOrder(right.note.tier);
    if (tier !== 0) return tier;
    const score = linkCompareScoreRank(left.score, right.score);
    if (score !== 0) return score;
    const depth =
      linkPathDepth(left.note.path) - linkPathDepth(right.note.path);
    if (depth !== 0) return depth;
    if (left.note.inbound !== right.note.inbound) {
      return right.note.inbound - left.note.inbound;
    }
    return linkCompareNormalized(left.note.path, right.note.path);
  });
  return ranked.slice(0, LINK_RESULT_LIMIT).map(({ score, note }) => {
    const alias = linkIsAliasMatchKind(score.kind) ? score.value : null;
    let replacement = note.insertTarget;
    if (alias && !field.hasAuthoredAlias && !field.hasAuthoredSubpath) {
      replacement += `|${alias}`;
    }
    const text = linkReplacementText(field, replacement);
    return {
      replacement: text,
      cursorAfter: linkCursorAfter(field, text.length),
      path: note.path,
      name: note.stem,
      alias,
      matchKind: score.kind,
    };
  });
}

function linkNotesForScope(notes, field) {
  if (!field || field.scope === "vault") return notes.slice();
  return resolveLinkTarget(notes, field.target || "");
}

function rankLinkHeadingCandidates(field, notes) {
  if (field.targetKind !== "heading") return [];
  const ranked = [];
  for (const note of linkNotesForScope(notes, field)) {
    for (const heading of note.headings || []) {
      const score = linkBestMatch(field.query, [
        { value: heading.title, component: "stem" },
      ]);
      if (score) ranked.push({ score, note, heading });
    }
  }
  const vault = field.scope === "vault";
  ranked.sort((left, right) => {
    if (vault) {
      const tier =
        linkTierOrder(left.note.tier) - linkTierOrder(right.note.tier);
      if (tier !== 0) return tier;
    }
    const score = linkCompareScoreRank(left.score, right.score);
    if (score !== 0) return score;
    if (vault) {
      const depth =
        linkPathDepth(left.note.path) - linkPathDepth(right.note.path);
      if (depth !== 0) return depth;
      if (left.note.inbound !== right.note.inbound) {
        return right.note.inbound - left.note.inbound;
      }
    }
    const path = linkCompareNormalized(left.note.path, right.note.path);
    if (path !== 0) return path;
    return left.heading.ordinal - right.heading.ordinal;
  });
  return ranked.slice(0, LINK_RESULT_LIMIT).map(({ score, note, heading }) => {
    const replacement =
      field.scope === "vault"
        ? `${note.insertTarget}#${heading.title}`
        : heading.title;
    const text = linkReplacementText(field, replacement);
    return {
      replacement: text,
      cursorAfter: linkCursorAfter(field, text.length),
      path: note.path,
      name: note.stem,
      heading: heading.title,
      level: heading.level,
      matchKind: score.kind,
    };
  });
}

function rankLinkBlockCandidates(field, notes) {
  if (field.targetKind !== "block") return [];
  const ranked = [];
  for (const note of linkNotesForScope(notes, field)) {
    for (const block of note.blocks || []) {
      const score = linkBestMatch(field.query, [
        { value: block.id, component: "stem" },
      ]);
      if (score) ranked.push({ score, note, block });
    }
  }
  const vault = field.scope === "vault";
  ranked.sort((left, right) => {
    if (vault) {
      const tier =
        linkTierOrder(left.note.tier) - linkTierOrder(right.note.tier);
      if (tier !== 0) return tier;
    }
    const score = linkCompareScoreRank(left.score, right.score);
    if (score !== 0) return score;
    if (vault) {
      const depth =
        linkPathDepth(left.note.path) - linkPathDepth(right.note.path);
      if (depth !== 0) return depth;
      if (left.note.inbound !== right.note.inbound) {
        return right.note.inbound - left.note.inbound;
      }
    }
    const path = linkCompareNormalized(left.note.path, right.note.path);
    if (path !== 0) return path;
    return left.block.ordinal - right.block.ordinal;
  });
  return ranked.slice(0, LINK_RESULT_LIMIT).map(({ score, note, block }) => {
    const replacement =
      field.scope === "vault"
        ? `${note.insertTarget}#^${block.id}`
        : block.id;
    const text = linkReplacementText(field, replacement);
    return {
      replacement: text,
      cursorAfter: linkCursorAfter(field, text.length),
      path: note.path,
      name: note.stem,
      blockId: block.id,
      matchKind: score.kind,
    };
  });
}

function linkNormalizeTarget(target) {
  const cleaned = String(target || "").trim().replace(/\\/g, "/");
  return cleaned.endsWith(".md") ? cleaned.slice(0, -3) : cleaned;
}

// Mirror of `NoteIndex::resolve_target`: exact insert-target / path
// match first, then a unique stem, then a unique alias.
function resolveLinkTarget(notes, target) {
  const normalized = linkNormalizeTarget(target);
  if (normalized === "") return [];
  const exact = notes.filter(
    (note) =>
      linkEqualsNormalized(note.insertTarget, normalized) ||
      linkEqualsNormalized(note.path, normalized) ||
      linkEqualsNormalized(note.path, `${normalized}.md`),
  );
  if (exact.length > 0) return exact;
  if (normalized.includes("/")) return [];
  const stems = notes.filter((note) =>
    linkEqualsNormalized(note.stem, normalized),
  );
  if (stems.length === 1) return stems;
  const aliases = notes.filter((note) =>
    (note.aliases || []).some((alias) =>
      linkEqualsNormalized(alias, normalized),
    ),
  );
  if (aliases.length === 1) return aliases;
  return [];
}

// --- Path tiers: port of `note_catalog::tiers::path_tier`. ---

const LINK_ALWAYS_EXCLUDED_DIRECTORY_NAMES = new Set([
  ".bob",
  ".git",
  ".obsidian",
  "_conflicts",
  "_generated",
  "_templates",
]);

function linkIsExcludedDirectoryName(name) {
  return LINK_ALWAYS_EXCLUDED_DIRECTORY_NAMES.has(name);
}

function linkIsExcludedNotePath(path) {
  const components = String(path).split("/");
  return components
    .slice(0, -1)
    .some(
      (component) =>
        component.startsWith(".") ||
        linkIsExcludedDirectoryName(component),
    );
}

function linkPathStartsWith(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

function linkDaysInMonth(year, month) {
  if (month === 2) {
    const leap =
      (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function linkIsValidDate(year, month, day) {
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= linkDaysInMonth(year, month);
}

// Dated satellites (`YYYY/yyyymmdd_suffix.md`) read as archive, exactly
// like bob's `satellite_date_suffix`.
function linkIsSatellite(path) {
  const components = String(path).split("/");
  if (components.length !== 2) return false;
  const [yearComponent, file] = components;
  if (!/^\d{4}$/.test(yearComponent)) return false;
  if (!file.endsWith(".md")) return false;
  const stem = file.slice(0, -3);
  const match = /^(\d{8})_([A-Za-z]+)$/.exec(stem);
  if (!match) return false;
  if (!["habit", "done", "poms", "events"].includes(match[2])) {
    return false;
  }
  const year = Number(yearComponent);
  const month = Number(match[1].slice(4, 6));
  const day = Number(match[1].slice(6, 8));
  if (Number(match[1].slice(0, 4)) !== year) return false;
  return linkIsValidDate(year, month, day);
}

function classifyLinkTier(path, options) {
  const relative = String(path).replace(/\\/g, "/");
  const components = relative.split("/");
  const libraryRoots =
    (options && options.libraryRoots) || ["lib", "xlib"];
  const hasPdfSibling =
    (options && options.hasPdfSibling) || (() => false);
  const hiddenComponent = components.some((component, index) => {
    if (component.startsWith(".")) return true;
    return component.startsWith("_") && index + 1 < components.length;
  });
  if (
    hiddenComponent ||
    libraryRoots.some((root) => root && linkPathStartsWith(relative, root)) ||
    (relative.endsWith(".md") &&
      hasPdfSibling(
        relative.slice(0, -3).split("/").slice(0, -1).concat([
          `${relative.split("/").pop().slice(0, -3)}.pdf`,
        ]).join("/"),
      ))
  ) {
    return "hidden";
  }
  const first = components[0] || "";
  if (
    first === "done" ||
    ["old_lib", "ref_history", "lit_review"].includes(first) ||
    linkIsSatellite(relative)
  ) {
    return "archive";
  }
  return "living";
}

// --- Nearby list: prompt-only convenience for an empty `[[`. ---
//
// Not in the shared vectors. Order: parent notes first (through the
// host's parent-note resolver), then notes the source links to in vault
// order, then recent files. Deduplicated, never the source note, never
// archive or hidden, capped at 8.

function rankLinkNearbyNotes(index, options) {
  const settings = options || {};
  const sourcePath = settings.sourcePath || null;
  const byPath =
    index && index.byPath instanceof Map
      ? index.byPath
      : new Map((index || []).map((note) => [note.path, note]));
  const seen = new Set();
  const rows = [];
  const consider = (path, reason) => {
    if (!path || seen.has(path)) return;
    seen.add(path);
    if (path === sourcePath) return;
    const note = byPath.get(path);
    if (!note) return;
    if (note.tier !== "living") return;
    rows.push({ path: note.path, name: note.stem, reason });
  };
  for (const path of settings.parentPaths || []) {
    if (rows.length >= LINK_NEARBY_LIMIT) break;
    consider(path, "parent");
  }
  for (const path of settings.linkedPaths || []) {
    if (rows.length >= LINK_NEARBY_LIMIT) break;
    consider(path, "linked");
  }
  for (const path of settings.recentPaths || []) {
    if (rows.length >= LINK_NEARBY_LIMIT) break;
    consider(path, "recent");
  }
  return rows.slice(0, LINK_NEARBY_LIMIT);
}
