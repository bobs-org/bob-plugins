const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { optionsFromArgs, sweep } = require("./retire-project-count-keys.cjs");

test("cleanup defaults to preview and rejects ambiguous flags", () => {
  assert.equal(optionsFromArgs([], {}).apply, false);
  assert.equal(optionsFromArgs(["--apply"], {}).apply, true);
  assert.throws(() => optionsFromArgs(["--apply", "--dry-run"], {}));
  assert.throws(() => optionsFromArgs(["--bob-dir"], {}));
});

test("cleanup includes archives, guards one batch per note, skips stale/refused, and reruns safely", (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "retire-counts-"));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  fs.mkdirSync(path.join(vault, "done"));
  const state = new Map([
    ["both.md", ["task_count", "open_task_count"]],
    ["done/one.md", ["task_count"]],
    ["stale.md", ["open_task_count"]],
    ["refused.md", ["task_count"]],
    ["body.md", []],
  ]);
  for (const name of state.keys()) fs.writeFileSync(path.join(vault, name), "task_count");
  const updates = [];
  const invoke = (_options, args, request) => {
    if (args[0] === "__catalog") return { features: ["props_v1"] };
    const name = args[2];
    if (args[1] === "show") return {
      fingerprint: `sha256:${name}`, frontmatter: { state: "ok" },
      properties: state.get(name).map((key) => ({ key })),
    };
    updates.push({ name, request, preview: args.includes("-d") });
    assert.equal(request.expect, `sha256:${name}`);
    assert.deepEqual(request.ops, state.get(name).map((key) => ({ op: "prop.unset", key })));
    if (name === "stale.md") throw new Error("prop_stale");
    if (name === "refused.md") throw new Error("prop_opaque");
    if (!args.includes("-d")) state.set(name, []);
    return { changed: true };
  };
  const output = [];
  assert.deepEqual(sweep({ vault, apply: false }, invoke, (s) => output.push(s)), { changed: 2, keys: 3, skipped: 2 });
  assert.equal(updates.length, 4);
  assert.ok(updates.every((row) => row.preview));
  assert.match(output.join("\n"), /stale.md\tskipped\tprop_stale/);
  assert.deepEqual(sweep({ vault, apply: true }, invoke, () => {}), { changed: 2, keys: 3, skipped: 2 });
  assert.deepEqual(sweep({ vault, apply: true }, invoke, () => {}), { changed: 0, keys: 0, skipped: 2 });
});

test("cleanup fails before mutation when bob lacks props_v1", () => {
  assert.throws(() => sweep({}, () => ({ features: [] }), () => {}), /props_v1/);
});
