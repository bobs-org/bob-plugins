// Task requirement twin drift test (bob-cli-on.10.1.2). The cycler owns the
// plugin-side twins: RQ (`task-reqs-lines-twin.js`, `task-reqs-twin.js`), RL
// (`task-block-layout-twin.js`, `task-block-tidy-twin.js`), and RW
// (`task-reqs-writers-twin.js`). Nav carries all five and Block ID Prompt
// the RQ pair, each byte for byte, and every plugin copy of bob-cli's
// fixtures stays byte-identical. The built nav and Block ID Prompt bundles
// must run the shared vectors through their own copies.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { helpers: cyclerHelpers } = require("./task-status-cycler-harness.cjs");
const { helpers: navHelpers } = require("./navigation-hotkeys-harness.cjs");
const { helpers: blockIdHelpers } = require("./block-id-prompt-harness.cjs");
const {
  CANONICAL_DIR,
  TASK_REQ_FIXTURE_FILES,
  fixtureDir,
  readFixture,
  runRq,
  rlRunners,
  runWrite,
} = require("./task-reqs-vectors.cjs");

const PLUGINS_DIR = path.join(__dirname, "..", "plugins");
const CYCLER = "task-status-cycler";
const NAV = "bob-navigation-hotkeys";
const BLOCK_ID = "block-id-prompt";
const LEDGER = "bob-ledger-tools";

const RQ_TWINS = ["task-reqs-lines-twin.js", "task-reqs-twin.js"];
const ALL_TWINS = [...RQ_TWINS, "task-block-layout-twin.js", "task-block-tidy-twin.js", "task-reqs-writers-twin.js"];
const COPIES = [
  { plugin: NAV, twins: ALL_TWINS, fixtures: TASK_REQ_FIXTURE_FILES, exportsFragment: "728-task-reqs-exports.js" },
  { plugin: BLOCK_ID, twins: RQ_TWINS, fixtures: ["README.md", "vectors.json"], exportsFragment: "171-task-reqs-exports.js" },
];

const srcPath = (plugin, file) => path.join(PLUGINS_DIR, plugin, "src", file);
const manifestOf = (plugin) => JSON.parse(fs.readFileSync(srcPath(plugin, "fragments.json"), "utf8"));

// The fragment in `plugin` whose name is `NNN-<twin>`.
function fragmentFor(plugin, twin) {
  const matches = manifestOf(plugin).filter((entry) => entry.replace(/^\d+[a-z]?-/, "") === twin);
  assert.equal(matches.length, 1, `${plugin} lists exactly one ${twin}`);
  return matches[0];
}

test("nav and Block ID Prompt twin fragments are byte-identical to the cycler's", () => {
  for (const { plugin, twins } of COPIES) {
    for (const twin of twins) {
      const source = fs.readFileSync(srcPath(CYCLER, fragmentFor(CYCLER, twin)));
      const copy = fs.readFileSync(srcPath(plugin, fragmentFor(plugin, twin)));
      assert.ok(copy.equals(source), `${plugin} ${twin} is a byte-for-byte copy of the cycler's; recopy it`);
    }
  }
});

test("each plugin lists its twins in cycler order before its exports, and bundles them verbatim", () => {
  for (const { plugin, twins, exportsFragment } of [
    { plugin: CYCLER, twins: ALL_TWINS, exportsFragment: "211-task-reqs-exports.js" },
    ...COPIES,
  ]) {
    const manifest = manifestOf(plugin);
    const positions = twins.map((twin) => manifest.indexOf(fragmentFor(plugin, twin)));
    positions.forEach((position, index) => {
      if (index > 0) assert.ok(position > positions[index - 1], `${plugin} keeps ${twins[index]} after ${twins[index - 1]}`);
    });
    const exportsAt = manifest.indexOf(exportsFragment);
    assert.ok(exportsAt > positions[positions.length - 1], `${plugin} exports the twins after defining them`);
    const bundle = fs.readFileSync(path.join(PLUGINS_DIR, plugin, "main.js"), "utf8");
    for (const twin of twins) {
      const fragment = fragmentFor(plugin, twin);
      const text = fs.readFileSync(srcPath(plugin, fragment), "utf8");
      assert.ok(bundle.includes(`// ---- src/${fragment} ----\n${text}`), `${plugin} main.js carries ${fragment}; run npm run build`);
    }
  }
});

test("every plugin copy of the task_reqs fixtures is byte-identical", (t) => {
  const cyclerDir = fixtureDir(CYCLER);
  for (const { plugin, fixtures } of COPIES) {
    for (const name of fixtures) {
      assert.ok(
        fs.readFileSync(path.join(fixtureDir(plugin), name)).equals(fs.readFileSync(path.join(cyclerDir, name))),
        `${plugin} ${name} matches the cycler's copy`,
      );
    }
  }
  assert.ok(
    fs.readFileSync(path.join(fixtureDir(LEDGER), "vectors.json")).equals(fs.readFileSync(path.join(cyclerDir, "vectors.json"))),
    "bob-ledger-tools vectors.json matches the cycler's copy",
  );
  if (!fs.existsSync(CANONICAL_DIR)) {
    t.diagnostic("bob-cli fixtures are not beside this checkout; skipped the canonical comparison");
    return;
  }
  for (const name of TASK_REQ_FIXTURE_FILES) {
    assert.ok(
      fs.readFileSync(path.join(cyclerDir, name)).equals(fs.readFileSync(path.join(CANONICAL_DIR, name))),
      `${name} matches bob-cli's canonical fixture`,
    );
  }
});

test("each plugin's exports fragment publishes the same twin helpers", () => {
  const twinNames = (helpers) => Object.keys(helpers).filter((name) => /^(taskReq[A-Z]|taskBlock[A-Z]|TASK_REQ_|TASK_BLOCK_)/.test(name)).sort();
  const cycler = twinNames(cyclerHelpers);
  assert.deepEqual(twinNames(navHelpers), cycler, "nav exports every cycler twin helper");
  const rq = cycler.filter((name) => /^(taskReq[A-Z]|TASK_REQ_)/.test(name) && !/^taskReq(Drop|Restore|Toggle|Insert)$/.test(name));
  assert.deepEqual(twinNames(blockIdHelpers), rq, "Block ID Prompt exports the RQ helpers");
});

const vectors = readFixture(CYCLER, "vectors.json");
const layout = readFixture(CYCLER, "layout.json");
const writes = readFixture(CYCLER, "writes.json");

for (const [plugin, helpers] of [[NAV, navHelpers], [BLOCK_ID, blockIdHelpers]]) {
  test(`${plugin} bundle runs every RQ vector through its own twin`, () => {
    for (const testCase of vectors.cases) {
      assert.deepEqual(runRq(helpers, testCase), testCase.expect.nodes, `${plugin} ${testCase.id}`);
    }
  });
}

test("nav bundle runs every RL and RW vector through its own twins", () => {
  for (const [section, run] of Object.entries(rlRunners(navHelpers))) {
    for (const testCase of layout[section]) {
      assert.deepEqual(run(testCase), testCase.expect, `nav ${testCase.id} ${section}`);
    }
  }
  for (const testCase of writes.cases) {
    assert.deepEqual(runWrite(navHelpers, testCase, writes.date), testCase.expect, `nav ${testCase.id}`);
  }
});
