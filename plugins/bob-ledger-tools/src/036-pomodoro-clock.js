// --- Which clock a session is on: pure mirror of bob's counted-links rule ---
// Shared contract: bob-cli's tests/fixtures/pomodoro_clock/vectors.json
// (copied byte-for-byte under scripts/fixtures/). A session is off the clock
// iff it keeps at least one Task Link and every kept link resolves to a task
// whose own line carries a standalone `#offclock` tag (aliases `#off-clock`
// and `#untracked`). An unlinked session, an unresolved link, or one on-clock
// link keeps the whole session worked. Everything here reads lines and
// returns facts, text, or messages; it never touches the editor.

// A dedicated Task Link bullet once its 🍅 markers are stripped: plain,
// embedded, or wrapped in one `~~` pair, and nothing else on the line.
const POMODORO_CLOCK_LINK_RE =
  /^([ \t]+)[-*+][ \t]+(~~[ \t]*)?(!?)(\[\[([^\]|#]*)#\^([A-Za-z0-9-]+)(?:\|[^\]]*)?\]\])([ \t]*~~)?[ \t]*$/;
const POMODORO_CLOCK_TASK_LINE_RE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[.\](?:[ \t]|$)/;

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
function pomodoroClockLinkFacts(lines, links, resolveTask) {
  const rows = eventRunEventRows(lines);
  return links.map((link) => {
    const fact = { token: link.token, offClock: null, text: null };
    if (link.pathPart === "") {
      const event = eventRunById(rows, link.blockId);
      if (event) return { ...fact, offClock: event.offClock, text: event.title };
      const line = pomodoroClockTaskLineText(lines, link.blockId);
      if (line === null) return fact;
      return { ...fact, offClock: eventTaskLineIsOffClock(line), text: pomodoroClockTaskLabel(line) };
    }
    let line = null;
    try {
      line = typeof resolveTask === "function" ? resolveTask(link) : null;
    } catch (error) {
      line = null;
    }
    if (typeof line !== "string" || !POMODORO_CLOCK_TASK_LINE_RE.test(line)) return fact;
    return { ...fact, offClock: eventTaskLineIsOffClock(line), text: pomodoroClockTaskLabel(line) };
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

// The clock of the session headlined at `entryIndex` from its counted lineup.
// Returns { offClock, verdict, facts, notice }.
function pomodoroLineupClock(lines, entryIndex, resolveTask, name = null) {
  const links = pomodoroClockCountedLinks(lines, entryIndex);
  const facts = pomodoroClockLinkFacts(lines, links, resolveTask);
  const verdict = clockVerdict(facts);
  return {
    offClock: verdict.kind === "off-clock",
    verdict,
    facts,
    notice: pomodoroClockMixedNotice(name, facts, verdict),
  };
}
