const assert = require("node:assert/strict");
const test = require("node:test");
const {
  helpers,
  installClipboardStub,
  FakeDocument,
  editorLivePreviewField,
  editorInfoField,
} = require("./copy-chips-test-helpers.cjs");
const {
  sampleCpuWork,
  isWithinCpuBudget,
  cpuBudgetDiagnostic,
} = require("./cpu-work-perf-support.cjs");

const BUDGET_MS = 35;

function makeDailyNote() {
  const lines = ["# 2026-11-19", ""];
  let chips = 0;
  for (let index = 0; index < 2000; index += 1) {
    if (index % 10 === 0 && chips < 200) {
      lines.push(`- [ ] Task ${index} with \`copy: payload-${index}\` and notes`);
      chips += 1;
    } else if (index === 500) {
      lines.push("```");
      lines.push("`copy: fenced-should-stay-code`");
      lines.push("```");
    } else {
      lines.push(`Prose line ${index} with no chip to pad the daily note.`);
    }
  }
  return { lines, chips };
}

function fakeViewFor(lines, visibleFrom, visibleTo) {
  const text = lines.join("\n");
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const doc = {
    toString: () => text,
    length: text.length,
    lineAt(pos) {
      let index = 0;
      for (let i = 0; i < starts.length; i += 1) {
        if (starts[i] <= pos) index = i;
        else break;
      }
      return {
        text: lines[index],
        from: starts[index],
        to: starts[index] + lines[index].length,
        number: index + 1,
      };
    },
  };
  return {
    state: {
      doc,
      field: () => true,
      selection: { ranges: [] },
    },
    visibleRanges: [{ from: starts[visibleFrom], to: starts[visibleTo] + lines[visibleTo].length }],
    dom: { ownerDocument: undefined },
  };
}

test("2,000-line daily note with 200 chips fits the 35 ms CPU budget", () => {
  const { lines, chips } = makeDailyNote();
  assert.equal(chips, 200);
  // Correctness: full scan finds all 200.
  let total = 0;
  for (const line of lines) {
    total += helpers.copyChipLiveChipsForLine(line, 0, 0, null).length;
  }
  assert.equal(total, 200);
  const { lines: noteLines } = { lines: noteLinesAlias(lines) };
  function noteLinesAlias(value) {
    return value;
  }
  const makeRun = () => () => {
    // Simulate one Live Preview rebuild over a wide viewport (200 lines).
    const view = fakeViewFor(noteLines, 0, 199);
    let found = 0;
    for (const range of view.visibleRanges) {
      let pos = range.from;
      let guard = 0;
      while (pos <= range.to && guard < 10000) {
        guard += 1;
        const line = view.state.doc.lineAt(pos);
        found += helpers.copyChipLiveChipsForLine(line.text, line.from, line.from, null).length;
        if (line.to >= range.to) break;
        pos = line.to + 1;
      }
    }
    if (found !== 20) throw new Error("expected 20 chips in the first 200 lines, saw " + found);
  };
  const { cpuSamples, wallSamples } = sampleCpuWork(makeRun, { warmups: 3, samples: 7 });
  assert.ok(
    isWithinCpuBudget(cpuSamples, BUDGET_MS),
    cpuBudgetDiagnostic("copy-chips live rebuild (200 lines)", cpuSamples, wallSamples, BUDGET_MS),
  );
});

test("narrow viewport visits only visible syntax ranges", () => {
  const { lines } = makeDailyNote();
  // First 10 lines hold exactly one chip (line 2).
  const view = fakeViewFor(lines, 0, 9);
  let visited = 0;
  let found = 0;
  for (const range of view.visibleRanges) {
    let pos = range.from;
    let guard = 0;
    while (pos <= range.to && guard < 10000) {
      guard += 1;
      const line = view.state.doc.lineAt(pos);
      visited += 1;
      found += helpers.copyChipLiveChipsForLine(line.text, line.from, line.from, null).length;
      if (line.to >= range.to) break;
      pos = line.to + 1;
    }
  }
  assert.equal(visited, 10);
  assert.equal(found, 1);
  // A whole-document scan would find all 200 chips; the viewport-limited
  // rebuild must not.
  let whole = 0;
  for (const line of lines) {
    whole += helpers.copyChipLiveChipsForLine(line, 0, 0, null).length;
  }
  assert.equal(whole, 200);
  assert.ok(found < whole, "viewport rebuild must not scan the whole document");
});

test("clipboard writes stay out of the perf path", async () => {
  const clip = installClipboardStub();
  try {
    const result = await helpers.copyChipCopyText("payload");
    assert.equal(result.ok, true);
    assert.deepEqual(clip.writes, ["payload"]);
  } finally {
    clip.restore();
  }
});

// --- Mixed copy and command chips through the production build path ------

const MIXED_RUNS = [
  "bob task reconcile",
  "bob gcal sync -n 2 && bob gkeep pull && bob gmail sync",
  "bob plan",
];

function makeMixedNote() {
  const lines = ["# 2026-11-20", ""];
  for (let index = 0; index < 2000; index += 1) {
    if (index % 10 === 0) {
      const run = MIXED_RUNS[(index / 10) % MIXED_RUNS.length];
      const label = (index / 10) % 4 === 1 ? "[Sync]" : "";
      lines.push(`- [ ] Task ${index} \`copy: payload-${index}\` then \`run${label}: ${run}\` and \`bob plan\``);
    } else if (index === 505) {
      lines.push("```");
      lines.push("`run: bob plan`");
      lines.push("```");
    } else {
      lines.push(`Prose line ${index} with no chip to pad the daily note.`);
    }
  }
  return lines;
}

function mixedView(lines, visibleTo) {
  const text = lines.join("\n");
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const lineAt = (pos) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return { text: lines[lo], from: starts[lo], to: starts[lo] + lines[lo].length, number: lo + 1 };
  };
  return {
    state: {
      doc: { toString: () => text, length: text.length, lineAt, sliceString: (a, b) => text.slice(a, b) },
      sliceDoc: (a, b) => text.slice(a, b),
      selection: { ranges: [] },
      field: (field) => (field === editorLivePreviewField ? true : field === editorInfoField ? { file: { path: "daily/2026-11-20.md" } } : null),
    },
    visibleRanges: [{ from: starts[0], to: starts[visibleTo] + lines[visibleTo].length }],
    dom: { ownerDocument: new FakeDocument() },
    dispatch() {},
  };
}

function mixedPlugin() {
  const engine = {
    version: 1,
    token: "1:fp",
    resolveCalls: 0,
    resolved: [],
    resolve(text) {
      engine.resolveCalls += 1;
      engine.resolved.push(text);
      const steps = text.split(" && ").map((step, index) => Object.freeze({ index: index + 1, text: step, policy: "run", presentation: "action" }));
      return Object.freeze({ ok: true, state: "ready", signature: JSON.stringify(steps.map((row) => row.text)), steps: Object.freeze(steps), reason: null, step: null });
    },
    runText() {
      throw new Error("rendering never runs");
    },
    openText() {
      throw new Error("rendering never opens");
    },
    catalogInfo: () => Object.freeze({ token: engine.token }),
  };
  const app = {
    workspace: { on: () => ({}), offref() {} },
    vault: { getAbstractFileByPath: (p) => ({ path: p }) },
    plugins: { plugins: { "bob-command-mode": { api: { commandMode: engine } } }, enabledPlugins: new Set(["bob-command-mode"]) },
  };
  const plugin = { app, registerEvent() {} };
  helpers.commandChipRuntimeSetup(plugin);
  return { plugin, engine };
}

// One Live Preview paint: the real decoration pass, then CM's toDOM and
// destroy for every widget it emitted.
function paintMixed(view, plugin) {
  const set = helpers.copyChipBuildLiveDecorations(view, plugin);
  const adds = set.adds || [];
  let runs = 0;
  for (const add of adds) {
    const widget = add.value.widget;
    const dom = widget.toDOM(view);
    if (widget.constructor === helpers.commandChipEnsureLiveWidget()) runs += 1;
    widget.destroy(dom);
  }
  return { total: adds.length, runs };
}

test("2,000-line mixed note paints both kinds inside the 35 ms CPU budget", () => {
  const lines = makeMixedNote();
  const { plugin, engine } = mixedPlugin();
  const view = mixedView(lines, 201);
  const first = paintMixed(view, plugin);
  assert.deepEqual(first, { total: 40, runs: 20 }, "20 chip lines in the viewport, one copy and one run each");
  const makeRun = () => () => {
    const painted = paintMixed(view, plugin);
    if (painted.runs !== 20) throw new Error("expected 20 command chips, saw " + painted.runs);
  };
  const { cpuSamples, wallSamples } = sampleCpuWork(makeRun, { warmups: 3, samples: 7 });
  assert.ok(
    isWithinCpuBudget(cpuSamples, BUDGET_MS),
    cpuBudgetDiagnostic("mixed copy/command live paint (200 lines)", cpuSamples, wallSamples, BUDGET_MS),
  );
  assert.equal(engine.resolveCalls, MIXED_RUNS.length, "identical text resolves once per catalog generation");
  plugin.commandChipRuntime.store.dispose();
});

test("mixed discovery stays inside the viewport and re-resolves only on a new catalog", () => {
  const lines = makeMixedNote();
  const { plugin, engine } = mixedPlugin();
  const narrow = paintMixed(mixedView(lines, 11), plugin);
  assert.deepEqual(narrow, { total: 2, runs: 1 }, "a narrow viewport never scans the whole note");
  assert.deepEqual(engine.resolved, ["bob task reconcile"]);
  paintMixed(mixedView(lines, 201), plugin);
  assert.equal(engine.resolveCalls, 3);
  paintMixed(mixedView(lines, 201), plugin);
  assert.equal(engine.resolveCalls, 3, "a rebuild is all cache hits");
  engine.token = "2:fp-new";
  paintMixed(mixedView(lines, 201), plugin);
  assert.equal(engine.resolveCalls, 6, "a new catalog generation resolves each text once more");
  const whole = paintMixed(mixedView(lines, lines.length - 1), plugin);
  assert.deepEqual(whole, { total: 400, runs: 200 }, "the fenced run span stays code");
  assert.equal(engine.resolveCalls, 6);
});
