// --- Pomodoro home chips: pure mirror of bob-cli pomodoro homes -----------
// The shared Rust contract and vectors live in bob-cli. This mirror only
// resolves each dedicated Task Link to its current area/project home and
// derives the quiet label, chip, and area hue. It never writes note text.

const POMODORO_HOME_MAX_DEPTH = 16;
const POMODORO_HOME_SLOT_ORDER = [
  "blue",
  "orange",
  "aqua",
  "yellow",
  "magenta",
  "green",
  "violet",
  "red",
];
const POMODORO_HOME_HUES = {
  blue: { light: "#2a78d6", dark: "#3987e5" },
  orange: { light: "#eb6834", dark: "#d95926" },
  aqua: { light: "#1baf7a", dark: "#199e70" },
  yellow: { light: "#eda100", dark: "#c98500" },
  magenta: { light: "#e87ba4", dark: "#d55181" },
  green: { light: "#008300", dark: "#008300" },
  violet: { light: "#6250d6", dark: "#9085e9" },
  red: { light: "#e34948", dark: "#e66767" },
};

function pomodoroHomeStem(path) {
  const name = String(path || "").split("/").pop() || "";
  return name.replace(/\.md$/i, "");
}

function pomodoroHomeLinkTarget(value) {
  const text = String(value || "").trim();
  const match = /^\[\[([^\]]*)\]\]$/.exec(text);
  if (!match) {
    return "";
  }
  return pomodoroHomePathInner(match[1]);
}

function pomodoroHomePathInner(inner) {
  const raw = String(inner || "").split("|")[0].trim();
  const hash = raw.indexOf("#");
  let path = (hash === -1 ? raw : raw.slice(0, hash)).trim();
  if (/\.md$/i.test(path)) {
    path = path.slice(0, -3);
  }
  return path;
}

function pomodoroHomeFrontmatterScalar(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    if (value.length !== 1) {
      return "";
    }
    return pomodoroHomeFrontmatterScalar(value[0]);
  }
  return "";
}

function pomodoroHomeCollectStrings(value, into) {
  if (typeof value === "string") {
    const text = value.trim();
    if (text) {
      into.push(text);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      pomodoroHomeCollectStrings(item, into);
    }
  }
}

function pomodoroHomeTypeName(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    return "";
  }
  const linked = pomodoroHomeLinkTarget(text);
  if (linked) {
    return linked.toLowerCase();
  }
  return pomodoroHomePathInner(text.replace(/^\[+|\]+$/g, "")).toLowerCase();
}

function pomodoroHomeType(frontmatter) {
  if (!frontmatter || typeof frontmatter !== "object") {
    return "other";
  }
  const names = [];
  pomodoroHomeCollectStrings(frontmatter.type, names);
  const normalized = names.map(pomodoroHomeTypeName).filter(Boolean);
  if (normalized.includes("area")) {
    return "area";
  }
  if (normalized.includes("project")) {
    return "project";
  }
  return "other";
}

function pomodoroHomeParentTarget(raw) {
  if (raw == null) {
    return "";
  }
  if (Array.isArray(raw)) {
    // Obsidian parses the unquoted scalar `parent: [[dev]]` as `[ ["dev"] ]`.
    // A YAML sequence such as `parent: ["[[dev]]"]` is `["[[dev]]"]` and
    // does not satisfy Rust's scalar-wikilink parent contract.
    if (
      raw.length !== 1 ||
      !Array.isArray(raw[0]) ||
      raw[0].length !== 1 ||
      typeof raw[0][0] !== "string"
    ) {
      return "";
    }
    return pomodoroHomePathInner(raw[0][0]);
  }
  if (typeof raw !== "string") {
    return "";
  }
  // Quoted scalar wikilinks remain strings in Obsidian's parsed frontmatter.
  // Bare strings and single-item YAML sequences are not parent wikilinks.
  return pomodoroHomeLinkTarget(raw);
}

function pomodoroHomePercentages(weights) {
  const values = Array.isArray(weights) ? weights.map((weight) => Number(weight) || 0) : [];
  const total = values.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) {
    return values.map(() => 0);
  }
  const result = [];
  const remainders = [];
  let assigned = 0;
  values.forEach((weight, index) => {
    const numerator = weight * 100;
    const floor = Math.floor(numerator / total);
    result.push(floor);
    assigned += floor;
    remainders.push({ index, remainder: numerator % total });
  });
  remainders.sort((left, right) => {
    if (right.remainder !== left.remainder) {
      return right.remainder - left.remainder;
    }
    return left.index - right.index;
  });
  const leftover = Math.max(0, 100 - assigned);
  for (let index = 0; index < leftover && index < remainders.length; index += 1) {
    result[remainders[index].index] += 1;
  }
  return result;
}

function pomodoroHomeDisplayLabel(parts) {
  const ranked = (Array.isArray(parts) ? parts : []).slice().sort((left, right) => {
    const shareDelta = (right.share || 0) - (left.share || 0);
    if (shareDelta !== 0) {
      return shareDelta;
    }
    return (left._order || 0) - (right._order || 0);
  });
  const shown = ranked.slice(0, 2).map((part) => part.label);
  if (shown.length === 0) {
    return "";
  }
  return ranked.length > shown.length
    ? `${shown.join(" · ")} +${ranked.length - shown.length}`
    : shown.join(" · ");
}

function pomodoroHomeLineMinutes(line, timeRange) {
  const field = durationField(line);
  if (field) {
    const fieldMinutes = parseDurationMinutes(field.value);
    if (fieldMinutes !== null) {
      return fieldMinutes;
    }
  }
  return pomodoroHomeDuration(timeRange);
}

function pomodoroHomeCacheFor(file, metadataCache, vault) {
  try {
    if (!file || typeof file !== "object" || typeof file.path !== "string") {
      return null;
    }
    if (!metadataCache || typeof metadataCache.getFileCache !== "function") {
      return null;
    }
    let actual = file;
    if (vault && typeof vault.getAbstractFileByPath === "function") {
      actual = vault.getAbstractFileByPath(file.path);
    }
    if (!actual || typeof actual.path !== "string") {
      return null;
    }
    return metadataCache.getFileCache(actual) || null;
  } catch (error) {
    return null;
  }
}

function pomodoroHomeBlockLine(path, blockId, metadataCache, vault) {
  try {
    const id = String(blockId || "");
    if (!path || !id || !metadataCache) {
      return null;
    }
    let file = null;
    try {
      file = vault && typeof vault.getAbstractFileByPath === "function"
        ? vault.getAbstractFileByPath(path)
        : null;
    } catch (error) {
      file = null;
    }
    const cache = pomodoroHomeCacheFor(file || { path }, metadataCache, vault);
    const blocks = cache && cache.blocks && typeof cache.blocks === "object"
      ? cache.blocks
      : null;
    if (!blocks) {
      return null;
    }
    const block = Object.prototype.hasOwnProperty.call(blocks, id)
      ? blocks[id]
      : blocks[id.toLowerCase()];
    const start = block && block.position && block.position.start;
    return start && Number.isInteger(start.line) && start.line >= 0
      ? start.line + 1
      : null;
  } catch (error) {
    return null;
  }
}

function pomodoroHomeResolveFile(target, sourcePath, dailyPath, metadataCache, vault) {
  try {
    const name = String(target || "").trim();
    if (name === "") {
      if (vault && typeof vault.getAbstractFileByPath === "function") {
        return vault.getAbstractFileByPath(dailyPath) || { path: dailyPath };
      }
      return dailyPath ? { path: dailyPath } : null;
    }
    if (metadataCache && typeof metadataCache.getFirstLinkpathDest === "function") {
      const file = metadataCache.getFirstLinkpathDest(name, sourcePath || dailyPath);
      if (file && typeof file.path === "string") {
        return file;
      }
    }
    if (vault && typeof vault.getAbstractFileByPath === "function") {
      const exact = /\.md$/i.test(name) ? name : `${name}.md`;
      return vault.getAbstractFileByPath(exact) || null;
    }
  } catch (error) {
    return null;
  }
  return null;
}

function pomodoroHomeAmbiguousTarget(target, vault) {
  try {
    if (!vault || typeof vault.getMarkdownFiles !== "function") {
      return false;
    }
    const wanted = pomodoroHomeStem(target).toLowerCase();
    if (!wanted) {
      return false;
    }
    const matches = vault.getMarkdownFiles().filter((file) =>
      pomodoroHomeStem(file && file.path).toLowerCase() === wanted,
    );
    return matches.length > 1;
  } catch (error) {
    return false;
  }
}

function pomodoroHomePathEqual(left, right) {
  const a = String(left || "").replace(/\.md$/i, "").toLowerCase();
  const b = String(right || "").replace(/\.md$/i, "").toLowerCase();
  return a !== "" && a === b;
}

function pomodoroHomeFnv1a(stem) {
  let hash = 0x811c9dc5;
  const value = String(stem || "").toLowerCase();
  for (const character of value) {
    const point = character.codePointAt(0);
    const bytes = [];
    if (point <= 0x7f) {
      bytes.push(point);
    } else if (point <= 0x7ff) {
      bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
    } else if (point <= 0xffff) {
      bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
    } else {
      bytes.push(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 0x3f),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    }
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash >>> 0;
}

function pomodoroHomeWarning(warnings, seen, code, path, message) {
  const key = `${code}:${String(path || "")}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  warnings.push({ code, path: String(path || ""), message });
}

function pomodoroHomeHueForArea(areaFile, areaFrontmatter, warnings, seen) {
  const path = areaFile && typeof areaFile.path === "string" ? areaFile.path : "";
  const stem = pomodoroHomeStem(path);
  const configured = areaFrontmatter && areaFrontmatter.color;
  if (configured !== undefined && configured !== null && configured !== "") {
    if (typeof configured === "string") {
      const slot = configured.trim().toLowerCase();
      if (POMODORO_HOME_SLOT_ORDER.includes(slot)) {
        return slot;
      }
    }
    pomodoroHomeWarning(
      warnings,
      seen,
      "area_color_invalid",
      path,
      `Invalid area color on ${path}; using its deterministic fallback.`,
    );
  }
  return POMODORO_HOME_SLOT_ORDER[
    pomodoroHomeFnv1a(stem) % POMODORO_HOME_SLOT_ORDER.length
  ];
}

function pomodoroHomeReadFrontmatter(file, metadataCache, vault) {
  const cache = pomodoroHomeCacheFor(file, metadataCache, vault);
  const frontmatter =
    cache && cache.frontmatter && typeof cache.frontmatter === "object" && !Array.isArray(cache.frontmatter)
      ? cache.frontmatter
      : {};
  return { cache, frontmatter };
}

function pomodoroHomeResolve(target, dailyPath, metadataCache, vault, warnings, seen) {
  const first = pomodoroHomeResolveFile(target, dailyPath, dailyPath, metadataCache, vault);
  if (!first || typeof first.path !== "string") {
    return null;
  }
  const chain = [];
  const visited = new Set();
  let current = first;
  for (let depth = 0; current && depth < POMODORO_HOME_MAX_DEPTH; depth += 1) {
    const path = String(current.path || "");
    if (!path || visited.has(path.toLowerCase())) {
      break;
    }
    visited.add(path.toLowerCase());
    const { frontmatter } = pomodoroHomeReadFrontmatter(current, metadataCache, vault);
    const type = pomodoroHomeType(frontmatter);
    // Retired: a leftover `rollup:` key is silently ignored: no effect, no warning.
    chain.push({ file: current, path, frontmatter, type });
    const parentTarget = pomodoroHomeParentTarget(frontmatter.parent);
    if (!parentTarget || pomodoroHomePathEqual(parentTarget, path)) {
      break;
    }
    current = pomodoroHomeResolveFile(parentTarget, path, dailyPath, metadataCache, vault);
  }
  if (chain.length === 0) {
    return null;
  }
  const homeIndex = chain.findIndex((item) => item.type === "area" || item.type === "project");
  if (homeIndex === -1) {
    return null;
  }
  const areaIndexes = [];
  chain.forEach((item, index) => {
    if (item.type === "area") {
      areaIndexes.push(index);
    }
  });
  const topAreaIndex = areaIndexes.length > 0 ? areaIndexes[areaIndexes.length - 1] : -1;
  const topArea = topAreaIndex === -1 ? null : chain[topAreaIndex];
  const nearestAreaIndex = areaIndexes.length > 0 ? areaIndexes[0] : -1;
  const subarea =
    nearestAreaIndex !== -1 && nearestAreaIndex !== topAreaIndex
      ? chain[nearestAreaIndex].path
      : null;
  const home = chain[homeIndex];
  const hue = topArea
    ? pomodoroHomeHueForArea(topArea.file, topArea.frontmatter, warnings, seen)
    : null;
  return {
    key: home.path,
    label: pomodoroHomeStem(home.path).toLowerCase(),
    kind: home.type,
    area: topArea ? topArea.path : "@unfiled",
    area_label: topArea ? pomodoroHomeStem(topArea.path).toLowerCase() : "unfiled",
    subarea,
    hue,
    chain: chain.map((item) => item.path),
  };
}

function pomodoroHomeBucketPart(key, label, area, areaLabel, hue) {
  return {
    key,
    label,
    kind: "bucket",
    area,
    area_label: areaLabel,
    hue,
    subarea: null,
  };
}

function pomodoroHomeDuration(range) {
  const match = /^([0-9]{2}):?([0-9]{2})-([0-9]{2}):?([0-9]{2})$/.exec(
    String(range || ""),
  );
  if (!match) {
    return null;
  }
  const start = Number(match[1]) * 60 + Number(match[2]);
  let end = Number(match[3]) * 60 + Number(match[4]);
  if (end < start) {
    end += 24 * 60;
  }
  return end - start;
}

function pomodoroHomeLinkFromBody(body) {
  try {
    let text = String(body || "").trim();
    text = text.replace(/^(?:🍅\s*)+/, "");
    if (text.startsWith("~~") && text.endsWith("~~") && text.length >= 4) {
      text = text.slice(2, -2).trim();
    }
    const tokens = todayWikilinkTokens(text);
    if (tokens.length !== 1) {
      return null;
    }
    const token = tokens[0];
    if (token.start !== 0 || token.end !== text.length) {
      return null;
    }
    return { target: token.pathPart, blockId: token.blockId };
  } catch (error) {
    return null;
  }
}

function pomodoroHomeParseEntries(content) {
  try {
    const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
    const section = planSectionRange(lines);
    if (!section) {
      return [];
    }
    const fenced = planFencedLines(lines, section.start, section.end);
    const entries = [];
    for (let index = section.start; index <= section.end; index += 1) {
      if (fenced.has(index) || /^[ \t]/.test(String(lines[index] || ""))) {
        continue;
      }
      const parsed = planParseEntry(lines[index]);
      if (!parsed || parsed.state === "cancelled") {
        continue;
      }
      const leading = planLeadingRange(parsed.body);
      if (leading.length === null) {
        continue;
      }
      const name = planParseNameTail(parsed.body.slice(leading.length));
      const links = [];
      const range = [];
      for (let child = index + 1; child <= section.end; child += 1) {
        if (fenced.has(child)) {
          continue;
        }
        if (!todayIsSubBulletLine(lines[child])) {
          break;
        }
        range.push(child);
      }
      if (range.length > 0) {
        const childIndent = todayIndentLen(lines[range[0]]);
        for (const child of range) {
          if (todayIndentLen(lines[child]) !== childIndent) {
            continue;
          }
          const bullet = todayBulletBody(lines[child]);
          const link = bullet ? pomodoroHomeLinkFromBody(bullet.body) : null;
          if (link) {
            links.push(link);
          }
        }
      }
      entries.push({
        line: index,
        status: parsed.state,
        name: name || "",
        minutes: pomodoroHomeLineMinutes(lines[index], leading.timeRange),
        links,
      });
    }
    return entries;
  } catch (error) {
    return [];
  }
}

function pomodoroHomeTaskHome(link, file, dailyPath, metadataCache, vault, warnings, seen, taskLineForBlock, health, rootSeen) {
  const ownHome = pomodoroHomeResolve(
    file.path,
    dailyPath,
    metadataCache,
    vault,
    warnings,
    seen,
  );
  if (typeof taskLineForBlock !== "function") {
    return ownHome;
  }
  let line = null;
  try {
    line = taskLineForBlock(file.path, String(link.blockId || ""));
  } catch (error) {
    line = null;
  }
  if (typeof line !== "string") {
    return ownHome;
  }
  const root = rootMarkModel(line, {
    sourcePath: file.path,
    metadataCache,
    vault,
  });
  const seenRoots = rootSeen instanceof Set ? rootSeen : new Set();
  const rootKey = `${file.path.toLowerCase()}#${String(link.blockId || "").toLowerCase()}`;
  if (root && (root.state === "repair" || root.state === "rolls-up") && !seenRoots.has(rootKey)) {
    seenRoots.add(rootKey);
    if (health && root.state === "repair") {
      health.root_field_invalid = (Number(health.root_field_invalid) || 0) + 1;
    } else if (health && root.state === "rolls-up") {
      health.root_field_not_root = (Number(health.root_field_not_root) || 0) + 1;
    }
  }
  if (!root || root.state === "repair") {
    return ownHome;
  }
  const rootPath = root.targetPath;
  if (!rootPath) {
    return ownHome;
  }
  const rootedHome = pomodoroHomeResolve(
    rootPath,
    file.path,
    metadataCache,
    vault,
    warnings,
    seen,
  );
  return rootedHome && rootedHome.key !== "@unfiled" ? rootedHome : ownHome;
}

function pomodoroHomeShareParts(entry, dailyPath, metadataCache, vault, warnings, seen, health, taskLineForBlock, rootSeen) {
  const entryLinks = Array.isArray(entry.links) ? entry.links : [];
  const resolved = [];
  const distinct = new Set();
  for (const link of entryLinks) {
    const file = pomodoroHomeResolveFile(
      link.target,
      dailyPath,
      dailyPath,
      metadataCache,
      vault,
    );
    const path = file && typeof file.path === "string" ? file.path : null;
    const key = path ? `${path.toLowerCase()}#${String(link.blockId || "").toLowerCase()}` :
      `${String(link.target || "").toLowerCase()}#${String(link.blockId || "").toLowerCase()}`;
    if (distinct.has(key)) {
      continue;
    }
    distinct.add(key);
    const home = file
      ? pomodoroHomeTaskHome(
          link,
          file,
          dailyPath,
          metadataCache,
          vault,
          warnings,
          seen,
          taskLineForBlock,
          health,
          rootSeen,
        )
      : null;
    if (home && home.key !== "@unfiled") {
      resolved.push(home);
    } else {
      if (file) {
        if (health) {
          health.unfiled_links += 1;
        }
        pomodoroHomeWarning(warnings, seen, "unfiled_link", path, "Task Link has no area or project home.");
      } else {
        const ambiguous = pomodoroHomeAmbiguousTarget(link.target, vault);
        if (health) {
          health[ambiguous ? "ambiguous_links" : "unresolved_links"] += 1;
          health.unfiled_links += 1;
        }
        pomodoroHomeWarning(
          warnings,
          seen,
          ambiguous ? "ambiguous_link" : "unresolved_link",
          `${String(link.target || "")}#${String(link.blockId || "")}`,
          "Task Link could not be resolved.",
        );
      }
      resolved.push({
        key: "@unfiled",
        label: "unfiled",
        kind: "bucket",
        area: "@unfiled",
        area_label: "unfiled",
        subarea: null,
        hue: null,
      });
    }
  }
  if (resolved.length === 0) {
    if (entry.status === "completed") {
      const part = pomodoroHomeBucketPart("@unlinked", "unlinked", "@unlinked", "unlinked", null);
      return {
        kind: "unlinked",
        parts: [{ ...part, tasks: 0, minutes: Number.isInteger(entry.minutes) ? entry.minutes : 0, sourceOrder: 0 }],
        resolved,
      };
    }
    return { kind: "unlinked", parts: [], resolved };
  }
  const taskCount = resolved.length;
  const minutes = Number.isInteger(entry.minutes) ? entry.minutes : 0;
  const base = Math.floor(minutes / taskCount);
  const remainder = minutes % taskCount;
  const map = new Map();
  resolved.forEach((home, index) => {
    let part = map.get(home.key);
    if (!part) {
      part = { ...home, tasks: 0, minutes: 0, sourceOrder: index };
      map.set(home.key, part);
    }
    part.tasks += 1;
    part.minutes += base + (index === 0 ? remainder : 0);
  });
  return {
    kind: "work",
    parts: Array.from(map.values()),
    resolved,
  };
}

function pomodoroHomeSessionModel(entry, dailyPath, metadataCache, vault, warnings, seen, health, taskLineForBlock, rootSeen = new Set()) {
  const aggregate = pomodoroHomeShareParts(
    entry,
    dailyPath,
    metadataCache,
    vault,
    warnings,
    seen,
    health,
    taskLineForBlock,
    rootSeen,
  );
  const attributed = entry.status === "completed";
  const minutesKnown = attributed && Number.isInteger(entry.minutes);
  const parts = aggregate.parts.map((part, index) => ({
    key: part.key,
    label: part.label,
    kind: part.kind,
    area: part.area || "@unfiled",
    area_label: part.area_label || "unfiled",
    hue: part.hue || null,
    tasks: part.tasks,
    _order: Number.isInteger(part.sourceOrder) ? part.sourceOrder : index,
    ...(attributed ? { minutes: Number.isInteger(part.minutes) ? part.minutes : 0 } : {}),
  }));
  let weights = parts.map((part) => {
    if (minutesKnown) {
      return Number(part.minutes) || 0;
    }
    return Number(part.tasks) || 0;
  });
  if (weights.reduce((sum, weight) => sum + weight, 0) === 0) {
    weights = parts.map((part) => {
      const tasks = Number(part.tasks) || 0;
      return tasks > 0 ? tasks : 1;
    });
  }
  const shares = pomodoroHomePercentages(weights);
  parts.forEach((part, index) => {
    part.share = shares[index] || 0;
    part._order = Number.isInteger(part._order) ? part._order : index;
  });
  const label = aggregate.kind === "unlinked" ? "" : pomodoroHomeDisplayLabel(parts);
  let lead = null;
  if (parts.length > 0) {
    lead = parts.reduce((best, part) => {
      if (!best) {
        return part;
      }
      if ((part.tasks || 0) > (best.tasks || 0)) {
        return part;
      }
      if ((part.tasks || 0) === (best.tasks || 0) && (part._order || 0) < (best._order || 0)) {
        return part;
      }
      return best;
    }, null);
  }
  const chip = aggregate.kind === "unlinked" ? null : label || null;
  return {
    state: attributed ? "attributed" : "forecast",
    kind: aggregate.kind,
    label,
    chip,
    hue: lead ? lead.hue : null,
    parts: parts.map(({ _order, ...part }) => part),
    lead_home: lead ? lead.key : "@unlinked",
    tooltip: parts
      .filter((part) => part.tasks > 0)
      .map((part) => `${part.label} · ${part.tasks} ${part.tasks === 1 ? "task" : "tasks"}${attributed ? ` · ${part.minutes}m` : ""}`)
      .join("\n"),
  };
}

function pomodoroHomeModels(content, dailyPath, metadataCache, vault, taskLineForBlock) {
  const warnings = [];
  const warningKeys = new Set();
  const health = {
    unfiled_links: 0,
    ambiguous_links: 0,
    unresolved_links: 0,
    area_color_invalid: 0,
  };
  const rootSeen = new Set();
  const entries = pomodoroHomeParseEntries(content);
  const sessions = entries.map((entry) => ({
    line: entry.line,
    name: entry.name,
    ...pomodoroHomeSessionModel(entry, dailyPath, metadataCache, vault, warnings, warningKeys, health, taskLineForBlock, rootSeen),
  }));
  health.area_color_invalid = warnings.filter((item) => item.code === "area_color_invalid").length;
  return { entries: sessions, warnings, health };
}

function buildPomodoroHomeChipElement(doc, model) {
  try {
    if (!doc || typeof doc.createElement !== "function" || !model || !model.chip) {
      return null;
    }
    const chip = doc.createElement("span");
    chip.setAttribute("class", "bob-pomodoro-home-chip");
    chip.setAttribute("role", "img");
    chip.setAttribute("aria-label", `Pomodoro home: ${model.label}`);
    chip.setAttribute("data-home-state", model.state || "forecast");
    if (model.hue) {
      chip.setAttribute("data-home-hue", model.hue);
    }
    if (model.tooltip) {
      chip.setAttribute("title", model.tooltip);
    }
    const dot = doc.createElement("span");
    dot.setAttribute("class", "bob-pomodoro-home-dot");
    dot.setAttribute("aria-hidden", "true");
    const label = doc.createElement("span");
    label.setAttribute("class", "bob-pomodoro-home-label");
    label.textContent = model.chip;
    chip.appendChild(dot);
    chip.appendChild(label);
    return chip;
  } catch (error) {
    return null;
  }
}
