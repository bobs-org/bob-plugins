// Synthetic fixtures and assertions for the real-Obsidian Cabinets proof.
"use strict";

const assert = require("node:assert/strict");
const home = require("./obsidian-home-cards-e2e-lib.cjs");
const records = require("./obsidian-record-card-e2e-lib.cjs");
const periods = require("./obsidian-intention-card-e2e-lib.cjs");

const HELP_TEXT = [
  "Usage: node scripts/obsidian-cabinets-e2e.cjs [OPTIONS]",
  "",
  "Verify property-card cabinets in an isolated real Obsidian vault.",
  "The vault contains synthetic notes only. Run the real matrix under xvfb-run on Linux.",
  "--self-test validates fixtures and acceptance inventory without launching Obsidian.",
  "",
  "  -e, --executable PATH   Obsidian executable (default: /snap/obsidian/current/app/obsidian)",
  "  -o, --out DIRECTORY    Save PNG screenshots here",
  "  -r, --report PATH      Write the structured JSON report here",
  "  -s, --self-test        Run offline checks only",
  "  -h, --help             Print this help",
].join("\n");

const PATHS = Object.freeze({
  area: "cash.md",
  project: "sase.md",
  leaf: "leaf.md",
  singleArea: "single.md",
  album: "eat.md",
  emptyAlbum: "empty.md",
  subscriptions: "subscriptions.md",
  bank: "bank.md",
  prose: "essay.md",
  notebook: "tools.md",
  record: "eat/place-001.md",
  ref: "ref/attention.md",
  day: "2026/20261120.md",
  week: "2026/2026-W47.md",
  quarter: "2026/2026-Q4.md",
  year: "2026.md",
  untyped: "area.md",
  malformed: "malformed.md",
  duplicate: "duplicate.md",
  ordinary: "ordinary.md",
  embed: "embed-host.md",
});

const SPECS = Object.freeze([
  { key: "area", path: PATHS.area, kind: "area", cabinets: ["areas", "projects", "notebooks", "albums", "properties"] },
  { key: "project", path: PATHS.project, kind: "project", cabinets: ["projects", "properties"] },
  { key: "leaf", path: PATHS.leaf, kind: "project", cabinets: ["properties"] },
  { key: "single-area", path: PATHS.singleArea, kind: "area", cabinets: ["projects", "properties"] },
  { key: "album", path: PATHS.album, kind: "album", cabinets: ["records", "schema", "properties"] },
  { key: "empty-album", path: PATHS.emptyAlbum, kind: "album", cabinets: ["schema", "properties"] },
  { key: "subscriptions", path: PATHS.subscriptions, kind: "album", cabinets: ["records", "schema", "properties"] },
  { key: "bank", path: PATHS.bank, kind: "bank", cabinets: ["setup", "properties"] },
  { key: "prose", path: PATHS.prose, kind: "prose", cabinets: ["outline", "properties"] },
  { key: "notebook", path: PATHS.notebook, kind: "notebook", cabinets: ["properties"] },
  { key: "record", path: PATHS.record, kind: "record", cabinets: ["properties"] },
  { key: "ref", path: PATHS.ref, kind: "ref", cabinets: ["properties"] },
  { key: "day", path: PATHS.day, kind: "day", cabinets: ["properties"] },
  { key: "week", path: PATHS.week, kind: "week", cabinets: ["properties"] },
  { key: "quarter", path: PATHS.quarter, kind: "quarter", cabinets: ["properties"] },
  { key: "year", path: PATHS.year, kind: "year", cabinets: ["properties"] },
]);

const SCREENSHOT_HOSTS = Object.freeze([
  { key: "area", path: PATHS.area, mode: "live", state: "rest" },
  { key: "area", path: PATHS.area, mode: "live", state: "armed" },
  { key: "album", path: PATHS.album, mode: "live", state: "rest" },
  { key: "bank", path: PATHS.bank, mode: "live", state: "rest" },
  { key: "prose", path: PATHS.prose, mode: "live", state: "rest" },
  { key: "record", path: PATHS.record, mode: "live", state: "rest" },
  { key: "footer", path: PATHS.area, mode: "live", state: "armed" },
]);

// The sase-like project host lists 64 sub-projects; the last two are closed.
const PROJECT_OPEN_ROWS = 62;

function quote(value) { return JSON.stringify(String(value)); }

function callout(kind, rows) {
  const lines = [`> [!${kind}]`];
  for (const row of rows) lines.push(`> - ${row}`);
  return lines.join("\n") + "\n";
}

function areaNote({ title, catalogs = "", body = "", parent = "cash" }) {
  return [
    "---", 'type: "[[area]]"', ...(parent ? [`parent: "[[${parent}]]"`] : []), "color: blue", "---", "",
    `# ${title}`, "", catalogs, body, "",
  ].join("\n");
}

function projectNote(title, { parent = "cash", catalogs = "", body = "" } = {}) {
  return [
    "---", 'type: "[[project]]"', `parent: "[[${parent}]]"`, "status: wip", "---", "",
    `# ${title}`, "", catalogs, body, "",
  ].join("\n");
}

function fixtureNotes() {
  const areaCatalogs = [
    "## Areas", "", callout("areas", ["**[[home|Home]]** — Household systems."]), "",
    "## Projects", "", callout("projects", ["**[[sase|SASE]]** — Project catalog sentinel."]), "",
    "## Notebooks", "", callout("notebooks", ["**[[tools|Tools]]** — Notes about tools."]), "",
    "## Albums", "", callout("albums", ["**[[eat|Eat]]** — Places to try."]), "",
  ].join("\n");
  const projectRows = Array.from({ length: 64 }, (_, i) =>
    `**[[sase-row-${String(i + 1).padStart(2, "0")}|Project row ${String(i + 1).padStart(2, "0")}]]** — synthetic project row ${i + 1}.`);
  // End the 64-row catalog the way bob's projects writer does: closed rows
  // nest under its link-free `**Closed**` group label, which must still absorb.
  const projectCallout = callout("projects", projectRows.slice(0, PROJECT_OPEN_ROWS))
    + ["> - **Closed**", ...projectRows.slice(PROJECT_OPEN_ROWS).map((row) => `>   - ✅ ${row}`)].join("\n") + "\n";
  const projectCatalog = ["## Projects", "", projectCallout, "", "Authored prose stays visible below this kept heading.", ""]
    .join("\n");
  const recordFields = {
    status: "{required: true, values: {to_try: To try, liked: Liked}}",
    location: "{required: true, suggest: true}",
    category: "{required: true, suggest: true}",
  };
  const notes = {
    [PATHS.area]: areaNote({ title: "Cash", catalogs: areaCatalogs,
      body: "## Notes\n\nCash area body sentinel.\n\n[[cash#Projects|Jump to Projects]]", parent: null }),
    [PATHS.project]: projectNote("SASE", { catalogs: projectCatalog, body: "Project body sentinel." }),
    [PATHS.leaf]: projectNote("Leaf Project", { body: "A project with no catalog cabinet." }),
    [PATHS.singleArea]: areaNote({ title: "Single Catalog", catalogs: "## Projects\n\n" + callout("projects", ["**[[sase|SASE]]** — one direct item."]) }),
    [PATHS.album]: records.albumNote({ title: "Eat", parent: "cash", noun: "restaurant", fields: recordFields,
      extra: "## Records\n\n" + callout("records", Array.from({ length: 106 }, (_, i) =>
        `**[[eat/place-${String(i + 1).padStart(3, "0")}|Place ${String(i + 1).padStart(3, "0")}]]**`)) }),
    [PATHS.emptyAlbum]: records.albumNote({ title: "Empty", parent: "cash", noun: "spot", fields: { status: "{values: {to_try: To try}}" } }),
    [PATHS.subscriptions]: records.albumNote({ title: "Subscriptions", parent: "bank", noun: "subscription", fields: {
      status: "{required: true, values: {active: Active, cancelled: Cancelled}}",
      amount: "{required: true, values: number}", cadence: "{required: true, values: {monthly: Monthly, yearly: Yearly}}",
    }, extra: "## Records\n\n" + callout("records", ["**[[subscriptions/streamco|StreamCo]]**", "**[[subscriptions/music|Music]]**"]) }),
    [PATHS.bank]: '---\ntype: "[[area]]"\nparent: "[[cash]]"\nbank:\n  accounts:\n    checking:\n      kind: checking\n      start: 2026-11-01\n---\n\n# Bank\n\nBank hub body sentinel.\n',
    [PATHS.prose]: '---\ntype: "[[prose]]"\nparent: "[[cash]]"\nsummary: A synthetic prose note.\n---\n\n# Essay\n\n## Outline\n\n- First section\n- Second section\n\n## First section\n\nProse body sentinel.\n',
    [PATHS.notebook]: '---\ntype: "[[notebook]]"\nparent: "[[cash]]"\nsummary: Tools and workflow.\n---\n\n# Tools\n\nNotebook body sentinel.\n',
    [PATHS.ref]: '---\ntype: "[[ref]]"\nparent: "[[cash]]"\ntitle: "A Reference"\nsummary: "A reference card fixture."\nsource_url: "https://example.test/reference"\n---\n\n# A Reference\n\nReference body sentinel.\n',
    [PATHS.untyped]: '---\naliases: ["Plain area"]\n---\n\n# Plain area\n\nThis root note remains untyped.\n',
    [PATHS.malformed]: '---\ntype: "[[area]]"\n---\n\n# Malformed\n\n## Projects\n\n> [!projects]\n> - **[[lost|Stored malformed row]]**\n> - not-a-managed-row\n\n',
    [PATHS.duplicate]: '---\ntype: "[[area]]"\n---\n\n# Duplicate\n\n## Projects\n\n' + callout("projects", ["[[one]]"]) + "\n## Projects\n\n" + callout("projects", ["[[two]]"]),
    [PATHS.ordinary]: '---\ntype: "[[note]]"\n---\n\n# Ordinary\n\n![[cash]]\n\n[[cash]]\n',
    [PATHS.embed]: '---\ntype: "[[note]]"\n---\n\n# Embed host\n\n![[cash]]\n\n[[cash]]\n',
  };
  notes[PATHS.record] = records.recordNote({
    title: "Place 001", album: "eat", fields: { status: "to_try", location: "Downtown", category: "Dinner" },
    body: "## Notes\n\nRecord body sentinel.",
  });
  notes[PATHS.day] = periods.fixturePlan("2026-11-20").notes[PATHS.day];
  const period = periods.fixturePlan("2026-11-20").notes;
  notes[PATHS.week] = period[PATHS.week];
  notes[PATHS.quarter] = period[PATHS.quarter];
  notes[PATHS.year] = '---\ntype: "[[day]]"\nid: 2026\naliases: ["2026"]\ntags: [yearly]\n---\n\n# 2026\n\nYear body sentinel.\n';
  for (let i = 2; i <= 106; i += 1) {
    const path = `eat/place-${String(i).padStart(3, "0")}.md`;
    notes[path] = records.recordNote({ title: `Place ${String(i).padStart(3, "0")}`, album: "eat",
      fields: { status: i % 3 ? "to_try" : "liked", location: "Downtown", category: "Dinner" } });
  }
  for (const [name, title] of [["streamco", "StreamCo"], ["music", "Music"]]) {
    notes[`subscriptions/${name}.md`] = records.recordNote({ title, album: "subscriptions",
      fields: { status: "active", amount: 12, cadence: "monthly" } });
  }
  notes["home.md"] = areaNote({ title: "Home", body: "Home child area." });
  const canvas = {
    nodes: [{ id: "cash-node", type: "file", file: "cash.md", x: 0, y: 0, width: 400, height: 300 }],
    edges: [],
  };
  notes["cabinet-context.canvas"] = JSON.stringify(canvas, null, 2) + "\n";
  return notes;
}

function screenshotNeeds() {
  const result = [];
  for (const host of SCREENSHOT_HOSTS) {
    for (const theme of ["light", "dark"]) {
      for (const width of ["narrow", "wide"]) {
        for (const mode of ["live", "reading"]) {
          const state = host.state === "armed" ? "-armed" : "";
          result.push(`${host.key}-${mode}-${theme}-${width}${state}`);
        }
      }
    }
  }
  result.push("area-live-light-wide-reduced-motion");
  result.push("area-live-light-wide-forced-colors");
  return result;
}

function parseArgs(argv) {
  const args = { executable: null, out: null, report: null, selfTest: false, help: false };
  const input = Array.isArray(argv) ? argv.slice() : [];
  for (let i = 0; i < input.length; i += 1) {
    const flag = input[i];
    const take = (label) => {
      const value = input[++i];
      if (!value || value.startsWith("-")) throw new Error(`${flag} requires a ${label} value`);
      return value;
    };
    if (flag === "-e" || flag === "--executable") args.executable = take("PATH");
    else if (flag === "-o" || flag === "--out") args.out = take("DIRECTORY");
    else if (flag === "-r" || flag === "--report") args.report = take("PATH");
    else if (flag === "-s" || flag === "--self-test") args.selfTest = true;
    else if (flag === "-h" || flag === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  return args;
}

function countCatalogRows(markdown, kind) {
  const re = new RegExp(`^>\\s*[-+*]\\s+.*\\[\\[[^\\]]+\\]\\]`, "gm");
  const section = String(markdown || "").split(new RegExp(`^##\\s+${kind}\\s*$`, "im"))[1] || "";
  return (section.split(/^##\s+/m)[0].match(re) || []).length;
}

function selfTest() {
  const notes = fixtureNotes();
  for (const spec of SPECS) assert.ok(notes[spec.path], `fixture for ${spec.key}`);
  assert.equal(countCatalogRows(notes[PATHS.area], "Areas"), 1);
  assert.equal(countCatalogRows(notes[PATHS.area], "Projects"), 1);
  assert.equal(countCatalogRows(notes[PATHS.project], "Projects"), 64);
  assert.equal(countCatalogRows(notes[PATHS.album], "Records"), 106);
  assert.doesNotMatch(notes[PATHS.untyped], /^type:/m);
  assert.match(notes[PATHS.duplicate], /## Projects[\s\S]*## Projects/);
  assert.ok(notes["cabinet-context.canvas"]);
  assert.equal(SPECS.length, 16);
  assert.equal(screenshotNeeds().length, 58);
  assert.equal(new Set(screenshotNeeds()).size, screenshotNeeds().length);
  assert.deepEqual(parseArgs(["-e", "/x/obsidian", "-o", "/tmp/shots", "-r", "/tmp/report.json", "-s"]), {
    executable: "/x/obsidian", out: "/tmp/shots", report: "/tmp/report.json", selfTest: true, help: false,
  });
  assert.throws(() => parseArgs(["--report"]), /requires/);
  assert.throws(() => parseArgs(["--unknown"]), /Unknown/);
  assert.deepEqual(SPECS.find((x) => x.key === "area").cabinets, ["areas", "projects", "notebooks", "albums", "properties"]);
  assert.deepEqual(SPECS.find((x) => x.key === "album").cabinets, ["records", "schema", "properties"]);
  return true;
}

module.exports = {
  HELP_TEXT, PATHS, SPECS, SCREENSHOT_HOSTS, fixtureNotes, screenshotNeeds, parseArgs,
  countCatalogRows, selfTest,
};
