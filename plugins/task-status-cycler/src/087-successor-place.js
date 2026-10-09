// Successor placement edits and notice text (docs/task-dependencies.md §12.3,
// §12.5–§12.6) plus the config and today-path loaders. Pure code only: no
// vault reads, no editor writes. Consumed with 085-successor-plan.js by the
// wiring phase.
function successorIndentOf(lineText) {
  const match = String(lineText || "").match(/^[ \t]*/);
  return match ? match[0] : "";
}

function successorEntryNameAt(lines, entryLine) {
  const parts = parsePomodoroEntryLineParts(String(lines[entryLine] || ""));
  return parts && parts.name ? parts.name : "";
}

// Apply ordered successor placements to the day text. Slot anchors insert
// immediately after the anchor bullet's subtree (the bullet plus its
// deeper-indented children), in successor order; the indent is the anchor
// bullet's own. Closing anchors append after the target entry's existing
// children (one tab in): the created continuation
// (`options.createdEntry = { line }`), else the first open same-name entry
// after the closed one, else a new `- [ ] () — NAME` placeholder right
// after the closed entry's sub-bullet range (successors count as carried).
// A lone stub child is replaced. `dailyLines` is text or an array;
// `options.closingEntry` is the 0-based closed-entry line. Returns
// `{ text, splices, links, skipped }`: `splices` apply in array order
// (`{ at, deleteCount, lines }`, 0-based); `links` aligns with `placements`
// (`entry_line`/`line` 1-based, `entry_name` `""` when unnamed); `skipped`
// lists placements with no valid target (the wiring reports them as
// `failed` rows).
function planSuccessorInsertions(dailyLines, placements, options = {}) {
  const sourceText = Array.isArray(dailyLines)
    ? dailyLines.map((line) => String(line ?? "")).join("\n")
    : String(dailyLines ?? "");
  const ending = sourceText.includes("\r\n") ? "\r\n" : "\n";
  const lines = sourceText.split(/\r?\n/);
  const list = Array.isArray(placements) ? placements : [];
  const closingEntry = Number.isInteger(options.closingEntry)
    ? options.closingEntry
    : null;
  const createdEntry =
    options.createdEntry && typeof options.createdEntry === "object"
      ? options.createdEntry
      : null;
  const section = findPomodorosSectionInLines(lines);
  const entries = parseSuccessorLedgerEntries(lines);
  const entryOfLine = (line) => {
    let owner = null;
    for (const entry of entries) {
      if (entry.entryLine <= line) {
        owner = entry;
      } else {
        break;
      }
    }
    return owner;
  };

  const ops = [];
  const skipped = [];
  let seq = 0;

  const slotGroups = new Map();
  const closingItems = [];
  list.forEach((placement, order) => {
    const anchor = placement && placement.anchor;
    if (anchor && anchor.bulletLine != null) {
      if (!slotGroups.has(anchor.bulletLine)) {
        slotGroups.set(anchor.bulletLine, []);
      }
      slotGroups.get(anchor.bulletLine).push({ placement, order });
    } else {
      closingItems.push({ placement, order });
    }
  });

  for (const [bulletLine, items] of slotGroups) {
    if (
      !Number.isInteger(bulletLine) ||
      bulletLine < 0 ||
      bulletLine >= lines.length
    ) {
      for (const item of items) {
        skipped.push({
          key: (item.placement && item.placement.key) || null,
          order: item.order,
          reason: "no-anchor-bullet",
        });
      }
      continue;
    }
    const owner = entryOfLine(bulletLine);
    const indent = successorIndentOf(lines[bulletLine]);
    let end = bulletLine + 1;
    while (end < lines.length) {
      const text = lines[end];
      if (!text.trim()) {
        break;
      }
      if (!INDENTED_LIST_LINE_RE.test(text)) {
        break;
      }
      if (successorIndentOf(text).length <= indent.length) {
        break;
      }
      end += 1;
    }
    ops.push({
      at: end,
      deleteCount: 0,
      lines: items.map(
        (item) => `${indent}- ${item.placement.blockLink}`,
      ),
      seq: seq++,
      marks: items.map((item, index) => ({
        order: item.order,
        index,
        entryOriginal: owner ? owner.entryLine : null,
        entryCreated: false,
      })),
    });
  }

  if (closingItems.length > 0) {
    let targetLine = null;
    let entryCreated = false;
    let placeholderOp = false;
    if (
      createdEntry &&
      Number.isInteger(createdEntry.line) &&
      createdEntry.line >= 0 &&
      createdEntry.line < lines.length
    ) {
      targetLine = createdEntry.line;
      entryCreated = true;
    } else if (
      closingEntry != null &&
      closingEntry >= 0 &&
      closingEntry < lines.length
    ) {
      const closedName = successorEntryNameAt(lines, closingEntry);
      if (closedName) {
        const next = entries.find(
          (entry) =>
            entry.open &&
            entry.entryLine > closingEntry &&
            entry.name === closedName,
        );
        if (next) {
          targetLine = next.entryLine;
        }
      }
      if (targetLine == null) {
        const range = section
          ? getSubBulletBlockRange(lines, closingEntry, section)
          : { startLine: closingEntry + 1, endLine: closingEntry + 1 };
        const placeholder = formatPomodoroPlaceholderLine(
          successorEntryNameAt(lines, closingEntry) || "",
        );
        ops.push({
          at: range.endLine,
          deleteCount: 0,
          lines: [
            placeholder,
            ...closingItems.map((item) => `\t- ${item.placement.blockLink}`),
          ],
          seq: seq++,
          marks: closingItems.map((item, index) => ({
            order: item.order,
            index: 1 + index,
            entryOriginal: null,
            entryCreated: true,
          })),
        });
        placeholderOp = true;
      }
    } else {
      for (const item of closingItems) {
        skipped.push({
          key: (item.placement && item.placement.key) || null,
          order: item.order,
          reason: "no-closing-entry",
        });
      }
    }
    if (targetLine != null && !placeholderOp) {
      const range = section
        ? getSubBulletBlockRange(lines, targetLine, section)
        : { startLine: targetLine + 1, endLine: targetLine + 1 };
      const children = lines.slice(range.startLine, range.endLine);
      if (children.length === 1 && children[0].trim() === "-") {
        ops.push({
          at: range.startLine,
          deleteCount: 1,
          lines: closingItems.map((item) => `\t- ${item.placement.blockLink}`),
          seq: seq++,
          marks: closingItems.map((item, index) => ({
            order: item.order,
            index,
            entryOriginal: targetLine,
            entryCreated,
          })),
        });
      } else {
        ops.push({
          at: range.endLine,
          deleteCount: 0,
          lines: closingItems.map((item) => `\t- ${item.placement.blockLink}`),
          seq: seq++,
          marks: closingItems.map((item, index) => ({
            order: item.order,
            index,
            entryOriginal: targetLine,
            entryCreated,
          })),
        });
      }
    }
  }

  ops.sort((left, right) => left.at - right.at || left.seq - right.seq);
  const out = lines.slice();
  let shift = 0;
  const linkLineByOrder = new Map();
  const entryLineByOrder = new Map();
  const createdByOrder = new Map();
  for (const op of ops) {
    const actual = op.at + shift;
    out.splice(actual, op.deleteCount, ...op.lines);
    for (const mark of op.marks) {
      linkLineByOrder.set(mark.order, actual + mark.index);
      if (mark.entryOriginal == null) {
        entryLineByOrder.set(mark.order, actual);
      } else {
        let entryLine = mark.entryOriginal;
        for (const earlier of ops) {
          if (earlier === op) {
            break;
          }
          if (earlier.at <= mark.entryOriginal) {
            entryLine += earlier.lines.length - earlier.deleteCount;
          }
        }
        entryLineByOrder.set(mark.order, entryLine);
      }
      createdByOrder.set(mark.order, mark.entryCreated === true);
    }
    shift += op.lines.length - op.deleteCount;
  }

  const finalEntries = parseSuccessorLedgerEntries(out);
  const firstPlaceholder = finalEntries.find(
    (entry) => entry.open && entry.placeholder,
  );
  const firstPlaceholderLine = firstPlaceholder
    ? firstPlaceholder.entryLine
    : null;
  const links = [];
  list.forEach((placement, order) => {
    if (!linkLineByOrder.has(order)) {
      return;
    }
    const entryLine = entryLineByOrder.get(order);
    const entry = finalEntries.find((item) => item.entryLine === entryLine);
    links.push({
      key: (placement && placement.key) || null,
      rowIndex: placement && placement.rowIndex != null ? placement.rowIndex : null,
      entry_name: entry && entry.name ? entry.name : "",
      entry_line: entryLine + 1,
      entry_created: createdByOrder.get(order) === true,
      next_up: firstPlaceholderLine != null && entryLine === firstPlaceholderLine,
      line: linkLineByOrder.get(order) + 1,
      block_link: placement ? placement.blockLink : null,
    });
  });

  return {
    text: out.join(ending),
    splices: ops.map((op) => ({
      at: op.at,
      deleteCount: op.deleteCount,
      lines: op.lines.slice(),
    })),
    links,
    skipped,
  };
}

function truncateSuccessorNoticeText(text, limit = SUCCESSOR_NOTICE_TEXT_LIMIT) {
  const value = String(text || "");
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

// Plain notice fallback and walk-toast form for the shared §12.5 notice
// model (`{ predecessors, unblocked, still_blocked, failure }`). One notice
// per gesture; silence (`""`) when nothing was unblocked. Never leads with
// a block ID; task text truncates at 48 characters with `…`.
function successorNoticeText(model = {}) {
  const source = model && typeof model === "object" ? model : {};
  const predecessors = Array.isArray(source.predecessors) ? source.predecessors : [];
  const unblocked = Array.isArray(source.unblocked) ? source.unblocked : [];
  const linked = unblocked.filter((row) => row && row.link);
  const notLinked = unblocked.filter((row) => row && !row.link);
  const failure = source.failure && typeof source.failure === "object" ? source.failure : null;

  if (failure && Number(failure.count) > 0) {
    const pred = predecessors[0] && predecessors[0].text
      ? truncateSuccessorNoticeText(predecessors[0].text)
      : "tasks";
    const count = Number(failure.count);
    return `⚠ Closed ${pred} — couldn't link ${count} successor${count === 1 ? "" : "s"} (${failure.reason || "daily note changed"})`;
  }
  if (linked.length === 1) {
    const row = linked[0];
    const text = truncateSuccessorNoticeText(row.text);
    const name = (row.link && row.link.entry_name) || "";
    if (row.link && row.link.entry_created) {
      return name
        ? `🔓 Next in new ${name} session (next up): ${text}`
        : `🔓 Next in new session (next up): ${text}`;
    }
    return name
      ? `🔓 Next in ${name}: ${text}`
      : `🔓 Next at line ${(row.link && row.link.line) || "?"}: ${text}`;
  }
  if (linked.length > 1) {
    const names = [];
    for (const row of linked) {
      const label = (row.link && row.link.entry_name) ||
        `line ${(row.link && row.link.line) || "?"}`;
      if (!names.includes(label)) {
        names.push(label);
      }
    }
    if (names.length === 1) {
      const shown = linked
        .slice(0, 2)
        .map((row) => truncateSuccessorNoticeText(row.text));
      const more = linked.length > 2 ? `, +${linked.length - 2}` : "";
      return `🔓 ${linked.length} linked → ${names[0]}: ${shown.join(", ")}${more}`;
    }
    return `🔓 ${linked.length} linked · ${names.join(", ")}`;
  }
  const breaker = notLinked.filter((row) => row.not_linked === "breaker");
  if (breaker.length > 0 && breaker.length === notLinked.length) {
    return `🔓 ${breaker.length} unblocked · not linked (more than 5)`;
  }
  if (notLinked.length === 1) {
    const row = notLinked[0];
    const lane = row.status_name || successorStatusName(row.status_symbol);
    return `🔓 Unblocked: ${truncateSuccessorNoticeText(row.text)} (${lane})`;
  }
  if (notLinked.length > 1) {
    const shown = notLinked.slice(0, 3).map(
      (row) => `${truncateSuccessorNoticeText(row.text)} (${row.status_name || successorStatusName(row.status_symbol)})`,
    );
    const more = notLinked.length > 3 ? `, +${notLinked.length - 3} more` : "";
    return `🔓 Unblocked: ${shown.join(", ")}${more}`;
  }
  return "";
}

// --- Loaders ---
// Duplicated from bob-ledger-tools intentionally: deployed plugins must not
// import one another (see `010-core.js:70`).
const SUCCESSOR_DAILY_NOTES_COMMAND_ID = "daily-notes";
const SUCCESSOR_DEFAULT_DAILY_FORMAT = "YYYY/YYYYMMDD";
const SUCCESSOR_DAILY_FORMAT_TOKENS = ["YYYY", "YY", "MM", "DD", "M", "D"];

function successorDailyDateTokens(value) {
  const date = value instanceof Date ? value : new Date(value);
  const yearText = String(date.getFullYear());
  const monthNumber = date.getMonth() + 1;
  const monthText = String(monthNumber).padStart(2, "0");
  const dayNumber = date.getDate();
  const dayText = String(dayNumber).padStart(2, "0");
  return {
    YYYY: yearText,
    YY: yearText.slice(-2),
    MM: monthText,
    DD: dayText,
    M: String(monthNumber),
    D: String(dayNumber),
  };
}

function successorFormatDailyDate(value, format = SUCCESSOR_DEFAULT_DAILY_FORMAT) {
  const source = String(format || SUCCESSOR_DEFAULT_DAILY_FORMAT);
  const tokens = successorDailyDateTokens(value);
  let result = "";
  for (let index = 0; index < source.length;) {
    if (source[index] === "[") {
      const endIndex = source.indexOf("]", index + 1);
      if (endIndex !== -1) {
        result += source.slice(index + 1, endIndex);
        index = endIndex + 1;
        continue;
      }
    }
    const token = SUCCESSOR_DAILY_FORMAT_TOKENS.find((candidate) =>
      source.startsWith(candidate, index),
    );
    if (token) {
      result += tokens[token];
      index += token.length;
      continue;
    }
    result += source[index];
    index += 1;
  }
  return result;
}

function successorNormalizeVaultPath(value) {
  const text = String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!text) {
    return "";
  }
  const compactPath = text.replace(/\/+/g, "/").replace(/\/$/, "");
  if (typeof normalizePath === "function") {
    return normalizePath(compactPath).replace(/^\/+/, "");
  }
  return compactPath;
}

function successorEnsureMarkdownExtension(path) {
  const normalized = successorNormalizeVaultPath(path);
  return /\.md$/i.test(normalized) ? normalized : `${normalized}.md`;
}

function successorJoinVaultPath(folder, path) {
  const normalizedPath = successorNormalizeVaultPath(path);
  const normalizedFolder = successorNormalizeVaultPath(folder);
  return normalizedFolder
    ? successorNormalizeVaultPath(`${normalizedFolder}/${normalizedPath}`)
    : normalizedPath;
}

function successorDailyNotesOptions(app) {
  const internalPlugins = app && app.internalPlugins;
  const plugin =
    (internalPlugins &&
      internalPlugins.plugins &&
      internalPlugins.plugins[SUCCESSOR_DAILY_NOTES_COMMAND_ID]) ||
    (internalPlugins && typeof internalPlugins.getPluginById === "function"
      ? internalPlugins.getPluginById(SUCCESSOR_DAILY_NOTES_COMMAND_ID)
      : null);
  const instance = plugin && plugin.instance;
  return (instance && instance.options) || {};
}

// Vault-relative path of today's daily note, mirroring ledger's
// `todayDailyPath` (`020-time-and-pomodoro.js:278`).
function todayDailyPath(app, now = new Date()) {
  const options = successorDailyNotesOptions(app) || {};
  const path = successorEnsureMarkdownExtension(
    successorFormatDailyDate(now, options.format || SUCCESSOR_DEFAULT_DAILY_FORMAT),
  );
  return successorJoinVaultPath(options.folder || "", path);
}

function successorRequireOptionalNodeModule(name) {
  try {
    if (typeof require !== "function") {
      return null;
    }
    return require(name);
  } catch (_error) {
    return null;
  }
}

function successorJoinPathSegments(firstSegment, ...restSegments) {
  const trim = (text, side) => {
    const value = String(text || "");
    if (side === "left") {
      return value.replace(/^\/+/, "");
    }
    if (side === "right") {
      return value.replace(/\/+$/, "");
    }
    return value.replace(/^\/+|\/+$/g, "");
  };
  const first = trim(firstSegment, "right");
  const rest = restSegments
    .map((segment) => trim(segment, "both"))
    .filter((segment) => segment.length > 0);
  return [first, ...rest].filter((segment) => segment.length > 0).join("/");
}

function successorConfigHomeDir(osModule, env) {
  if (osModule && typeof osModule.homedir === "function") {
    try {
      const home = osModule.homedir();
      if (typeof home === "string" && home.trim()) {
        return home;
      }
    } catch (_error) {
      // Fall through to $HOME below.
    }
  }
  if (env && typeof env.HOME === "string" && env.HOME.trim()) {
    return env.HOME;
  }
  return "~";
}

// Config path for `plan.link_unblocked`, honoring `$XDG_CONFIG_HOME` like
// ledger's `planConfigPath`.
function successorPlanConfigPath(options = {}) {
  const env = options.env ||
    (typeof process !== "undefined" && process.env ? process.env : {});
  const osModule = options.osModule === undefined
    ? successorRequireOptionalNodeModule("os")
    : options.osModule;
  const xdgConfigHome =
    typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.trim()
      ? env.XDG_CONFIG_HOME
      : null;
  const configHome = xdgConfigHome ||
    successorJoinPathSegments(successorConfigHomeDir(osModule, env), ".config");
  return successorJoinPathSegments(configHome, "bob/config.yml");
}

let successorLinkUnblockedCache = { key: null, result: true };

function resetSuccessorLinkUnblockedCache() {
  successorLinkUnblockedCache = { key: null, result: true };
}

function successorConfigStatKey(fsModule, configPath) {
  try {
    if (!fsModule || typeof fsModule.statSync !== "function") {
      return null;
    }
    const stat = fsModule.statSync(configPath);
    const mtime =
      stat && stat.mtimeMs !== undefined && stat.mtimeMs !== null
        ? stat.mtimeMs
        : stat && stat.mtime
          ? Number(stat.mtime)
          : "?";
    const size =
      stat && stat.size !== undefined && stat.size !== null ? stat.size : "?";
    return `${mtime}:${size}`;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return "missing";
    }
    return null;
  }
}

function parseSuccessorLinkUnblockedScalar(raw) {
  const value = String(raw || "")
    .replace(/["']/g, "")
    .split("#")[0]
    .trim()
    .toLowerCase();
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return true;
}

// Minimal `plan:` → `link_unblocked:` reader (block style plus single-line
// flow style). Anything missing or invalid reads `true` (§12.8).
function parseSuccessorLinkUnblocked(text) {
  let inPlan = false;
  for (const line of String(text || "").split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) {
      continue;
    }
    const top = line.match(/^([A-Za-z0-9_-]+)\s*:(.*)$/);
    if (top) {
      inPlan = top[1] === "plan";
      if (inPlan) {
        const rest = top[2].trim();
        if (rest) {
          const flow = rest.match(/link_unblocked\s*:\s*([^,\s}]+)/i);
          if (flow) {
            return parseSuccessorLinkUnblockedScalar(flow[1]);
          }
          if (/^\{.*\}$/.test(rest)) {
            return true;
          }
        }
      }
      continue;
    }
    if (inPlan) {
      const nested = line.match(/^\s+link_unblocked\s*:\s*(\S+)/i);
      if (nested) {
        return parseSuccessorLinkUnblockedScalar(nested[1]);
      }
    }
  }
  return true;
}

// Read the `plan.link_unblocked` kill switch from
// `$XDG_CONFIG_HOME/bob/config.yml` (else `~/.config/bob/config.yml`),
// stat-cached on mtime and size like ledger's `loadPlanCaps`. A missing or
// invalid value reads `true`. Pure apart from the config read.
function loadLinkUnblocked(options = {}) {
  const env = options.env ||
    (typeof process !== "undefined" && process.env ? process.env : {});
  const osModule = options.osModule === undefined
    ? successorRequireOptionalNodeModule("os")
    : options.osModule;
  const fsModule = options.fsModule === undefined
    ? successorRequireOptionalNodeModule("fs")
    : options.fsModule;
  const configPath = options.configPath || successorPlanConfigPath({ env, osModule });
  if (!fsModule || typeof fsModule.readFileSync !== "function") {
    return true;
  }
  const statKey = successorConfigStatKey(fsModule, configPath);
  const key = statKey == null ? null : `${configPath}|${statKey}`;
  if (key != null && successorLinkUnblockedCache.key === key) {
    return successorLinkUnblockedCache.result;
  }
  let result = true;
  try {
    result = parseSuccessorLinkUnblocked(fsModule.readFileSync(configPath, "utf8"));
  } catch (_error) {
    result = true;
  }
  if (key != null) {
    successorLinkUnblockedCache = { key, result };
  }
  return result;
}
