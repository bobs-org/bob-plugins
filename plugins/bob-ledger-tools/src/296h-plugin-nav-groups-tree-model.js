// Derived tree-note sibling rings and the outline-ordered parent tour for
// api.navGroups v1 (bob-cli-ra engine). Pure: no DOM, no app access, never
// throws, never writes, never spawns. Callers pass file lists, per-file
// caches, and a link resolver; every function returns frozen values or null.
//
// A note joins the walk when propertyCardNoteSpecies says area, project,
// notebook, or prose. A ring holds one type, one resolved parent path, and
// (for projects) one lane. Groups are the occupied parents in outline
// order: a pre-order traversal keyed by (kindRank, foldedLabel, path).

const NAV_GROUPS_TREE_KINDS = Object.freeze(["area", "project", "notebook", "prose"]);
const NAV_GROUPS_TREE_MAX_HOPS = 16;
const NAV_GROUPS_TREE_SENTINEL_AREA = "area.md";
const NAV_GROUPS_TREE_SENTINEL_PROJECT = "project.md";
const NAV_GROUPS_TREE_SINGULAR = Object.freeze({
  area: "area",
  project: "project",
  notebook: "notebook",
  prose: "prose note",
});
const NAV_GROUPS_TREE_PLURAL = Object.freeze({
  area: "areas",
  project: "projects",
  notebook: "notebooks",
  prose: "prose notes",
});
const NAV_GROUPS_TREE_INDEXING = Object.freeze({
  reason: "indexing",
  message: "Link walk is indexing",
});

function navGroupsTreeIsKind(kind) {
  return kind === "area" || kind === "project" || kind === "notebook" || kind === "prose";
}

function navGroupsTreeKindRank(kind) {
  if (kind === "area") return 0;
  if (kind === "project") return 1;
  if (kind === "notebook") return 2;
  if (kind === "prose") return 3;
  return 4;
}

function navGroupsTreeFolded(text) {
  try {
    return String(text == null ? "" : text).toLowerCase();
  } catch (_) {
    return "";
  }
}

function navGroupsTreeStem(path) {
  try {
    const text = String(path == null ? "" : path).replace(/\\/g, "/");
    const base = text.split("/").pop() || "";
    return base.replace(/\.md$/i, "");
  } catch (_) {
    return "";
  }
}

function navGroupsTreeHumanizeStem(stem) {
  try {
    if (typeof notebookCardHumanizeStem === "function") return notebookCardHumanizeStem(stem);
  } catch (_) {}
  try {
    return String(stem == null ? "" : stem).replace(/[^A-Za-z0-9]+/g, " ").trim();
  } catch (_) {
    return "";
  }
}

// Titles that provably survive propertyCardCleanInlineText unchanged:
// no wikilinks, no escapes, single internal spaces, no edge whitespace.
const NAV_GROUPS_TREE_PLAIN_TITLE_RE = /^[^\s[\\]+(?: [^\s[\\]+)*$/;

function navGroupsTreePlainTitle(text) {
  try {
    if (typeof text !== "string" || !text) return "";
    if (NAV_GROUPS_TREE_PLAIN_TITLE_RE.test(text)) return text;
  } catch (_) {}
  return "";
}

function navGroupsTreeFirstAlias(frontmatter) {
  try {
    const aliases = frontmatter && frontmatter.aliases;
    const list = Array.isArray(aliases) ? aliases : [aliases];
    let seen = false;
    let allPlain = true;
    let first = "";
    for (const value of list) {
      if (typeof value !== "string" || !value) continue;
      if (!seen) {
        seen = true;
        first = value;
      }
      if (!NAV_GROUPS_TREE_PLAIN_TITLE_RE.test(value)) {
        allPlain = false;
        break;
      }
    }
    if (seen && allPlain) return first;
    if (typeof propertyCardFirstAlias === "function") {
      const alias = propertyCardFirstAlias(frontmatter && frontmatter.aliases);
      if (alias) return String(alias).trim();
    }
  } catch (_) {}
  try {
    const aliases = frontmatter && frontmatter.aliases;
    if (typeof aliases === "string" && aliases.trim()) return aliases.trim();
    if (Array.isArray(aliases)) {
      for (const entry of aliases) {
        if (typeof entry === "string" && entry.trim()) return entry.trim();
      }
    }
  } catch (_) {}
  return "";
}

function navGroupsTreeSpecies(path, frontmatter, today) {
  try {
    if (typeof propertyCardNoteSpecies !== "function") return null;
    const kind = propertyCardNoteSpecies({ path, frontmatter: frontmatter || {}, today });
    return navGroupsTreeIsKind(kind) ? kind : null;
  } catch (_) {
    return null;
  }
}

// Fast membership with verdicts identical to navGroupsTreeSpecies,
// ordered to match propertyCardNoteSpecies (bank; exclusions; album;
// record; home; temporal; notebook; prose). The path-independent type
// work is memoized by the caller per distinct frontmatter type value; the
// temporal check runs only for notebook/prose-typed notes whose path could
// match a period pattern (every temporal match carries a 4-digit year).

function navGroupsTreeExcludedFast(path) {
  try {
    return navGroupsTreeExcludedFastNormalized(navGroupsNormalizePath(path));
  } catch (_) {
    return true;
  }
}

function navGroupsTreeExcludedFastNormalized(normalized) {
  try {
    const raw = String(normalized == null ? "" : normalized);
    if (!raw) return true;
    if (raw === "area.md" || raw === "project.md" || raw === "dash.md") return true;
    const head = raw.slice(0, 7).toLowerCase();
    if (head === "bank.md") return true;
    const segments = raw.split("/");
    for (const segment of segments) {
      if (!segment || segment === "." || segment === "..") continue;
      if (segment === "done") return true;
      break;
    }
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      if (
        segment === "_templates" || segment === "_conflicts"
        || segment === ".git" || segment === ".obsidian" || segment === "_generated"
      ) return true;
    }
  } catch (_) {
    return true;
  }
  return false;
}

// One pass over the raw vault path: canonical form (identical to
// navGroupsNormalizePath), the stem, and the exclusion verdict. The index
// build runs this once per file instead of three separate walks.
function navGroupsTreeScanPath(path) {
  try {
    let text = String(path == null ? "" : path);
    if (text.indexOf("\\") !== -1) text = text.split("\\").join("/");
    let start = 0;
    while (text.startsWith("./", start)) start += 2;
    while (text[start] === "/") start += 1;
    if (start > 0) text = text.slice(start);
    if (text.endsWith("/")) text = text.slice(0, -1);
    if (!text) return { normalized: "", stem: "", excluded: true };
    if (text.slice(-3).toLowerCase() !== ".md") text = text + ".md";
    const normalized = text;
    if (normalized === "area.md" || normalized === "project.md" || normalized === "dash.md") {
      return { normalized, stem: normalized.slice(0, -3), excluded: true };
    }
    if (normalized.length === 7 && normalized.toLowerCase() === "bank.md") {
      return { normalized, stem: normalized.slice(0, -3), excluded: true };
    }
    const segments = normalized.split("/");
    for (const segment of segments) {
      if (!segment || segment === "." || segment === "..") continue;
      if (segment === "done") {
        return { normalized, stem: segments[segments.length - 1].slice(0, -3), excluded: true };
      }
      break;
    }
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      if (
        segment === "_templates" || segment === "_conflicts"
        || segment === ".git" || segment === ".obsidian" || segment === "_generated"
      ) {
        return { normalized, stem: segments[segments.length - 1].slice(0, -3), excluded: true };
      }
    }
    return { normalized, stem: segments[segments.length - 1].slice(0, -3), excluded: false };
  } catch (_) {
    return { normalized: "", stem: "", excluded: true };
  }
}

function navGroupsTreeKindOfType(frontmatter) {
  try {
    const fm = frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter)
      ? frontmatter
      : {};
    if (typeof albumSchemaEntryKindOf === "function" && albumSchemaEntryKindOf(fm) === "album") {
      return "other";
    }
    if (
      typeof recordSheetIsCanonicalRecordType === "function"
      && recordSheetIsCanonicalRecordType(fm) === true
    ) {
      return "other";
    }
    if (typeof pomodoroHomeType === "function") {
      const home = pomodoroHomeType(fm);
      if (home === "area" || home === "project") return home;
    }
    if (typeof noteCardIsNotebookKind === "function" && noteCardIsNotebookKind(fm) === true) {
      return "notebook";
    }
    if (typeof noteCardIsProseKind === "function" && noteCardIsProseKind(fm) === true) {
      return "prose";
    }
  } catch (_) {}
  return "other";
}

function navGroupsTreeTypeKey(type) {
  try {
    if (type === undefined) return "u";
    if (typeof type === "string") return "s:" + type;
    return typeof type + ":" + JSON.stringify(type);
  } catch (_) {
    return null;
  }
}

function navGroupsTreeMemoizedKindOfType(memo, frontmatter) {
  try {
    const fm = frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter)
      ? frontmatter
      : {};
    if (memo && typeof memo.get === "function" && typeof memo.set === "function") {
      const key = navGroupsTreeTypeKey(fm.type);
      if (key !== null) {
        let kind = memo.get(key);
        if (kind === undefined) {
          kind = navGroupsTreeKindOfType(fm);
          memo.set(key, kind);
        }
        return kind;
      }
    }
  } catch (_) {}
  return navGroupsTreeKindOfType(frontmatter);
}

function navGroupsTreeCouldBeTemporal(path) {
  try {
    return /\d{4}/.test(String(path == null ? "" : path));
  } catch (_) {
    return true;
  }
}

function navGroupsTreeSpeciesFast(path, frontmatter, today, kindOfType) {
  try {
    return navGroupsTreeSpeciesFastNormalized(navGroupsNormalizePath(path), frontmatter, today, kindOfType);
  } catch (_) {
    return null;
  }
}

function navGroupsTreeKindOfScan(scan, frontmatter, today, kindOfType) {
  try {
    if (!scan || !scan.normalized || scan.excluded) return null;
    const fm = frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter)
      ? frontmatter
      : {};
    const classify = typeof kindOfType === "function"
      ? kindOfType(fm)
      : navGroupsTreeKindOfType(fm);
    if (
      classify !== "area" && classify !== "project"
      && classify !== "notebook" && classify !== "prose"
    ) return null;
    if (
      (classify === "notebook" || classify === "prose")
      && navGroupsTreeCouldBeTemporal(scan.normalized)
    ) {
      try {
        if (
          typeof intentionCardSubjectForPath === "function"
          && intentionCardSubjectForPath(scan.normalized, today)
        ) return null;
      } catch (_) {}
    }
    return classify;
  } catch (_) {
    return null;
  }
}

function navGroupsTreeSpeciesFastNormalized(normalized, frontmatter, today, kindOfType) {
  try {
    if (!normalized) return null;
    const scan = navGroupsTreeScanPath(normalized);
    if (!scan.normalized || scan.excluded) return null;
    return navGroupsTreeKindOfScan(scan, frontmatter, today, kindOfType);
  } catch (_) {
    return null;
  }
}

// Display label per the Order table: stem for areas and projects, the
// first H1 (then alias, then humanized stem) for notebooks, and the prose
// title parts (title, then alias, then stem) for prose.
function navGroupsTreeLabelFor(kind, path, frontmatter, fileCache, stem) {
  try {
    const fm = frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter)
      ? frontmatter
      : {};
    const noteStem = typeof stem === "string" ? stem : navGroupsTreeStem(path);
    if (kind === "notebook") {
      const headings = fileCache && Array.isArray(fileCache.headings) ? fileCache.headings : [];
      for (const entry of headings) {
        if (entry && entry.level === 1 && typeof entry.heading === "string" && entry.heading.trim()) {
          return entry.heading.trim();
        }
      }
      const alias = navGroupsTreeFirstAlias(fm);
      if (alias) return alias;
      return navGroupsTreeHumanizeStem(noteStem) || noteStem;
    }
    if (kind === "prose") {
      const plain = navGroupsTreePlainTitle(fm.title);
      if (plain) return plain;
      if (typeof proseNoteCardTitleParts === "function") {
        const parts = proseNoteCardTitleParts(fm, path);
        if (parts && typeof parts.text === "string" && parts.text.trim()) return parts.text.trim();
      } else {
        if (typeof fm.title === "string" && fm.title.trim()) return fm.title.trim();
        const alias = navGroupsTreeFirstAlias(fm);
        if (alias) return alias;
      }
      return noteStem;
    }
    return noteStem;
  } catch (_) {
    return navGroupsTreeStem(path);
  }
}

// Project lanes come from the metadata cache: the cache.blocks.prj line
// names a source line, and the listItems entry on that line carries the
// checkbox char. x, X, or - is closed; anything else (including a missing
// or unreadable ^prj) is open.
function navGroupsTreeLaneFromCache(fileCache) {
  try {
    const cache = fileCache && typeof fileCache === "object" ? fileCache : null;
    const blocks = cache && cache.blocks && typeof cache.blocks === "object" ? cache.blocks : null;
    if (!blocks || !Object.prototype.hasOwnProperty.call(blocks, "prj")) return "open";
    const block = blocks.prj;
    const start = block && block.position && block.position.start;
    if (!start || !Number.isInteger(start.line)) return "open";
    const items = Array.isArray(cache.listItems) ? cache.listItems : [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const itemStart = item.position && item.position.start;
      if (!itemStart || itemStart.line !== start.line) continue;
      const task = typeof item.task === "string" ? item.task : "";
      return task === "x" || task === "X" || task === "-" ? "closed" : "open";
    }
    return "open";
  } catch (_) {
    return "open";
  }
}

function navGroupsTreeNormalizeTargetFast(raw) {
  try {
    if (typeof raw !== "string") return null;
    const text = raw.trim();
    const match = /^\[\[([^\]]+)\]\]$/.exec(text);
    if (!match) return null;
    const inner = String(match[1] || "").split("|")[0].trim();
    const hash = inner.indexOf("#");
    let target = (hash === -1 ? inner : inner.slice(0, hash)).trim();
    if (/\.md$/i.test(target)) target = target.slice(0, -3);
    return target.trim() || "";
  } catch (_) {
    return null;
  }
}

function navGroupsTreeNormalizeTarget(raw) {
  try {
    const fast = navGroupsTreeNormalizeTargetFast(raw);
    if (typeof fast === "string" && fast) return fast;
    if (typeof raw === "string" && raw.trim()) return "";
    if (typeof homeCardParentTarget === "function") {
      const target = homeCardParentTarget(raw);
      if (typeof target === "string" && target.trim()) return target.trim();
    }
  } catch (_) {}
  try {
    if (typeof raw !== "string") return "";
    const match = /\[\[([^\]]+)\]\]/.exec(raw.trim());
    if (!match) return "";
    const inner = String(match[1] || "").split("|")[0] || "";
    const hash = inner.indexOf("#");
    let target = (hash === -1 ? inner : inner.slice(0, hash)).trim();
    if (/\.md$/i.test(target)) target = target.slice(0, -3);
    return target.trim();
  } catch (_) {
    return "";
  }
}

// Classify the raw frontmatter parent before resolution: missing (absent,
// blank, or a non-link scalar), list (any YAML sequence but Obsidian's
// nested `[["x"]]` parse of an unquoted scalar wikilink), or a target.
function navGroupsTreeClassifyParentRaw(raw) {
  try {
    if (raw === undefined || raw === null) return { status: "missing" };
    if (typeof raw === "string") {
      if (!raw.trim()) return { status: "missing" };
      const target = navGroupsTreeNormalizeTarget(raw);
      if (!target) return { status: "missing" };
      return { status: "target", target };
    }
    if (Array.isArray(raw)) {
      if (raw.length === 0) return { status: "missing" };
      if (
        raw.length === 1 && Array.isArray(raw[0]) && raw[0].length === 1
        && typeof raw[0][0] === "string"
      ) {
        const target = navGroupsTreeNormalizeTarget(raw);
        if (!target) return { status: "missing" };
        return { status: "target", target };
      }
      return { status: "list" };
    }
    return { status: "missing" };
  } catch (_) {
    return { status: "missing" };
  }
}

// Classify results repeat per vault (few distinct parent values across
// thousands of notes). The caller threads one map through a whole build;
// single-file callers omit it.
function navGroupsTreeClassifyParentMemo(raw, memo) {
  try {
    if (typeof raw === "string" && memo && typeof memo.get === "function" && typeof memo.set === "function") {
      let hit = memo.get(raw);
      if (hit === undefined) {
        hit = navGroupsTreeClassifyParentRaw(raw);
        memo.set(raw, hit);
      }
      return hit;
    }
  } catch (_) {}
  return navGroupsTreeClassifyParentRaw(raw);
}

function navGroupsTreeIsSentinelPath(path) {
  try {
    const normalized = navGroupsNormalizePath(path);
    return normalized === NAV_GROUPS_TREE_SENTINEL_AREA || normalized === NAV_GROUPS_TREE_SENTINEL_PROJECT;
  } catch (_) {
    return false;
  }
}

// One unresolved node per scanned file. Resolution, cycle detection, and
// ring/tour building run in later passes over the table. Pass a memoized
// kindOfType over many files; a single file can omit it.
function navGroupsTreeNodeFor(path, fileCache, today, kindOfType) {
  try {
    const scan = navGroupsTreeScanPath(path);
    if (!scan.normalized) return null;
    const normalized = scan.normalized;
    const cache = fileCache && typeof fileCache === "object" ? fileCache : {};
    const frontmatter = cache.frontmatter && typeof cache.frontmatter === "object" && !Array.isArray(cache.frontmatter)
      ? cache.frontmatter
      : {};
    const kind = navGroupsTreeKindOfScan(scan, frontmatter, today, kindOfType);
    const lane = kind === "project" ? navGroupsTreeLaneFromCache(cache) : null;
    const label = kind
      ? navGroupsTreeLabelFor(kind, normalized, frontmatter, cache, scan.stem)
      : scan.stem;
    let parentRaw = null;
    try {
      parentRaw = Object.prototype.hasOwnProperty.call(frontmatter, "parent")
        ? frontmatter.parent
        : undefined;
    } catch (_) {
      parentRaw = undefined;
    }
    return {
      path: normalized,
      kind,
      lane,
      label,
      folded: navGroupsTreeFolded(label),
      stem: scan.stem,
      parentRaw,
      parentStatus: "missing",
      parentTarget: "",
      parentPath: "",
      parentReason: "no-parent",
    };
  } catch (_) {
    return null;
  }
}

function navGroupsTreeProblemReason(status) {
  if (status === "missing") return "no-parent";
  if (status === "list") return "list-parent";
  if (status === "unresolved") return "unresolved-parent";
  if (status === "self" || status === "cycle") return status === "self" ? "self-parent" : "cycle";
  return null;
}

// Resolve every node's parent link against the vault. Identity is the
// resolved vault path; the root area.md and project.md type notes are
// sentinel group parents, never members and never navigable targets.
function navGroupsTreeResolveParents(nodes, resolveLink, classifyMemo) {
  try {
    const resolve = typeof resolveLink === "function" ? resolveLink : null;
    for (const node of nodes.values()) {
      try {
        const classified = navGroupsTreeClassifyParentMemo(node.parentRaw, classifyMemo);
        if (classified.status === "missing") {
          node.parentStatus = "missing";
          node.parentTarget = "";
          node.parentPath = "";
          node.parentReason = "no-parent";
          continue;
        }
        if (classified.status === "list") {
          node.parentStatus = "list";
          node.parentTarget = "";
          node.parentPath = "";
          node.parentReason = "list-parent";
          continue;
        }
        const target = classified.target;
        let resolved = "";
        try {
          resolved = resolve ? String(resolve(target, node.path) || "") : "";
        } catch (_) {
          resolved = "";
        }
        const normalized = resolved ? navGroupsNormalizePath(resolved) : "";
        if (!normalized) {
          node.parentStatus = "unresolved";
          node.parentTarget = target;
          node.parentPath = "";
          node.parentReason = "unresolved-parent";
          continue;
        }
        if (normalized.toLowerCase() === node.path.toLowerCase()) {
          node.parentStatus = "self";
          node.parentTarget = target;
          node.parentPath = normalized;
          node.parentReason = "self-parent";
          continue;
        }
        if (normalized === "area.md" || normalized === "project.md") {
          node.parentStatus = "sentinel";
          node.parentTarget = target;
          node.parentPath = normalized;
          node.parentReason = null;
          continue;
        }
        node.parentStatus = "ok";
        node.parentTarget = target;
        node.parentPath = normalized;
        node.parentReason = null;
      } catch (_) {
        node.parentStatus = "missing";
        node.parentTarget = "";
        node.parentPath = "";
        node.parentReason = "no-parent";
      }
    }
    // A parent chain that returns to the note itself within 16 hops is a
    // cycle. A cycle farther up the chain never suppresses the note's ring.
    // Walks read live table entries but verdicts apply afterwards, so
    // sibling verdicts never depend on table order: y and z flag each other
    // in the same pass.
    const cyclic = [];
    for (const node of nodes.values()) {
      try {
        if (!node.kind) continue;
        if (node.parentStatus !== "ok" || !node.parentPath) continue;
        const own = node.path.toLowerCase();
        const seen = new Set([own]);
        let current = node.parentPath;
        for (let hop = 0; hop < NAV_GROUPS_TREE_MAX_HOPS; hop += 1) {
          if (!current) break;
          const key = String(current).toLowerCase();
          if (key === own) {
            cyclic.push(node);
            break;
          }
          if (seen.has(key)) break;
          seen.add(key);
          const next = nodes.get(current);
          if (!next || next.parentStatus !== "ok" || !next.parentPath) break;
          current = next.parentPath;
        }
      } catch (_) {}
    }
    for (const node of cyclic) {
      try {
        node.parentStatus = "cycle";
        node.parentReason = "cycle";
      } catch (_) {}
    }
  } catch (_) {}
}

function navGroupsTreeLookup(nodes, path) {
  try {
    if (!nodes || typeof nodes.get !== "function") return null;
    const exact = nodes.get(path);
    if (exact) return exact;
    const lower = String(path || "").toLowerCase();
    for (const node of nodes.values()) {
      if (node && String(node.path || "").toLowerCase() === lower) return node;
    }
  } catch (_) {}
  return null;
}

function navGroupsTreeRingKey(kind, lane, parentPath) {
  return kind + "|" + (kind === "project" ? lane || "open" : "") + "|" + parentPath;
}

function navGroupsTreeUniverseKey(kind, lane) {
  return kind + "|" + (kind === "project" ? lane || "open" : "");
}

function navGroupsTreeCompareMembers(left, right) {
  try {
    const aFolded = left && typeof left.folded === "string" ? left.folded : "";
    const bFolded = right && typeof right.folded === "string" ? right.folded : "";
    if (aFolded < bFolded) return -1;
    if (aFolded > bFolded) return 1;
    const aPath = left && typeof left.path === "string" ? left.path : "";
    const bPath = right && typeof right.path === "string" ? right.path : "";
    if (aPath < bPath) return -1;
    if (aPath > bPath) return 1;
  } catch (_) {}
  return 0;
}

// Ring building: members sharing type, resolved parent, and lane, in
// catalog order (folded label, then path).
function navGroupsTreeBuildRings(nodes) {
  const rings = new Map();
  try {
    for (const node of nodes.values()) {
      try {
        if (!node || !node.kind) continue;
        if (node.parentStatus !== "ok" && node.parentStatus !== "sentinel") continue;
        const key = navGroupsTreeRingKey(node.kind, node.lane, node.parentPath);
        if (!rings.has(key)) rings.set(key, []);
        rings.get(key).push(node);
      } catch (_) {}
    }
    for (const ring of rings.values()) ring.sort(navGroupsTreeCompareMembers);
  } catch (_) {}
  return rings;
}

// Outline key for one occupied parent: the (kindRank, foldedLabel, path)
// list from its topmost reachable ancestor down to itself. Sentinels key
// empty and stop the walk, as do unresolved or list parents, repeats, and
// 16 hops.
function navGroupsTreeOutlineKeyFor(parentPath, nodes) {
  try {
    if (navGroupsTreeIsSentinelPath(parentPath)) return [];
    const parts = [];
    const seen = new Set();
    let current = parentPath;
    for (let hop = 0; hop < NAV_GROUPS_TREE_MAX_HOPS && current; hop += 1) {
      if (navGroupsTreeIsSentinelPath(current)) break;
      const key = String(current).toLowerCase();
      if (seen.has(key)) break;
      seen.add(key);
      const node = navGroupsTreeLookup(nodes, current);
      const kind = node && node.kind ? node.kind : "other";
      const folded = node && typeof node.folded === "string"
        ? node.folded
        : navGroupsTreeFolded(navGroupsTreeStem(current));
      parts.push([navGroupsTreeKindRank(kind), folded, current]);
      if (!node) break;
      if (node.parentStatus === "sentinel") break;
      if (node.parentStatus !== "ok" || !node.parentPath) break;
      current = node.parentPath;
    }
    parts.reverse();
    return parts;
  } catch (_) {
    return [];
  }
}

function navGroupsTreeCompareKeys(left, right) {
  try {
    const a = Array.isArray(left) ? left : [];
    const b = Array.isArray(right) ? right : [];
    const length = Math.min(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
      const x = a[index] || [];
      const y = b[index] || [];
      if (x[0] !== y[0]) return (x[0] || 0) - (y[0] || 0);
      if (x[1] < y[1]) return -1;
      if (x[1] > y[1]) return 1;
      if (x[2] < y[2]) return -1;
      if (x[2] > y[2]) return 1;
    }
    return a.length - b.length;
  } catch (_) {
    return 0;
  }
}

// Tour building: the occupied parents per kind (and lane) in outline
// order, each carrying its ring. Repeated ]N cycles this fixed ring.
function navGroupsTreeBuildTours(nodes, rings) {
  const tours = new Map();
  try {
    const byUniverse = new Map();
    for (const [ringKey, ring] of rings) {
      try {
        if (!Array.isArray(ring) || ring.length === 0) continue;
        const head = ring[0];
        const universe = navGroupsTreeUniverseKey(head.kind, head.lane);
        if (!byUniverse.has(universe)) byUniverse.set(universe, new Map());
        byUniverse.get(universe).set(head.parentPath, ring);
      } catch (_) {}
    }
    for (const [universe, families] of byUniverse) {
      try {
        const entries = [];
        for (const [parentPath, ring] of families) {
          entries.push({
            parentPath,
            key: navGroupsTreeOutlineKeyFor(parentPath, nodes),
            ring,
          });
        }
        entries.sort((left, right) => navGroupsTreeCompareKeys(left.key, right.key));
        tours.set(universe, entries);
      } catch (_) {}
    }
  } catch (_) {}
  return tours;
}

