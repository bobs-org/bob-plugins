// --- Plan budget ----------------------------------------------------------
// JavaScript mirror of docs/plan.md (bob-cli), the authoritative definition.
// The Rust engine (src/native/plan_budget/) implements the same rules; both
// test against the same conformance examples. Field names are camelCase here.

const PLAN_UNNAMED_THEME = "(unnamed)";
const PLAN_CONFIG_RELATIVE_PATH = "bob/config.yml";
const PLAN_TASKS_PLUGIN_ID = "obsidian-tasks-plugin";
const PLAN_LINT_THEME_CAP = "plan_theme_cap_exceeded";
const PLAN_LINT_LINK_CAP = "plan_link_cap_exceeded";
const PLAN_LINT_DUPLICATE_NAME = "duplicate_open_pomodoro_name";
const PLAN_LINT_INVENTORY_LABEL = "inventory_label_open";
const PLAN_LINT_SUBHEADING = "subheading_in_pomodoros";
const PLAN_LINT_NEXT_CAP = "next_cap_exceeded";
const PLAN_LINT_PENDING_CAP = "pending_cap_exceeded";
// Emitted only by the bob-ledger-tools `bob-plan` block: `bob plan` has
// no native READY count.
const PLAN_LINT_READY_CAP = "ready_cap_exceeded";
const PLAN_DAILY_PATH_RE = /(^|\/)\d{4}\/\d{8}\.md$/;
const PLAN_ENTRY_RE = /^- \[([^\]])\]/;
const PLAN_PLACEHOLDER_RE = /^\([ \t]*\)/;
const PLAN_BLOCK_ID_RE = /^[A-Za-z0-9-]+$/;
const PLAN_ATX_RE = /^(?: {0,3})(#{1,6})(?:\s|$)/;
// This string must stay identical to the Tasks plugin's own event: the
// installed bundle (`~/bob/.obsidian/plugins/obsidian-tasks-plugin/main.js`,
// `TasksEvents.onReloadOpenSearchResults`) subscribes under exactly this
// name, and every open Tasks query re-reads only when it fires.
const TODAY_RELOAD_EVENT = "obsidian-tasks-plugin:reload-open-search-results";

function defaultPlanCaps() {
  return {
    maxThemes: 3,
    maxLinks: 10,
    maxNext: 15,
    maxPending: 10,
    maxReady: 100,
    maxReadyPerNote: 5,
    strict: false,
    exempt: ["GTD"],
    inventoryLabels: ["LATER", "MISC", "NEW FEATURES", "SASE"],
  };
}

const PLAN_U32_MAX = 4294967295;

function planCapOrDefault(value, fallback) {
  return Number.isInteger(value) && value >= 1 ? value : fallback;
}

function planReadyCapOrDefault(value, fallback) {
  return Number.isInteger(value) && value >= 1 && value <= PLAN_U32_MAX
    ? value
    : fallback;
}

// Per-note Ready cap: an integer 1–999 (`docs/plan.md`, "Ready cap per
// note"), unlike the unbounded lane caps above.
function planPerNoteCapOrDefault(value, fallback) {
  return Number.isInteger(value) && value >= 1 && value <= 999
    ? value
    : fallback;
}

function planStringListOrDefault(value, fallback) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const out = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      return [...fallback];
    }
    out.push(item.trim());
  }
  return out;
}

// Case-insensitive component key: collapsed whitespace, lowercased.
function normalizePlanComponent(value) {
  return String(value || "")
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .join(" ")
    .toLowerCase();
}

function splitPlanComponents(name) {
  return String(name || "")
    .split("+")
    .map((component) => component.trim())
    .filter((component) => component.length > 0);
}

// Normalize a camelCase caps object, substituting defaults for anything
// missing or invalid. Never throws.
function effectivePlanCaps(caps) {
  const defaults = defaultPlanCaps();
  const raw =
    caps && typeof caps === "object" && !Array.isArray(caps) ? caps : {};
  return {
    maxThemes: planCapOrDefault(raw.maxThemes, defaults.maxThemes),
    maxLinks: planCapOrDefault(raw.maxLinks, defaults.maxLinks),
    maxNext: planCapOrDefault(raw.maxNext, defaults.maxNext),
    maxPending: planCapOrDefault(raw.maxPending, defaults.maxPending),
    maxReady: planReadyCapOrDefault(raw.maxReady, defaults.maxReady),
    maxReadyPerNote: planPerNoteCapOrDefault(
      raw.maxReadyPerNote,
      defaults.maxReadyPerNote,
    ),
    strict:
      typeof raw.strict === "boolean" ? raw.strict : defaults.strict,
    exempt: planStringListOrDefault(raw.exempt, defaults.exempt),
    inventoryLabels: planStringListOrDefault(
      raw.inventoryLabels,
      defaults.inventoryLabels,
    ),
  };
}

// Read the `plan:` block out of a parsed config file (snake_case keys, with
// camelCase tolerated). Unknown keys stay ignored. A missing block means the
// defaults; any invalid value falls back to the full default block, as Rust
// does. Use coercePlanCaps when the invalid flag matters.
function parsePlanCaps(yamlObject) {
  return coercePlanCaps(planCapsBlock(yamlObject)).caps;
}

function planCapsBlock(yamlObject) {
  if (
    !yamlObject ||
    typeof yamlObject !== "object" ||
    Array.isArray(yamlObject)
  ) {
    return {};
  }
  const block = yamlObject.plan;
  if (!block || typeof block !== "object" || Array.isArray(block)) {
    return {};
  }
  return block;
}

function coercePlanCaps(block) {
  const defaults = defaultPlanCaps();
  const raw =
    block && typeof block === "object" && !Array.isArray(block) ? block : {};
  const pick = (snake, camel) =>
    raw[snake] !== undefined ? raw[snake] : raw[camel];
  let invalid = false;
  const cap = (snake, camel, fallback) => {
    const value = pick(snake, camel);
    if (value === undefined || value === null) {
      return fallback;
    }
    if (!Number.isInteger(value) || value < 1) {
      invalid = true;
      return fallback;
    }
    return value;
  };
  const readyCap = (snake, camel, fallback) => {
    const value = pick(snake, camel);
    if (value === undefined || value === null) {
      return fallback;
    }
    if (!Number.isInteger(value) || value < 1 || value > PLAN_U32_MAX) {
      invalid = true;
      return fallback;
    }
    return value;
  };
  const perNoteCap = (snake, camel, fallback) => {
    const value = pick(snake, camel);
    if (value === undefined || value === null) {
      return fallback;
    }
    if (!Number.isInteger(value) || value < 1 || value > 999) {
      invalid = true;
      return fallback;
    }
    return value;
  };
  const list = (snake, camel, fallback) => {
    const value = pick(snake, camel);
    if (value === undefined) {
      return [...fallback];
    }
    if (!Array.isArray(value)) {
      invalid = true;
      return [...fallback];
    }
    const out = [];
    for (const item of value) {
      if (typeof item !== "string" || !item.trim()) {
        invalid = true;
        return [...fallback];
      }
      out.push(item.trim());
    }
    return out;
  };
  const strictValue = pick("strict", "strict");
  let strict = defaults.strict;
  if (strictValue !== undefined) {
    if (typeof strictValue !== "boolean") {
      invalid = true;
    } else {
      strict = strictValue;
    }
  }
  // Unknown keys (including a legacy `max_now`) stay ignored, so an old
  // config loads without error.
  const caps = {
    maxThemes: cap("max_themes", "maxThemes", defaults.maxThemes),
    maxLinks: cap("max_links", "maxLinks", defaults.maxLinks),
    maxNext: cap("max_next", "maxNext", defaults.maxNext),
    maxPending: cap("max_pending", "maxPending", defaults.maxPending),
    maxReady: readyCap("max_ready", "maxReady", defaults.maxReady),
    maxReadyPerNote: perNoteCap(
      "max_ready_per_note",
      "maxReadyPerNote",
      defaults.maxReadyPerNote,
    ),
    strict,
    exempt: list("exempt", "exempt", defaults.exempt),
    inventoryLabels: list(
      "inventory_labels",
      "inventoryLabels",
      defaults.inventoryLabels,
    ),
  };
  // Like Rust, any invalid value falls back to the full default block.
  if (invalid) {
    return { caps: { ...defaults }, invalid: true };
  }
  return { caps, invalid: false };
}

function emptyPlanBudget(caps) {
  const effective = effectivePlanCaps(caps);
  return {
    hasSection: false,
    themes: { count: 0, cap: effective.maxThemes, over: false },
    links: { count: 0, cap: effective.maxLinks, over: false },
    status: "ok",
    themeNames: [],
    entries: [],
    warnings: [],
  };
}

function planFenceMarker(line) {
  const text = String(line || "");
  let indent = 0;
  while (text[indent] === " ") {
    indent += 1;
  }
  if (indent > 3) {
    return null;
  }
  const rest = text.slice(indent);
  const char = rest[0];
  if (char !== "`" && char !== "~") {
    return null;
  }
  let length = 0;
  while (rest[length] === char) {
    length += 1;
  }
  return length >= 3 ? { char, length } : null;
}

function planClosesFence(line, open) {
  const marker = planFenceMarker(line);
  if (!marker) {
    return false;
  }
  const trimmed = String(line || "").trimStart();
  return (
    marker.char === open.char &&
    marker.length >= open.length &&
    trimmed.slice(marker.length).trim() === ""
  );
}

function planFencedLines(lines, start, end) {
  const fenced = new Set();
  let open = null;
  for (let index = start; index <= end; index += 1) {
    const line = lines[index];
    if (open) {
      fenced.add(index);
      if (planClosesFence(line, open)) {
        open = null;
      }
    } else {
      const marker = planFenceMarker(line);
      if (marker) {
        fenced.add(index);
        open = marker;
      }
    }
  }
  return fenced;
}

function planAtxLevel(line) {
  const match = PLAN_ATX_RE.exec(String(line || ""));
  return match ? match[1].length : null;
}

// Ledger lines: from the `## Pomodoros` heading up to the next `## `
// heading. Frontmatter and fenced code blocks are skipped. Returns
// `{ start, end }` 0-based inclusive, or null.
function planSectionRange(lines) {
  if (!Array.isArray(lines)) {
    return null;
  }
  let frontmatterEnd = -1;
  if (String(lines[0] || "").trimEnd() === "---") {
    for (let index = 1; index < lines.length; index += 1) {
      if (String(lines[index] || "").trimEnd() === "---") {
        frontmatterEnd = index;
        break;
      }
    }
  }
  let sectionStart = -1;
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    if (index <= frontmatterEnd) {
      continue;
    }
    const line = String(lines[index] || "");
    if (fence) {
      if (planClosesFence(line, fence)) {
        fence = null;
      }
      continue;
    }
    const marker = planFenceMarker(line);
    if (marker) {
      fence = marker;
      continue;
    }
    if (sectionStart === -1) {
      if (/^##\s+Pomodoros(?:\s|$)/.test(line)) {
        sectionStart = index + 1;
      }
    } else if (/^##\s/.test(line)) {
      return { start: sectionStart, end: index - 1 };
    }
  }
  return sectionStart === -1
    ? null
    : { start: sectionStart, end: lines.length - 1 };
}

function planNormalizeHhmm(value) {
  const digits = String(value || "").replace(/:/g, "");
  if (!/^\d{4}$/.test(digits)) {
    return null;
  }
  const hours = Number.parseInt(digits.slice(0, 2), 10);
  const minutes = Number.parseInt(digits.slice(2), 10);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return digits;
}

function planParseParentheticalTime(inside) {
  const dash = String(inside || "").indexOf("-");
  if (dash === -1) {
    return null;
  }
  let rawStart = String(inside).slice(0, dash).trim();
  let bold = false;
  if (rawStart.startsWith("**")) {
    bold = true;
    rawStart = rawStart.slice(2).trim();
  }
  const start = planNormalizeHhmm(rawStart);
  if (!start) {
    return null;
  }
  const rawEnd = String(inside).slice(dash + 1).trimStart();
  const endMatch = /^[0-9:]+/.exec(rawEnd);
  if (!endMatch) {
    return null;
  }
  const end = planNormalizeHhmm(endMatch[0]);
  if (!end) {
    return null;
  }
  let rest = rawEnd.slice(endMatch[0].length);
  if (bold) {
    if (!rest.startsWith("**")) {
      return null;
    }
    rest = rest.slice(2);
  } else if (rest.startsWith("**")) {
    return null;
  }
  if (rest !== "" && !/^\s/.test(rest)) {
    return null;
  }
  return { start, end };
}

// Leading `()` placeholder or `(time-range)` of an entry body, mirroring
// capture_pomodoros::parse_entry_body. A name only exists after one of these.
function planLeadingRange(body) {
  const text = String(body || "");
  const placeholder = PLAN_PLACEHOLDER_RE.exec(text);
  if (placeholder) {
    return {
      length: placeholder[0].length,
      timeRange: null,
      placeholder: true,
    };
  }
  if (!text.startsWith("(")) {
    return { length: null, timeRange: null, placeholder: false };
  }
  const close = text.indexOf(")", 1);
  if (close === -1) {
    return { length: null, timeRange: null, placeholder: false };
  }
  const parsed = planParseParentheticalTime(text.slice(1, close));
  if (!parsed) {
    return { length: null, timeRange: null, placeholder: false };
  }
  return {
    length: close + 1,
    timeRange: `${parsed.start}-${parsed.end}`,
    placeholder: false,
  };
}

// The text after `—` (em dash) that follows the leading placeholder or time
// range. A merged name (`BOB + DECKS`) is split by the caller.
function planParseNameTail(remaining) {
  const trimmed = String(remaining || "").replace(/^[ \t]+/, "");
  if (!trimmed.startsWith("—")) {
    return null;
  }
  const name = trimmed.slice(1).replace(/^[ \t]+/, "").trim();
  return name ? name : null;
}

function planParseEntry(line) {
  const text = String(line || "");
  const match = PLAN_ENTRY_RE.exec(text);
  if (!match) {
    return null;
  }
  const afterBracket = text.slice(match[0].length);
  if (!/^\s/.test(afterBracket)) {
    return null;
  }
  const body = afterBracket.trim();
  const checkbox = String(match[1] || "").trim();
  if (/^x$/i.test(checkbox)) {
    return { state: "completed", body };
  }
  if (checkbox === "-") {
    return { state: "cancelled", body };
  }
  return { state: "open", body };
}

// Inner spans of `~~…~~` struck pairs on one line.
function planStruckInnerSpans(line) {
  const text = String(line || "");
  const marks = [];
  let base = 0;
  let rest = text;
  for (;;) {
    const found = rest.indexOf("~~");
    if (found === -1) {
      break;
    }
    marks.push(base + found);
    base += found + 2;
    rest = text.slice(base);
  }
  const spans = [];
  for (let index = 0; index + 1 < marks.length; index += 2) {
    spans.push([marks[index] + 2, marks[index + 1]]);
  }
  return spans;
}

// Block links `[[target#^id]]` (also `![[…]]` and `[[…|alias]]`, with or
// without a trailing `#` move-only marker) outside `~~…~~` struck spans.
// An empty target, the daily note's vault-relative path without `.md`, and
// its basename all canonicalize to the daily path itself (rule 6).
function planCanonicalTarget(target, dailyPath) {
  const name = String(target || "");
  if (!dailyPath) {
    return name;
  }
  const daily = String(dailyPath).replace(/\.md$/, "");
  if (!daily) {
    return name;
  }
  const basename = daily.split("/").pop();
  if (name === "" || name === daily || name === basename) {
    return daily;
  }
  return name;
}

function planBlockLinks(line, dailyPath) {
  const text = String(line || "");
  const struck = planStruckInnerSpans(text);
  const links = [];
  let base = 0;
  let rest = text;
  for (;;) {
    const open = rest.indexOf("[[");
    if (open === -1) {
      break;
    }
    const absoluteOpen = base + open;
    const afterOpen = rest.slice(open + 2);
    const close = afterOpen.indexOf("]]");
    if (close === -1) {
      break;
    }
    let inside = afterOpen.slice(0, close);
    let linkEnd = absoluteOpen + 2 + close + 2;
    if (rest.slice(open + 2 + close + 2).startsWith("#")) {
      linkEnd += 1;
    }
    if (inside.endsWith("#")) {
      inside = inside.slice(0, -1);
    }
    const pipe = inside.indexOf("|");
    const target = pipe === -1 ? inside : inside.slice(0, pipe);
    const caret = target.indexOf("#^");
    if (caret !== -1) {
      const blockId = target.slice(caret + 2).trim();
      if (
        blockId &&
        PLAN_BLOCK_ID_RE.test(blockId) &&
        !struck.some(
          ([start, end]) => absoluteOpen >= start && linkEnd <= end,
        )
      ) {
        let name = target.slice(0, caret).trim();
        if (name.endsWith(".md")) {
          name = name.slice(0, -3);
        }
        links.push([planCanonicalTarget(name, dailyPath), blockId]);
      }
    }
    base = linkEnd;
    rest = text.slice(base);
  }
  return links;
}

function planMeter(count, cap) {
  return { count, cap, over: count > cap };
}

// Pure ledger budget and lint engine implementing docs/plan.md rules 1–9.
function computePlanBudget(content, caps, dailyPath) {
  const effective = effectivePlanCaps(caps);
  const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
  const section = planSectionRange(lines);
  if (!section) {
    return emptyPlanBudget(effective);
  }
  const fenced = planFencedLines(lines, section.start, section.end);
  const warnings = [];
  for (let index = section.start; index <= section.end; index += 1) {
    if (fenced.has(index)) {
      continue;
    }
    const level = planAtxLevel(lines[index]);
    if (level !== null && level >= 3) {
      warnings.push({
        code: PLAN_LINT_SUBHEADING,
        message:
          "subheading inside the Pomodoros section splits time totals",
        line: index + 1,
      });
    }
  }

  const scanned = [];
  for (let index = section.start; index <= section.end; index += 1) {
    if (fenced.has(index)) {
      continue;
    }
    const line = String(lines[index] || "");
    if (line.startsWith(" ") || line.startsWith("\t")) {
      continue;
    }
    const parsed = planParseEntry(line);
    if (!parsed) {
      continue;
    }
    if (parsed.state === "cancelled") {
      continue;
    }
    const leading = planLeadingRange(parsed.body);
    const name =
      leading.length === null
        ? null
        : planParseNameTail(parsed.body.slice(leading.length));
    scanned.push({
      line: index + 1,
      state: parsed.state,
      name,
      timeRange: leading.timeRange,
      placeholder: leading.placeholder,
      isCurrent: false,
    });
  }

  const timedOpen = scanned.filter(
    (entry) => entry.state === "open" && entry.timeRange !== null,
  );
  if (timedOpen.length === 1) {
    timedOpen[0].isCurrent = true;
  }

  const exempt = new Set(
    effective.exempt.map((value) => normalizePlanComponent(value)),
  );
  const inventory = new Set(
    effective.inventoryLabels.map((value) => normalizePlanComponent(value)),
  );
  const entryLines = new Set(scanned.map((entry) => entry.line));

  const entries = [];
  const themeNames = [];
  const themeKeys = new Set();
  const seenThemes = new Map();
  const inventoryWarned = new Set();
  const seenLinks = new Set();
  let unnamedCounted = false;

  for (const entry of scanned) {
    if (entry.state !== "open") {
      continue;
    }
    const components = entry.name ? splitPlanComponents(entry.name) : [];
    const keys = components.map((component) =>
      normalizePlanComponent(component),
    );
    const exemptEntry =
      keys.length > 0 && keys.every((key) => exempt.has(key));
    let entryLinks = [];
    if (!exemptEntry) {
      for (
        let offset = 0;
        entry.line + offset <= section.end;
        offset += 1
      ) {
        const index = entry.line + offset;
        if (entryLines.has(index + 1)) {
          break;
        }
        if (fenced.has(index)) {
          continue;
        }
        const line = String(lines[index] || "");
        if (line !== "" && !line.startsWith(" ") && !line.startsWith("\t")) {
          break;
        }
        for (const link of planBlockLinks(line, dailyPath)) {
          entryLinks.push(link);
        }
      }
    }
    if (components.length === 0 && entryLinks.length === 0) {
      // An empty `()` placeholder never counts.
      continue;
    }

    const distinctLinks = new Set();
    if (!exemptEntry) {
      for (const [target, blockId] of entryLinks) {
        const key = `${target}\u0000${blockId}`;
        distinctLinks.add(key);
        seenLinks.add(key);
      }
    }

    for (let index = 0; index < components.length; index += 1) {
      const component = components[index];
      const key = keys[index];
      if (exempt.has(key)) {
        continue;
      }
      if (seenThemes.has(key)) {
        warnings.push({
          code: PLAN_LINT_DUPLICATE_NAME,
          message:
            `${component} is open in more than one Pomodoro ` +
            `(lines ${seenThemes.get(key)} and ${entry.line})`,
          line: entry.line,
        });
      } else {
        seenThemes.set(key, entry.line);
      }
      if (inventory.has(key) && !inventoryWarned.has(key)) {
        inventoryWarned.add(key);
        warnings.push({
          code: PLAN_LINT_INVENTORY_LABEL,
          message: `${component} is an inventory label, not a theme`,
          line: entry.line,
        });
      }
    }

    if (components.length === 0 && !unnamedCounted) {
      unnamedCounted = true;
      themeKeys.add(PLAN_UNNAMED_THEME);
      themeNames.push(PLAN_UNNAMED_THEME);
    }
    for (let index = 0; index < components.length; index += 1) {
      const component = components[index];
      const key = keys[index];
      if (exempt.has(key) || themeKeys.has(key)) {
        continue;
      }
      themeKeys.add(key);
      themeNames.push(component);
    }

    const row = {
      line: entry.line,
      name: entry.name === null ? PLAN_UNNAMED_THEME : entry.name,
      components,
      exempt: exemptEntry,
      running: entry.isCurrent,
      highlight: false,
      links: distinctLinks.size,
    };
    if (entry.timeRange !== null) {
      row.timeRange = entry.timeRange;
    }
    entries.push(row);
  }

  const highlightIndex = entries.findIndex((entry) => !entry.exempt);
  if (highlightIndex !== -1) {
    entries[highlightIndex].highlight = true;
  }

  const themes = planMeter(themeNames.length, effective.maxThemes);
  const links = planMeter(seenLinks.size, effective.maxLinks);
  const status = themes.over || links.over ? "over" : "ok";
  if (themes.over) {
    warnings.push({
      code: PLAN_LINT_THEME_CAP,
      message: `today's plan has ${themes.count}/${themes.cap} themes`,
    });
  }
  if (links.over) {
    warnings.push({
      code: PLAN_LINT_LINK_CAP,
      message: `today's plan has ${links.count}/${links.cap} links`,
    });
  }

  return {
    hasSection: true,
    themes,
    links,
    status,
    themeNames,
    entries,
    warnings,
  };
}

