const assert = require("node:assert/strict");
const test = require("node:test");
const { helpers } = require("./navigation-hotkeys-harness.cjs");

const {
  rankSnoozeSuggestions,
  snoozeCardInText,
  buildSnoozeCardFooter,
  snoozeCardForecastCounts,
  buildSnoozeCardSnoozedHeader,
  snoozeCardInputMessage,
  snoozeCardRefusalMessage,
  resolveSnoozeCardKey,
  snoozeCardIsAltZEvent,
  snoozeCardVimrcMapsAltZ,
  snoozeCardVimrcConflict,
  registerSnoozeTaskCommand,
  planTaskCard,
  resolveTaskCardKey,
  TASK_CARD_ROW_ORDER,
  TASK_CARD_ROW_SHORTCUTS,
} = helpers;

const CLOCK = { date: "2026-11-27", nowMinutes: 13 * 60, zone: "UTC" };

test("ranked suggestions group event, quick, and used times with dedupe", () => {
  const ranked = rankSnoozeSuggestions({
    ...CLOCK,
    events: [
      { title: "Yogi interview", endMin: 15 * 60 + 30 },
      { title: "Standup", endMin: 14 * 60 + 10 },
      { title: "Past", endMin: 12 * 60 },
    ],
    usedTimesToday: [15 * 60 + 30, 16 * 60],
  });
  assert.ok(ranked.length >= 4);
  assert.equal(ranked[0].group, "event");
  assert.equal(ranked[0].label, "14:10 · after Standup");
  assert.equal(ranked[1].group, "event");
  assert.equal(ranked[1].label, "15:30 · after Yogi interview");
  const quick = ranked.filter((item) => item.group === "quick").map((item) => item.input);
  assert.deepEqual(quick, ["+30m", "+1h", "+2h"]);
  const used = ranked.filter((item) => item.group === "used");
  assert.equal(used.length, 1);
  assert.equal(used[0].display, "16:00");
  const minutes = ranked.map((item) => item.minutes);
  assert.equal(new Set(minutes).size, minutes.length);
});

test("past and next-day candidates are discarded", () => {
  const ranked = rankSnoozeSuggestions({
    ...CLOCK,
    events: [{ title: "Past", endMin: 12 * 60 }],
    usedTimesToday: [12 * 60, 23 * 60 + 59],
  });
  for (const item of ranked) {
    assert.ok(item.minutes > CLOCK.nowMinutes && item.minutes < 1440);
  }
  assert.ok(ranked.every((item) => item.group !== "event" || item.minutes > CLOCK.nowMinutes));
});

test("preselect is the top suggestion so Alt+Z then Enter works", () => {
  const ranked = rankSnoozeSuggestions({
    ...CLOCK,
    events: [{ title: "Yogi interview", endMin: 15 * 60 + 30 }],
    usedTimesToday: [],
  });
  assert.ok(ranked.length > 0);
  assert.equal(ranked[0].display, "15:30");
});

test("typed invalid input never silently submits a suggestion", () => {
  assert.equal(snoozeCardInputMessage({ ok: false, refusal: "past" }), "same-day only — Schedule (s:) defers to another day");
  assert.equal(snoozeCardInputMessage({ ok: false, refusal: "next_day" }), "same-day only — Schedule (s:) defers to another day");
  assert.equal(snoozeCardInputMessage({ ok: false, refusal: "dst_gap" }), "that wall time does not exist today — pick a nearby time");
  assert.equal(snoozeCardInputMessage({ ok: false, refusal: "invalid" }), "use 1530, 15:30, 3:30p, 3p, 19, +45m, +2h, or +1h30m");
});

test("footer states the actual consequence and omits missing data", () => {
  const full = buildSnoozeCardFooter({
    departure: "WRITE",
    destination: "WRITE",
    display: "15:30",
    inText: "in 2h 30m",
    nowCount: 9,
    nowCap: 13,
    afterCount: 10,
    afterCap: 13,
  });
  assert.ok(full.includes("leaves WRITE"));
  assert.ok(full.includes("wakes into WRITE at 15:30"));
  assert.ok(full.includes("in 2h 30m"));
  assert.ok(full.includes("TODAY 9/13 now, 10/13 after"));
  const minimal = buildSnoozeCardFooter({ display: "15:30", inText: "in 1h" });
  assert.equal(minimal, "at 15:30 · in 1h");
  const over = buildSnoozeCardFooter({ display: "15:30", nowCount: 14, nowCap: 13, overCap: true });
  assert.ok(over.includes("over cap"));
  assert.ok(over.includes("TODAY 14/13 now"));
});

test("footer forecast counts the planned postimage and one future on-clock wake", () => {
  const forecast = (nowCount, cap, identities, onClock, block = "target") =>
    snoozeCardForecastCounts({ nowCount, cap, identities, onClock, identity: { route: "jobs.md", block } });
  assert.deepEqual(forecast(0, 13, [], true), { nowCount: 0, nowCap: 13, afterCount: 1, afterCap: 13, overCap: false }); // live-linked task leaves now
  assert.deepEqual(forecast(1, 13, [{ target: "jobs", blockId: "other" }], true), { nowCount: 1, nowCap: 13, afterCount: 2, afterCap: 13, overCap: false }); // unlinked Ready task
  assert.deepEqual(forecast(0, 13, [], true), { nowCount: 0, nowCap: 13, afterCount: 1, afterCap: 13, overCap: false }); // duplicate live links are removed by planner
  assert.deepEqual(forecast(1, 13, [{ target: "jobs", blockId: "other" }], true), { nowCount: 1, nowCap: 13, afterCount: 2, afterCap: 13, overCap: false }); // already-snoozed retime
  assert.deepEqual(forecast(1, 13, [{ target: "jobs", blockId: "other" }], false), { nowCount: 1, nowCap: 13, afterCount: 1, afterCap: 13, overCap: false }); // off-clock task
  assert.deepEqual(forecast(13, 13, [], true), { nowCount: 13, nowCap: 13, afterCount: 14, afterCap: 13, overCap: true }); // over cap remains informative
  assert.deepEqual(forecast(1, 13, [{ target: "jobs.md", blockId: "target" }], true), { nowCount: 1, nowCap: 13, afterCount: 1, afterCap: 13, overCap: false }); // already counted identity is not added twice
});

test("snoozed header reads the truthful blocked and timed states", () => {
  assert.equal(buildSnoozeCardSnoozedHeader({ display: "15:30", inText: "in 2h" }), "Snoozed until 15:30 · in 2h");
  assert.equal(buildSnoozeCardSnoozedHeader({ display: "15:30", inText: "in 2h 15m", state: "asleep" }), "Snoozed until 15:30 · in 2h 15m");
  assert.equal(buildSnoozeCardSnoozedHeader({ display: "15:30", state: "due" }), "Snoozed until 15:30 · due — waking");
  assert.equal(buildSnoozeCardSnoozedHeader({ display: "15:30", state: "blocked", blockedReason: "waiting on interview notes" }), "Snoozed until 15:30 · blocked — waiting on interview notes");
  assert.equal(buildSnoozeCardSnoozedHeader({ display: "15:30", state: "blocked" }), "Snoozed until 15:30 · blocked — waits on prerequisites");
});

test("Alt+Z conflict scan reads every vim map mode and the configured vimrc", async () => {
  assert.equal(snoozeCardVimrcMapsAltZ('" nmap <A-z> ignored\nmap <A-z> :echo hi'), true);
  assert.equal(snoozeCardVimrcMapsAltZ("imap <M-z> :echo hi\nnnoremap Alt+Z :echo hi"), true);
  assert.equal(snoozeCardVimrcMapsAltZ("nnoremap <C-z> :echo hi"), false);
  const calls = [];
  const app = { vault: { configDir: ".obsidian", adapter: { read: async (path) => {
    calls.push(path);
    if (path.endsWith("data.json")) return JSON.stringify({ vimrcFileName: "settings/vimrc" });
    return "vnoremap <A-z> :echo hi";
  } } } };
  assert.deepEqual(await snoozeCardVimrcConflict(app), { kind: "vimrc", commandId: "obsidian-vimrc-support", path: "settings/vimrc" });
  assert.deepEqual(calls, [".obsidian/plugins/obsidian-vimrc-support/data.json", "settings/vimrc"]);
});

test("Alt+Z registers a default only when hotkeys, plugin defaults, and vimrc are clear", async () => {
  const makePlugin = (app) => {
    const registered = [];
    return { app, registered, addCommand(command) { registered.push(command); } };
  };
  const clearApp = () => ({
    hotkeyManager: { customKeys: new Map(), defaultKeys: new Map(), getHotkeys: () => [] },
    commands: { commands: {} },
    vault: { configDir: ".obsidian", adapter: { read: async () => { throw new Error("no vimrc"); } } },
  });
  const clean = makePlugin(clearApp());
  assert.equal(await registerSnoozeTaskCommand(clean), true);
  assert.deepEqual(clean.registered[0].hotkeys, [{ modifiers: ["Alt"], key: "Z" }]);

  const sources = [
    (app) => app.hotkeyManager.customKeys.set("command-palette:open", [{ modifiers: ["Alt"], key: "Z" }]),
    (app) => { app.commands.commands["other-plugin:open"] = { hotkeys: [{ modifiers: ["Alt"], key: "Z" }] }; },
    (app) => { app.vault.adapter.read = async (path) => path.endsWith("data.json") ? JSON.stringify({ vimrcFileName: "vimrc" }) : "nmap <M-z> :echo hi"; },
  ];
  for (const configure of sources) {
    const app = clearApp();
    configure(app);
    const conflicted = makePlugin(app);
    assert.equal(await registerSnoozeTaskCommand(conflicted), true);
    assert.deepEqual(conflicted.registered[0].hotkeys, [], JSON.stringify(conflicted.snoozeAltZConflict));
    assert.ok(conflicted.snoozeAltZConflict.length > 0);
    assert.equal(conflicted.addCommand.name, "addCommand", "temporary metadata adapter is restored");
  }
});

test("refusal copy teaches event and blocked states", () => {
  assert.ok(snoozeCardRefusalMessage({ refusal: "event_task", span: "10:00-11:00" }).includes("Calendar Event Tasks cannot be snoozed"));
  assert.ok(snoozeCardRefusalMessage({ refusal: "blocked", reason: "waiting on X" }).includes("Blocked"));
  assert.ok(snoozeCardRefusalMessage({ refusal: "done" }).includes("already done"));
});

test("card keys move, complete, confirm, and close through one route", () => {
  const model = { kind: "snooze-card" };
  assert.deepEqual(resolveSnoozeCardKey(model, { key: "ArrowDown" }), { type: "move-selection", direction: "next" });
  assert.deepEqual(resolveSnoozeCardKey(model, { key: "ArrowUp" }), { type: "move-selection", direction: "previous" });
  assert.deepEqual(resolveSnoozeCardKey(model, { key: "p", ctrlKey: true }), { type: "move-selection", direction: "previous" });
  assert.deepEqual(resolveSnoozeCardKey(model, { key: "n", ctrlKey: true }), { type: "move-selection", direction: "next" });
  assert.deepEqual(resolveSnoozeCardKey(model, { key: "Tab" }), { type: "complete-selection" });
  assert.deepEqual(resolveSnoozeCardKey(model, { key: "Enter" }), { type: "confirm" });
  assert.deepEqual(resolveSnoozeCardKey(model, { key: "Escape" }), { type: "close-card" });
  assert.deepEqual(resolveSnoozeCardKey(model, { key: "[", ctrlKey: true, code: "BracketLeft" }), { type: "close-card" });
  assert.deepEqual(resolveSnoozeCardKey(model, { key: "Enter", repeat: true }), { type: "ignored", reason: "repeated-action-key" });
  assert.equal(resolveSnoozeCardKey(model, { key: "a", isComposing: true }), null);
});

test("q closes outside a text control and types inside one", () => {
  const model = { kind: "snooze-card" };
  assert.deepEqual(resolveSnoozeCardKey(model, { key: "q", target: { tagName: "DIV" } }), { type: "close-card" });
  assert.equal(resolveSnoozeCardKey(model, { key: "q", target: { tagName: "INPUT" } }), null);
});

test("in-text helper formats relative durations", () => {
  assert.equal(snoozeCardInText(14 * 60, 13 * 60), "in 1h");
  assert.equal(snoozeCardInText(15 * 60 + 30, 13 * 60 + 20), "in 2h 10m");
  assert.equal(snoozeCardInText(13 * 60 + 10, 13 * 60), "in 10m");
});

test("Task Card exposes snooze after Schedule with the z shortcut", () => {
  assert.deepEqual(TASK_CARD_ROW_ORDER.slice(0, 3), ["schedule", "snooze", "depends-on"]);
  assert.equal(TASK_CARD_ROW_SHORTCUTS.snooze, "z");
  const minimal = planTaskCard({
    config: { properties: [] },
    content: "- [ ] #task Demo\n",
    lineText: "- [ ] #task Demo\n",
    cursorLine: 0,
    filePath: "notes/demo.md",
  });
  assert.equal(minimal.selectedRowId, "schedule");
  const ids = minimal.rows.map((row) => row.id);
  assert.ok(ids.includes("snooze"));
  const snoozeRow = minimal.rows.find((row) => row.id === "snooze");
  assert.equal(snoozeRow.action, "snooze");
  const single = planTaskCard({
    config: { properties: [] },
    content: "- [ ] #task Demo\n",
    lineText: "- [ ] #task Demo\n",
    cursorLine: 0,
    filePath: "notes/demo.md",
  });
  void single;
  const resolved = resolveTaskCardKey(minimal, { key: "z" });
  assert.equal(resolved.rowId, "snooze");
  assert.equal(resolved.type, "open-action");
  const repeated = resolveTaskCardKey(minimal, { key: "z", repeat: true });
  assert.equal(repeated.type, "ignored");
});

test("Alt+Z binding matches KeyZ on Mac option-key layouts", () => {
  assert.equal(snoozeCardIsAltZEvent({ altKey: true, code: "KeyZ", key: "Ω" }), true);
  assert.equal(snoozeCardIsAltZEvent({ altKey: true, key: "z" }), true);
  assert.equal(snoozeCardIsAltZEvent({ altKey: true, key: "Z" }), true);
  assert.equal(snoozeCardIsAltZEvent({ altKey: true, ctrlKey: true, key: "z" }), false);
  assert.equal(snoozeCardIsAltZEvent({ key: "z" }), false);
});
