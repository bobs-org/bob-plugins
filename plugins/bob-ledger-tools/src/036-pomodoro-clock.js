// --- Which clock a session is on: pure mirror of bob's counted-links rule ---
// Shared contract: bob-cli's tests/fixtures/pomodoro_clock/vectors.json
// (copied byte-for-byte under scripts/fixtures/). A session is off the clock
// iff it keeps at least one Task Link and every kept link resolves to a task
// whose effective clock is off. An unlinked session, an unresolved link, or
// one on-clock link keeps the whole session worked. Everything here reads
// lines and returns facts, text, or messages; it never touches the editor.

// A dedicated Task Link bullet once its 🍅 markers are stripped: plain,
// embedded, or wrapped in one `~~` pair, and nothing else on the line.
const POMODORO_CLOCK_LINK_RE =
  /^([ \t]+)[-*+][ \t]+(~~[ \t]*)?(!?)(\[\[([^\]|#]*)#\^([A-Za-z0-9-]+)(?:\|[^\]]*)?\]\])([ \t]*~~)?[ \t]*$/;
const POMODORO_CLOCK_TASK_LINE_RE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[.\](?:[ \t]|$)/;

function taskEffectiveClockResolution(path, line, metadataCache, vault) {
  const sourcePath = String(path || "");
  const text = String(line || "");
  const tag = eventTaskClockTag(text);
  if (tag.source !== "default") return tag;
  const defaultResolution = { offClock: false, source: "default", note: null, conflict: false };
  if (!sourcePath || !metadataCache || typeof metadataCache.getFileCache !== "function") {
    return defaultResolution;
  }

  let startPath = sourcePath;
  try {
    const root = rootMarkModel(text, { sourcePath, metadataCache, vault });
    if (root && root.state !== "repair" && typeof root.targetPath === "string" && root.targetPath) {
      startPath = root.targetPath;
    }
  } catch (error) {
    // An invalid or unresolved root starts at the task's residence note.
  }

  const first = pomodoroHomeResolveFile(startPath, sourcePath, sourcePath, metadataCache, vault);
  if (!first || typeof first.path !== "string") return defaultResolution;
  const visited = new Set();
  let current = first;
  for (let depth = 0; current && depth < POMODORO_HOME_MAX_DEPTH; depth += 1) {
    const currentPath = String(current.path || "");
    const key = currentPath.toLowerCase();
    if (!currentPath || visited.has(key)) break;
    visited.add(key);
    const { frontmatter } = pomodoroHomeReadFrontmatter(current, metadataCache, vault);
    const raw = frontmatter.offclock;
    const hasValue = Object.prototype.hasOwnProperty.call(frontmatter, "offclock") &&
      raw !== undefined && raw !== null && !(typeof raw === "string" && raw.trim() === "");
    if (hasValue) {
      const kind = pomodoroHomeType(frontmatter);
      if (kind === "area" || kind === "project") {
        if (raw === true || (typeof raw === "string" && raw.trim().toLowerCase() === "true")) {
          return { offClock: true, source: "note", note: currentPath, conflict: false };
        }
        if (raw === false || (typeof raw === "string" && raw.trim().toLowerCase() === "false")) {
          return { offClock: false, source: "note", note: currentPath, conflict: false };
        }
        return { offClock: false, source: "invalid_note", note: currentPath, conflict: false };
      }
      // Defaults on other note kinds are ignored; keep walking parents.
    }
    const parentTarget = pomodoroHomeParentTarget(frontmatter.parent);
    if (!parentTarget || pomodoroHomePathEqual(parentTarget, currentPath)) break;
    current = pomodoroHomeResolveFile(parentTarget, currentPath, sourcePath, metadataCache, vault);
  }
  return defaultResolution;
}

// Public effective-clock API used by task-status-cycler. Returns
// `{ offClock, source, notePath }`. Callers fall back to tag-only when this
// API or the note metadata cache is unavailable.
function taskEffectiveOffClock(path, line, metadataCache, vault) {
  const resolution = taskEffectiveClockResolution(path, line, metadataCache, vault);
  return {
    offClock: resolution.offClock,
    source: resolution.source,
    notePath: resolution.note,
  };
}

function pomodoroClockTagOnlyResolution(line) {
  return eventTaskClockTag(line);
}

function pomodoroClockResolveLine(line, resolveClock, link) {
  if (typeof resolveClock === "function") {
    try {
      const value = resolveClock(link, line);
      if (typeof value === "boolean") {
        return { ...pomodoroClockTagOnlyResolution(line), offClock: value };
      }
      if (value && typeof value.offClock === "boolean") return value;
    } catch (error) {
      // Fall back to explicit line tags when note metadata is unavailable.
    }
  }
  return pomodoroClockTagOnlyResolution(line);
}

// The session's counted Task Links, in ledger order: direct-child bullets at
// the first child indentation, plain, struck, 🍅-marked, or embedded. Deferred
// `[[…]]#` bodies, notes, mentions, and fenced lines are not counted.
function pomodoroClockCountedLinks(lines, entryIndex) {
  const links = [];
  const entryIndent = eventRunIndent(lines[entryIndex]);
  let childIndent = null;
  let fence = false;
  for (let index = entryIndex + 1; index < lines.length; index += 1) {
    const line = String(lines[index] || "");
    if (line.trim() === "" || eventRunIndent(line) <= entryIndent) break;
    if (childIndent === null) childIndent = eventRunIndent(line);
    if (/^[ \t]*(`{3,}|~{3,})/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence || eventRunIndent(line) !== childIndent) continue;
    const match = POMODORO_CLOCK_LINK_RE.exec(line.replace(/🍅[ \t]?/g, ""));
    if (!match || Boolean(match[2]) !== Boolean(match[7])) continue;
    links.push({
      embedded: match[3] === "!",
      struck: Boolean(match[2]),
      token: `${match[3]}${match[4]}`,
      pathPart: match[5],
      blockId: match[6],
      lineIndex: index,
      index: links.length + 1,
    });
  }
  return links;
}

// The clock verdict over caller-resolved facts (`offClock`: true, false, or
// null when the link did not resolve to exactly one task).
function clockVerdict(facts) {
  const list = Array.isArray(facts) ? facts : [];
  if (list.length === 0) return { kind: "worked", reason: "unlinked", index: null };
  const unresolved = list.findIndex((fact) => fact.offClock === null || fact.offClock === undefined);
  if (unresolved >= 0) return { kind: "worked", reason: "unresolved", index: unresolved };
  const onClock = list.findIndex((fact) => fact.offClock === false);
  if (onClock >= 0) return { kind: "worked", reason: "mixed", index: onClock };
  return { kind: "off-clock", reason: null, index: null };
}

function pomodoroClockTaskLineText(lines, blockId) {
  const pattern = new RegExp(`(?:^|\\s)\\^${blockId.replace(/[^A-Za-z0-9-]/g, "")}\\s*$`);
  const found = lines.filter((line) => pattern.test(String(line || "")) && POMODORO_CLOCK_TASK_LINE_RE.test(String(line || "")));
  return found.length === 1 ? String(found[0]) : null;
}

// Mirror of bob's `close_task_text` label: the task text without tags, fields,
// and the block id.
function pomodoroClockTaskLabel(lineText) {
  const body = String(lineText || "")
    .replace(POMODORO_CLOCK_TASK_LINE_RE, "")
    .replace(/(?:^|\s)\^[A-Za-z0-9-]+\s*$/, "");
  return body
    .split(/\s+/)
    .filter((token) => token && !token.startsWith("#") && !token.startsWith("[") && !token.startsWith("^"))
    .join(" ");
}

// One fact per link. Same-note links read `lines` (Event Tasks first, then
// any single task carrying the block id); other-note links go through
// `resolveTask(link)`, which returns the task's full line text or null.
function pomodoroClockLinkFacts(lines, links, resolveTask, resolveClock) {
  const rows = eventRunEventRows(lines);
  return links.map((link) => {
    const fact = { token: link.token, offClock: null, text: null, lineText: null };
    if (link.pathPart === "") {
      const event = eventRunById(rows, link.blockId);
      if (event) {
        const lineText = String(lines[event.lineIndex] || "");
        const resolution = pomodoroClockResolveLine(lineText, resolveClock, link);
        return { ...fact, ...resolution, resolution, text: event.title, lineText };
      }
      const line = pomodoroClockTaskLineText(lines, link.blockId);
      if (line === null) return fact;
      const resolution = pomodoroClockResolveLine(line, resolveClock, link);
      return { ...fact, ...resolution, resolution, text: pomodoroClockTaskLabel(line), lineText: line };
    }
    let line = null;
    try {
      line = typeof resolveTask === "function" ? resolveTask(link) : null;
    } catch (error) {
      line = null;
    }
    const lineText = line && typeof line === "object" ? line.lineText : line;
    if (typeof lineText !== "string" || !POMODORO_CLOCK_TASK_LINE_RE.test(lineText)) return fact;
    const resolution = pomodoroClockResolveLine(lineText, resolveClock, link);
    return { ...fact, ...resolution, resolution, text: pomodoroClockTaskLabel(lineText), lineText };
  });
}

// The `pomodoro_clock_mixed` notice, worded like bob capture's warning; null
// unless the lineup holds an off-clock link yet the session stays worked.
function pomodoroClockMixedNotice(name, facts, verdict) {
  const list = Array.isArray(facts) ? facts : [];
  if (verdict.kind === "off-clock" || !list.some((fact) => fact.offClock === true)) return null;
  const label = String(name || "").trim() || "the session";
  let detail = null;
  if (verdict.reason === "unresolved") {
    const link = list[verdict.index];
    detail = `${link && link.token ? link.token : "a Task Link"} does not resolve`;
  } else if (verdict.reason === "mixed") {
    const link = list[verdict.index];
    if (link && link.text) {
      detail = `it also links ${link.text}`;
    } else {
      detail = `it also links ${link && link.token ? link.token : "another task"}`;
    }
  }
  if (detail === null) return null;
  return { code: "pomodoro_clock_mixed", message: `◌ ${label} stays on the clock: ${detail}` };
}

function pomodoroClockResolutionNotices(facts) {
  const notices = [];
  const seen = new Set();
  for (const fact of Array.isArray(facts) ? facts : []) {
    const resolution = fact && fact.resolution;
    const code = resolution && resolution.conflict
      ? "clock_tag_conflict"
      : resolution && resolution.source === "invalid_note"
        ? "note_offclock_invalid"
        : null;
    if (!code) continue;
    const key = `${code}:${fact.token || fact.text || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = String(fact.text || fact.token || "a task").trim();
    const message = code === "clock_tag_conflict"
      ? `◌ ${label} has both #on and #off; #on wins`
      : `◌ ${resolution.note || "a note"} has an invalid offclock: value; that task stays on the clock`;
    notices.push({ code, message });
  }
  return notices;
}

// The clock of the session headlined at `entryIndex` from its counted lineup.
// Returns { offClock, verdict, facts, notice }.
function pomodoroLineupClock(lines, entryIndex, resolveTask, name = null, resolveClock = null) {
  const links = pomodoroClockCountedLinks(lines, entryIndex);
  const facts = pomodoroClockLinkFacts(lines, links, resolveTask, resolveClock);
  const verdict = clockVerdict(facts);
  const notice = pomodoroClockMixedNotice(name, facts, verdict);
  const notices = pomodoroClockResolutionNotices(facts);
  if (notice) notices.push(notice);
  return {
    offClock: verdict.kind === "off-clock",
    verdict,
    facts,
    notice,
    notices,
  };
}
