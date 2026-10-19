// --- Today (ledger-derived) -------------------------------------------------
// JavaScript mirror of `today_links` in `src/native/plan_budget/today.rs`,
// which is exactly the `=x` / start lineup rule
// (`list_queued_links` in `src/native/capture_pomodoro_start.rs`):
// a direct child bullet at an open entry's first child indentation whose
// body, after stripping Pomodoro markers, is exactly one plain
// `[[target#^id]]` or embedded `![[target#^id]]` block link — not struck
// through and not fenced. `docs/plan.md` ("Today conformance examples")
// is the shared test vector source for both implementations.

function todayIndentLen(line) {
  const text = String(line || "");
  let indent = 0;
  while (text[indent] === " " || text[indent] === "\t") {
    indent += 1;
  }
  return indent;
}

function todayMarkerLen(afterIndent) {
  const text = String(afterIndent || "");
  const first = text[0];
  if (first === "-" || first === "*" || first === "+") {
    return 1;
  }
  if (first >= "0" && first <= "9") {
    let digits = 0;
    while (
      digits < text.length &&
      text[digits] >= "0" &&
      text[digits] <= "9"
    ) {
      digits += 1;
    }
    const closer = text[digits];
    if (closer === "." || closer === ")") {
      return digits + 1;
    }
  }
  return null;
}

// An indented list line (a possible sub-bullet): indented, with a valid
// marker followed by nothing or whitespace.
function todayIsSubBulletLine(line) {
  const text = String(line || "");
  if (text.trim() === "") {
    return false;
  }
  const indent = todayIndentLen(text);
  if (indent === 0) {
    return false;
  }
  const markerLen = todayMarkerLen(text.slice(indent));
  if (markerLen === null) {
    return false;
  }
  const rest = text.slice(indent + markerLen);
  return rest === "" || rest[0] === " " || rest[0] === "\t";
}

// The bullet body with trailing whitespace trimmed, or null when the line
// is not a well-formed bullet.
function todayBulletBody(line) {
  const text = String(line || "");
  const indent = todayIndentLen(text);
  const markerLen = todayMarkerLen(text.slice(indent));
  if (markerLen === null) {
    return null;
  }
  const afterMarker = text.slice(indent + markerLen);
  if (afterMarker !== "" && afterMarker[0] !== " " && afterMarker[0] !== "\t") {
    return null;
  }
  const bodyStart = indent + markerLen + (afterMarker === "" ? 0 : 1);
  const trimmed = text.slice(bodyStart).replace(/[ \t]+$/, "");
  if (trimmed === "") {
    return null;
  }
  return { bodyStart, bodyEnd: bodyStart + trimmed.length, body: trimmed };
}

function todayStripWrappingQuotes(value) {
  const text = String(value || "");
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if (
      (first === '"' && last === '"') ||
      (first === "'" && last === "'")
    ) {
      return text.slice(1, -1).trim();
    }
  }
  return text;
}

function todayIsUriScheme(path) {
  const colon = String(path || "").indexOf(":");
  if (colon === -1) {
    return false;
  }
  const scheme = String(path).slice(0, colon);
  if (!scheme || !/[A-Za-z]/.test(scheme[0])) {
    return false;
  }
  return /^[A-Za-z][A-Za-z0-9+.-]*$/.test(scheme);
}

// One `[[target#^id]]` token on a line, mirroring
// `wikilink_tokens`/`parse_block_target`: the alias (`|…`) is ignored,
// the block ID must match `PLAN_BLOCK_ID_RE`, and paths holding `#`, `^`,
// or a URI scheme never parse.
function todayWikilinkTokens(line) {
  const text = String(line || "");
  const tokens = [];
  let cursor = 0;
  for (;;) {
    const open = text.indexOf("[[", cursor);
    if (open === -1) {
      break;
    }
    const innerStart = open + 2;
    const relativeClose = text.slice(innerStart).indexOf("]]");
    if (relativeClose === -1) {
      break;
    }
    const close = innerStart + relativeClose + 2;
    const inner = text.slice(innerStart, innerStart + relativeClose);
    const rawTarget = todayStripWrappingQuotes(
      inner.split("|")[0] || "",
    ).trim();
    const caret = rawTarget.indexOf("#^");
    if (caret !== -1) {
      const rawPath = rawTarget.slice(0, caret).trim();
      const blockId = rawTarget.slice(caret + 2).trim();
      if (
        blockId &&
        PLAN_BLOCK_ID_RE.test(blockId) &&
        !rawPath.includes("#") &&
        !rawPath.includes("^") &&
        !todayIsUriScheme(rawPath)
      ) {
        let pathPart = rawPath;
        if (/\.md$/i.test(pathPart)) {
          pathPart = pathPart.slice(0, -3);
        }
        const embedded = open > 0 && text[open - 1] === "!";
        tokens.push({
          start: embedded ? open - 1 : open,
          end: close,
          embedded,
          pathPart,
          blockId,
        });
      }
    }
    cursor = close;
  }
  return tokens;
}

// The trimmed body is exactly one plain or embedded block link, mirroring
// `bare_plain_link`/`bare_embedded_link` (a trailing `#` move-only marker
// disqualifies, exactly as in Rust).
function todayBareLink(body) {
  const text = String(body || "");
  const tokens = todayWikilinkTokens(text);
  if (tokens.length !== 1) {
    return null;
  }
  const token = tokens[0];
  return token.start === 0 && token.end === text.length ? token : null;
}

// A dedicated Task Link: strip leading Pomodoro markers (the Strip policy
// only removes markers directly before the link), then require a bare link
// outside `~~…~~` struck spans.
function todayLinkFromBody(body) {
  const stripped = String(body || "").replace(/^(?:🍅\s*)+/, "");
  if (stripped === "") {
    return null;
  }
  const token = todayBareLink(stripped);
  if (!token) {
    return null;
  }
  const struck = planStruckInnerSpans(stripped);
  if (
    struck.some(([start, end]) => token.start >= start && token.end <= end)
  ) {
    return null;
  }
  return token;
}

function emptyTodayCache() {
  return {
    date: null,
    dailyPath: null,
    keys: [],
    rank: new Map(),
    details: new Map(),
    detailsSignature: "",
    idsByPath: new Map(),
  };
}

function todayEachOpenEntry(content, visit) {
  if (typeof visit !== "function") {
    return;
  }
  const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
  const section = planSectionRange(lines);
  if (!section) {
    return;
  }
  const fenced = planFencedLines(lines, section.start, section.end);
  for (let index = section.start; index <= section.end; index += 1) {
    if (fenced.has(index)) {
      continue;
    }
    const line = String(lines[index] || "");
    if (line.startsWith(" ") || line.startsWith("\t")) {
      continue;
    }
    const parsed = planParseEntry(line);
    if (!parsed || parsed.state !== "open") {
      continue;
    }
    // The entry's sub-bullet range: following non-empty indented list
    // lines (a blank line, a column-0 line, or the section end stops it).
    const range = [];
    for (let sub = index + 1; sub <= section.end; sub += 1) {
      if (fenced.has(sub)) {
        continue;
      }
      if (!todayIsSubBulletLine(lines[sub])) {
        break;
      }
      range.push(sub);
    }
    const leading = planLeadingRange(parsed.body);
    const entryName =
      leading.length === null
        ? null
        : planParseNameTail(parsed.body.slice(leading.length));
    visit({
      index,
      lines,
      fenced,
      parsed,
      leading,
      entryName,
      range,
    });
  }
}

// Every dedicated Task Link under today's open entries, in ledger order.
// `dailyPath` canonicalizes empty targets only for key building in
// `resolveTodayKeys`; the recorded `target` is the written path part.
function computeTodayLinks(content, dailyPath) {
  const links = [];
  todayEachOpenEntry(content, (entry) => {
    const range = entry.range;
    if (!range || range.length === 0) {
      return;
    }
    const childIndent = todayIndentLen(entry.lines[range[0]]);
    for (const sub of range) {
      if (todayIndentLen(entry.lines[sub]) !== childIndent) {
        continue;
      }
      const bullet = todayBulletBody(entry.lines[sub]);
      if (!bullet) {
        continue;
      }
      const token = todayLinkFromBody(bullet.body);
      if (!token) {
        continue;
      }
      links.push({
        entryLine: entry.index + 1,
        entryName: entry.entryName,
        entryRange: entry.leading.timeRange,
        entryPlaceholder: entry.leading.placeholder === true,
        ledgerLine: sub + 1,
        target: token.pathPart,
        blockId: token.blockId,
        embedded: token.embedded,
      });
    }
  });
  return links;
}

function todayOpenEntries(content) {
  const entries = [];
  todayEachOpenEntry(content, (entry) => {
    entries.push(
      Object.freeze({
        entryLine: entry.index + 1,
        name: entry.entryName,
        range: entry.leading.timeRange,
        placeholder: entry.leading.placeholder === true,
      }),
    );
  });
  return Object.freeze(entries);
}

function todayRunningEntryLine(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const timed = [];
  for (const entry of list) {
    if (!entry || entry.placeholder === true) {
      continue;
    }
    if (typeof entry.range === "string" && entry.range) {
      timed.push(entry);
    }
  }
  if (timed.length !== 1) {
    return null;
  }
  const line = timed[0].entryLine;
  return typeof line === "number" ? line : null;
}

function todayResolveLinkKey(link, dailyPath, resolve) {
  if (!link || typeof link.blockId !== "string" || !link.blockId) {
    return null;
  }
  let resolved = null;
  const target = typeof link.target === "string" ? link.target : "";
  if (target === "") {
    resolved = typeof dailyPath === "string" ? dailyPath : null;
  } else if (typeof resolve === "function") {
    try {
      const file = resolve(target, dailyPath);
      resolved = file && typeof file.path === "string" ? file.path : null;
    } catch (error) {
      resolved = null;
    }
  }
  if (typeof resolved !== "string" || !resolved) {
    return null;
  }
  const withExtension = /\.md$/i.test(resolved) ? resolved : `${resolved}.md`;
  return `${withExtension}#${link.blockId}`;
}

// Every resolved Today link in ledger order, without dedupe.
function resolveTodayLinkKeys(links, dailyPath, resolve) {
  const out = [];
  const list = Array.isArray(links) ? links : [];
  for (const link of list) {
    const key = todayResolveLinkKey(link, dailyPath, resolve);
    if (!key) {
      continue;
    }
    out.push(Object.freeze({ link, key }));
  }
  return out;
}

// Ordered, unique Today keys (`"<vault path with .md>#<block id>"`).
// `resolve(target, dailyPath)` wraps
// `app.metadataCache.getFirstLinkpathDest`; an empty target is the daily
// note itself. Unresolved targets are skipped. First-occurrence dedupe of
// `resolveTodayLinkKeys`.
function resolveTodayKeys(links, dailyPath, resolve) {
  const seen = new Set();
  const keys = [];
  for (const item of resolveTodayLinkKeys(links, dailyPath, resolve)) {
    if (!item || typeof item.key !== "string" || seen.has(item.key)) {
      continue;
    }
    seen.add(item.key);
    keys.push(item.key);
  }
  return keys;
}

function todayKeyParts(key) {
  const text = typeof key === "string" ? key : "";
  const hash = text.lastIndexOf("#");
  if (hash === -1) {
    return { path: text, blockId: "" };
  }
  return {
    path: text.slice(0, hash),
    blockId: text.slice(hash + 1),
  };
}

function todayIdsByPathFromKeys(keys) {
  const map = new Map();
  for (const key of Array.isArray(keys) ? keys : []) {
    const parts = todayKeyParts(key);
    if (!parts.path || !parts.blockId) {
      continue;
    }
    let ids = map.get(parts.path);
    if (!(ids instanceof Set)) {
      ids = new Set();
      map.set(parts.path, ids);
    }
    ids.add(parts.blockId);
  }
  return map;
}

function todayLinkDetails(resolved, options) {
  const runningEntryLine =
    options && typeof options.runningEntryLine === "number"
      ? options.runningEntryLine
      : null;
  const homeLabels =
    options && options.homeLabels instanceof Map ? options.homeLabels : new Map();
  const map = new Map();
  const seen = new Set();
  const list = Array.isArray(resolved) ? resolved : [];
  for (const item of list) {
    if (!item || typeof item.key !== "string" || !item.key || !item.link) {
      continue;
    }
    const link = item.link;
    const entryLine = link.entryLine;
    const seenKey = `${item.key}\0${String(entryLine)}`;
    if (seen.has(seenKey)) {
      continue;
    }
    seen.add(seenKey);
    const name =
      typeof link.entryName === "string" && link.entryName
        ? link.entryName
        : null;
    const home = homeLabels.get(entryLine);
    const label =
      name || (typeof home === "string" && home ? home : null);
    const detail = Object.freeze({
      entryLine,
      ledgerLine: link.ledgerLine,
      name,
      range: typeof link.entryRange === "string" ? link.entryRange : null,
      placeholder: link.entryPlaceholder === true,
      running: entryLine === runningEntryLine,
      label,
      embedded: link.embedded === true,
    });
    const existing = map.get(item.key);
    if (existing) {
      existing.push(detail);
    } else {
      map.set(item.key, [detail]);
    }
  }
  for (const [key, details] of map) {
    details.sort((left, right) => {
      if (left.running !== right.running) {
        return left.running ? -1 : 1;
      }
      const leftLine =
        typeof left.entryLine === "number" ? left.entryLine : 0;
      const rightLine =
        typeof right.entryLine === "number" ? right.entryLine : 0;
      return leftLine - rightLine;
    });
    map.set(key, Object.freeze(details.slice()));
  }
  return map;
}

function todayDetailsSignature(details) {
  if (!(details instanceof Map)) {
    return "";
  }
  const rows = [];
  for (const [key, list] of details) {
    const items = Array.isArray(list) ? list : [];
    rows.push([
      key,
      items.map((detail) => ({
        entryLine: detail ? detail.entryLine : null,
        ledgerLine: detail ? detail.ledgerLine : null,
        name: detail ? detail.name : null,
        range: detail ? detail.range : null,
        placeholder: !!(detail && detail.placeholder),
        running: !!(detail && detail.running),
        label: detail ? detail.label : null,
        embedded: !!(detail && detail.embedded),
      })),
    ]);
  }
  return JSON.stringify(rows);
}

function planTaskBlockId(task) {
  if (!task || typeof task !== "object") {
    return null;
  }
  for (const key of ["blockLink", "blockId"]) {
    const value = task[key];
    if (typeof value !== "string") {
      continue;
    }
    // Tasks 8.4.0 keeps the block ID in `blockLink` as ` ^id` (see its
    // `blockLinkRegex`: `/ \^<id>$/`); the ID itself matches
    // `PLAN_BLOCK_ID_RE`.
    const trimmed = value.trim().replace(/^\^/, "");
    if (trimmed && PLAN_BLOCK_ID_RE.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

function planTaskStatusSymbol(task) {
  if (!task || typeof task !== "object") {
    return "";
  }
  const status =
    task.status && typeof task.status === "object" ? task.status : {};
  for (const value of [status.symbol, task.statusSymbol, task.symbol]) {
    if (typeof value === "string" && value) {
      return value;
    }
  }
  return "";
}

function planLaneVisible(task, list, todayDay) {
  if (planTaskIsDone(task)) {
    return false;
  }
  if (planTaskIsBlocked(task, list)) {
    return false;
  }
  const tags = planTaskTags(task);
  if (
    tags.some(
      (tag) => typeof tag === "string" && tag.toLowerCase().includes("#hide"),
    )
  ) {
    return false;
  }
  const loweredPath = String(planTaskPath(task) || "").toLowerCase();
  if (loweredPath.includes("_templates") || loweredPath.includes("_conflicts")) {
    return false;
  }
  if (todayDay !== null) {
    const scheduled = planTaskScheduledDay(task);
    if (scheduled !== null && scheduled > todayDay) {
      return false;
    }
  }
  return true;
}

// A lane budget over Tasks-plugin task objects: `"next"` is symbol `*`,
// `"pending"` is type IN_PROGRESS. Visibility matches the dash defaults
// (`docs/plan.md`, "Lanes"), counting the whole lane, Today included.
function laneBudgetFromTasks(tasks, today, caps, lane) {
  const effective = effectivePlanCaps(caps);
  const list = Array.isArray(tasks) ? tasks : [];
  const todayDay = planDayNumber(today === undefined ? new Date() : today);
  let count = 0;
  for (const task of list) {
    if (!planLaneVisible(task, list, todayDay)) {
      continue;
    }
    if (lane === "next") {
      if (planTaskStatusSymbol(task) !== "*") {
        continue;
      }
    } else if (lane === "pending") {
      const type =
        task && task.status && typeof task.status === "object"
          ? task.status.type
          : null;
      if (type !== "IN_PROGRESS") {
        continue;
      }
    } else {
      continue;
    }
    count += 1;
  }
  const cap = lane === "pending" ? effective.maxPending : effective.maxNext;
  return { count, cap, over: count > cap };
}

