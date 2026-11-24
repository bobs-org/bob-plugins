// Offline fixtures and acceptance rules for the real-Obsidian Area/Project
// card proof. The fixtures are synthetic and never copied from the live vault.
"use strict";

const assert = require("node:assert/strict");

const FIXTURE_TODAY = "2026-11-24";
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
  wip: "root_plan.md",
  blocked: "blocked_plan.md",
  scheduled: "scheduled_plan.md",
  done: "done_plan.md",
  canceled: "canceled_plan.md",
  legacy: "legacy_theme_plan.md",
  missing: "missing_goal.md",
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
    [PATHS.wip]: project({ root: true, task_type: "BUILD" },
      "- [ ] #task #prj Ship the root rollout ^prj\n"),
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
  };
}

const EXPECTED = Object.freeze({
  [PATHS.area]: { kind: "area", title: "Development", lifecycle: null, icon: "layers", form: "field" },
  [PATHS.subarea]: { kind: "area", title: "tooling_ops", lifecycle: null, icon: "layers", form: "field", crumb: "Development" },
  [PATHS.inbox]: { kind: "area", title: "Mac Inbox", lifecycle: null, icon: "layers", form: "field", pill: "INBOX" },
  [PATHS.wip]: { kind: "project", title: "root_plan", lifecycle: "WIP", icon: "target", form: "pennant", pill: "ROOT" },
  [PATHS.blocked]: { kind: "project", title: "blocked_plan", lifecycle: "BLOCKED", icon: "target", form: "pennant" },
  [PATHS.scheduled]: { kind: "project", title: "scheduled_plan", lifecycle: "SCHEDULED", detail: "starts Dec 2", icon: "target", form: "pennant" },
  [PATHS.done]: { kind: "project", title: "done_plan", lifecycle: "DONE", detail: "Nov 20", icon: "target", form: "pennant", terminal: true },
  [PATHS.canceled]: { kind: "project", title: "canceled_plan", lifecycle: "CANCELED", detail: "Oct 2", icon: "target", form: "pennant", terminal: true },
  [PATHS.legacy]: { kind: "project", title: "legacy_theme_plan", lifecycle: "WIP", icon: "target", form: "pennant", chip: "#BUILD" },
  [PATHS.missing]: { kind: "project", title: "Notes without a goal task", lifecycle: "NO ^prj TASK", icon: "target", form: "pennant" },
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

function cardFailures(probe, notePath, mode) {
  const expected = EXPECTED[notePath];
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
  if (!expected.pill && probe?.pills?.some((pill) => pill === "ROOT" || pill === "INBOX")) failures.push("unexpected route/root pill is present");
  if (expected.crumb && !probe?.crumbs?.includes(expected.crumb)) failures.push("resolved parent crumb is missing");
  if (expected.chip && !probe?.chips?.some((chip) => chip.includes(expected.chip))) failures.push("authored legacy-theme chip is missing");
  if (expected.terminal && (probe?.chipCount !== 0 || probe?.metaPresent)) failures.push("terminal project still has its policy/readout row");
  return failures;
}

function selfTest() {
  const notes = fixtureNotes();
  assert.deepEqual(Object.keys(notes).sort(), Object.keys(EXPECTED).sort());
  assert.match(notes[PATHS.scheduled], /\[\?\].*\[scheduled:: 2026-12-02\].*\^prj/);
  assert.match(notes[PATHS.done], /\[x\].*\[completion:: 2026-11-20\].*\^prj/);
  assert.match(notes[PATHS.canceled], /\[-\].*\[cancelled:: 2026-10-02\].*\^prj/);
  assert.match(notes[PATHS.wip], /root: true/);
  assert.match(notes[PATHS.legacy], /theme: "BUILD"/);
  assert.doesNotMatch(notes[PATHS.missing], /\^prj/);
  const needs = screenshotNeeds();
  assert.equal(needs.length, 24);
  assert.ok(needs.includes("dev-live-light-wide"));
  assert.ok(needs.includes("done_plan-reading-dark-narrow"));
  assert.deepEqual(cardFailures({
    path: PATHS.wip, mode: "live", kind: "project", title: "root_plan", ariaLabel: "Project: root_plan",
    icon: "target", tileForm: "pennant", footPresent: true, nativePropertiesVisible: true,
    lifecycle: "WIP", pills: ["ROOT"], chipCount: 0, metaPresent: false,
  }, PATHS.wip, "live"), []);
  assert.deepEqual(cardFailures({
    path: PATHS.missing, mode: "live", kind: "project", title: "Notes without a goal task",
    ariaLabel: "Project: Notes without a goal task", icon: "target", tileForm: "pennant",
    footPresent: true, nativePropertiesVisible: true, lifecycle: "NO ^prj TASK",
  }, PATHS.missing, "live"), []);
  assert.ok(cardFailures({ path: PATHS.wip }, PATHS.wip, "live").length > 0);
}

module.exports = { HELP_TEXT, FIXTURE_TODAY, PATHS, EXPECTED, fixtureNotes, screenshotNeeds, parseArgs, cardFailures, selfTest };
