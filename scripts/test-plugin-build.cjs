const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const builderModule = import("./build-plugins.mjs");
const parityModule = import("./check-split-parity.mjs");

const fixtureRoots = new Set();
test.after(() => {
  for (const root of fixtureRoots) rmSync(root, { recursive: true, force: true });
});

function fixture(files, manifest = Object.keys(files)) {
  const root = mkdtempSync(path.join(os.tmpdir(), "bob-plugin-build-test-"));
  const pluginRoot = path.join(root, "plugins", "fixture-plugin");
  const srcRoot = path.join(pluginRoot, "src");
  mkdirSync(srcRoot, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const filename = path.join(srcRoot, ...relativePath.split("/"));
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, content);
  }
  writeFileSync(
    path.join(srcRoot, "fragments.json"),
    typeof manifest === "string" ? manifest : JSON.stringify(manifest, null, 2),
  );
  fixtureRoots.add(root);
  return {
    root,
    srcRoot,
    outputPath: path.join(pluginRoot, "main.js"),
  };
}

function quiet(callback) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return callback();
  } finally {
    console.log = originalLog;
  }
}

function assertCheckFailureIsReadOnly(buildPlugins, root, outputPath, expression) {
  const before = existsSync(outputPath) ? readFileSync(outputPath) : null;
  assert.throws(() => quiet(() => buildPlugins(root, { check: true })), expression);
  const after = existsSync(outputPath) ? readFileSync(outputPath) : null;
  if (before === null) {
    assert.equal(after, null, "read-only failure must not create main.js");
  } else {
    assert.deepEqual(after, before, "read-only failure must not edit main.js");
  }
}

test("manifest order is authoritative and fragments share one lexical scope", async () => {
  const { buildPlugins } = await builderModule;
  const repo = fixture(
    {
      "z-first.js": 'const shared = 42; globalThis.order = ["first"];\n',
      "a-second.js": 'globalThis.order.push("second"); globalThis.value = shared;\n',
    },
    ["z-first.js", "a-second.js"],
  );
  quiet(() => buildPlugins(repo.root));
  const output = readFileSync(repo.outputPath, "utf8");
  assert.ok(output.indexOf("src/z-first.js") < output.indexOf("src/a-second.js"));
  const context = {};
  vm.runInNewContext(output, context);
  assert.deepEqual(Array.from(context.order), ["first", "second"]);
  assert.equal(context.value, 42);
});

test("builds are deterministic and build:check is read-only on success", async () => {
  const { buildPlugins } = await builderModule;
  const repo = fixture({ "one.js": "globalThis.built = true;\n" });
  quiet(() => buildPlugins(repo.root));
  const first = readFileSync(repo.outputPath);
  quiet(() => buildPlugins(repo.root));
  const second = readFileSync(repo.outputPath);
  assert.deepEqual(second, first);
  quiet(() => buildPlugins(repo.root, { check: true }));
  assert.deepEqual(readFileSync(repo.outputPath), first);
});

test("read-only check rejects changed fragments and edited generated output", async () => {
  const { buildPlugins } = await builderModule;
  const repo = fixture({ "one.js": "globalThis.value = 1;\n" });
  quiet(() => buildPlugins(repo.root));
  const originalOutput = readFileSync(repo.outputPath);
  writeFileSync(path.join(repo.srcRoot, "one.js"), "globalThis.value = 2;\n");
  assertCheckFailureIsReadOnly(buildPlugins, repo.root, repo.outputPath, /stale generated bundle/);
  assert.deepEqual(readFileSync(repo.outputPath), originalOutput);

  writeFileSync(path.join(repo.srcRoot, "one.js"), "globalThis.value = 1;\n");
  writeFileSync(repo.outputPath, Buffer.from("hand edit\n"));
  const handEdited = readFileSync(repo.outputPath);
  assertCheckFailureIsReadOnly(buildPlugins, repo.root, repo.outputPath, /stale generated bundle/);
  assert.deepEqual(readFileSync(repo.outputPath), handEdited);
});

test("check rejects a missing generated bundle without writing it", async () => {
  const { buildPlugins } = await builderModule;
  const repo = fixture({ "one.js": "const value = 1;\n" });
  assertCheckFailureIsReadOnly(buildPlugins, repo.root, repo.outputPath, /missing generated bundle/);
});

test("fragment line limit is enforced before writing output", async () => {
  const { buildPlugins } = await builderModule;
  const body = Array.from({ length: 1001 }, () => "// line").join("\n") + "\n";
  const repo = fixture({ "large.js": body });
  assert.throws(() => quiet(() => buildPlugins(repo.root)), /has 1001 lines; limit is 1000/);
  assert.equal(existsSync(repo.outputPath), false);
});

test("fragment syntax errors are rejected before writing output", async () => {
  const { buildPlugins } = await builderModule;
  const repo = fixture({ "bad.js": "const value = ;\n" });
  assert.throws(() => quiet(() => buildPlugins(repo.root)), /src\/bad.js does not parse under Node/);
  assert.equal(existsSync(repo.outputPath), false);
});

test("malformed, empty, duplicate, and traversal manifests are rejected read-only", async (t) => {
  const { buildPlugins } = await builderModule;
  const cases = [
    ["invalid JSON", "{", /not valid JSON/],
    ["empty manifest", "[]", /nonempty JSON array/],
    ["non-array manifest", '{"fragment":"one.js"}', /nonempty JSON array/],
    ["duplicate entries", ["one.js", "one.js"], /duplicate fragment entry/],
    ["traversal entry", ["../outside.js"], /normalized relative path under src/],
    ["absolute entry", [path.resolve("/outside.js")], /normalized relative path under src/],
  ];
  for (const [name, manifest, expected] of cases) {
    await t.test(name, () => {
      const repo = fixture({ "one.js": "const value = 1;\n" }, manifest);
      assertCheckFailureIsReadOnly(buildPlugins, repo.root, repo.outputPath, expected);
    });
  }
});

test("missing and omitted fragments are rejected read-only", async (t) => {
  const { buildPlugins } = await builderModule;
  await t.test("missing manifest entry", () => {
    const repo = fixture({}, ["missing.js"]);
    assertCheckFailureIsReadOnly(buildPlugins, repo.root, repo.outputPath, /missing fragment/);
  });
  await t.test("unlisted JavaScript source", () => {
    const repo = fixture(
      { "listed.js": "const listed = 1;\n", "omitted.js": "const omitted = 2;\n" },
      ["listed.js"],
    );
    assertCheckFailureIsReadOnly(buildPlugins, repo.root, repo.outputPath, /omitted from manifest/);
  });
});

test("escaping fragment symlinks are rejected read-only", async (t) => {
  const { buildPlugins } = await builderModule;
  const repo = fixture({});
  const outsidePath = path.join(repo.root, "outside.js");
  writeFileSync(outsidePath, "const outside = true;\n");
  symlinkSync(outsidePath, path.join(repo.srcRoot, "escape.js"));
  writeFileSync(
    path.join(repo.srcRoot, "fragments.json"),
    JSON.stringify(["escape.js"]),
  );
  assertCheckFailureIsReadOnly(buildPlugins, repo.root, repo.outputPath, /symlink escapes src/);
});

test("parity comparator identifies changed helper and plugin methods", async () => {
  const { comparePluginExports } = await parityModule;
  class BasePlugin {
    method() {
      return "base";
    }
  }
  BasePlugin.helpers = {
    helper() {
      return "base";
    },
  };
  class BuiltPlugin {
    method() {
      return "built";
    }
  }
  BuiltPlugin.helpers = {
    helper() {
      return "built";
    },
  };
  const mismatches = comparePluginExports(BasePlugin, BuiltPlugin);
  assert.ok(mismatches.includes("helpers.helper source differs"));
  assert.ok(mismatches.includes("default export.prototype.method source differs"));
});
