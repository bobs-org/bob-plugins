const DELETE_GUARD_FRESH_MS = 24 * 60 * 60 * 1000;
const DELETE_GUARD_REPEAT_MS = 5000;
const DELETE_GUARD_FUTURE_SKEW_MS = 300000;
const DELETE_GUARD_DAILY_PATH_RE = /^(\d{4})\/(\d{8})\.md$/i;
const DELETE_GUARD_MODIFIER_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "AltGraph",
]);

function deleteGuardNowMs(now) {
  if (now instanceof Date) {
    const ms = now.getTime();
    return Number.isFinite(ms) ? ms : Date.now();
  }
  const ms = Number(now);
  return Number.isFinite(ms) ? ms : Date.now();
}

function deleteGuardDateKey(now) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidDeleteGuardYmd(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    return false;
  }
  const local = new Date(y, m - 1, d);
  return (
    local.getFullYear() === y &&
    local.getMonth() === m - 1 &&
    local.getDate() === d
  );
}

function formatDeleteGuardYmd(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeCreatedTimestampString(value) {
  const text = String(value || "").trim();
  if (!text.includes("T")) {
    return text;
  }
  if (/[+-]\d{2}:\d{2}$/.test(text) || /Z$/i.test(text)) {
    return text;
  }
  return text.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
}

function parseDeleteGuardCreated(value, nowMs) {
  if (value instanceof Date) {
    const ms = value.getTime();
    if (!Number.isFinite(ms)) {
      return null;
    }
    if (ms - nowMs > DELETE_GUARD_FUTURE_SKEW_MS) {
      return null;
    }
    return { ms, dateKey: deleteGuardDateKey(value) };
  }
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  if (!text) {
    return null;
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) {
    const year = dateOnly[1];
    const month = dateOnly[2];
    const day = dateOnly[3];
    if (!isValidDeleteGuardYmd(year, month, day)) {
      return null;
    }
    const local = new Date(Number(year), Number(month) - 1, Number(day));
    const ms = local.getTime();
    if (ms - nowMs > DELETE_GUARD_FUTURE_SKEW_MS) {
      return null;
    }
    return { ms, dateKey: formatDeleteGuardYmd(year, month, day) };
  }
  const ms = Date.parse(normalizeCreatedTimestampString(text));
  if (!Number.isFinite(ms)) {
    return null;
  }
  if (ms - nowMs > DELETE_GUARD_FUTURE_SKEW_MS) {
    return null;
  }
  return { ms, dateKey: deleteGuardDateKey(new Date(ms)) };
}

function parseDeleteGuardJournalDate(value, path) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return deleteGuardDateKey(value);
  }
  if (typeof value === "string") {
    const text = value.trim();
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (ymd && isValidDeleteGuardYmd(ymd[1], ymd[2], ymd[3])) {
      return formatDeleteGuardYmd(ymd[1], ymd[2], ymd[3]);
    }
    const ym = /^(\d{4})-(\d{2})$/.exec(text);
    if (ym && isValidDeleteGuardYmd(ym[1], ym[2], "01")) {
      return formatDeleteGuardYmd(ym[1], ym[2], "01");
    }
    const year = /^(\d{4})$/.exec(text);
    if (year && isValidDeleteGuardYmd(year[1], "01", "01")) {
      return formatDeleteGuardYmd(year[1], "01", "01");
    }
  }
  const daily = DELETE_GUARD_DAILY_PATH_RE.exec(String(path || "").replace(/\\/g, "/"));
  if (!daily) {
    return "";
  }
  const year = daily[1];
  const stamp = daily[2];
  if (stamp.slice(0, 4) !== year) {
    return "";
  }
  const month = stamp.slice(4, 6);
  const day = stamp.slice(6, 8);
  if (!isValidDeleteGuardYmd(year, month, day)) {
    return "";
  }
  return formatDeleteGuardYmd(year, month, day);
}

function isDeleteGuardDailyPath(path) {
  return DELETE_GUARD_DAILY_PATH_RE.test(String(path || "").replace(/\\/g, "/"));
}

function isDeleteGuardJournal(frontmatter, path) {
  const names = parentRuleTypeNames(frontmatter);
  if (names.includes("day")) {
    return true;
  }
  return isDeleteGuardDailyPath(path);
}

function isDeleteGuardTemplatePath(path) {
  const normalized = String(path || "").replace(/\\/g, "/");
  return normalized === "_templates" || normalized.startsWith("_templates/");
}

function isDeleteGuardMarkdown(input) {
  if (input && typeof input.isMarkdown === "boolean") {
    return input.isMarkdown;
  }
  return /\.md$/i.test(String((input && input.path) || ""));
}

function stripDeleteGuardFrontmatter(text) {
  const source = String(text || "");
  const lines = source.split(/\r?\n/);
  if (!startsWithFrontmatter(lines)) {
    return source;
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (FRONTMATTER_DELIMITER_RE.test(lines[index])) {
      return lines.slice(index + 1).join("\n");
    }
  }
  return source;
}

function isDeleteGuardBlankBody(body) {
  return stripDeleteGuardFrontmatter(body).trim() === "";
}

function countDeleteGuardBacklinks(resolvedLinks, path) {
  const target = String(path || "");
  if (!target || !resolvedLinks || typeof resolvedLinks !== "object") {
    return 0;
  }
  let count = 0;
  for (const source of Object.keys(resolvedLinks)) {
    if (source === target) {
      continue;
    }
    const targets = resolvedLinks[source];
    if (targets && typeof targets === "object" && Number(targets[target]) > 0) {
      count += 1;
    }
  }
  return count;
}

function countDeleteGuardOpenTasks(listItems) {
  if (!Array.isArray(listItems)) {
    return 0;
  }
  let count = 0;
  for (const item of listItems) {
    if (!item || item.task == null || item.task === false) {
      continue;
    }
    const mark = String(item.task);
    if (mark !== "x" && mark !== "X" && mark !== "-") {
      count += 1;
    }
  }
  return count;
}

function deleteGuardKindLabel(frontmatter) {
  const kind = parentRuleKindOf(frontmatter);
  if (kind === "area") {
    return childNoteKindAriaLabel({ kind: "area" });
  }
  if (kind === "notebook") {
    return childNoteKindAriaLabel({ kind: "notebook" });
  }
  if (kind === "project") {
    return "Project note";
  }
  return "";
}

function pluralizeDeleteGuard(count, one, many) {
  return count === 1 ? one : many.replace("{n}", String(count));
}

function formatDeleteGuardFacts(facts) {
  const parts = [];
  if (facts && facts.kindLabel) {
    parts.push(facts.kindLabel);
  }
  const backlinks = facts && Number(facts.backlinkCount);
  if (backlinks > 0) {
    parts.push(
      pluralizeDeleteGuard(
        backlinks,
        "1 note links here",
        "{n} notes link here",
      ),
    );
  }
  const openTasks = facts && Number(facts.openTaskCount);
  if (openTasks > 0) {
    parts.push(
      pluralizeDeleteGuard(openTasks, "1 open task", "{n} open tasks"),
    );
  }
  const lineCount = facts && Number(facts.lineCount);
  if (Number.isFinite(lineCount) && lineCount >= 0) {
    parts.push(pluralizeDeleteGuard(lineCount, "1 line", "{n} lines"));
  }
  return parts.join(" · ");
}

function rapidRepeatReason(lastDelete, path, nowMs) {
  if (!lastDelete || lastDelete.path == null || lastDelete.path === "") {
    return null;
  }
  const at = Number(lastDelete.at);
  if (!Number.isFinite(at)) {
    return null;
  }
  const delta = nowMs - at;
  if (delta < 0 || delta >= DELETE_GUARD_REPEAT_MS) {
    return null;
  }
  const seconds = Math.max(1, Math.round(delta / 1000));
  const previous = String(lastDelete.path);
  const text = `You deleted "${previous}" ${seconds}s ago`;
  return previous === path ? text : `${text} — this is a different file`;
}

function managedFileReason(path, frontmatter) {
  if (isManagedRefNote(path, frontmatter)) {
    return "Managed reference note — bob ref owns its PDF and reading task";
  }
  if (isDoneArchivePath(path)) {
    return "Done archive";
  }
  if (isDeleteGuardTemplatePath(path)) {
    return "Template";
  }
  return null;
}

function childNotesReason(count) {
  if (!(count > 0)) {
    return null;
  }
  return pluralizeDeleteGuard(
    count,
    "1 note names it as its parent",
    "{n} notes name it as their parent",
  );
}

function journalReason(frontmatter, path, nowMs) {
  if (!isDeleteGuardJournal(frontmatter, path)) {
    return null;
  }
  const dateKey = parseDeleteGuardJournalDate(
    frontmatter && frontmatter.date,
    path,
  );
  if (!dateKey) {
    return "Journal note";
  }
  const todayKey = deleteGuardDateKey(nowMs);
  if (dateKey > todayKey) {
    return null;
  }
  if (isDeleteGuardDailyPath(path)) {
    return dateKey === todayKey
      ? `Daily note for ${dateKey} (today)`
      : `Daily note for ${dateKey}`;
  }
  return `Journal note dated ${dateKey}`;
}

function establishedReason(input, nowMs) {
  if (!isDeleteGuardMarkdown(input)) {
    return null;
  }
  const created = parseDeleteGuardCreated(
    input.frontmatter && input.frontmatter.created,
    nowMs,
  );
  const isEstablished =
    !created || nowMs - created.ms > DELETE_GUARD_FRESH_MS;
  if (!isEstablished) {
    return null;
  }
  const childNoteCount = Number(input.childNoteCount) || 0;
  const backlinkCount = Number(input.backlinkCount) || 0;
  if (
    isDeleteGuardBlankBody(input.body) &&
    childNoteCount === 0 &&
    backlinkCount === 0
  ) {
    return null;
  }
  if (!created) {
    return "No created: date — treated as an established note";
  }
  const daysAgo = Math.max(1, Math.floor((nowMs - created.ms) / 86400000));
  const daysLabel = pluralizeDeleteGuard(daysAgo, "1 day ago", "{n} days ago");
  return `Created ${created.dateKey} (${daysLabel})`;
}

function classifyDeleteConfirmKey(event) {
  if (!event) {
    return "ignore";
  }
  if (event.isComposing === true || event.keyCode === 229) {
    return "ignore";
  }
  if (event.repeat === true) {
    return "ignore";
  }
  const key = String(event.key || "");
  if (DELETE_GUARD_MODIFIER_KEYS.has(key)) {
    return "ignore";
  }
  const ctrl = event.ctrlKey === true;
  const meta = event.metaKey === true;
  const alt = event.altKey === true;
  if ((key === "y" || key === "Y") && !ctrl && !meta && !alt) {
    return "confirm";
  }
  return "cancel";
}

function planDeleteCurrentFile(input) {
  const settings = input && typeof input === "object" ? input : {};
  const path = String(settings.path || "");
  const nowMs = deleteGuardNowMs(settings.now);
  const frontmatter = settings.frontmatter || null;
  const reasons = [];
  const repeat = rapidRepeatReason(settings.lastDelete, path, nowMs);
  if (repeat) {
    reasons.push(repeat);
  }
  if (!isDeleteGuardMarkdown(settings)) {
    reasons.push("Not a Markdown note");
  }
  const journal = journalReason(frontmatter, path, nowMs);
  if (journal) {
    reasons.push(journal);
  }
  const managed = managedFileReason(path, frontmatter);
  if (managed) {
    reasons.push(managed);
  }
  const children = childNotesReason(Number(settings.childNoteCount) || 0);
  if (children) {
    reasons.push(children);
  }
  const established = establishedReason(settings, nowMs);
  if (established) {
    reasons.push(established);
  }
  const facts = {
    kindLabel: deleteGuardKindLabel(frontmatter),
    backlinkCount: Number(settings.backlinkCount) || 0,
    openTaskCount: Number(settings.openTaskCount) || 0,
    lineCount: Number.isFinite(Number(settings.lineCount))
      ? Number(settings.lineCount)
      : 0,
  };
  facts.text = formatDeleteGuardFacts(facts);
  return Object.freeze({
    confirm: reasons.length > 0,
    reasons: Object.freeze(reasons.slice()),
    facts: Object.freeze(facts),
  });
}
