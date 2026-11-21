// Keep the proseField allowlist and text-control role declarations in lockstep.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const fixture = require("./fixtures/prose-fields.json");
const markers = new Map();
const sourceFiles = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (entry.isFile() && entry.name.endsWith(".js")) sourceFiles.push(absolute);
  }
}

for (const entry of fs.readdirSync(path.join(root, "plugins"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const plugin = path.join(root, "plugins", entry.name);
  const fragments = path.join(plugin, "src");
  if (fs.existsSync(fragments)) walk(fragments);
  else if (fs.existsSync(path.join(plugin, "main.js"))) sourceFiles.push(path.join(plugin, "main.js"));
}

function creationSite(line) {
  return /\.createEl\s*\(\s*["'](?:input|textarea)["']/.test(line)
    || /\.add(?:Text|TextArea|Search)\s*\(/.test(line)
    || /new\s+Text(?:Area)?Component\s*\(/.test(line)
    || /\.createElement\s*\(\s*["'](?:input|textarea)["']/.test(line)
    // Any DOM helper named *Append / *El / *Element whose tag argument is
    // input or textarea (notebookCreateEl, recordCardEl, bankCategoryUiAppend,
    // statsEl, copyChipAuthorMakeEl, ...), so a new helper cannot bypass a role.
    || /\b[A-Za-z_$][\w$]*(?:Append|El|Element)\s*\(\s*[^,()]+,\s*["'](?:input|textarea)["']/.test(line)
    || /setAttribute\s*\(\s*["']contenteditable["']\s*,\s*["'](?:true|)["']/.test(line);
}

for (const absolute of sourceFiles) {
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  const lines = fs.readFileSync(absolute, "utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!creationSite(lines[index])) continue;
    const context = lines.slice(Math.max(0, index - 3), index).join("\n");
    const found = [...context.matchAll(/\/\/\s*bob-text:\s*(prose|literal|mixed|none)\s+([^\n]+)/g)];
    assert.ok(found.length, `${relative}:${index + 1} text control needs a bob-text role within the previous 3 lines`);
    const [role, detail] = found[found.length - 1].slice(1);
    markers.set(`${relative}:${index + 1}`, { file: relative, line: index + 1, role, detail: detail.trim() });
  }
}

test("every text-control creation site declares its prose role", () => {
  assert.ok(markers.size > 0, "the scanner must find text controls");
  for (const marker of markers.values()) {
    const ids = [...marker.detail.matchAll(/S(\d{1,2})/g)].map((match) => `S${match[1]}`);
    if (marker.role === "prose") {
      assert.ok(ids.length, `${marker.file}:${marker.line} prose marker needs an S1-S15 ID`);
    }
    for (const id of ids) {
      assert.ok(fixture.surfaces.some((surface) => surface.id === id), `${marker.file}:${marker.line} names unknown ${id}`);
    }
  }
});

test("S1-S15 fixture pins creation markers and proseField wiring", () => {
  const ids = new Set(fixture.surfaces.map((surface) => surface.id));
  assert.deepEqual([...ids].sort(), Array.from({ length: 15 }, (_, index) => `S${index + 1}`).sort());
  for (const surface of fixture.surfaces) {
    const creation = fs.readFileSync(path.join(root, surface.creation), "utf8");
    const wiring = fs.readFileSync(path.join(root, surface.wiring), "utf8");
    assert.match(creation, new RegExp(`bob-text: (?:prose|mixed) .*${surface.id}`), `${surface.id} needs an annotated creation site`);
    assert.match(wiring, /links:\s*true|proseField/, `${surface.id} wiring file must opt into proseField`);
  }
});
