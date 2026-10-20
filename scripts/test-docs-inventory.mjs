import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { generateInventory, scanCommands } from "./docs-inventory.mjs";

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bob-plugin-docs-"));
}

function writeManifest(root, directory, pluginManifest, { fragments, files, main } = {}) {
  const pluginRoot = path.join(root, "plugins", directory);
  fs.mkdirSync(pluginRoot, { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, "manifest.json"), JSON.stringify(pluginManifest, null, 2) + "\n");
  if (fragments) {
    const sourceRoot = path.join(pluginRoot, "src");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "fragments.json"), JSON.stringify(fragments, null, 2) + "\n");
    for (const [file, content] of Object.entries(files ?? {})) {
      fs.writeFileSync(path.join(sourceRoot, file), content);
    }
    if (main !== undefined) fs.writeFileSync(path.join(pluginRoot, "main.js"), main);
  } else if (main !== undefined) {
    fs.writeFileSync(path.join(pluginRoot, "main.js"), main);
  }
}

function manifest(id, overrides = {}) {
  return {
    id,
    name: id,
    version: "1.0.0",
    minAppVersion: "1.8.7",
    description: "A | useful plugin.",
    isDesktopOnly: false,
    ...overrides,
  };
}

test("scans multiline, one-line, and guarded literal registrations", () => {
  const source = [
    "this.addCommand({",
    '  id: "multi-line",',
    '  name: "Multi line",',
    '  hotkeys: [{ modifiers: ["Ctrl", "Alt"], key: "]" }],',
    "  callback: () => this.run(),",
    "});",
    'if (typeof this.addCommand === "function") this.addCommand({ id: "one-line", name: "One line" });',
    'try { this.addCommand({ id: "guarded", name: "Guarded", editorCallback: () => this.run() }); } catch {}',
  ].join("\n");

  const commands = scanCommands([{ path: "literal.js", content: source }]);
  assert.deepEqual(commands.map(({ id }) => id), ["guarded", "multi-line", "one-line"]);
  assert.deepEqual(commands.find(({ id }) => id === "multi-line").hotkeys, ["Ctrl+Alt+]"]);
  assert.deepEqual(commands.find(({ id }) => id === "one-line").hotkeys, []);
});

test("scans an optional addCommand call", () => {
  const commands = scanCommands([{
    path: "optional.js",
    content: 'this.addCommand?.({ id: "optional", name: "Optional" });',
  }]);
  assert.deepEqual(commands.map(({ id }) => id), ["optional"]);
});

test("allows addCommand references only in a typeof guard", () => {
  const source = [
    'if (typeof this.addCommand === "function") this.addCommand({ id: "this-guard", name: "This guard" });',
    'if (typeof plugin.addCommand === "function") plugin.addCommand?.({ id: "plugin-guard", name: "Plugin guard" });',
  ].join("\n");
  assert.deepEqual(scanCommands([{ path: "guards.js", content: source }]).map(({ id }) => id), ["plugin-guard", "this-guard"]);
});

test("rejects bind, call, and aliased addCommand references with source locations", () => {
  for (const [label, expression] of [
    ["bind", "this.addCommand.bind(this)"],
    ["call", "this.addCommand.call(this, {})"],
    ["alias", "const add = this.addCommand"],
  ]) {
    assert.throws(
      () => scanCommands([{ path: label + ".js", content: expression }]),
      new RegExp(label + "\\.js:1:\\d+: unsupported non-call addCommand reference"),
    );
  }
});

test("expands literal command data from a constant-array forEach across source files", () => {
  const table = [
    "const YANK_PATH_COMMANDS = [",
    '  { id: "yank-relative", name: "Yank relative path", kind: "relative" },',
    '  { id: "yank-absolute", name: "Yank absolute path", kind: "absolute" },',
    "];",
  ].join("\n");
  const registration = [
    "YANK_PATH_COMMANDS.forEach((command) => {",
    "  this.addCommand({",
    "    id: command.id,",
    "    name: command.name,",
    "    callback: () => this.yank(() => command.kind),",
    "  });",
    "});",
  ].join("\n");

  const commands = scanCommands([
    { path: "table.js", content: table },
    { path: "plugin.js", content: registration },
  ]);
  assert.deepEqual(commands.map(({ id }) => id), ["yank-absolute", "yank-relative"]);
});

test("balances nested callback syntax and ignores misleading comments, strings, templates, and regexes", () => {
  const tick = String.fromCharCode(96);
  const source = [
    '// this.addCommand({ id: "comment", name: "Comment" });',
    'const misleading = "this.addCommand({ id: fake, name: fake })";',
    "const template = " + tick + "this.addCommand({ id: fake, name: fake })" + tick + ";",
    "const expression = /this\\.addCommand\\(\\{/;",
    "this.addCommand({",
    '  id: "real",',
    '  name: "Real command",',
    "  callback: () => outer(() => {",
    '    const text = "a closing } and an opening {";',
    "    return nested({ value: [1, 2, 3] });",
    "  }),",
    "});",
  ].join("\n");

  assert.deepEqual(scanCommands([{ path: "nested.js", content: source }]).map(({ id }) => id), ["real"]);
});

test("decodes escaped string metadata and literal default hotkeys", () => {
  const source = 'this.addCommand({ id: "escaped\\u002did", name: "A \\"quoted\\" \\\\ label", hotkeys: [{ modifiers: ["Mod"], key: "Enter" }] });';
  const [command] = scanCommands([{ path: "escaped.js", content: source }]);
  assert.equal(command.id, "escaped-id");
  assert.equal(command.name, 'A "quoted" \\ label');
  assert.deepEqual(command.hotkeys, ["Mod+Enter"]);
});

test("returns no commands for a plugin without registrations", () => {
  assert.deepEqual(scanCommands([{ path: "empty.js", content: "class Plugin { onload() {} }" }]), []);
});

test("fails with source locations for dynamic metadata, hotkeys, and malformed tables", () => {
  assert.throws(
    () => scanCommands([{ path: "dynamic.js", content: 'this.addCommand({ id: commandId, name: "Dynamic" });' }]),
    /dynamic\.js:1:.*command id/,
  );
  assert.throws(
    () => scanCommands([{ path: "hotkey.js", content: 'this.addCommand({ id: "x", name: "X", hotkeys: makeHotkeys() });' }]),
    /hotkey\.js:1:.*hotkeys/,
  );
  assert.throws(
    () => scanCommands([
      { path: "table.js", content: 'const COMMANDS = [{ id: "x", name: dynamicName }];' },
      { path: "plugin.js", content: 'COMMANDS.forEach((command) => { this.addCommand({ id: command.id, name: command.name }); });' },
    ]),
    /table\.js:1:.*command name/,
  );
  assert.throws(
    () => scanCommands([{ path: "empty-id.js", content: 'this.addCommand({ id: "", name: "Empty" });' }]),
    /empty-id\.js:1:.*command id cannot be empty/,
  );
  assert.throws(
    () => scanCommands([{ path: "empty-name.js", content: 'this.addCommand({ id: "x", name: "" });' }]),
    /empty-name\.js:1:.*command name cannot be empty/,
  );
});

test("fails duplicate command ids with both registration locations", () => {
  const source = [
    'this.addCommand({ id: "same", name: "First" });',
    'this.addCommand({ id: "same", name: "Second" });',
  ].join("\n");
  assert.throws(
    () => scanCommands([{ path: "duplicates.js", content: source }]),
    /duplicate command id "same".*duplicates\.js:2:.*first registered at duplicates\.js:1:/,
  );
});

test("checks drift without writes, preserves prose, and generates deterministically", async (t) => {
  const root = temporaryDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "README.md"), "# Bob plugins\n\nExisting README details.\n\n## Plugins\n\nExisting plugin table.\n");
  writeManifest(root, "example-plugin", manifest("example-plugin", {
    name: "Example | Plugin",
    minAppVersion: "1.9.9",
    description: "A description | with a pipe.",
  }), {
    fragments: ["10-commands.js", "20-empty.js"],
    files: {
      "10-commands.js": 'this.addCommand({ id: "example", name: "Example command", callback: () => this.run() });',
      "20-empty.js": "",
    },
    main: 'this.addCommand({ id: "generated-main-must-be-ignored", name: "Ignored" });',
  });
  writeManifest(root, "plain-plugin", manifest("plain-plugin", {
    minAppVersion: "1.10.0",
    isDesktopOnly: true,
  }), {
    main: "class Plugin { onload() {} }",
  });

  const initialReadme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const initialCheck = await generateInventory(root, { check: true });
  assert.ok(initialCheck.stale.includes("README.md"));
  assert.ok(initialCheck.stale.includes("docs/index.md"));
  assert.equal(fs.existsSync(path.join(root, "docs")), false);
  assert.equal(fs.readFileSync(path.join(root, "README.md"), "utf8"), initialReadme);

  const generated = await generateInventory(root);
  assert.equal(generated.inventory.plugins.length, 2);
  assert.equal(generated.inventory.plugins.find(({ id }) => id === "example-plugin").commands.length, 1);
  assert.equal(generated.inventory.plugins.find(({ id }) => id === "plain-plugin").commands.length, 0);

  const readmePath = path.join(root, "README.md");
  const readme = fs.readFileSync(readmePath, "utf8");
  assert.match(readme, /The plugins require Obsidian 1\.10\.0 or later\./);
  assert.match(readme, /Existing README details\./);
  assert.ok(fs.readFileSync(path.join(root, "docs", "example-plugin.md"), "utf8").includes("Example \\| Plugin"));
  assert.match(fs.readFileSync(path.join(root, "docs", "plain-plugin.md"), "utf8"), /registers no command palette commands/);

  const pagePath = path.join(root, "docs", "example-plugin.md");
  fs.appendFileSync(pagePath, "\nHandwritten page detail.\n");
  const beforeSecondRun = new Map(
    ["README.md", "docs/index.md", "docs/example-plugin.md", "docs/plain-plugin.md"]
      .map((file) => [file, fs.readFileSync(path.join(root, file), "utf8")]),
  );
  const secondRun = await generateInventory(root);
  assert.deepEqual(secondRun.stale, []);
  for (const [file, content] of beforeSecondRun) {
    assert.equal(fs.readFileSync(path.join(root, file), "utf8"), content, file + " changed on the second generation");
  }
  assert.match(fs.readFileSync(pagePath, "utf8"), /Handwritten page detail\./);

  const stalePage = fs.readFileSync(pagePath, "utf8").replace("| Version | 1.0.0 |", "| Version | stale |");
  fs.writeFileSync(pagePath, stalePage);
  const staleCheckBytes = fs.readFileSync(pagePath, "utf8");
  const drift = await generateInventory(root, { check: true });
  assert.ok(drift.stale.includes("docs/example-plugin.md"));
  assert.equal(fs.readFileSync(pagePath, "utf8"), staleCheckBytes);
});

test("code-span table cells preserve backslashes and use a safe backtick fence", async (t) => {
  const root = temporaryDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "README.md"), "# Bob plugins\n\n## Plugins\n");
  const ticks = "`".repeat(3);
  writeManifest(root, "code-plugin", manifest("code-plugin"), {
    main: 'this.addCommand({ id: "back\\\\slash|pipe' + ticks + 'value", name: "Code" });',
  });

  await generateInventory(root);
  const page = fs.readFileSync(path.join(root, "docs", "code-plugin.md"), "utf8");
  const fence = "`".repeat(4);
  assert.ok(page.includes("| " + fence + "back\\slash\\|pipe" + ticks + "value" + fence + " |"));
});

test("does not write any output when source validation fails", async (t) => {
  const root = temporaryDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const readme = "# Bob plugins\n\n## Plugins\n";
  fs.writeFileSync(path.join(root, "README.md"), readme);
  writeManifest(root, "dynamic-plugin", manifest("dynamic-plugin"), {
    main: 'this.addCommand({ id: getId(), name: "Dynamic" });',
  });

  await assert.rejects(generateInventory(root), /command id/);
  assert.equal(fs.existsSync(path.join(root, "docs")), false);
  assert.equal(fs.readFileSync(path.join(root, "README.md"), "utf8"), readme);
});
