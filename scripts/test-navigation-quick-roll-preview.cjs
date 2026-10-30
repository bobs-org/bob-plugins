// Roll preview for review-walk landings and api.quickRoll v1
// (plan 202610/quick_roll_alt_p.md, phase review-preview).
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  notices,
  helpers,
  createBulletPropertyPickerHarness,
  createPriorityPickerConfig,
} = require("./navigation-hotkeys-harness.cjs");

const {
  planPriorityRollRecommendationAtLine,
  planQuickRollPreview,
  quickRollPreviewForLine,
  appendQuickRollLine,
  createQuickRollApi,
  buildReviewJumpNotice,
  appendReviewPostLandingTail,
  validateBulletPropertyConfig,
  QUICK_ROLL_KEY_LABEL,
} = helpers;

const BASE_DATE = new Date(2026, 8, 30);
const fixedRandom = () => 0;

const ROLL = "- [ ] #task Roll [priority:: medium] [scheduled:: 2026-10-01] ^roll";
const DECAY = [
  "- [ ] #task Decay [priority:: medium] [scheduled:: 2026-10-01] ^decay",
  "\t- 🗓️ **SCHEDULE LOG**",
  "\t\t- *2026-10-01* — 🎲 P2 roll · in **17** (8–30) days",
].join("\n");
const CANCEL = [
  "- [ ] #task Cancel [priority:: lowest] [scheduled:: 2026-10-01] ^cancel",
  "\t- 🗓️ **SCHEDULE LOG**",
  "\t\t- *2026-10-01* — 🎲 P4 roll · in **200** (91–365) days",
].join("\n");
const RECURRING = [
  "- [ ] #task Recurring [priority:: lowest] [scheduled:: 2026-10-01] 🔁 ^recurring",
  "\t- 🗓️ **SCHEDULE LOG**",
  "\t\t- *2026-10-01* — 🎲 P4 roll · in **200** (91–365) days",
].join("\n");
const NOPRIORITY = "- [ ] #task No priority [scheduled:: 2026-10-01] ^none";
const CLOSED = "- [x] #task Done [priority:: medium] [scheduled:: 2026-10-01] ^done";
const PROJECT = [
  "---",
  "type: [[project]]",
  "scheduled: 2026-10-01",
  "---",
  "- [ ] #task Ship [priority:: medium] ^prj",
].join("\n");

function standardConfig() {
  return createPriorityPickerConfig();
}

function customLevels(levels, extra = {}) {
  return validateBulletPropertyConfig({
    properties: [
      { name: "scheduled", values: "date" },
      {
        name: "priority",
        values: "priority",
        schedules: "scheduled",
        levels,
        ...extra,
      },
    ],
  });
}

function pickerRecommendation(content, options = {}) {
  const harness = createBulletPropertyPickerHarness({
    content,
    cursor: options.cursor || { line: 0, ch: 0 },
    config: options.config || standardConfig(),
    baseDate: BASE_DATE,
    random: fixedRandom,
  });
  assert.equal(
    harness.open({
      config: harness.config,
      baseDate: BASE_DATE,
      random: fixedRandom,
    }),
    true,
  );
  const picker = harness.plugin.activeBulletPropertyPicker;
  assert.ok(picker, "Task Card opened");
  const recommendation = picker.computePriorityRollRecommendation();
  picker.close();
  return recommendation;
}

function sharedRecommendation(content, options = {}) {
  return planPriorityRollRecommendationAtLine({
    config: options.config || standardConfig(),
    content,
    line:
      options.cursor && Number.isInteger(options.cursor.line)
        ? options.cursor.line
        : 0,
    baseDate: BASE_DATE,
    random: fixedRandom,
  });
}

async function waitUntil(predicate, message) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message || "asynchronous picker action did not settle");
}

async function runQuickRoll(content, options = {}) {
  notices.length = 0;
  const harness = createBulletPropertyPickerHarness({
    content,
    cursor: options.cursor || { line: 0, ch: 0 },
    config: options.config || standardConfig(),
    baseDate: BASE_DATE,
    random: fixedRandom,
  });
  harness.plugin.rollByRecommendation(harness.editor, {
    config: harness.config,
    baseDate: BASE_DATE,
    random: fixedRandom,
  });
  await waitUntil(
    () => !harness.plugin.activeBulletPropertyPicker,
    "quick roll did not close its Task Card",
  );
  return harness.editor.getValue();
}

function scheduledOffset(content) {
  const match = /\[scheduled:: (\d{4})-(\d{2})-(\d{2})\]/.exec(
    String(content || ""),
  );
  assert.ok(match, "expected a scheduled date in the written content");
  const written = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return Math.round((written - BASE_DATE) / (24 * 60 * 60 * 1000));
}

test("the shared planner matches the Task Card recommendation", () => {
  const fixtures = [
    { name: "roll", content: ROLL },
    { name: "decay", content: DECAY },
    { name: "cancel", content: CANCEL },
    { name: "unavailable", content: RECURRING },
    { name: "no priority", content: NOPRIORITY },
    { name: "closed", content: CLOSED },
    { name: "project-inline", content: PROJECT, cursor: { line: 4, ch: 0 } },
  ];
  for (const fixture of fixtures) {
    assert.deepEqual(
      sharedRecommendation(fixture.content, fixture),
      pickerRecommendation(fixture.content, fixture),
      fixture.name,
    );
  }
});

test("the preview table strings are exact", () => {
  assert.equal(QUICK_ROLL_KEY_LABEL, "Alt+P");

  const roll = quickRollPreviewForLine({
    config: standardConfig(),
    content: ROLL,
    line: 0,
    tier: "rotten",
  });
  assert.deepEqual(roll, {
    ok: true,
    kind: "roll",
    line: "Alt+P roll P2 1/1 · 8–30d",
    compact: "Alt+P roll P2 1/1",
    detail: "Alt+P: roll P2 again (1 of 1), 8–30 days out",
  });

  const noLimit = quickRollPreviewForLine({
    config: customLevels(
      [
        { label: "P1", value: "high", min_days: 2, max_days: 7 },
        { label: "P2", value: "medium", min_days: 8, max_days: 30 },
        { label: "P3", value: "low", min_days: 31, max_days: 90 },
        { label: "P4", value: "lowest", min_days: 91, max_days: 365 },
      ],
      { decay: false },
    ),
    content: ROLL,
    line: 0,
    tier: "next",
  });
  assert.deepEqual(noLimit, {
    ok: true,
    kind: "roll",
    line: "Alt+P roll P2 · 8–30d",
    compact: "Alt+P roll P2",
    detail: "Alt+P: roll P2 again, 8–30 days out",
  });

  const oneDay = quickRollPreviewForLine({
    config: customLevels([
      { label: "P1", value: "high", min_days: 8, max_days: 8 },
      { label: "P2", value: "medium", min_days: 8, max_days: 30 },
    ]),
    content: "- [ ] #task One [priority:: high] [scheduled:: 2026-10-01] ^one",
    line: 0,
    tier: "next",
  });
  assert.deepEqual(oneDay, {
    ok: true,
    kind: "roll",
    line: "Alt+P roll P1 1/1 · 8d",
    compact: "Alt+P roll P1 1/1",
    detail: "Alt+P: roll P1 again (1 of 1), 8 days out",
  });

  const noBounds = planQuickRollPreview(
    { kind: "roll", level: { label: "P2" }, limit: 1, step: 1 },
    {},
  );
  assert.deepEqual(noBounds, {
    ok: true,
    kind: "roll",
    line: "Alt+P roll P2 1/1",
    compact: "Alt+P roll P2 1/1",
    detail: "Alt+P: roll P2 again (1 of 1)",
  });

  const decay = quickRollPreviewForLine({
    config: standardConfig(),
    content: DECAY,
    line: 0,
    tier: "next",
  });
  assert.deepEqual(decay, {
    ok: true,
    kind: "decay",
    line: "Alt+P decay P2 → P3 · 31–90d",
    compact: "Alt+P decay P2→P3",
    detail: "Alt+P: decay P2 → P3, 31–90 days out",
  });

  const cancel = quickRollPreviewForLine({
    config: standardConfig(),
    content: CANCEL,
    line: 0,
    tier: "rotten",
  });
  assert.deepEqual(cancel, {
    ok: true,
    kind: "cancel",
    line: "Alt+P cancel? · decayed past P4",
    compact: "Alt+P cancel?",
    detail: "Alt+P: cancel — decayed past P4 (confirm on the Task Card)",
  });

  const immediate = planQuickRollPreview(
    {
      kind: "cancel",
      level: { label: "P4" },
      streak: 2,
    },
    { cancelConfirms: false },
  );
  assert.deepEqual(immediate, {
    ok: true,
    kind: "cancel",
    line: "Alt+P cancel · decayed past P4",
    compact: "Alt+P cancel",
    detail: "Alt+P: cancel — decayed past P4",
  });

  const assign = quickRollPreviewForLine({
    config: standardConfig(),
    content: NOPRIORITY,
    line: 0,
    tier: "next",
  });
  assert.deepEqual(assign, {
    ok: true,
    kind: "assign",
    line: "Alt+P set P1 · 2–7d",
    compact: "Alt+P set P1",
    detail: "Alt+P: no priority — set P1, 2–7 days out",
  });
});

test("checklist tiers and unpreviewable rows report ok:false", () => {
  const config = standardConfig();
  for (const tier of ["pre", "post", "PRE", "POST"]) {
    assert.deepEqual(
      quickRollPreviewForLine({ config, content: ROLL, line: 0, tier }),
      { ok: false, reason: "checklist-tier" },
      tier,
    );
  }
  assert.deepEqual(quickRollPreviewForLine({ config, content: NOPRIORITY, line: 0, tier: "next" }), {
    ok: true,
    kind: "assign",
    line: "Alt+P set P1 · 2–7d",
    compact: "Alt+P set P1",
    detail: "Alt+P: no priority — set P1, 2–7 days out",
  });
  for (const tier of ["pre", "post"]) {
    assert.deepEqual(
      quickRollPreviewForLine({ config, content: NOPRIORITY, line: 0, tier }),
      { ok: false, reason: "checklist-tier" },
      `nopriority ${tier}`,
    );
  }
  assert.equal(
    quickRollPreviewForLine({ config, content: CLOSED, line: 0, tier: "next" }).ok,
    false,
  );
  assert.equal(
    quickRollPreviewForLine({ config, content: RECURRING, line: 0, tier: "next" }).ok,
    false,
  );
  assert.equal(
    quickRollPreviewForLine({ config, content: "- just a line", line: 0, tier: "next" })
      .ok,
    false,
  );
});

test("a silent config failure reports ok:false with no Notice", () => {
  notices.length = 0;
  const before = notices.length;
  const preview = quickRollPreviewForLine({
    config: null,
    content: ROLL,
    line: 0,
    tier: "next",
  });
  assert.deepEqual(preview, { ok: false, reason: "no-config" });
  assert.equal(notices.length, before, "no Notice was shown");
});

function queueEntry({ tier, line, text }) {
  return {
    key: `walk.md:${line}`,
    path: "walk.md",
    line,
    originalMarkdown: `- [ ] #task ${text}`,
    text,
    state: null,
    bucket: null,
    tier,
    tierLabel: tier.toUpperCase(),
    lane: "ready",
    fresh: "2026-10-06",
    dueOn: "2026-10-08",
    daysOverdue: 5,
    interval: 7,
    rank: 14,
    tierRank: 2,
    tierTotal: 9,
  };
}

test("landing toasts append the preview after tails", () => {
  const rottenNotice = buildReviewJumpNotice(
    queueEntry({ tier: "rotten", line: 1, text: "Rot" }),
    14,
    31,
    { todayText: "2026-10-08" },
  );
  assert.equal(
    rottenNotice,
    "Review 14/31 · ROTTEN 2/9 · rotten 5d · every 7d",
  );
  assert.equal(
    appendQuickRollLine(rottenNotice, "Alt+P roll P2 1/1 · 8–30d"),
    "Review 14/31 · ROTTEN 2/9 · rotten 5d · every 7d\nAlt+P roll P2 1/1 · 8–30d",
  );

  const nextNotice = buildReviewJumpNotice(
    queueEntry({ tier: "next", line: 2, text: "Next" }),
    5,
    31,
    { todayText: "2026-10-08" },
  );
  assert.deepEqual(nextNotice.split("\n"), [
    "Review 5/31 · NEXT 2/9 · confirmed 2 days ago",
    "Still next? Ctrl+Alt+F keep · Alt+N release · Ctrl+Shift+Enter today",
  ]);
  assert.equal(
    appendQuickRollLine(nextNotice, "Alt+P decay P1 → P2 · 8–30d"),
    "Review 5/31 · NEXT 2/9 · confirmed 2 days ago\nStill next? Ctrl+Alt+F keep · Alt+N release · Ctrl+Shift+Enter today\nAlt+P decay P1 → P2 · 8–30d",
  );

  const wrapped = buildReviewJumpNotice(
    queueEntry({ tier: "rotten", line: 1, text: "Rot" }),
    14,
    31,
    { todayText: "2026-10-08", wrapped: true },
  );
  assert.match(wrapped, /wrapped around$/);
  const wrappedTailed = appendQuickRollLine(wrapped, "Alt+P roll P2 1/1 · 8–30d");
  assert.match(wrappedTailed, /wrapped around\nAlt\+P roll P2 1\/1 · 8–30d$/);

  const posted = appendReviewPostLandingTail(rottenNotice, {
    commitments: 2,
    rotten: 1,
    post: 3,
  });
  assert.match(posted, /2 commitments due · 1 ROTTEN left$/);
  const postedTailed = appendQuickRollLine(posted, "Alt+P roll P2 1/1 · 8–30d");
  assert.match(postedTailed, /ROTTEN left\nAlt\+P roll P2 1\/1 · 8–30d$/);

  assert.equal(appendQuickRollLine(rottenNotice, ""), rottenNotice);
});

test("api.quickRoll has the v1 shape and never throws", () => {
  const missing = createQuickRollApi(null);
  assert.equal(missing.version, 1);
  assert.equal(missing.keyLabel, "Alt+P");
  assert.deepEqual(missing.preview({ content: ROLL, line: 0, tier: "next" }), {
    ok: false,
    reason: "unavailable",
  });

  const api = createQuickRollApi({});
  assert.equal(api.version, 1);
  assert.equal(api.keyLabel, "Alt+P");
  assert.equal(typeof api.preview, "function");
  const preview = api.preview({ content: NOPRIORITY, line: 0, tier: "next" });
  assert.equal(preview.ok, false);
  const fromLines = api.preview({
    lines: NOPRIORITY.split("\n"),
    line: 0,
    tier: "next",
  });
  assert.equal(fromLines.ok, false);
  for (const bad of [null, undefined, {}, "x", { line: "0" }]) {
    const settled = api.preview(bad);
    assert.equal(typeof settled, "object");
    assert.equal(settled.ok, false);
  }
  assert.ok(Object.isFrozen(api));
  assert.ok(Object.isFrozen(api.preview({ content: ROLL, line: 0 })));
});

test("the preview matches what Alt+P then writes", async () => {
  const config = standardConfig();

  const rollPreview = quickRollPreviewForLine({
    config,
    content: ROLL,
    line: 0,
    tier: "rotten",
  });
  assert.equal(rollPreview.ok, true);
  assert.equal(rollPreview.kind, "roll");
  const writtenRoll = await runQuickRoll(ROLL);
  const rollOffset = scheduledOffset(writtenRoll);
  assert.ok(
    rollOffset >= 8 && rollOffset <= 30,
    `rolled ${rollOffset}d lands in the previewed 8–30d window`,
  );
  assert.match(writtenRoll, /SCHEDULE LOG/);

  const decayPreview = quickRollPreviewForLine({
    config,
    content: DECAY,
    line: 0,
    tier: "next",
  });
  assert.equal(decayPreview.ok, true);
  assert.equal(decayPreview.kind, "decay");
  const writtenDecay = await runQuickRoll(DECAY);
  assert.match(writtenDecay, /\[priority:: low\]/);
  const decayOffset = scheduledOffset(writtenDecay);
  assert.ok(
    decayOffset >= 31 && decayOffset <= 90,
    `decayed ${decayOffset}d lands in the previewed 31–90d window`,
  );

  const cancelPreview = quickRollPreviewForLine({
    config,
    content: CANCEL,
    line: 0,
    tier: "rotten",
  });
  assert.equal(cancelPreview.ok, true);
  assert.equal(cancelPreview.kind, "cancel");
});
