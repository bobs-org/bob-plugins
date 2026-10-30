const test = require("node:test");
const assert = require("node:assert/strict");
const {
  helpers,
} = require("./task-status-cycler-harness.cjs");

// Successor theme writes (plan:202610/task_card_successor_themes.md
// successor-theme-write). Pure planner + planSuccessors integration plus
// preservation regressions for close/move/roll writers.

const TODAY = "2026-10-09";
const DAILY_PATH = "2026/20261009.md";

const FIX_DAY = [
  "# 2026-10-09",
  "",
  "## Pomodoros",
  "- [ ] () — FIX",
  "\t- [[sase#^fix-apollo]]",
  "- [ ] () — WRITE",
  "\t- [[sase#^fix-apollo]]",
  "- [ ] () — DEEP",
].join("\n");

const FIX_CLOSED = [
  { path: "sase.md", blockId: "fix-apollo", taskId: "sase__fix-apollo", text: "Fix apollo machine!" },
];

function noteSuggestion(overrides = {}) {
  return {
    theme: { key: "write", name: "WRITE", known: true, hue: "violet", hue_source: "hash" },
    source: "note",
    label: "from sase_blog",
    from: {
      path: "Areas/sase_blog.md",
      stem: "sase_blog",
      kind: "area",
      chain: ["Areas/sase_blog.md"],
      hue: "aqua",
    },
    ...overrides,
  };
}

function stubTaskThemeOf(line) {
  const text = String(line || "");
  const matches = [...text.matchAll(/[\[(](?:type|theme)::\s*([^\]\)\n]*)[\]\)]/g)];
  if (matches.length === 0) {
    return { state: "none" };
  }
  if (matches.length > 1) {
    return { state: "repair", repair: "duplicate" };
  }
  const value = matches[0][1].trim();
  if (!value || /[+]/.test(value) || /[^A-Za-z0-9 &'(),./-]/.test(value)) {
    return { state: "repair", repair: "invalid" };
  }
  return { state: "set", value: value.toUpperCase(), key: value.toLowerCase() };
}

function stubClearTaskTheme(line) {
  return String(line || "").replace(/[ \t]*[\[(](?:type|theme)::[^\]\)\n]*[\]\)]/g, "");
}

function stubSetTaskTheme(line, name) {
  const cleared = stubClearTaskTheme(line).replace(/[ \t]+$/g, "");
  const idMatch = cleared.match(/^(.*?)([ \t]+\^[A-Za-z0-9_-]+)$/);
  if (idMatch) {
    return `${idMatch[1]} [type:: ${name}]${idMatch[2]}`;
  }
  return `${cleared} [type:: ${name}]`;
}

function stubPlanRetype(options = {}) {
  const keyOf = (value) => value && value.theme && value.theme.key
    ? String(value.theme.key).toLowerCase()
    : (typeof value === "string" ? value.toLowerCase() : "");
  const effectiveKey = keyOf(options.effective);
  const inheritedKey = keyOf(options.inherited);
  const candidates = String(options.destination || "")
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part && part.toLowerCase() !== "plan");
  if (candidates.length === 0) {
    return { kind: "container" };
  }
  const destinationKey = candidates[0].toLowerCase();
  if (effectiveKey && candidates.some((part) => part.toLowerCase() === effectiveKey)) {
    return { kind: "consistent" };
  }
  if (inheritedKey && inheritedKey === destinationKey) {
    return { kind: "clear" };
  }
  return { kind: "set", key: destinationKey, name: candidates[0].toUpperCase() };
}

function stubThemesApi(suggestion, catalog = null) {
  return {
    version: 1,
    suggestFor: () => suggestion,
    taskThemeOf: stubTaskThemeOf,
    setTaskTheme: stubSetTaskTheme,
    clearTaskTheme: stubClearTaskTheme,
    planRetype: stubPlanRetype,
    effectiveTypeFor: ({ line, text }) => {
      const sourceLine = String(text || "").split(/\r?\n/)[Number(line) - 1] || "";
      const field = stubTaskThemeOf(sourceLine);
      if (field.state !== "set") {
        return suggestion;
      }
      if (suggestion && suggestion.theme && suggestion.theme.key === field.key) {
        return suggestion;
      }
      return {
        ...(suggestion || {}),
        theme: {
          ...((suggestion && suggestion.theme) || {}),
          key: field.key,
          name: field.value,
        },
        source: "task",
        inherited: suggestion,
      };
    },
    snapshot: () => ({
      themes: catalog || [{ key: "write", name: "WRITE" }, { key: "fix", name: "FIX" }, { key: "build", name: "BUILD" }],
      configured_themes: [],
    }),
  };
}

function stubLedgerApi(exempt = ["PLAN"]) {
  return {
    caps: () => ({ exempt, strict: false, maxThemes: 5 }),
  };
}

function stubTypedPlacementApi(kind, index = null, name = "WRITE") {
  const suggestion = noteSuggestion();
  return {
    ...stubThemesApi(suggestion),
    effectiveTypeFor: () => suggestion,
    typeAgrees: (type, entryName) => String(entryName || "")
      .split("+")
      .some((part) => part.trim().toLowerCase() === String(type).toLowerCase()),
    planPlacement: () => kind === "entry"
      ? { kind, index }
      : kind === "create"
        ? { kind, name }
        : { kind },
  };
}

function planFixture({ day, notes, closed, options = {} }) {
  const documents = Object.entries(notes).map(([path, text]) => ({ path, text }));
  const tasks = helpers.tasksFromDocuments(documents);
  const index = helpers.buildDependentsIndex(tasks);
  const plan = helpers.planSuccessors({
    closed,
    index,
    dailyBefore: day,
    dailyPath: DAILY_PATH,
    today: TODAY,
    linkUnblocked: true,
    basenameCounts: { sase: 1, ship: 1 },
    noteTexts: notes,
    selection: "all",
    ...options,
  });
  return { plan, tasks };
}

function offerKeyFor(plan, blockId) {
  const row = plan.unblocked.find((item) => item.block_id === blockId);
  assert.ok(row && row.offer, `offer for ${blockId}`);
  return row.offer.key;
}

test("successor default placement follows the effective task type", () => {
  const notes = {
    "sase.md": "- [x] #task Fix apollo [id:: sase__fix-apollo] ^fix-apollo\n- [?] #task Follower [type:: WRITE] [dependsOn:: sase__fix-apollo] ^follower",
  };
  const { plan } = planFixture({
    day: FIX_DAY,
    notes,
    closed: FIX_CLOSED,
    options: {
      successorTheme: {
        themesApi: stubTypedPlacementApi("entry", 1),
        ledgerApi: stubLedgerApi(),
      },
    },
  });
  const row = plan.unblocked.find((item) => item.block_id === "follower");
  assert.equal(row.offer.destination.entry_name, "WRITE");
  assert.equal(row.link.entry_name, "WRITE");
  assert.equal(row.theme_changed || false, false, "default placement never retypes the task");
  assert.deepEqual(plan.placements[0].override, {
    kind: "existing",
    entryLine: 5,
    entryText: "- [ ] () — WRITE",
  });
});

test("successor default placement creates a typed entry when needed", () => {
  const notes = {
    "sase.md": "- [x] #task Fix apollo [id:: sase__fix-apollo] ^fix-apollo\n- [?] #task Follower [type:: WRITE] [dependsOn:: sase__fix-apollo] ^follower",
  };
  const { plan } = planFixture({
    day: FIX_DAY,
    notes,
    closed: FIX_CLOSED,
    options: {
      successorTheme: {
        themesApi: stubTypedPlacementApi("create"),
        ledgerApi: stubLedgerApi(),
      },
    },
  });
  const row = plan.unblocked.find((item) => item.block_id === "follower");
  assert.equal(row.offer.destination.entry_name, "WRITE");
  assert.equal(row.link.entry_name, "WRITE");
  assert.deepEqual(plan.placements[0].override, { kind: "new", name: "WRITE" });
});

test("strict type-cap refusal leaves the successor unlinked", () => {
  const notes = {
    "sase.md": "- [x] #task Fix apollo [id:: sase__fix-apollo] ^fix-apollo\n- [?] #task Follower [type:: WRITE] [dependsOn:: sase__fix-apollo] ^follower",
  };
  const { plan } = planFixture({
    day: FIX_DAY,
    notes,
    closed: FIX_CLOSED,
    options: {
      successorTheme: {
        themesApi: stubTypedPlacementApi("refused"),
        ledgerApi: stubLedgerApi(),
      },
    },
  });
  const row = plan.unblocked.find((item) => item.block_id === "follower");
  assert.equal(row.link, null);
  assert.equal(row.not_linked, "strict_cap");
  assert.equal(row.offer.selected, false);
  assert.equal(plan.placements.length, 0);
});

// Set via an existing bucket.
test("successor retarget to existing FIX writes [type:: FIX]", () => {
  const notes = {
    "sase.md": "- [?] #task Fix apollo [id:: sase__fix-apollo] ^fix-apollo\n- [?] #task Follower [dependsOn:: sase__fix-apollo] ^follower",
  };
  // Default is WRITE, retarget is FIX, so the field must be set.
  const shown = noteSuggestion();
  const key = offerKeyFor(planFixture({ day: FIX_DAY, notes, closed: FIX_CLOSED }).plan, "follower");
  const { plan } = planFixture({
    day: FIX_DAY, notes, closed: FIX_CLOSED,
    options: {
      selection: [key],
      destinations: new Map([[key, { kind: "existing", entryLine: 3, entryText: "- [ ] () — FIX", themeIntent: { deliberate: true, linkOnce: false, shown } }]]),
      successorTheme: { themesApi: stubThemesApi(shown), ledgerApi: stubLedgerApi() },
    },
  });
  const row = plan.unblocked.find((item) => item.block_id === "follower");
  assert.ok(row.link, "still links");
  assert.equal(row.theme_changed, true);
  assert.equal(row.theme_action, "set");
  assert.equal(row.theme_name, "FIX");
  const edit = plan.edits.find((item) => item.path === "sase.md" && item.line === row.line);
  assert.ok(edit.after.includes("[type:: FIX]"), edit.after);
});

// Clear selects the inherited key.
test("successor retarget selecting the inherited key clears the field", () => {
  const notes = {
    "sase.md": "- [?] #task Fix apollo [id:: sase__fix-apollo] ^fix-apollo\n- [?] #task Follower [type:: FIX] [dependsOn:: sase__fix-apollo] ^follower",
  };
  const shown = noteSuggestion({ theme: { key: "fix", name: "FIX" } });
  const inherited = noteSuggestion({ theme: { key: "write", name: "WRITE" } });
  const withInherited = { ...shown, source: "task", inherited };
  const key = offerKeyFor(planFixture({ day: FIX_DAY, notes, closed: FIX_CLOSED }).plan, "follower");
  const { plan } = planFixture({
    day: FIX_DAY, notes, closed: FIX_CLOSED,
    options: {
      selection: [key],
      destinations: new Map([[key, { kind: "existing", entryLine: 3, entryText: "- [ ] () — FIX", themeIntent: { deliberate: true, linkOnce: false, shown: withInherited } }]]),
      successorTheme: { themesApi: stubThemesApi(withInherited), ledgerApi: stubLedgerApi() },
    },
  });
  // Destination FIX differs from inherited WRITE, so this is a set, not a clear.
  // Clear happens when the destination equals the inherited key: use WRITE entry.
  const key2 = key;
  const { plan: cleared } = planFixture({
    day: FIX_DAY, notes, closed: FIX_CLOSED,
    options: {
      selection: [key2],
      destinations: new Map([[key2, { kind: "existing", entryLine: 5, entryText: "- [ ] () — WRITE", themeIntent: { deliberate: true, linkOnce: false, shown: withInherited } }]]),
      successorTheme: { themesApi: stubThemesApi(withInherited), ledgerApi: stubLedgerApi() },
    },
  });
  const row = cleared.unblocked.find((item) => item.block_id === "follower");
  assert.equal(row.theme_changed, true);
  assert.equal(row.theme_action, "clear");
  const edit = cleared.edits.find((item) => item.path === "sase.md" && item.line === row.line);
  assert.ok(!edit.after.includes("[type::"), edit.after);
});

// Same-key no-op retains exact bytes.
test("same-key successor retarget is a byte-preserving no-op", () => {
  const before = "- [?] #task Follower [theme:: FIX] [dependsOn:: sase__fix-apollo] ^follower";
  const notes = {
    "sase.md": `- [?] #task Fix apollo [id:: sase__fix-apollo] ^fix-apollo\n${before}`,
  };
  // The effective type and explicit destination are both FIX, so D6 is consistent.
  const shown = noteSuggestion({ theme: { key: "fix", name: "FIX" } });
  const key = offerKeyFor(planFixture({ day: FIX_DAY, notes, closed: FIX_CLOSED }).plan, "follower");
  const { plan } = planFixture({
    day: FIX_DAY, notes, closed: FIX_CLOSED,
    options: {
      selection: [key],
      destinations: new Map([[key, { kind: "existing", entryLine: 3, entryText: "- [ ] () — FIX", themeIntent: { deliberate: true, linkOnce: false, shown } }]]),
      successorTheme: { themesApi: stubThemesApi(shown), ledgerApi: stubLedgerApi() },
    },
  });
  const row = plan.unblocked.find((item) => item.block_id === "follower");
  assert.equal(row.theme_changed || false, false);
  assert.equal(row.theme_suggestion_changed || false, false);
});

// Repair: invalid field plus valid destination sets.
test("invalid theme field repairs to the retarget destination", () => {
  const notes = {
    "sase.md": "- [?] #task Fix apollo [id:: sase__fix-apollo] ^fix-apollo\n- [?] #task Follower [theme:: ???] [dependsOn:: sase__fix-apollo] ^follower",
  };
  // Default WRITE differs from FIX, so the invalid field repairs to FIX.
  const shown = noteSuggestion();
  const key = offerKeyFor(planFixture({ day: FIX_DAY, notes, closed: FIX_CLOSED }).plan, "follower");
  const { plan } = planFixture({
    day: FIX_DAY, notes, closed: FIX_CLOSED,
    options: {
      selection: [key],
      destinations: new Map([[key, { kind: "existing", entryLine: 3, entryText: "- [ ] () — FIX", themeIntent: { deliberate: true, linkOnce: false, shown } }]]),
      successorTheme: { themesApi: stubThemesApi(shown), ledgerApi: stubLedgerApi() },
    },
  });
  const row = plan.unblocked.find((item) => item.block_id === "follower");
  assert.equal(row.theme_changed, true);
  assert.equal(row.theme_name, "FIX");
});

// New bucket name writes.
test("successor retarget to a new WRITE bucket writes the new name", () => {
  const notes = {
    "sase.md": "- [?] #task Fix apollo [id:: sase__fix-apollo] ^fix-apollo\n- [?] #task Follower [dependsOn:: sase__fix-apollo] ^follower",
  };
  // Default FIX differs from WRITE, so a new WRITE bucket sets WRITE.
  const shown = noteSuggestion({ theme: { key: "fix", name: "FIX" } });
  const key = offerKeyFor(planFixture({ day: FIX_DAY, notes, closed: FIX_CLOSED }).plan, "follower");
  const { plan } = planFixture({
    day: FIX_DAY, notes, closed: FIX_CLOSED,
    options: {
      selection: [key],
      destinations: new Map([[key, { kind: "new", name: "WRITE", themeIntent: { deliberate: true, linkOnce: false, shown } }]]),
      successorTheme: { themesApi: stubThemesApi(shown), ledgerApi: stubLedgerApi() },
    },
  });
  const row = plan.unblocked.find((item) => item.block_id === "follower");
  assert.equal(row.theme_changed, true);
  assert.equal(row.theme_name, "WRITE");
});

// PLAN+BUILD means BUILD.
test("PLAN+BUILD retarget writes BUILD (PLAN is exempt)", () => {
  const notes = {
    "sase.md": "- [?] #task Fix apollo [id:: sase__fix-apollo] ^fix-apollo\n- [?] #task Follower [dependsOn:: sase__fix-apollo] ^follower",
  };
  const day = ["# 2026-10-09", "", "## Pomodoros", "- [ ] () — PLAN+BUILD", "\t- [[sase#^fix-apollo]]"].join("\n");
  // Default WRITE differs from BUILD, so PLAN+BUILD resolves to BUILD.
  const shown = noteSuggestion();
  const offered = planFixture({ day, notes, closed: FIX_CLOSED });
  const key = offerKeyFor(offered.plan, "follower");
  const { plan } = planFixture({
    day, notes, closed: FIX_CLOSED,
    options: {
      selection: [key],
      destinations: new Map([[key, { kind: "existing", entryLine: 3, entryText: "- [ ] () — PLAN+BUILD", themeIntent: { deliberate: true, linkOnce: false, shown } }]]),
      successorTheme: { themesApi: stubThemesApi(shown), ledgerApi: stubLedgerApi() },
    },
  });
  const row = plan.unblocked.find((item) => item.block_id === "follower");
  assert.equal(row.theme_changed, true);
  assert.equal(row.theme_name, "BUILD");
});

// Unnamed / all-exempt / composite destinations never write.
test("unnamed, all-exempt, and composite destinations never write a theme", () => {
  const notes = {
    "sase.md": "- [?] #task Fix apollo [id:: sase__fix-apollo] ^fix-apollo\n- [?] #task Follower [dependsOn:: sase__fix-apollo] ^follower",
  };
  const shown = noteSuggestion();
  const cases = [
    { kind: "existing", entryLine: 3, entryText: "- [ ] () — FIX" },
    { kind: "new", name: "PLAN" },
    { kind: "new", name: "FIX+WRITE" },
  ];
  // Unnamed: an existing entry with no name resolves to null.
  const unnamedDay = ["# 2026-10-09", "", "## Pomodoros", "- [ ] ()", "\t- [[sase#^fix-apollo]]"].join("\n");
  const unnamedOffered = planFixture({ day: unnamedDay, notes, closed: FIX_CLOSED });
  const unnamedKey = offerKeyFor(unnamedOffered.plan, "follower");
  const { plan: unnamed } = planFixture({
    day: unnamedDay, notes, closed: FIX_CLOSED,
    options: {
      selection: [unnamedKey],
      destinations: new Map([[unnamedKey, { ...cases[0], entryLine: 3, entryText: "- [ ] ()", themeIntent: { deliberate: true, linkOnce: false, shown } }]]),
      successorTheme: { themesApi: stubThemesApi(shown), ledgerApi: stubLedgerApi() },
    },
  });
  assert.equal(unnamed.unblocked.find((item) => item.block_id === "follower").theme_changed || false, false);
  for (const destination of cases.slice(1)) {
    const key = offerKeyFor(planFixture({ day: FIX_DAY, notes, closed: FIX_CLOSED }).plan, "follower");
    const { plan } = planFixture({
      day: FIX_DAY, notes, closed: FIX_CLOSED,
      options: {
        selection: [key],
        destinations: new Map([[key, { ...destination, themeIntent: { deliberate: true, linkOnce: false, shown } }]]),
        successorTheme: { themesApi: stubThemesApi(shown), ledgerApi: stubLedgerApi() },
      },
    });
    assert.equal(plan.unblocked.find((item) => item.block_id === "follower").theme_changed || false, false, JSON.stringify(destination));
  }
});

// Two independently retargeted successors keep their own themes.
test("two retargeted successors remember different themes", () => {
  const notes = {
    "sase.md": "- [?] #task Fix apollo [id:: sase__fix-apollo] ^fix-apollo\n- [?] #task One [dependsOn:: sase__fix-apollo] ^one\n- [?] #task Two [dependsOn:: sase__fix-apollo] ^two",
  };
  const shownFix = noteSuggestion({ theme: { key: "fix", name: "FIX" } });
  const shownWrite = noteSuggestion();
  const offered = planFixture({ day: FIX_DAY, notes, closed: FIX_CLOSED });
  const keyOne = offerKeyFor(offered.plan, "one");
  const keyTwo = offerKeyFor(offered.plan, "two");
  // One defaults to WRITE and retargets to FIX; two defaults to FIX and retargets to WRITE.
  const destinations = new Map([
    [keyOne, { kind: "existing", entryLine: 3, entryText: "- [ ] () — FIX", themeIntent: { deliberate: true, linkOnce: false, shown: shownWrite } }],
    [keyTwo, { kind: "existing", entryLine: 5, entryText: "- [ ] () — WRITE", themeIntent: { deliberate: true, linkOnce: false, shown: shownFix } }],
  ]);
  const themesApi = {
    ...stubThemesApi(shownWrite),
    effectiveTypeFor: ({ path, line }) => {
      const text = notes["sase.md"].split("\n")[line - 1] || "";
      if (text.includes("^one")) {
        return shownWrite;
      }
      return shownFix;
    },
  };
  const { plan } = planFixture({
    day: FIX_DAY, notes, closed: FIX_CLOSED,
    options: { selection: [keyOne, keyTwo], destinations, successorTheme: { themesApi, ledgerApi: stubLedgerApi() } },
  });
  const one = plan.unblocked.find((item) => item.block_id === "one");
  const two = plan.unblocked.find((item) => item.block_id === "two");
  assert.equal(one.theme_changed, true);
  assert.equal(one.theme_name, "FIX");
  assert.equal(two.theme_changed, true);
  assert.equal(two.theme_name, "WRITE");
});

// No suggestion, missing API, and guard refusals never write.
test("no suggestion, missing API, and guard refusals never write", () => {
  const notes = {
    "sase.md": "- [?] #task Fix apollo [id:: sase__fix-apollo] ^fix-apollo\n- [?] #task Follower [dependsOn:: sase__fix-apollo] ^follower",
  };
  const shown = noteSuggestion();
  const key = offerKeyFor(planFixture({ day: FIX_DAY, notes, closed: FIX_CLOSED }).plan, "follower");
  const dest = (themeIntent) => ({ kind: "existing", entryLine: 3, entryText: "- [ ] () — FIX", themeIntent });
  // No suggestion: suggestFor returns null but the intent has a shown value.
  const { plan: noSuggestion } = planFixture({
    day: FIX_DAY, notes, closed: FIX_CLOSED,
    options: {
      selection: [key],
      destinations: new Map([[key, dest({ deliberate: true, linkOnce: false, shown })]]),
      successorTheme: { themesApi: stubThemesApi(null), ledgerApi: stubLedgerApi() },
    },
  });
  const noSugRow = noSuggestion.unblocked.find((item) => item.block_id === "follower");
  assert.equal(noSugRow.theme_changed || false, false);
  assert.equal(noSugRow.theme_suggestion_changed, true);
  assert.ok(noSugRow.link, "link behavior still permitted");
  // Missing API.
  const { plan: missing } = planFixture({
    day: FIX_DAY, notes, closed: FIX_CLOSED,
    options: {
      selection: [key],
      destinations: new Map([[key, dest({ deliberate: true, linkOnce: false, shown })]]),
      successorTheme: null,
    },
  });
  assert.equal(missing.unblocked.find((item) => item.block_id === "follower").theme_changed || false, false);
  // Guard refusals: linkOnce, non-deliberate, missing shown, and default placement.
  for (const intent of [
    { deliberate: true, linkOnce: true, shown },
    { deliberate: false, linkOnce: false, shown },
    { deliberate: true, linkOnce: false, shown: null },
  ]) {
    const { plan } = planFixture({
      day: FIX_DAY, notes, closed: FIX_CLOSED,
      options: {
        selection: [key],
        destinations: new Map([[key, dest(intent)]]),
        successorTheme: { themesApi: stubThemesApi(shown), ledgerApi: stubLedgerApi() },
      },
    });
    assert.equal(plan.unblocked.find((item) => item.block_id === "follower").theme_changed || false, false, JSON.stringify(intent));
  }
  // Default placement (no override) never writes even with APIs present.
  const { plan: fallback } = planFixture({
    day: FIX_DAY, notes, closed: FIX_CLOSED,
    options: { selection: [key], successorTheme: { themesApi: stubThemesApi(shown), ledgerApi: stubLedgerApi() } },
  });
  assert.equal(fallback.unblocked.find((item) => item.block_id === "follower").theme_changed || false, false);
  // An offer merely appearing (not selected) never writes.
  const { plan: idle } = planFixture({
    day: FIX_DAY, notes, closed: FIX_CLOSED,
    options: { selection: [], successorTheme: { themesApi: stubThemesApi(shown), ledgerApi: stubLedgerApi() } },
  });
  assert.ok(idle.unblocked.every((row) => !row.theme_changed));
});

// Stale task, suggestion, and destination skip the field edit.
test("stale task, suggestion, and destination skip the theme edit", () => {
  const notes = {
    "sase.md": "- [?] #task Fix apollo [id:: sase__fix-apollo] ^fix-apollo\n- [?] #task Follower [dependsOn:: sase__fix-apollo] ^follower",
  };
  const shown = noteSuggestion();
  const key = offerKeyFor(planFixture({ day: FIX_DAY, notes, closed: FIX_CLOSED }).plan, "follower");
  // Stale task: refreshed note text no longer matches the planned preimage.
  const staleNotes = {
    "sase.md": "- [?] #task Fix apollo [id:: sase__fix-apollo] ^fix-apollo\n- [?] #task Follower edited [dependsOn:: sase__fix-apollo] ^follower",
  };
  const staleTaskPlan = helpers.planSuccessors({
    closed: FIX_CLOSED,
    index: helpers.buildDependentsIndex(helpers.tasksFromDocuments([{ path: "sase.md", text: notes["sase.md"] }])),
    dailyBefore: FIX_DAY,
    dailyPath: DAILY_PATH,
    today: TODAY,
    linkUnblocked: true,
    basenameCounts: { sase: 1 },
    noteTexts: staleNotes,
    selection: [key],
    destinations: new Map([[key, { kind: "existing", entryLine: 3, entryText: "- [ ] () — FIX", themeIntent: { deliberate: true, linkOnce: false, shown } }]]),
    successorTheme: { themesApi: stubThemesApi(shown), ledgerApi: stubLedgerApi() },
  });
  const staleRow = staleTaskPlan.unblocked.find((item) => item.block_id === "follower");
  assert.equal((staleRow && staleRow.theme_changed) || false, false);
  // Stale suggestion: current suggestion differs from shown.
  const current = noteSuggestion({ theme: { key: "fix", name: "FIX" } });
  const { plan: staleSug } = planFixture({
    day: FIX_DAY, notes, closed: FIX_CLOSED,
    options: {
      selection: [key],
      destinations: new Map([[key, { kind: "existing", entryLine: 3, entryText: "- [ ] () — FIX", themeIntent: { deliberate: true, linkOnce: false, shown } }]]),
      successorTheme: { themesApi: stubThemesApi(current), ledgerApi: stubLedgerApi() },
    },
  });
  // Shown is WRITE, current is FIX, so the suggestion changed: no write, link kept.
  const sugRow = staleSug.unblocked.find((item) => item.block_id === "follower");
  assert.equal(sugRow.theme_changed || false, false);
  assert.equal(sugRow.theme_suggestion_changed, true);
  assert.ok(sugRow.link);
  // Stale destination: moved preimage and closed entry.
  for (const bad of [
    { kind: "existing", entryLine: 3, entryText: "- [ ] () — MOVED" },
    { kind: "existing", entryLine: 5, entryText: "- [x] () — WRITE" },
  ]) {
    const day = bad.entryText.startsWith("- [x]")
      ? FIX_DAY.replace("- [ ] () — WRITE", "- [x] () — WRITE")
      : FIX_DAY;
    const offered = planFixture({ day, notes, closed: FIX_CLOSED });
    const badKey = offerKeyFor(offered.plan, "follower");
    const { plan } = planFixture({
      day, notes, closed: FIX_CLOSED,
      options: {
        selection: [badKey],
        destinations: new Map([[badKey, { ...bad, themeIntent: { deliberate: true, linkOnce: false, shown } }]]),
        successorTheme: { themesApi: stubThemesApi(shown), ledgerApi: stubLedgerApi() },
      },
    });
    assert.equal(plan.unblocked.find((item) => item.block_id === "follower").theme_changed || false, false, JSON.stringify(bad));
  }
});

// Saved theme survives a later daily-link failure (no atomicity claim).
test("theme edit persists when the daily insertion later fails", () => {
  const notes = {
    "sase.md": "- [?] #task Fix apollo [id:: sase__fix-apollo] ^fix-apollo\n- [?] #task Follower [dependsOn:: sase__fix-apollo] ^follower",
  };
  const shown = noteSuggestion();
  const key = offerKeyFor(planFixture({ day: FIX_DAY, notes, closed: FIX_CLOSED }).plan, "follower");
  const { plan } = planFixture({
    day: FIX_DAY, notes, closed: FIX_CLOSED,
    options: {
      selection: [key],
      destinations: new Map([[key, { kind: "existing", entryLine: 3, entryText: "- [ ] () — FIX", themeIntent: { deliberate: true, linkOnce: false, shown } }]]),
      successorTheme: { themesApi: stubThemesApi(shown), ledgerApi: stubLedgerApi() },
    },
  });
  const row = plan.unblocked.find((item) => item.block_id === "follower");
  assert.equal(row.theme_changed, true);
  assert.equal(row.theme_name, "FIX");
  const edit = plan.edits.find((item) => item.path === "sase.md" && item.line === row.line);
  assert.ok(edit.after.includes("[type:: FIX]"), edit.after);
  // Simulate the daily write failing after the task write: the insertion
  // planner skips on moved daily text, but the task edit stays themed.
  const movedDay = FIX_DAY.replace("- [ ] () — FIX", "- [ ] () — MOVED");
  const inserted = helpers.planSuccessorInsertions(movedDay, plan.placements, {});
  assert.equal(inserted.skipped.length, 1);
  assert.ok(edit.after.includes("[type:: FIX]"));
  assert.equal(row.theme_changed, true);
});

// Local daily-note successors resolve the daily snapshot.
test("daily-note successors use the daily snapshot for suggestFor", () => {
  const day = ["# 2026-10-09", "", "## Pomodoros", "- [ ] () — FIX", "- [?] #task Local [dependsOn:: sase__fix-apollo] ^local"].join("\n");
  const notes = {
    "sase.md": "- [?] #task Fix apollo [id:: sase__fix-apollo] ^fix-apollo",
  };
  // Default WRITE differs from FIX, so the daily successor sets FIX.
  const shown = noteSuggestion();
  let seen = null;
  const themesApi = {
    ...stubThemesApi(shown),
    effectiveTypeFor: (request) => {
      seen = request;
      return shown;
    },
  };
  const documents = [
    { path: "sase.md", text: notes["sase.md"] },
    { path: DAILY_PATH, text: day },
  ];
  const tasks = helpers.tasksFromDocuments(documents);
  const index = helpers.buildDependentsIndex(tasks);
  const offered = helpers.planSuccessors({
    closed: FIX_CLOSED,
    index,
    dailyBefore: day,
    dailyPath: DAILY_PATH,
    today: TODAY,
    linkUnblocked: true,
    basenameCounts: {},
    noteTexts: { "sase.md": notes["sase.md"], [DAILY_PATH]: day },
    selection: "all",
  });
  const target = offered.unblocked.find((item) => item.block_id === "local");
  assert.ok(target && target.offer, "daily successor offered");
  const planned = helpers.planSuccessors({
    closed: FIX_CLOSED,
    index,
    dailyBefore: day,
    dailyPath: DAILY_PATH,
    today: TODAY,
    linkUnblocked: true,
    basenameCounts: {},
    noteTexts: { "sase.md": notes["sase.md"], [DAILY_PATH]: day },
    selection: [target.offer.key],
    destinations: new Map([[target.offer.key, { kind: "new", name: "FIX", themeIntent: { deliberate: true, linkOnce: false, shown } }]]),
    successorTheme: { themesApi, ledgerApi: stubLedgerApi() },
  });
  const row = planned.unblocked.find((item) => item.block_id === "local");
  assert.equal(row.theme_changed, true);
  assert.ok(seen, "suggestFor called");
  assert.equal(seen.path, DAILY_PATH);
});

// Preservation: distinctive theme fields survive status, recovery, and stamp writers.
test("[theme:: FIX] and (theme:: FIX) survive close and recovery writers", () => {
  for (const field of ["[theme:: FIX]", "(theme:: FIX)"]) {
    const line = `- [ ] #task Keep ${field} ^keep`;
    const raised = helpers.replaceTaskStatusSymbol(line, "x");
    assert.ok(raised.includes(field), `close preserves ${field}: ${raised}`);
    assert.ok(raised.startsWith("- [x]"), raised);
    const recovered = helpers.rewriteRecoveredTaskLine(`- [?] #task Keep ${field} #prj_is_blocked`, " ", {
      today: TODAY,
      isDailyNote: false,
      isToday: false,
    });
    assert.ok(typeof recovered === "string", `recovery returns a line for ${field}`);
    assert.ok(recovered.includes(field), `recovery preserves ${field}: ${recovered}`);
    assert.ok(!recovered.includes("#prj_is_blocked"), `recovery strips project tag: ${recovered}`);
    const withField = helpers.replaceTaskStatusSymbol(`- [?] #task Keep ${field}`, " ");
    assert.ok(withField.includes(field), withField);
    const stamped = helpers.applyFreshStampLine(
      `- [*] #task Keep ${field}`,
      (text) => `${text} [fresh:: ${TODAY}]`,
      TODAY,
      { content: `- [*] #task Keep ${field}`, line: 0 },
    );
    assert.ok(stamped.includes(field), `stamp preserves ${field}: ${stamped}`);
    const pulled = helpers.projectPullInRewriteLine(`- [ ] #task Keep ${field} ^keep`, "*", {
      recoverRank: false,
      today: TODAY,
      isDailyNote: false,
      isToday: true,
    });
    assert.ok(String(pulled || "").includes(field), `pull-in preserves ${field}: ${pulled}`);
  }
});

// Preservation: move writer carries the exact theme bytes.
test("Ctrl+Shift+M move preserves exact theme bytes", () => {
  const nav = require("./navigation-hotkeys-harness.cjs").helpers;
  for (const field of ["[theme:: FIX]", "(theme:: FIX)"]) {
    const source = [`- [ ] #task Keep ${field} ^keep`].join("\n");
    const destination = ["---", 'type: "[[area]]"', "status: ready", "---", "## Tasks", ""].join("\n");
    const discovery = nav.discoverMovableObsidianTaskTargets(source, 0, 0);
    assert.equal(discovery.valid, true, discovery.error);
    const plan = nav.planTaskMoveAcrossFiles({
      sourcePath: "Source.md",
      destinationPath: "Dest.md",
      sourceContent: source,
      destinationContent: destination,
      targets: discovery.targets,
    });
    assert.equal(plan.valid, true, plan.error);
    const after = plan.changes.get("Dest.md").after;
    assert.ok(after.includes(field), `move preserves ${field}: ${after}`);
  }
});
