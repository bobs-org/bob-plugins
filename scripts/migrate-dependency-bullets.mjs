#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    return {
      MarkdownView: EmptyClass,
      Modal: EmptyClass,
      Notice: EmptyClass,
      Plugin: EmptyClass,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class EditorView {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { helpers } = require(
  path.join(scriptDir, "../plugins/bob-navigation-hotkeys/main.js"),
);
Module._load = originalLoad;

function parseArgs(argv) {
  const options = { vault: path.join(os.homedir(), "bob"), write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write") {
      options.write = true;
    } else if (arg === "--vault") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--vault requires a directory");
      }
      options.vault = path.resolve(argv[index]);
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: migrate-dependency-bullets.mjs [--vault DIR] [--write]\n\nDry-run is the default; --write updates Markdown files in place.",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function listMarkdownFiles(root) {
  const files = [];
  const skipped = new Set([".git", ".obsidian", "_generated", "_templates"]);
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (skipped.has(entry.name)) {
        continue;
      }
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(fullPath);
      }
    }
  }
  await visit(root);
  return files;
}

function indexDependencies(files) {
  const candidates = new Map();
  const addCandidate = (id, resolution) => {
    if (!id) return;
    const key = `${resolution.filePath}#^${resolution.blockId}`;
    let entries = candidates.get(id);
    if (!entries) {
      entries = new Map();
      candidates.set(id, entries);
    }
    entries.set(key, resolution);
  };
  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    const lineContexts = helpers.getMarkdownLineContexts(file.content);
    lines.forEach((line, lineIndex) => {
      if (
        !helpers.isObsidianTaskAtLine(
          file.content,
          lineIndex,
          lineContexts,
          lines,
        )
      ) {
        return;
      }
      const blockId = helpers.getTrailingBlockId(line);
      if (!blockId) {
        return;
      }
      const resolution = { filePath: file.relativePath, blockId };
      addCandidate(blockId, resolution);
      const idField = helpers.findBulletPropertyField(line, "id");
      const id = idField && String(idField.value || "").trim();
      addCandidate(id, resolution);
    });
  }
  const resolutions = new Map();
  const ambiguities = new Map();
  candidates.forEach((entries, id) => {
    const matches = Array.from(entries.values());
    if (matches.length === 1) {
      resolutions.set(id, matches[0]);
    } else {
      ambiguities.set(id, matches);
    }
  });
  return { resolutions, ambiguities };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const markdownPaths = await listMarkdownFiles(options.vault);
  const files = await Promise.all(
    markdownPaths.map(async (absolutePath) => ({
      absolutePath,
      relativePath: path.relative(options.vault, absolutePath).replaceAll(path.sep, "/"),
      content: await fs.readFile(absolutePath, "utf8"),
    })),
  );
  const index = indexDependencies(files);
  const resolutions = index.resolutions;

  index.ambiguities.forEach((matches, id) => {
    console.warn(
      `ambiguous dependency ID ${id}: ${matches
        .map((match) => `${match.filePath}#^${match.blockId}`)
        .join(", ")} (references will not be rewritten)`,
    );
  });

  let changedFiles = 0;
  let changedTasks = 0;
  let dependencyItems = 0;
  let propertyCount = 0;
  const unresolved = [];
  const skippedNonTasks = [];
  for (const file of files) {
    propertyCount += file.content.split(/\r?\n/).filter((line) =>
      Boolean(helpers.findBulletPropertyField(line, "dependsOn")),
    ).length;
    const result = helpers.transformDependencyBulletsInContent(
      file.content,
      file.relativePath,
      resolutions,
      { ambiguousIds: new Set(index.ambiguities.keys()) },
    );
    unresolved.push(...result.unresolved);
    skippedNonTasks.push(...result.skippedNonTasks);
    if (!result.changed) {
      continue;
    }
    changedFiles += 1;
    changedTasks += result.changedTasks;
    dependencyItems += result.dependencyItems;
    console.log(
      `${options.write ? "updated" : "would update"} ${file.relativePath}: ${result.changedTasks} task(s), ${result.dependencyItems} dependency bullet(s)`,
    );
    if (options.write) {
      await fs.writeFile(file.absolutePath, result.content, "utf8");
    }
  }

  unresolved.forEach(({ filePath, line, id, ambiguous }) => {
    if (!ambiguous) {
      console.warn(`unresolved ${filePath}:${line}: ${id}`);
    }
  });
  skippedNonTasks.forEach(({ filePath, line }) =>
    console.warn(`skipped non-task ${filePath}:${line}`),
  );
  console.log(
    `${options.write ? "Migration" : "Dry run"}: ${propertyCount} dependsOn properties; ${changedFiles} file(s), ${changedTasks} task(s), ${dependencyItems} resolved dependency bullet(s), ${unresolved.length} unresolved id(s), ${index.ambiguities.size} ambiguous id(s), ${skippedNonTasks.length} skipped non-task propert${skippedNonTasks.length === 1 ? "y" : "ies"}.`,
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
