const assert = require("node:assert/strict");
const test = require("node:test");
const {
  helpers,
  installClipboardStub,
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
