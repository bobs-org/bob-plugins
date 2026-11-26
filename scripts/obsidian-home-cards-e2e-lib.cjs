// Offline fixtures and acceptance rules for the real-Obsidian Area/Project
// card proof. The fixtures are synthetic and never copied from the live vault.
"use strict";

const assert = require("node:assert/strict");

const FIXTURE_TODAY = "2026-11-24";
const FIXTURE_CLOCK = `${FIXTURE_TODAY}T12:00:00`;
const NARROW_VIEWPORT = 400;
const WIDE_VIEWPORT = 1400;
const NARROW_CARD_MAX = 420;
const HELP_TEXT = [
  "Usage: node scripts/obsidian-home-cards-e2e.cjs [OPTIONS]",
  "",
  "Verify Area and Project cards in an isolated real Obsidian vault.",
  "The vault contains synthetic notes only. The real matrix runs under xvfb-run on Linux.",
  "--self-test validates fixtures and acceptance rules without launching Obsidian.",
  "",
  "  -e, --executable PATH   Obsidian executable (default: /snap/bin/obsidian)",
  "  -o, --out DIRECTORY    Save PNG screenshots here",
  "  -r, --report PATH      Write the structured JSON report here",
  "  -s, --self-test        Run offline checks only",
  "  -h, --help             Print this help",
].join("\n");
const PATHS = Object.freeze({
  area: "dev.md",
  subarea: "tooling_ops.md",
  inbox: "inbox.md",
  nestedInbox: "nested/inbox.md",
  wip: "root_plan.md",
  blocked: "blocked_plan.md",
  scheduled: "scheduled_plan.md",
  done: "done_plan.md",
  canceled: "canceled_plan.md",
  legacy: "legacy_theme_plan.md",
  missing: "missing_goal.md",
  archived: "archived_plan.md",
  lateTitle: "late_title_plan.md",
  inner: "inner_ops.md",
  mid: "mid_plan.md",
  deep: "deep_plan.md",
  long: "long_area.md",
  shadowed: "shadow_clock_plan.md",
  invalidClock: "invalid_clock_plan.md",
  mixedClock: "mixed_clock_plan.md",
  capOff: "cap_off_plan.md",
  createdMissing: "created_missing_plan.md",
  createdInvalid: "created_invalid_plan.md",
  complete: "complete_plan.md",
  nestedPrj: "nested_prj_plan.md",
  depBlocked: "dep_blocked_plan.md",
  subBlocked: "sub_blocked_plan.md",
  doneUndated: "done_undated_plan.md",
  untyped: "plain_note.md",
});

function yaml(rows, body) {
  const fields = Object.entries(rows).map(([key, value]) => {
    if (Array.isArray(value)) return `${key}:\n${value.map((item) => `  - ${JSON.stringify(item)}`).join("\n")}`;
    return `${key}: ${typeof value === "string" ? JSON.stringify(value) : String(value)}`;
  });
  return `---\n${fields.join("\n")}\n---\n${body}`;
}

function fixtureNotes() {
  const project = (fields, line) => yaml({ type: "[[project]]", parent: "[[dev]]", ...fields }, line);
  const longSummary = "Engineering work and tools across the whole stack, including local capture, the review walk, and the long-running plugin cards that must stay readable when the summary wraps onto a second line.";
  return {
    [PATHS.area]: yaml({
      type: "[[area]]", parent: "[[area]]", aliases: ["Development"], summary: "Engineering work and tools.",
      task_type: "BUILD", offclock: false,
    }, "# Development\n\nOngoing area notes.\n"),
    [PATHS.subarea]: yaml({
      type: "[[area]]", parent: "[[dev]]", summary: "Tooling and local automation.",
    }, "This area deliberately falls back to its stem.\n"),
    [PATHS.inbox]: yaml({
      type: "[[area]]", parent: "[[area]]", aliases: ["Mac Inbox"],
      summary: "A synthetic inbox route for acceptance.",
    }, "This fixture uses its first alias as the card title.\n"),
    [PATHS.nestedInbox]: yaml({
      type: "[[area]]", parent: "[[dev]]", aliases: ["Nested Inbox"],
      summary: "A nested inbox.md that is not the vault inbox.",
    }, "Nested inbox files are ordinary areas unless the inbox route says otherwise.\n"),
    [PATHS.wip]: project({ root: true, task_type: "BUILD" },
      "- [ ] #task #prj Ship the root rollout ^prj\n\nProject body line one.\nProject body line two.\nProject body line three.\n"),
    [PATHS.blocked]: project({},
      "- [?] #task #prj Wait for the review ^prj\n"),
    [PATHS.scheduled]: project({},
      "- [?] #task #prj Start the migration [scheduled:: 2026-12-02] ^prj\n"),
    [PATHS.done]: project({},
      "- [x] #task #prj Finish the old rollout [completion:: 2026-11-20] ^prj\n"),
    [PATHS.canceled]: project({},
      "- [-] #task #prj Retire the draft [cancelled:: 2026-10-02] ^prj\n"),
    [PATHS.legacy]: project({ theme: "BUILD" },
      "- [ ] #task #prj Keep the legacy theme ^prj\n"),
    [PATHS.missing]: project({}, "# Notes without a goal task\n"),
    [PATHS.archived]: yaml({
      type: "[[project]]", parent: "[[dev]]", status: "done",
    }, "# Archived without a live goal\n"),
    [PATHS.lateTitle]: project({},
      "- [ ] #task #prj Keep the early goal ^prj\n\n# Late heading after the task\n"),
    [PATHS.inner]: yaml({
      type: "[[area]]", parent: "[[dev]]", aliases: ["Inner Ops"],
    }, "# Inner Ops\n"),
    [PATHS.mid]: project({ parent: "[[inner_ops]]" },
      "- [ ] #task #prj Mid ancestry goal ^prj\n"),
    [PATHS.deep]: yaml({
      type: "[[project]]", parent: "[[mid_plan]]",
    }, "- [ ] #task #prj Deep ancestry goal ^prj\n"),
    [PATHS.long]: yaml({
      type: "[[area]]", parent: "[[area]]", aliases: ["Long Summary"],
      summary: longSummary, color: "yellow",
    }, "# Long Summary\n\nArea body line one.\nArea body line two.\nArea body line three.\nArea body line four.\nA plain body line below the card.\nAnother body line keeps the fixture readable.\nCursor probe target area body line.\n"),
    [PATHS.shadowed]: project({
      offclock: false, offclock_types: ["MEET"],
    }, "- [ ] #task #prj Shadowed clock policy ^prj\n"),
    [PATHS.invalidClock]: project({
      offclock: true, offclock_types: [],
    }, "- [ ] #task #prj Empty clock list ^prj\n"),
    [PATHS.mixedClock]: "---\ntype: \"[[project]]\"\nparent: \"[[dev]]\"\noffclock_types: [MEET, 7]\n---\n- [ ] #task #prj Mixed clock list ^prj\n",
    [PATHS.capOff]: project({ ready_cap: "off" },
      "- [ ] #task #prj Cap off project ^prj\n"),
    [PATHS.createdMissing]: project({},
      "- [ ] #task #prj Missing created stamp ^prj\n"),
    [PATHS.createdInvalid]: project({ created: "not-a-date" },
      "- [ ] #task #prj Invalid created stamp ^prj\n"),
    [PATHS.complete]: project({},
      "- [ ] #task #prj Close this completion fixture ^prj\n"),
    [PATHS.nestedPrj]: project({},
      "- parent note\n  - [x] #task #prj nested example ^prj\n"),
    [PATHS.depBlocked]: project({},
      "- [?] #task #prj Wait on the review ^prj\n  - ⛓️ **DEPENDS ON:** [[sase_plan#^abc123]]\n"),
    [PATHS.subBlocked]: project({ parent: "[[mid_plan]]" },
      "- [?] #task #prj Wait on the parent ^prj\n"),
    [PATHS.doneUndated]: project({},
      "- [x] #task #prj Finish without a date ^prj\n"),
    [PATHS.untyped]: yaml({ aliases: ["Plain"] }, "# Plain note\n\nThis note is not an Area or Project.\n"),
  };
}

const EXPECTED = Object.freeze({
  [PATHS.area]: { kind: "area", title: "Development", lifecycle: null, icon: "layers", form: "field", goalDecorated: false },
  [PATHS.subarea]: { kind: "area", title: "tooling_ops", lifecycle: null, icon: "layers", form: "field", crumb: "Development", goalDecorated: false },
  [PATHS.inbox]: { kind: "area", title: "Mac Inbox", lifecycle: null, icon: "layers", form: "field", pill: "INBOX", goalDecorated: false },
  [PATHS.wip]: { kind: "project", title: "root_plan", lifecycle: "WIP", icon: "target", form: "pennant", pill: "ROOT", goalDecorated: true },
  [PATHS.blocked]: { kind: "project", title: "blocked_plan", lifecycle: "BLOCKED", icon: "target", form: "pennant", goalDecorated: true },
  [PATHS.scheduled]: { kind: "project", title: "scheduled_plan", lifecycle: "SCHEDULED", detail: "starts Dec 2", icon: "target", form: "pennant", goalDecorated: true },
  [PATHS.done]: { kind: "project", title: "done_plan", lifecycle: "DONE", detail: "Nov 20", icon: "target", form: "pennant", terminal: true, goalDecorated: true },
  [PATHS.canceled]: { kind: "project", title: "canceled_plan", lifecycle: "CANCELED", detail: "Oct 2", icon: "target", form: "pennant", terminal: true, goalDecorated: true },
  [PATHS.depBlocked]: { kind: "project", title: "dep_blocked_plan", lifecycle: "BLOCKED", icon: "target", form: "pennant", goalDecorated: true },
  [PATHS.subBlocked]: { kind: "project", title: "sub_blocked_plan", lifecycle: "BLOCKED", icon: "target", form: "pennant", goalDecorated: true },
  [PATHS.doneUndated]: { kind: "project", title: "done_undated_plan", lifecycle: "DONE", icon: "target", form: "pennant", terminal: true, goalDecorated: true },
  [PATHS.legacy]: { kind: "project", title: "legacy_theme_plan", lifecycle: "WIP", icon: "target", form: "pennant", chip: "#BUILD", goalDecorated: true },
  [PATHS.missing]: { kind: "project", title: "Notes without a goal task", lifecycle: "NO ^prj TASK", icon: "target", form: "pennant", goalDecorated: false },
});

const EXTRA_EXPECTED = Object.freeze({
  [PATHS.nestedInbox]: { kind: "area", title: "Nested Inbox", lifecycle: null, icon: "layers", form: "field", forbidPill: "INBOX", crumb: "Development" },
  [PATHS.archived]: { kind: "project", title: "Archived without a live goal", lifecycle: "DONE", icon: "target", form: "pennant", terminal: true },
  [PATHS.lateTitle]: { kind: "project", title: "late_title_plan", lifecycle: "WIP", icon: "target", form: "pennant" },
  [PATHS.deep]: { kind: "project", title: "deep_plan", lifecycle: "WIP", icon: "target", form: "pennant", crumb: "Development" },
  [PATHS.long]: { kind: "area", title: "Long Summary", lifecycle: null, icon: "layers", form: "field" },
  [PATHS.shadowed]: { kind: "project", title: "shadow_clock_plan", lifecycle: "WIP", icon: "target", form: "pennant", chip: "off-clock · MEET" },
  [PATHS.invalidClock]: { kind: "project", title: "invalid_clock_plan", lifecycle: "WIP", icon: "target", form: "pennant", chipCount: 0 },
  [PATHS.mixedClock]: { kind: "project", title: "mixed_clock_plan", lifecycle: "WIP", icon: "target", form: "pennant", chipCount: 0 },
  [PATHS.capOff]: { kind: "project", title: "cap_off_plan", lifecycle: "WIP", icon: "target", form: "pennant" },
  [PATHS.createdMissing]: { kind: "project", title: "created_missing_plan", lifecycle: "WIP", icon: "target", form: "pennant" },
  [PATHS.createdInvalid]: { kind: "project", title: "created_invalid_plan", lifecycle: "WIP", icon: "target", form: "pennant" },
  [PATHS.complete]: { kind: "project", title: "complete_plan", lifecycle: "WIP", icon: "target", form: "pennant" },
  [PATHS.nestedPrj]: { kind: "project", title: "nested_prj_plan", lifecycle: "NO ^prj TASK", icon: "target", form: "pennant" },
});

function screenshotNeeds() {
  const result = [];
  for (const note of [PATHS.area, PATHS.wip, PATHS.done]) {
    for (const mode of ["live", "reading"]) {
      for (const theme of ["light", "dark"]) {
        for (const width of ["narrow", "wide"]) result.push(`${note.replace(/\.md$/, "")}-${mode}-${theme}-${width}`);
      }
    }
  }
  result.push("long_area-live-light-wide-collapsed");
  result.push("long_area-live-light-wide-drawer");
  result.push("root_plan-live-light-wide-reduced");
  result.push("long_area-live-dark-narrow-collapsed");
  return result;
}

function parseArgs(argv) {
  const args = { executable: null, out: null, report: null, selfTest: false, help: false };
  const input = Array.isArray(argv) ? argv.slice() : [];
  const value = (flag, label, index) => {
    const next = input[index];
    if (!next || next.startsWith("-")) throw new Error(`${flag} requires a ${label} value`);
    return next;
  };
  for (let index = 0; index < input.length; index += 1) {
    const flag = input[index];
    if (flag === "-e" || flag === "--executable") args.executable = value("--executable", "PATH", ++index);
    else if (flag === "-o" || flag === "--out") args.out = value("--out", "DIRECTORY", ++index);
    else if (flag === "-r" || flag === "--report") args.report = value("--report", "PATH", ++index);
    else if (flag === "-s" || flag === "--self-test") args.selfTest = true;
    else if (flag === "-h" || flag === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  return args;
}

function cardFailures(probe, notePath, mode, catalog = EXPECTED) {
  const expected = catalog[notePath];
  const failures = [];
  if (!expected) return ["fixture has no expected card contract"];
  if (!probe || probe.path !== notePath) failures.push("active note path is wrong");
  if (probe?.mode !== mode) failures.push("view mode is wrong");
  if (probe?.kind !== expected.kind) failures.push("card kind is wrong");
  if (probe?.title !== expected.title) failures.push("card title is wrong");
  if (!String(probe?.ariaLabel || "").startsWith(expected.kind === "area" ? "Area:" : "Project:")) failures.push("accessible name has no species prefix");
  if (probe?.icon !== expected.icon || probe?.tileForm !== expected.form) failures.push("species tile is wrong");
  if (!probe?.footPresent) failures.push("shared property foot is missing");
  if (!probe?.nativePropertiesVisible) failures.push("native Properties are not visible with the card");
  if (expected.lifecycle && probe?.lifecycle !== expected.lifecycle) failures.push("project lifecycle is wrong");
  if (expected.detail && !String(probe?.lifecycleDetail || "").includes(expected.detail)) failures.push("project lifecycle date detail is wrong");
  if (notePath === PATHS.scheduled && !/in \d+ days?/.test(String(probe?.lifecycleDetail || ""))) failures.push("future project schedule has no relative time");
  if (!expected.lifecycle && probe?.lifecycle) failures.push("area has a project lifecycle row");
  if (expected.pill && !probe?.pills?.includes(expected.pill)) failures.push(`${expected.pill} pill is missing`);
  if (expected.forbidPill && probe?.pills?.includes(expected.forbidPill)) failures.push(`${expected.forbidPill} pill must not appear`);
  if (!expected.pill && !expected.forbidPill && probe?.pills?.some((pill) => pill === "ROOT" || pill === "INBOX")) failures.push("unexpected route/root pill is present");
  if (expected.crumb && !probe?.crumbs?.includes(expected.crumb)) failures.push("resolved parent crumb is missing");
  if (expected.chip && !probe?.chips?.some((chip) => chip.includes(expected.chip))) failures.push("authored chip is missing");
  if (Number.isInteger(expected.chipCount) && probe?.chipCount !== expected.chipCount) failures.push("chip count is wrong");
  if (expected.terminal && (probe?.chipCount !== 0 || probe?.metaPresent)) failures.push("terminal project still has its policy/readout row");
  if (expected.goalDecorated === true && probe?.goalDecorated !== true) failures.push("recognized ^prj line has no goal decoration");
  if (expected.goalDecorated === false && probe?.goalDecorated === true) failures.push("goal decoration appears without a recognized ^prj line");
  return failures;
}

function inspectGeometry(probe, expect = {}) {
  const failures = [];
  const width = Number(probe?.cardWidth) || 0;
  const height = Number(probe?.cardHeight) || 0;
  if (!(width > 0 && height > 0)) failures.push("card has no layout box");
  if (expect.narrow && !(width > 0 && width <= NARROW_CARD_MAX)) {
    failures.push(`narrow card container is ${width}px, need <= ${NARROW_CARD_MAX}px`);
  }
  if (expect.wide && !(width > NARROW_CARD_MAX)) {
    failures.push(`wide card container is ${width}px, need > ${NARROW_CARD_MAX}px`);
  }
  if (expect.collapsed === true && probe?.collapsed !== true) failures.push("card is not collapsed");
  if (expect.collapsed === false && probe?.collapsed === true) failures.push("card is collapsed");
  if (expect.drawerOpen === true && probe?.drawerOpen !== true) failures.push("drawer is not open");
  if (expect.drawerOpen === false && probe?.drawerOpen === true) failures.push("drawer is open");
  if (expect.lifecycleVisible === true && !probe?.lifecycleVisible) failures.push("lifecycle is not visible");
  if (expect.summaryVisible === false && probe?.summaryVisible) failures.push("summary stayed visible while collapsed");
  if (expect.nativePropertiesVisible !== false && !probe?.nativePropertiesVisible) {
    failures.push("native Properties are not visible");
  }
  return {
    failures,
    container: {
      width,
      height,
      x: Number(probe?.cardX) || 0,
      y: Number(probe?.cardY) || 0,
      collapsed: probe?.collapsed === true,
      drawerOpen: probe?.drawerOpen === true,
      reducedMotion: probe?.reducedMotion === true,
    },
  };
}

const EXISTING_BOB_SERVICES = Object.freeze([
  "bank", "props", "gmail", "notebooks", "albums", "projects", "areas", "themes", "logs",
]);

function classifyBobInvocation(row) {
  const args = Array.isArray(row?.args) ? row.args : [];
  const command = String(args[0] || "");
  if (EXISTING_BOB_SERVICES.includes(command)) {
    return { service: `ledger:${command}`, homeCardTriggered: false, args };
  }
  return { service: command ? `unknown:${command}` : "unknown", homeCardTriggered: true, args };
}

function homeCardTriggeredBob(rows) {
  return (Array.isArray(rows) ? rows : []).map(classifyBobInvocation).filter((row) => row.homeCardTriggered);
}

function bobConfigYaml() {
  return [
    "timezone: America/New_York",
    "properties:",
    "  - name: scheduled",
    "    values: date",
    "",
  ].join("\n");
}

function selfTest() {
  const notes = fixtureNotes();
  assert.ok(Object.keys(notes).includes(PATHS.untyped));
  for (const key of Object.keys(EXPECTED)) assert.ok(notes[key], key);
  for (const key of Object.keys(EXTRA_EXPECTED)) assert.ok(notes[key], key);
  assert.ok(notes[PATHS.subarea].includes('parent: "[[dev]]"'));
  assert.match(notes[PATHS.area], /# Development/);
  assert.match(notes[PATHS.inbox], /Mac Inbox/);
  assert.match(notes[PATHS.nestedInbox], /Nested Inbox/);
  assert.match(notes[PATHS.scheduled], /\[scheduled:: 2026-12-02\]/);
  assert.match(notes[PATHS.legacy], /theme: "BUILD"/);
  assert.match(notes[PATHS.archived], /status: "done"/);
  assert.doesNotMatch(notes[PATHS.archived], /\^prj/);
  assert.match(notes[PATHS.lateTitle], /\^prj[\s\S]*# Late heading after the task/);
  assert.match(notes[PATHS.long], /Area body line four/);
  assert.match(notes[PATHS.wip], /Project body line three/);
  assert.match(notes[PATHS.deep], /parent: "\[\[mid_plan\]\]"/);
  assert.match(notes[PATHS.long], /second line/);
  assert.match(notes[PATHS.long], /A plain body line below the card/);
  assert.match(notes[PATHS.long], /Cursor probe target area body line/);
  assert.match(notes[PATHS.shadowed], /offclock_types:/);
  assert.match(notes[PATHS.invalidClock], /offclock_types:\n/);
  assert.match(notes[PATHS.mixedClock], /offclock_types: \[MEET, 7\]/);
  assert.match(notes[PATHS.capOff], /ready_cap: "off"/);
  assert.doesNotMatch(notes[PATHS.createdMissing], /^created:/m);
  assert.match(notes[PATHS.createdInvalid], /created: "not-a-date"/);
  assert.match(notes[PATHS.complete], /Close this completion fixture/);
  assert.match(notes[PATHS.nestedPrj], /  - \[x\] #task #prj nested example \^prj/);
  assert.match(notes[PATHS.depBlocked], /\*\*DEPENDS ON:\*\* \[\[sase_plan#\^abc123\]\]/);
  assert.match(notes[PATHS.depBlocked], /^- \[\?\] #task #prj Wait on the review \^prj$/m);
  assert.match(notes[PATHS.subBlocked], /parent: "\[\[mid_plan\]\]"/);
  assert.match(notes[PATHS.subBlocked], /^- \[\?\] #task #prj Wait on the parent \^prj$/m);
  assert.match(notes[PATHS.doneUndated], /^- \[x\] #task #prj Finish without a date \^prj$/m);
  assert.doesNotMatch(notes[PATHS.doneUndated], /completion::/);
  assert.doesNotMatch(notes[PATHS.untyped], /^type:/m);
  const needs = screenshotNeeds();
  assert.equal(needs.length, 28);
  assert.ok(needs.includes("dev-live-light-wide"));
  assert.ok(needs.includes("done_plan-reading-dark-narrow"));
  assert.ok(needs.includes("long_area-live-light-wide-collapsed"));
  assert.ok(needs.includes("root_plan-live-light-wide-reduced"));
  assert.equal(new Set(needs).size, needs.length);
  assert.deepEqual(cardFailures({
    path: PATHS.wip, mode: "live", kind: "project", title: "root_plan", ariaLabel: "Project: root_plan",
    icon: "target", tileForm: "pennant", footPresent: true, nativePropertiesVisible: true,
    lifecycle: "WIP", pills: ["ROOT"], chipCount: 0, metaPresent: false, goalDecorated: true,
  }, PATHS.wip, "live"), []);
  assert.deepEqual(cardFailures({
    path: PATHS.missing, mode: "live", kind: "project", title: "Notes without a goal task",
    ariaLabel: "Project: Notes without a goal task", icon: "target", tileForm: "pennant",
    footPresent: true, nativePropertiesVisible: true, lifecycle: "NO ^prj TASK", goalDecorated: false,
  }, PATHS.missing, "live"), []);
  assert.deepEqual(cardFailures({
    path: PATHS.depBlocked, mode: "reading", kind: "project", title: "dep_blocked_plan",
    ariaLabel: "Project: dep_blocked_plan", icon: "target", tileForm: "pennant",
    footPresent: true, nativePropertiesVisible: true, lifecycle: "BLOCKED", goalDecorated: true,
  }, PATHS.depBlocked, "reading"), []);
  assert.ok(cardFailures({
    path: PATHS.depBlocked, mode: "reading", kind: "project", title: "dep_blocked_plan",
    ariaLabel: "Project: dep_blocked_plan", icon: "target", tileForm: "pennant",
    footPresent: true, nativePropertiesVisible: true, lifecycle: "BLOCKED", goalDecorated: false,
  }, PATHS.depBlocked, "reading").length > 0, "a missing goal decoration fails acceptance");
  assert.deepEqual(cardFailures({
    path: PATHS.nestedInbox, mode: "live", kind: "area", title: "Nested Inbox",
    ariaLabel: "Area: Nested Inbox", icon: "layers", tileForm: "field",
    footPresent: true, nativePropertiesVisible: true, pills: [], crumbs: ["Development"],
  }, PATHS.nestedInbox, "live", EXTRA_EXPECTED), []);
  assert.ok(cardFailures({ path: PATHS.wip }, PATHS.wip, "live").length > 0);
  const geo = inspectGeometry({ cardWidth: 360, cardHeight: 120, collapsed: true, drawerOpen: false, lifecycleVisible: true, nativePropertiesVisible: true }, { narrow: true, collapsed: true });
  assert.deepEqual(geo.failures, []);
  assert.ok(inspectGeometry({ cardWidth: 800, cardHeight: 120 }, { narrow: true }).failures.length > 0);
  assert.equal(classifyBobInvocation({ args: ["bank", "report", "-f", "json"] }).homeCardTriggered, false);
  assert.equal(classifyBobInvocation({ args: ["props", "show", "dev.md"] }).homeCardTriggered, false);
  assert.equal(classifyBobInvocation({ args: ["plan", "-f", "json"] }).homeCardTriggered, true);
  assert.equal(homeCardTriggeredBob([
    { args: ["gmail", "list", "-a", "-f", "json"] },
    { args: ["capture", "x0"] },
  ]).length, 1);
  assert.match(bobConfigYaml(), /^properties:/m);
  assert.match(bobConfigYaml(), /name: scheduled/);
}

module.exports = {
  HELP_TEXT, FIXTURE_TODAY, FIXTURE_CLOCK, NARROW_VIEWPORT, WIDE_VIEWPORT, NARROW_CARD_MAX,
  PATHS, EXPECTED, EXTRA_EXPECTED, EXISTING_BOB_SERVICES, fixtureNotes, screenshotNeeds, parseArgs,
  cardFailures, inspectGeometry, classifyBobInvocation, homeCardTriggeredBob, bobConfigYaml, selfTest,
};
