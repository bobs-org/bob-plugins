#!/usr/bin/env node
// Validate every plugin under plugins/<id>/:
//   - manifest.json parses as JSON
//   - required manifest fields are present and well-typed
//   - manifest `id` matches the folder name
//   - `version` is a valid x.y.z semver
//   - main.js parses under Node (syntax check, no execution)
//
// Exits non-zero if any plugin fails. Tooling only -- no bundling.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PLUGINS_DIR = join(REPO_ROOT, "plugins");

// Required manifest fields and their expected JS types.
const REQUIRED_FIELDS = {
  id: "string",
  name: "string",
  version: "string",
  minAppVersion: "string",
  description: "string",
  author: "string",
};

const SEMVER = /^\d+\.\d+\.\d+$/;

function pluginDirs() {
  return readdirSync(PLUGINS_DIR)
    .filter((name) => {
      try {
        return statSync(join(PLUGINS_DIR, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

function validatePlugin(id) {
  const errors = [];
  const dir = join(PLUGINS_DIR, id);
  const manifestPath = join(dir, "manifest.json");
  const mainPath = join(dir, "main.js");

  // manifest.json parses.
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    errors.push(`manifest.json does not parse: ${err.message}`);
    return errors; // nothing else is checkable without a manifest
  }

  // Required fields present and well-typed.
  for (const [field, type] of Object.entries(REQUIRED_FIELDS)) {
    if (!(field in manifest)) {
      errors.push(`manifest missing required field: ${field}`);
    } else if (typeof manifest[field] !== type) {
      errors.push(`manifest field ${field} should be ${type}, got ${typeof manifest[field]}`);
    }
  }

  // isDesktopOnly, when present, must be a boolean.
  if ("isDesktopOnly" in manifest && typeof manifest.isDesktopOnly !== "boolean") {
    errors.push("manifest field isDesktopOnly should be boolean");
  }

  // id matches folder name.
  if (typeof manifest.id === "string" && manifest.id !== id) {
    errors.push(`manifest id "${manifest.id}" does not match folder "${id}"`);
  }

  // version is valid x.y.z.
  if (typeof manifest.version === "string" && !SEMVER.test(manifest.version)) {
    errors.push(`version "${manifest.version}" is not a valid x.y.z semver`);
  }

  // main.js parses under Node.
  try {
    execFileSync(process.execPath, ["--check", mainPath], { stdio: "pipe" });
  } catch (err) {
    const detail = (err.stderr || err.message || "").toString().trim();
    errors.push(`main.js does not parse under Node: ${detail.split("\n")[0]}`);
  }

  return errors;
}

function main() {
  const ids = pluginDirs();
  if (ids.length === 0) {
    console.error(`No plugins found under ${PLUGINS_DIR}`);
    process.exit(1);
  }

  let failed = 0;
  for (const id of ids) {
    const errors = validatePlugin(id);
    if (errors.length === 0) {
      console.log(`  ok    ${id}`);
    } else {
      failed += 1;
      console.log(`  FAIL  ${id}`);
      for (const e of errors) console.log(`          - ${e}`);
    }
  }

  const passed = ids.length - failed;
  console.log("");
  console.log(`${passed}/${ids.length} plugin(s) valid` + (failed ? `, ${failed} failed` : ""));
  process.exit(failed ? 1 : 0);
}

main();
