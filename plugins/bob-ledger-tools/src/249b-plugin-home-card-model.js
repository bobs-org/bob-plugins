// Pure local Area/Project card model (bob-cli-pl.4.1 presentation).
// Inputs are frontmatter, confirmed source bytes, injected ancestry, Ready
// snapshots, and a clock. Never writes, never spawns bob, never throws.

const HOME_CARD_MAX_CRUMBS = 4;
const HOME_CARD_MAX_HOPS = 8;
const HOME_CARD_TYPE_NOTES = Object.freeze(["area.md", "project.md"]);
const HOME_CARD_MONTHS = Object.freeze([
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]);
const HOME_CARD_MANAGED_KEYS = Object.freeze(["done_tasks", "template", "scheduled", "task_count", "open_task_count"]);
const HOME_CARD_MISSING_PRJ = 'NO ^prj TASK · add "- [ ] #task #prj … ^prj" as the first line';
const HOME_CARD_ROOT_TOOLTIP = "Pomodoro time here reports under this project";
const HOME_CARD_READY_SCOPE = "Ready tasks living in this note";

function homeCardPath(value) {
  const path = typeof value === "string"
    ? value
    : value && typeof value.path === "string"
      ? value.path
      : "";
  return String(path || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function homeCardStem(path) {
  const normalized = homeCardPath(path);
  const name = normalized.split("/").pop() || "";
  return name.replace(/\.md$/i, "");
}

function homeCardText(value) {
  return value === null || value === undefined ? "" : String(value);
}

function homeCardHasOwn(object, key) {
  return Boolean(object && typeof object === "object" && Object.prototype.hasOwnProperty.call(object, key));
}

function homeCardPathExcluded(path) {
  const text = homeCardPath(path);
  if (!text) return true;
  if (HOME_CARD_TYPE_NOTES.includes(text)) return true;
  try {
    if (typeof noteReadyPathExcluded === "function" && noteReadyPathExcluded(text)) return true;
  } catch (_) {}
  try {
    if (typeof isDoneArchivePath === "function" && isDoneArchivePath(text)) return true;
  } catch (_) {}
  const segments = text.split("/");
  if (segments[0] === "done") return true;
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] === "_templates" || segments[index] === "_conflicts") return true;
  }
  return false;
}

function homeCardKindFromFrontmatter(frontmatter) {
  try {
    if (typeof pomodoroHomeType === "function") {
      const kind = pomodoroHomeType(frontmatter);
      if (kind === "area" || kind === "project") return kind;
      return null;
    }
  } catch (_) {}
  try {
    if (typeof noteReadyKindFromType === "function") {
      const kind = noteReadyKindFromType(frontmatter && frontmatter.type);
      if (kind === "area" || kind === "project") return kind;
    }
  } catch (_) {}
  return null;
}

function homeCardIsAreaSentinel(entry) {
  if (!entry) return false;
  const path = homeCardPath(entry.path);
  const stem = homeCardText(entry.stem || homeCardStem(path)).toLowerCase();
  if (path === "area.md" || stem === "area") return true;
  return false;
}

function homeCardEligible(path, frontmatter) {
  const normalized = homeCardPath(path);
  if (!normalized || homeCardPathExcluded(normalized)) return null;
  const kind = homeCardKindFromFrontmatter(frontmatter);
  if (!kind) return null;
  return { path: normalized, kind, stem: homeCardStem(normalized) };
}

function homeCardCalendarDate(clock) {
  let now = null;
  try {
    now = typeof clock === "function" ? clock() : clock;
  } catch (_) {
    now = null;
  }
  const date = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function homeCardParseDate(value) {
  try {
    if (typeof parseFreshDateStrict === "function") return parseFreshDateStrict(value);
  } catch (_) {}
  const text = homeCardText(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  const day = Number(text.slice(8, 10));
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return text;
}

function homeCardDateDiffDays(from, to) {
  try {
    if (typeof freshDateDiffDays === "function") return freshDateDiffDays(from, to);
  } catch (_) {}
  const a = homeCardParseDate(from);
  const b = homeCardParseDate(to);
  if (!a || !b) return null;
  const ms = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)))
    - Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)));
  return Math.round(ms / 86400000);
}

function homeCardDateLabel(iso, today) {
  const parsed = homeCardParseDate(iso);
  if (!parsed) return "";
  const month = HOME_CARD_MONTHS[Number(parsed.slice(5, 7)) - 1];
  const day = Number(parsed.slice(8, 10));
  const year = Number(parsed.slice(0, 4));
  const todayYear = homeCardParseDate(today) ? Number(today.slice(0, 4)) : year;
  return year === todayYear ? `${month} ${day}` : `${month} ${day}, ${year}`;
}

function homeCardAuthoredKeys(sourceText) {
  if (typeof sourceText !== "string") return null;
  try {
    if (typeof propertyCardScanFrontmatter === "function") {
      const scan = propertyCardScanFrontmatter(sourceText);
      if (!scan || scan.state !== "closed") return new Set();
      return new Set((scan.entries || []).map((entry) => entry.key));
    }
  } catch (_) {}
  return new Set();
}

function homeCardEligibleHeading(sourceText) {
  if (typeof sourceText !== "string" || typeof propertyCardTitleSourceRange !== "function") return null;
  try {
    const probe = propertyCardTitleSourceRange(sourceText, {
      key: "home-probe",
      requireHeading: true,
      heading: (cleaned) => Boolean(cleaned),
      follower: () => false,
    });
    if (!probe || !probe.title) return null;
    const recognizer = typeof propertyCardHomeTitleRecognizer === "function"
      ? propertyCardHomeTitleRecognizer(probe.title)
      : null;
    const range = recognizer && typeof propertyCardTitleSourceRange === "function"
      ? propertyCardTitleSourceRange(sourceText, recognizer)
      : probe;
    return { text: probe.title, range: range || probe };
  } catch (_) {
    return null;
  }
}

function homeCardTitleModel(sourceText, frontmatter, stem) {
  const heading = homeCardEligibleHeading(sourceText);
  if (heading && heading.text) {
    return { text: heading.text, source: "h1", range: heading.range || null };
  }
  let alias = "";
  try {
    if (typeof propertyCardFirstAlias === "function") {
      alias = propertyCardFirstAlias(frontmatter && frontmatter.aliases);
    }
  } catch (_) {}
  if (!alias && frontmatter && typeof frontmatter.aliases === "string" && frontmatter.aliases.trim()) {
    alias = frontmatter.aliases.trim();
  }
  if (alias) return { text: alias, source: "alias", range: null };
  return { text: homeCardText(stem), source: "stem", range: null };
}

function homeCardParentTarget(raw) {
  try {
    if (typeof pomodoroHomeParentTarget === "function") {
      return homeCardText(pomodoroHomeParentTarget(raw)).trim();
    }
  } catch (_) {}
  if (typeof raw !== "string") return "";
  const text = raw.trim();
  const match = /\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/.exec(text);
  return match ? match[1].trim() : "";
}

function homeCardIsRoot(frontmatter) {
  try {
    if (typeof pomodoroHomeRootFlag === "function") return pomodoroHomeRootFlag(frontmatter) === true;
  } catch (_) {}
  const raw = frontmatter && frontmatter.root;
  return raw === true || (typeof raw === "string" && raw.trim().toLowerCase() === "true");
}

function homeCardCollapseCrumbs(crumbs) {
  try {
    if (typeof notebookHeaderCollapse === "function") {
      return notebookHeaderCollapse(crumbs, HOME_CARD_MAX_CRUMBS);
    }
  } catch (_) {}
  const list = Array.isArray(crumbs) ? crumbs.slice() : [];
  if (list.length <= HOME_CARD_MAX_CRUMBS) return list;
  return [list[0], { ellipsis: true, path: "", stem: "", title: "…", kind: "ellipsis" }, ...list.slice(-(HOME_CARD_MAX_CRUMBS - 2))];
}

function homeCardWalkAncestry(path, frontmatter, options = {}) {
  if (Array.isArray(options.ancestors)) {
    return {
      crumbs: options.ancestors.filter((row) => row && !homeCardIsAreaSentinel(row)),
      broken: options.ancestryBroken === true,
      cyclic: options.ancestryCyclic === true,
      truncated: options.ancestryTruncated === true,
    };
  }
  const resolve = typeof options.resolveParent === "function" ? options.resolveParent : null;
  const parent = homeCardParentTarget(frontmatter && frontmatter.parent);
  if (!parent || !resolve) {
    const missing = Boolean(frontmatter && homeCardHasOwn(frontmatter, "parent") && homeCardText(frontmatter.parent).trim());
    return { crumbs: [], broken: missing && !parent, cyclic: false, truncated: false };
  }
  const chain = [];
  const seen = new Set([homeCardPath(path).toLowerCase()]);
  let currentTarget = parent;
  let fromPath = homeCardPath(path);
  let broken = false;
  let cyclic = false;
  let truncated = false;
  for (let depth = 0; depth < HOME_CARD_MAX_HOPS && currentTarget; depth += 1) {
    let next = null;
    try { next = resolve(currentTarget, fromPath); } catch (_) { next = null; }
    if (!next || !homeCardPath(next.path)) {
      broken = true;
      break;
    }
    const nextPath = homeCardPath(next.path);
    const key = nextPath.toLowerCase();
    if (seen.has(key)) {
      cyclic = true;
      break;
    }
    seen.add(key);
    const kind = next.kind === "area" || next.kind === "project"
      ? next.kind
      : homeCardKindFromFrontmatter(next.frontmatter);
    if (kind !== "area" && kind !== "project") break;
    const entry = {
      path: nextPath,
      stem: next.stem || homeCardStem(nextPath),
      title: next.title || next.stem || homeCardStem(nextPath),
      kind,
      hue: next.hue || "",
    };
    if (!homeCardIsAreaSentinel(entry) && nextPath.toLowerCase() !== homeCardPath(path).toLowerCase()) {
      chain.push(entry);
    }
    const nextParent = homeCardParentTarget(next.parent !== undefined ? next.parent : (next.frontmatter && next.frontmatter.parent));
    if (!nextParent) break;
    currentTarget = nextParent;
    fromPath = nextPath;
    if (depth === HOME_CARD_MAX_HOPS - 1) truncated = true;
  }
  chain.reverse();
  return { crumbs: chain, broken, cyclic, truncated };
}

function homeCardHueName(value) {
  const hue = homeCardText(value).trim().toLowerCase();
  if (!hue || hue === "unresolved") return "";
  if (hue === "gray") return "grey";
  return hue;
}

function homeCardMaterial(kind, hue, terminal) {
  const name = homeCardHueName(hue);
  const neutral = !name || name === "grey";
  if (kind === "area") return { wash: 8, muted: false, paper: neutral ? "neutral" : "hue", hue: name };
  if (terminal) return { wash: 2, muted: true, paper: neutral ? "neutral" : "hue", hue: name };
  return { wash: 5, muted: false, paper: neutral ? "neutral" : "hue", hue: name };
}

function homeCardStatusLabel(value) {
  const text = homeCardText(value).trim().toLowerCase();
  if (text === "done" || text === "canceled" || text === "cancelled") {
    return text === "cancelled" ? "canceled" : text;
  }
  return "";
}

function homeCardInlineDate(line, key) {
  try {
    if (typeof dateMarkCanonicalFields === "function") {
      const fields = dateMarkCanonicalFields(line) || [];
      const match = fields.find((row) => row && row.field === key);
      if (match && match.date) return homeCardParseDate(match.date);
    }
  } catch (_) {}
  const pattern = new RegExp(`\\[\\s*${key}::\\s*(\\d{4}-\\d{2}-\\d{2})\\s*\\]`, "i");
  const match = pattern.exec(homeCardText(line));
  return match ? homeCardParseDate(match[1]) : null;
}

function homeCardSourceLines(source) {
  const lines = [];
  const separator = /\r\n|\r|\n/g;
  let cursor = 0;
  let match;
  while ((match = separator.exec(source))) {
    lines.push({ text: source.slice(cursor, match.index), from: cursor, to: match.index });
    cursor = match.index + match[0].length;
  }
  lines.push({ text: source.slice(cursor), from: cursor, to: source.length });
  return lines;
}

function homeCardListItemIndent(raw) {
  const match = /^( *)(?:[-+*]|\d+[.)])\s+/.exec(String(raw || ""));
  return match ? match[1].length : null;
}

function homeCardPrjIsNested(rows, index, start, fenced) {
  const currentIndent = homeCardListItemIndent(rows[index] && rows[index].text);
  if (currentIndent == null) return true;
  for (let cursor = index - 1; cursor >= start; cursor -= 1) {
    if (fenced.has(cursor)) continue;
    const text = String(rows[cursor].text || "");
    if (!text.trim()) continue;
    const prevIndent = homeCardListItemIndent(text);
    if (prevIndent == null) {
      const leading = (/^ */.exec(text) || [""])[0].length;
      if (leading <= currentIndent) return false;
      continue;
    }
    if (prevIndent < currentIndent) return true;
    if (prevIndent === currentIndent) return false;
  }
  return false;
}

function homeCardPrjTask(sourceText) {
  if (typeof sourceText !== "string") return { kind: "pending", mark: null, count: 0 };
  const rows = homeCardSourceLines(sourceText);
  const texts = rows.map((row) => row.text);
  let start = 0;
  try {
    if (typeof projectsBodyStart === "function") start = projectsBodyStart(texts);
  } catch (_) {
    if (/^\s*---\s*$/.test(texts[0] || "")) {
      start = texts.length;
      for (let index = 1; index < texts.length; index += 1) {
        if (/^\s*---\s*$/.test(texts[index])) { start = index + 1; break; }
      }
    }
  }
  let fenced = new Set();
  try {
    if (typeof projectsFencedLines === "function") fenced = projectsFencedLines(texts);
  } catch (_) {}
  const hits = [];
  for (let index = start; index < rows.length; index += 1) {
    if (fenced.has(index)) continue;
    const raw = String(rows[index].text || "").replace(/[ \t]+$/, "");
    const top = /^ {0,3}[-+*]\s+\[/.test(raw);
    const isPrj = typeof projectsIsPrjAnchor === "function"
      ? projectsIsPrjAnchor(raw)
      : (raw === "^prj" || raw.endsWith(" ^prj") || raw.endsWith("\t^prj"));
    if (!top || !isPrj || homeCardPrjIsNested(rows, index, start, fenced)) continue;
    const mark = typeof projectsCheckboxMark === "function"
      ? projectsCheckboxMark(raw)
      : ((/^\s*[-+*]\s+\[([^\]]*)\]/.exec(raw) || [])[1] || "");
    hits.push({
      line: index + 1,
      from: rows[index].from,
      to: rows[index].to,
      mark,
      text: raw,
    });
  }
  if (hits.length === 0) return { kind: "missing", mark: null, count: 0 };
  if (hits.length > 1) return { kind: "duplicate", mark: null, count: hits.length };
  const hit = hits[0];
  return {
    kind: "one",
    mark: hit.mark,
    count: 1,
    line: hit.line,
    from: hit.from,
    to: hit.to,
    text: hit.text,
    scheduled: homeCardInlineDate(hit.text, "scheduled"),
    completion: homeCardInlineDate(hit.text, "completion"),
    cancelled: homeCardInlineDate(hit.text, "cancelled"),
  };
}

function homeCardLifecycle(kind, sourceText, frontmatter, clock) {
  if (kind !== "project") return { kind: "none", pending: false };
  if (typeof sourceText !== "string") return { kind: "pending", pending: true };
  const prj = homeCardPrjTask(sourceText);
  const today = homeCardCalendarDate(clock);
  const terminalStatus = homeCardStatusLabel(frontmatter && frontmatter.status);
  if (prj.kind === "one") {
    const mark = homeCardText(prj.mark);
    if (mark === " " || mark === "*" || mark === "/") {
      return { kind: "wip", word: "WIP", icon: "circle-dot", tone: "wip", pending: false, prj };
    }
    if (mark === "?") {
      const scheduled = prj.scheduled;
      const days = scheduled ? homeCardDateDiffDays(today, scheduled) : null;
      if (scheduled && Number.isInteger(days) && days > 0) {
        const when = homeCardDateLabel(scheduled, today);
        const wait = days === 1 ? "in 1 day" : `in ${days} days`;
        return {
          kind: "scheduled",
          word: "SCHEDULED",
          detail: `starts ${when} · ${wait}`,
          icon: "calendar-clock",
          tone: "scheduled",
          pending: false,
          prj,
        };
      }
      return { kind: "blocked", word: "BLOCKED", icon: "unplug", tone: "blocked", pending: false, prj };
    }
    if (mark.toLowerCase() === "x") {
      const date = prj.completion || null;
      return {
        kind: "done",
        word: "DONE",
        detail: date ? homeCardDateLabel(date, today) : "",
        icon: "check",
        tone: "done",
        pending: false,
        prj,
        terminal: true,
      };
    }
    if (mark === "-") {
      const date = prj.cancelled || prj.completion || null;
      return {
        kind: "canceled",
        word: "CANCELED",
        detail: date ? homeCardDateLabel(date, today) : "",
        icon: "ban",
        tone: "canceled",
        pending: false,
        prj,
        terminal: true,
      };
    }
  }
  if (terminalStatus === "done" || terminalStatus === "canceled") {
    return {
      kind: terminalStatus,
      word: terminalStatus === "done" ? "DONE" : "CANCELED",
      icon: terminalStatus === "done" ? "check" : "ban",
      tone: terminalStatus,
      pending: false,
      prj,
      terminal: true,
      fromStatus: true,
    };
  }
  return {
    kind: "missing",
    word: "NO ^prj TASK",
    detail: HOME_CARD_MISSING_PRJ.replace(/^NO \^prj TASK · /, ""),
    icon: "triangle-alert",
    tone: "warning",
    pending: false,
    prj,
  };
}

function homeCardSummary(frontmatter, kind) {
  if (kind !== "area") return "";
  const value = frontmatter && frontmatter.summary;
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text;
}

function homeCardCoerceYamlScalar(text) {
  const raw = String(text == null ? "" : text).trim();
  if (!raw) return "";
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null" || raw === "~") return null;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if ((raw.startsWith("\"") && raw.endsWith("\"")) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function homeCardParseFlowSequence(text) {
  const raw = String(text || "").trim();
  if (!raw.startsWith("[") || !raw.endsWith("]")) return null;
  const inner = raw.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map((item) => homeCardCoerceYamlScalar(item));
}

function homeCardParseSourceMapping(sourceText) {
  if (typeof sourceText !== "string" || typeof propertyCardScanFrontmatter !== "function") return null;
  let scan = null;
  try { scan = propertyCardScanFrontmatter(sourceText); } catch (_) { scan = null; }
  if (!scan || scan.state !== "closed") return null;
  if (typeof parseYaml === "function" && typeof propertyCardInventoryParserResult === "function") {
    try {
      const parsed = propertyCardInventoryParserResult(parseYaml, scan.yaml);
      if (parsed && parsed.ok && parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)) {
        return parsed.value;
      }
    } catch (_) {}
  }
  const mapping = {};
  const lines = Array.isArray(scan.yamlLines) ? scan.yamlLines : [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || !String(line).trim() || /^\s/.test(line) || /^\s*#/.test(line)) continue;
    let colon = -1;
    let key = null;
    try {
      colon = typeof propertyCardInventoryColon === "function" ? propertyCardInventoryColon(line) : line.indexOf(":");
      key = colon >= 0 && typeof propertyCardInventoryKey === "function"
        ? propertyCardInventoryKey(line.slice(0, colon))
        : (colon >= 0 ? line.slice(0, colon).trim() : null);
    } catch (_) {
      colon = -1;
      key = null;
    }
    if (colon < 0 || !key) continue;
    const scalar = typeof propertyCardInventoryScalar === "function"
      ? propertyCardInventoryScalar(line, colon)
      : String(line.slice(colon + 1) || "").trim();
    if (scalar !== "" && scalar != null) {
      const flow = homeCardParseFlowSequence(scalar);
      mapping[String(key)] = flow || homeCardCoerceYamlScalar(scalar);
      continue;
    }
    const items = [];
    let cursor = index + 1;
    while (cursor < lines.length && /^\s+-\s+/.test(lines[cursor] || "")) {
      items.push(homeCardCoerceYamlScalar(String(lines[cursor]).replace(/^\s+-\s+/, "")));
      cursor += 1;
    }
    mapping[String(key)] = items;
  }
  return mapping;
}

function homeCardPolicyValues(frontmatter, sourceText, authored) {
  if (!authored) return frontmatter || {};
  if (typeof sourceText !== "string") return frontmatter || {};
  const sourceMap = homeCardParseSourceMapping(sourceText);
  if (!sourceMap) return {};
  const policy = {};
  for (const key of authored) {
    if (Object.prototype.hasOwnProperty.call(sourceMap, key)) policy[key] = sourceMap[key];
  }
  return policy;
}

function homeCardTypeChip(frontmatter, authored, options) {
  if (!authored) return null;
  const hasType = authored.has("task_type");
  const hasTheme = authored.has("theme");
  if (!hasType && !hasTheme) return null;
  const key = hasType ? "task_type" : "theme";
  const raw = frontmatter ? frontmatter[key] : undefined;
  if (raw === undefined || raw === null) return null;
  let parsed = null;
  try {
    parsed = typeof pomodoroThemeParseSingleNoteDefault === "function"
      ? pomodoroThemeParseSingleNoteDefault(raw)
      : (typeof raw === "string" ? { kind: raw.trim().toLowerCase() === "off" ? "off" : "name", name: raw.trim() } : { kind: "invalid" });
  } catch (_) {
    parsed = { kind: "invalid" };
  }
  if (!parsed || parsed.kind === "invalid") return null;
  if (parsed.kind === "off") {
    return { id: "type", key, settingKey: key, text: "type off", hue: "", warning: false, tooltip: "Stop parent defaults" };
  }
  if (parsed.kind !== "name" || !parsed.name) return null;
  const name = homeCardText(parsed.name).replace(/^#/, "");
  if (!name) return null;
  let hue = "";
  try {
    if (typeof options.themeHue === "function") {
      const resolved = options.themeHue(name, name);
      if (resolved && typeof resolved === "object" && Object.prototype.hasOwnProperty.call(resolved, "hue")) {
        hue = resolved.hue == null ? "" : homeCardHueName(resolved.hue);
      } else {
        hue = homeCardHueName(resolved);
      }
    }
  } catch (_) {}
  return {
    id: "type",
    key,
    settingKey: key,
    text: `#${name.toUpperCase()}`,
    hue,
    warning: false,
    tooltip: key === "theme" ? "Legacy theme key" : "",
  };
}

function homeCardClockValue(raw) {
  if (raw === true) return true;
  if (raw === false) return false;
  if (typeof raw === "string") {
    const text = raw.trim().toLowerCase();
    if (text === "true") return true;
    if (text === "false") return false;
  }
  return null;
}

function homeCardClockTypeNames(raw) {
  let parsed = null;
  try {
    parsed = typeof pomodoroClockOffclockTypes === "function"
      ? pomodoroClockOffclockTypes({ offclock_types: raw })
      : null;
  } catch (_) {
    parsed = null;
  }
  if (!parsed || parsed.kind !== "valid" || !(parsed.keys instanceof Set) || !parsed.keys.size) return null;
  const names = [];
  const values = Array.isArray(raw) ? raw : [raw];
  for (const item of values) {
    if (typeof item !== "string" || !item.trim()) continue;
    names.push(item.trim().replace(/^#/, "").toUpperCase());
  }
  return names.length ? names : null;
}

function homeCardClockChip(frontmatter, authored) {
  if (!authored) return null;
  const hasTypes = authored.has("offclock_types");
  const hasBool = authored.has("offclock");
  if (!hasTypes && !hasBool) return null;
  const flag = hasBool ? homeCardClockValue(frontmatter && frontmatter.offclock) : null;
  const shadowed = hasTypes && hasBool;
  const ignoredKey = hasTypes ? "offclock" : "";
  const ignoredValue = hasBool ? homeCardText(frontmatter && frontmatter.offclock) : "";
  const tooltip = shadowed
    ? `${ignoredKey}: ${ignoredValue} is ignored — Settings can clean this up`
    : "";
  if (hasTypes) {
    const names = homeCardClockTypeNames(frontmatter && frontmatter.offclock_types);
    if (!names) return null;
    return {
      id: "clock",
      key: "offclock_types",
      settingKey: "offclock_types",
      text: `off-clock · ${names.join(", ")}`,
      hue: "",
      warning: shadowed,
      tooltip,
      ignoredKey: shadowed ? ignoredKey : "",
      ignoredValue: shadowed ? ignoredValue : "",
    };
  }
  if (flag === true || flag === false) {
    return {
      id: "clock",
      key: "offclock",
      settingKey: "offclock",
      text: flag === true ? "off-clock" : "on-clock",
      hue: "",
      warning: false,
      tooltip: "",
      ignoredKey: "",
      ignoredValue: "",
    };
  }
  return null;
}

function homeCardRefreshChip(frontmatter, authored) {
  if (!authored || !authored.has("task_refresh")) return null;
  const raw = frontmatter && frontmatter.task_refresh;
  if (raw === undefined || raw === null || raw === false) return null;
  if (typeof raw === "object") return null;
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  let parsed = null;
  try {
    parsed = typeof freshnessParseNoteRefresh === "function"
      ? freshnessParseNoteRefresh(raw)
      : null;
  } catch (_) {
    parsed = null;
  }
  const days = parsed && Number.isInteger(parsed.days) ? parsed.days : null;
  if (days == null || parsed.lint) return null;
  return {
    id: "refresh",
    key: "task_refresh",
    settingKey: "task_refresh",
    text: `review ${days}d`,
    hue: "",
    warning: false,
    tooltip: "",
  };
}

function homeCardAliasChip(frontmatter, authored) {
  if (!authored || !authored.has("project_name_aliases")) return null;
  const raw = frontmatter && frontmatter.project_name_aliases;
  if (!Array.isArray(raw) || !raw.length) return null;
  const names = [];
  for (const item of raw) {
    if (typeof item !== "string" || !item.trim()) return null;
    names.push(item.trim());
  }
  if (!names.length) return null;
  const extra = names.length - 1;
  const text = extra > 0 ? `aka ${names[0]} +${extra}` : `aka ${names[0]}`;
  return { id: "aliases", key: "project_name_aliases", settingKey: "project_name_aliases", text, hue: "", warning: false, tooltip: names.join(", ") };
}

function homeCardChips(frontmatter, authored, options, terminal) {
  if (!authored || terminal) return [];
  return [
    homeCardTypeChip(frontmatter, authored, options),
    homeCardClockChip(frontmatter, authored),
    homeCardRefreshChip(frontmatter, authored),
    homeCardAliasChip(frontmatter, authored),
  ].filter(Boolean);
}

function homeCardReadyModel(ready, terminal) {
  if (terminal) return null;
  if (!ready || typeof ready !== "object") return null;
  const count = ready.count;
  if (!Number.isInteger(count) || count < 0) return null;
  const state = homeCardText(ready.state) || "empty";
  const source = homeCardText(ready.cap_source);
  const capLabel = source === "note" ? "ready_cap" : "plan.max_ready_per_note";
  if (state === "exempt" || ready.cap == null) {
    return {
      text: `${count} ready · no cap`,
      tooltip: `${HOME_CARD_READY_SCOPE}: ${count} · no cap`,
      state: "exempt",
    };
  }
  const cap = Number.isInteger(ready.cap) ? ready.cap : null;
  if (cap == null) return null;
  return {
    text: `${count}/${cap} ready`,
    tooltip: `${HOME_CARD_READY_SCOPE}: ${count} of ${cap} · cap from ${capLabel}`,
    state,
  };
}

function homeCardWhereMarks(spec) {
  const where = { type: "tile" };
  if (spec.parentPainted) where.parent = "kicker";
  if (spec.kind === "area" && spec.summary) where.summary = "subtitle";
  if (spec.authorsColor && spec.material && spec.material.paper === "hue") where.color = "tint";
  if (spec.kind === "project" && spec.root) where.root = "kicker";
  if (spec.kind === "project" && spec.lifecycle && spec.lifecycle.kind !== "pending" && spec.lifecycle.kind !== "none") {
    if (spec.lifecycle.fromStatus || spec.lifecycle.kind === "done" || spec.lifecycle.kind === "canceled" || spec.lifecycle.kind === "wip" || spec.lifecycle.kind === "blocked" || spec.lifecycle.kind === "scheduled" || spec.lifecycle.kind === "missing") {
      if (spec.lifecycle.fromStatus) where.status = "state";
    }
  }
  if (!spec.terminal) {
    for (const chip of spec.chips || []) {
      if (chip && chip.key) where[chip.key] = "chip";
    }
    if (spec.ready) where.ready_cap = "readout";
  }
  if (spec.createdPresent || (spec.kind === "project" && spec.createdKnown)) where.created = "foot";
  return where;
}

function homeCardManagedMap() {
  const managed = {};
  for (const key of HOME_CARD_MANAGED_KEYS) managed[key] = true;
  return managed;
}

function homeCardInbox(path, options) {
  if (options.inbox === true) return true;
  if (options.inbox === false) return false;
  try {
    if (typeof options.isInboxNote === "function") return options.isInboxNote(path) === true;
  } catch (_) {}
  return false;
}

function homeCardCrumbParts(crumbs, material) {
  const collapsed = homeCardCollapseCrumbs(crumbs);
  return collapsed.map((crumb, index) => {
    if (crumb && crumb.ellipsis) {
      return { text: "…", ellipsis: true };
    }
    const text = homeCardText(crumb.title || crumb.stem).trim();
    const target = homeCardPath(crumb.path);
    const part = {
      text,
      target,
      tooltip: target,
    };
    if (index === 0 && crumb.hue) {
      const hue = homeCardHueName(crumb.hue);
      if (hue && hue !== "grey") part.pip = hue;
    }
    return part;
  }).filter((part) => part.text);
}

function homeCardModel(input = {}) {
  try {
    const options = input && typeof input === "object" ? input : {};
    const frontmatter = options.frontmatter && typeof options.frontmatter === "object" && !Array.isArray(options.frontmatter)
      ? options.frontmatter : {};
    const eligible = homeCardEligible(options.path, frontmatter);
    if (!eligible) return null;
    const sourceText = typeof options.sourceText === "string" ? options.sourceText : undefined;
    const sourcePending = sourceText === undefined;
    const authored = homeCardAuthoredKeys(sourceText);
    const policy = homeCardPolicyValues(frontmatter, sourceText, authored);
    const title = homeCardTitleModel(sourceText, frontmatter, eligible.stem);
    if (!title.text) return null;
    const ancestry = homeCardWalkAncestry(eligible.path, frontmatter, options);
    const lifecycle = homeCardLifecycle(eligible.kind, sourceText, frontmatter, options.clock);
    const terminal = eligible.kind === "project" && lifecycle.terminal === true;
    const summary = homeCardSummary(frontmatter, eligible.kind);
    const hue = options.hue !== undefined ? options.hue : "";
    const material = homeCardMaterial(eligible.kind, hue, terminal);
    const chips = sourcePending ? [] : homeCardChips(policy, authored, options, terminal);
    const ready = sourcePending ? null : homeCardReadyModel(options.ready, terminal);
    const inbox = eligible.kind === "area" && homeCardInbox(eligible.path, options);
    const root = eligible.kind === "project" && homeCardIsRoot(frontmatter);
    const parentPainted = ancestry.crumbs.some((crumb) => homeCardPath(crumb.path));
    const createdPresent = homeCardHasOwn(frontmatter, "created");
    const where = homeCardWhereMarks({
      kind: eligible.kind,
      parentPainted,
      summary,
      authorsColor: authored ? authored.has("color") : false,
      material,
      root,
      lifecycle,
      terminal,
      chips,
      ready,
      createdPresent,
      createdKnown: !sourcePending,
    });
    const pills = [];
    if (inbox) pills.push({ id: "inbox", text: "INBOX", tooltip: "Inbox" });
    if (root) pills.push({ id: "root", text: "ROOT", tooltip: HOME_CARD_ROOT_TOOLTIP });
    let subtitle = { kind: "none", text: "", tooltip: "", pending: false };
    if (eligible.kind === "area" && summary) {
      subtitle = { kind: "summary", text: summary, tooltip: summary, pending: false };
    } else if (eligible.kind === "project") {
      if (lifecycle.pending) subtitle = { kind: "lifecycle", text: "", tooltip: "", pending: true, icon: "", tone: "" };
      else if (lifecycle.kind !== "none") {
        const detail = homeCardText(lifecycle.detail).trim();
        const text = detail ? `${lifecycle.word} · ${detail}` : lifecycle.word;
        subtitle = {
          kind: "lifecycle",
          text,
          word: lifecycle.word,
          detail,
          tooltip: text,
          icon: lifecycle.icon || "",
          tone: lifecycle.tone || "",
          pending: false,
        };
      }
    }
    return {
      kind: eligible.kind,
      path: eligible.path,
      stem: eligible.stem,
      title,
      hue: material.hue,
      material,
      terminal,
      inbox,
      root,
      crumbs: homeCardCrumbParts(ancestry.crumbs, material),
      ancestry: { broken: ancestry.broken, cyclic: ancestry.cyclic, truncated: ancestry.truncated },
      subtitle,
      chips,
      ready,
      pills,
      where,
      managed: homeCardManagedMap(),
      created: {
        present: createdPresent,
        silentMissing: eligible.kind === "area",
      },
      prj: lifecycle.prj || null,
      sourcePending,
      lifecycle,
    };
  } catch (_) {
    return null;
  }
}
