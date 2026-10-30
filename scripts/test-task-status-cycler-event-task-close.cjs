// Event Task clock close (plan:202610/bob_gcal_daily_events.md, phase
// event-close-js): Ctrl+Enter Pomodoro completion mirrors bob-cli's clock
// rule through a pre-pass that rewrites bare plain links to same-day Event
// Tasks (`!` for ended_inside, `#` for not_started / ended_before).
// bob-cli owns `tests/fixtures/event_task_close/vectors.json`; the copy under
// `plugins/task-status-cycler/scripts/fixtures/event_task_close/` is
// byte-for-byte identical and is never hand-edited. Every `classify` case and
// every `close` case not marked `rust_only` applies here.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  TaskStatusCyclerPlugin,
  helpers,
  createInMemoryObsidianApp,
  createTextEditor,
} = require("./task-status-cycler-harness.cjs");

const vectorsPath = path.join(
  __dirname,
  "../plugins/task-status-cycler/scripts/fixtures/event_task_close/vectors.json",
);
const vectors = JSON.parse(fs.readFileSync(vectorsPath, "utf8"));

function hhmm(value) {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(2));
}

test("event clock spans parse the documented grammar", () => {
  assert.deepEqual(
    helpers.parseEventTaskClockSpan("- [*] #task **0800-0830** Product interview"),
    { startMin: 480, endMin: 510, crossesMidnight: false },
  );
  assert.deepEqual(
    helpers.parseEventTaskClockSpan("- [ ] **2330-0030** Hand-written"),
    { startMin: 1410, endMin: 30, crossesMidnight: true },
  );
  for (const line of [
    "- **0800-0830** Missing checkbox",
    "- [ ] #task **2460-2500** invalid",
    "- [ ] #task **0800-0830**word",
    "- [ ] #task Standup ^standup",
  ]) {
    assert.equal(helpers.parseEventTaskClockSpan(line), null, line);
  }
});

test("event clock classifier matches the shared vectors", () => {
  assert.ok(Array.isArray(vectors.classify) && vectors.classify.length > 0);
  for (const vector of vectors.classify) {
    const span = helpers.parseEventTaskClockSpan(
      `- [ ] **${vector.span}** event`,
    );
    assert.ok(span, vector.id);
    assert.equal(
      helpers.classifyEventTaskClockSpan(
        span,
        hhmm(vector.session_start),
        hhmm(vector.close_at),
      ),
      vector.class,
      vector.id,
    );
  }
});

test("event clock pre-pass mirrors the shared close vectors", () => {
  const close = vectors.close.filter((vector) => !vector.rust_only);
  assert.ok(close.length > 0);
  for (const vector of close) {
    const lines = String(vector.day).split("\n");
    const section = helpers.findPomodorosSectionInLines(lines);
    const pomodoroLine = lines.findIndex((line) =>
      /— MEET/.test(line),
    );
    assert.ok(pomodoroLine !== -1, `${vector.id}: MEET line`);
    const rewrites = helpers.planEventTaskClockRewrites(
      lines,
      pomodoroLine,
      section,
      {
        sourcePath: "2026/20261029.md",
        todayPath: "2026/20261029.md",
        nowMinutes: hhmm(vector.now.slice(11, 13) + vector.now.slice(14, 16)),
      },
    );
    const rewritten = lines.slice();
    for (const rewrite of rewrites) {
      rewritten[rewrite.line] = rewrite.lineText;
    }
    const linkLines = rewritten.filter((line) =>
      /\[\[#\^/.test(line),
    );
    const expectedById = {};
    const classes = vector.expected_clock;
    const blockIds = [...vector.day.matchAll(/#\^([A-Za-z0-9_-]+)/g)].map(
      (match) => match[1],
    );
    const seen = new Set();
    const orderedIds = blockIds.filter((id) => {
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      return true;
    });
    assert.equal(classes.length, orderedIds.length, vector.id);
    for (let index = 0; index < orderedIds.length; index += 1) {
      expectedById[orderedIds[index]] = classes[index];
    }
    if (classes.every((clockClass) => clockClass === null)) {
      assert.deepEqual(rewrites, [], `${vector.id}: no clock without same-day links`);
      continue;
    }
    for (const [id, clockClass] of Object.entries(expectedById)) {
      if (clockClass === null) {
        continue;
      }
      const line = linkLines.find((candidate) => candidate.includes(`#^${id}`));
      assert.ok(line, `${vector.id}: link for ${id}`);
      const trimmed = line.trimEnd();
      if (clockClass === "ended_inside") {
        assert.ok(
          line.includes(`![[#^${id}`),
          `${vector.id}: ${id} completes`,
        );
      } else if (clockClass === "running") {
        assert.ok(
          !line.includes("![[") && !trimmed.endsWith("#"),
          `${vector.id}: ${id} stays plain`,
        );
      } else {
        assert.ok(
          trimmed.endsWith("#") && !line.includes("![["),
          `${vector.id}: ${id} defers`,
        );
      }
    }
  }
});

test("Ctrl+Enter completes ended meetings and carries the rest", async () => {
  const day = vectors.close[0].day;
  const dayPath = "2026/20261029.md";
  const harness = createInMemoryObsidianApp({ [dayPath]: day });
  const lines = day.split("\n");
  const pomodoroLine = lines.findIndex((line) => /— MEET/.test(line));
  const editor = createTextEditor(day, { line: pomodoroLine, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getEventTaskClockTodayPath = () => dayPath;
  plugin.getEventTaskClockNowMinutes = () => 10 * 60;
  plugin.scheduleCenterEditorLineInView = () => {};

  assert.equal(
    await plugin.completeActivePomodoroTask(
      editor,
      { path: dayPath },
      { pomodoroLine },
    ),
    true,
  );

  const closed = editor.getValue();
  // The meeting that ended inside the session is done (with the usual
  // completion stamp) …
  assert.match(closed, /- \[x\] #task \*\*0830-0900\*\* Ended inside .* \^ended-inside/);
  // … the running meeting is started …
  assert.match(closed, /- \[\/\] #task \*\*0930-1030\*\* Running \^running/);
  // … and future/past meetings are never started.
  assert.match(closed, /- \[ \] #task \*\*1000-1030\*\* Not started \^not-started/);
  assert.match(closed, /- \[ \] #task \*\*0700-0730\*\* Ended before \^ended-before/);
  // The session itself closed …
  assert.match(closed, /- \[x\] \(\*\*0800-1000\*\* \[t:: 120m\]\) — MEET/);
  // … and the carried MEET keeps every uncompleted meeting, not the done one.
  const carried = closed.slice(closed.indexOf("- [ ] () — MEET"));
  assert.match(carried, /\[\[#\^running\]\]/);
  assert.match(carried, /\[\[#\^not-started\]\]/);
  assert.match(carried, /\[\[#\^ended-before\]\]/);
  assert.doesNotMatch(carried, /ended-inside/);
});

test("Ctrl+Enter without a clock keeps the ordinary close behavior", async () => {
  const day = vectors.close[0].day;
  const dayPath = "2026/20261029.md";
  const harness = createInMemoryObsidianApp({ [dayPath]: day });
  const lines = day.split("\n");
  const pomodoroLine = lines.findIndex((line) => /— MEET/.test(line));
  // An untimed `()` entry has no session start, so the clock never applies:
  // every bare link is started and carried, exactly as before this change.
  const untimed = lines
    .map((line, index) =>
      index === pomodoroLine ? "- [ ] () — MEET" : line,
    )
    .join("\n");
  const editor = createTextEditor(untimed, { line: pomodoroLine, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getEventTaskClockTodayPath = () => dayPath;
  plugin.getEventTaskClockNowMinutes = () => 10 * 60;
  plugin.scheduleCenterEditorLineInView = () => {};

  assert.equal(
    await plugin.completeActivePomodoroTask(
      editor,
      { path: dayPath },
      { pomodoroLine },
    ),
    true,
  );

  const closed = editor.getValue();
  assert.match(closed, /- \[\/\] #task \*\*0830-0900\*\* Ended inside \^ended-inside/);
  assert.match(closed, /- \[\/\] #task \*\*1000-1030\*\* Not started \^not-started/);
  const carried = closed.slice(closed.indexOf("- [ ] () — MEET"));
  assert.match(carried, /\[\[#\^ended-inside\]\]/);
  assert.match(carried, /\[\[#\^not-started\]\]/);
});
