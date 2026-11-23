// Requirement close-card twin drift test (bob-cli-on.11.1.2). The cycler owns
// the plugin-side twins (`req-close-twin.js`, `req-verdicts-twin.js`). Nav
// copies them byte for byte, and every plugin copy of bob-cli's RV fixture
// stays byte-identical. The built nav bundle must run RV1–RV19 through its
// own copies. Runtime successor orchestration is not advertised.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { helpers: cyclerHelpers } = require("./task-status-cycler-harness.cjs");
const { helpers: navHelpers } = require("./navigation-hotkeys-harness.cjs");
const {
  CANONICAL_DIR,
  REQ_CLOSE_FIXTURE_FILES,
  fixtureDir,
  readFixture,
  sha256Hex,
  collectCase,
  collectChoiceCase,
  ownerJson,
  groupJson,
} = require("./req-close-vectors.cjs");

const PLUGINS_DIR = path.join(__dirname, "..", "plugins");
const CYCLER = "task-status-cycler";
const NAV = "bob-navigation-hotkeys";
const TWINS = ["req-close-twin.js", "req-verdicts-twin.js"];
const COPIES = [
  { plugin: NAV, twins: TWINS, fixtures: REQ_CLOSE_FIXTURE_FILES, exportsFragment: "728-task-reqs-exports.js" },
];

const srcPath = (plugin, file) => path.join(PLUGINS_DIR, plugin, "src", file);
const manifestOf = (plugin) => JSON.parse(fs.readFileSync(srcPath(plugin, "fragments.json"), "utf8"));

function fragmentFor(plugin, twin) {
  const matches = manifestOf(plugin).filter((entry) => entry.replace(/^\d+[a-z]?-/, "") === twin);
  assert.equal(matches.length, 1, `${plugin} lists exactly one ${twin}`);
  return matches[0];
}

test("nav req-close twin fragments are byte-identical to the cycler's", () => {
  for (const { plugin, twins } of COPIES) {
    for (const twin of twins) {
      const source = fs.readFileSync(srcPath(CYCLER, fragmentFor(CYCLER, twin)));
      const copy = fs.readFileSync(srcPath(plugin, fragmentFor(plugin, twin)));
      assert.ok(copy.equals(source), `${plugin} ${twin} is a byte-for-byte copy of the cycler's; recopy it`);
    }
  }
});

test("each plugin lists its req-close twins in cycler order before its exports, and bundles them verbatim", () => {
  for (const { plugin, twins, exportsFragment } of [
    { plugin: CYCLER, twins: TWINS, exportsFragment: "211-task-reqs-exports.js" },
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

test("every plugin copy of the req_close fixtures is byte-identical", (t) => {
  const cyclerDir = fixtureDir(CYCLER);
  for (const { plugin, fixtures } of COPIES) {
    for (const name of fixtures) {
      assert.ok(
        fs.readFileSync(path.join(fixtureDir(plugin), name)).equals(fs.readFileSync(path.join(cyclerDir, name))),
        `${plugin} ${name} matches the cycler's copy`,
      );
    }
  }
  if (!fs.existsSync(CANONICAL_DIR)) {
    t.diagnostic("bob-cli fixtures are not beside this checkout; skipped the canonical comparison");
    return;
  }
  for (const name of REQ_CLOSE_FIXTURE_FILES) {
    assert.ok(
      fs.readFileSync(path.join(cyclerDir, name)).equals(fs.readFileSync(path.join(CANONICAL_DIR, name))),
      `${name} matches bob-cli's canonical fixture`,
    );
  }
});

test("each plugin's exports fragment publishes the same req-close helpers", () => {
  const names = (helpers) => Object.keys(helpers).filter((name) => /^(reqClose[A-Z]|REQ_CLOSE_)/.test(name)).sort();
  const cyclerNames = names(cyclerHelpers);
  const navNames = names(navHelpers);
  const wiring = fs.readFileSync(srcPath(CYCLER, "198h-req-close-card-wiring.js"), "utf8");
  const cyclerOnly = new Set(
    [...wiring.matchAll(/^function (reqClose[A-Z]\w*)\(/gm)]
      .map((match) => match[1])
      .filter((name) => cyclerNames.includes(name)),
  );
  assert.deepEqual(
    cyclerNames.filter((name) => !cyclerOnly.has(name)),
    navNames,
    "nav exports every twin req-close helper; cycler-only card-wiring helpers live in 198h",
  );
});

const vectors = readFixture(CYCLER, "vectors.json");

test("nav bundle runs every RV1–RV19 row and choice vector through its own twin", () => {
  for (const testCase of vectors.cases.filter((entry) => entry.family === "rows")) {
    const { owners, groups } = collectCase(navHelpers, testCase);
    assert.deepEqual(owners.map(ownerJson), testCase.expect.owners, `nav ${testCase.id} owners`);
    assert.deepEqual(groups.map(groupJson), testCase.expect.groups, `nav ${testCase.id} groups`);
  }
  const rv12 = vectors.cases.find((entry) => entry.id === "RV12");
  const { owners } = collectChoiceCase(navHelpers, vectors, rv12);
  const result = navHelpers.reqCloseResolveVerdicts(
    owners,
    [],
    [
      { selector: rv12.input.key, verdict: "carry" },
      { selector: rv12.input.key, verdict: "carry" },
    ],
    null,
    sha256Hex,
  );
  assert.equal(result.ok, true, "nav RV12 identical carries stay idempotent");
  assert.equal(result.verdicts.length, 1);
});
