#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".obsidian",
  "_generated",
  "_templates",
]);

export function parseArgs(argv) {
  const options = { vault: path.join(os.homedir(), "bob"), write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write") {
      options.write = true;
    } else if (arg === "--vault") {
      const value = argv[++index];
      if (!value) throw new Error("--vault requires a directory");
      options.vault = path.resolve(value);
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function listMarkdownFiles(root) {
  const files = [];
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolutePath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(absolutePath);
      }
    }
  }
  await visit(root);
  return files;
}

function addIndexValue(index, key, value) {
  if (!key) return;
  const values = index.get(key) || [];
  values.push(value);
  index.set(key, values);
}

function getTaskIndex(files) {
  const tasks = [];
  const byPathBlock = new Map();
  const byExistingId = new Map();
  const byCanonicalId = new Map();
  const byPath = new Map();
  const notePaths = new Set(files.map((file) => file.relativePath));
  const basenamePaths = new Map();

  for (const file of files) {
    const basename = path.posix.basename(file.relativePath, ".md");
    addIndexValue(basenamePaths, basename, file.relativePath);
    file.content.split(/\r?\n/).forEach((lineText, line) => {
      if (!LIST_ITEM_RE.test(lineText)) return;
      const actualBlockId = helpers.getTrailingBlockId(lineText);
      const idField = helpers.findBulletPropertyField(lineText, "id");
      const existingId = idField ? String(idField.value || "").trim() : "";
      const blockId = actualBlockId || (/^[A-Za-z0-9-]+$/.test(existingId) ? existingId : "");
      if (!blockId && !existingId) return;
      let canonicalId;
      try {
        canonicalId = helpers.dependencyId(file.relativePath, blockId);
      } catch (error) {
        canonicalId = null;
      }
      const task = {
        filePath: file.relativePath,
        line,
        lineText,
        blockId,
        actualBlockId,
        needsBlockId: !actualBlockId && Boolean(blockId),
        existingId,
        canonicalId,
      };
      tasks.push(task);
      if (actualBlockId) {
        addIndexValue(byPathBlock, `${file.relativePath}#^${blockId}`, task);
      }
      addIndexValue(byExistingId, existingId, task);
      addIndexValue(byCanonicalId, canonicalId, task);
      addIndexValue(byPath, file.relativePath, task);
    });
  }
  return {
    tasks,
    byPathBlock,
    byExistingId,
    byCanonicalId,
    byPath,
    notePaths,
    basenamePaths,
  };
}

function unique(values) {
  return values && values.length === 1 ? values[0] : null;
}

function resolveNotePath(note, sourcePath, index) {
  if (!note) return sourcePath;
  const clean = String(note).replace(/\\/g, "/").replace(/\.md$/i, "");
  const candidates = [
    `${clean}.md`,
    path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), `${clean}.md`)),
  ];
  for (const candidate of candidates) {
    if (index.notePaths.has(candidate)) return candidate;
  }
  const basename = path.posix.basename(clean);
  return unique(index.basenamePaths.get(basename) || []);
}

function directTransclusionTargets(lines, parentLine, sourcePath, index) {
  const block = helpers.findCurrentBulletChildBlock(lines, parentLine);
  const candidates = [];
  let minimumIndent = Number.POSITIVE_INFINITY;
  for (let line = block.startLine; line < block.endLineExclusive; line += 1) {
    const details = helpers.parseDependencyTransclusionBulletDetails(lines[line]);
    if (!details) continue;
    const indent = details.indent.replace(/\t/g, "    ").length;
    if (indent < minimumIndent) {
      minimumIndent = indent;
      candidates.length = 0;
    }
    if (indent !== minimumIndent) continue;
    const filePath = resolveNotePath(details.note, sourcePath, index);
    const task = filePath
      ? unique(index.byPathBlock.get(`${filePath}#^${details.blockId}`) || [])
      : null;
    if (task) candidates.push(task);
  }
  return candidates;
}

function resolveEdge(id, position, dependencyIds, transclusions, sourcePath, index) {
  const matchingLinks = transclusions.filter((task) =>
    [task.existingId, task.blockId, task.canonicalId].includes(id),
  );
  if (matchingLinks.length === 1) return { task: matchingLinks[0], reason: "link" };
  if (matchingLinks.length > 1) return { ambiguous: matchingLinks, reason: "link" };
  if (transclusions.length === dependencyIds.length && transclusions[position]) {
    return { task: transclusions[position], reason: "link-order" };
  }

  const sameNote = (index.byPath.get(sourcePath) || []).filter((task) =>
    [task.existingId, task.blockId, task.canonicalId].includes(id),
  );
  if (sameNote.length === 1) return { task: sameNote[0], reason: "same-note" };
  if (sameNote.length > 1) return { ambiguous: sameNote, reason: "same-note" };

  const canonical = index.byCanonicalId.get(id) || [];
  if (canonical.length === 1) return { task: canonical[0], reason: "canonical" };
  if (canonical.length > 1) return { ambiguous: canonical, reason: "canonical" };

  const existing = index.byExistingId.get(id) || [];
  if (existing.length === 1) return { task: existing[0], reason: "existing-id" };
  if (existing.length > 1) return { ambiguous: existing, reason: "existing-id" };
  return { unresolved: true };
}

function rewriteDependencyFieldLine(lineText, resolvedIds) {
  const field = helpers.findBulletPropertyField(lineText, "dependsOn");
  if (!field) return lineText;
  const separator = field.raw.indexOf("::");
  const rawValue = field.raw.slice(separator + 2, -1);
  const segments = rawValue.split(",");
  const nextValue = segments.map((segment, index) => {
    const leading = /^\s*/.exec(segment)[0];
    const trailing = /\s*$/.exec(segment)[0];
    return resolvedIds[index]
      ? `${leading}${resolvedIds[index]}${trailing}`
      : segment;
  }).join(",");
  const replacement = `[${field.key}::${nextValue}]`;
  return lineText.slice(0, field.span.start) + replacement + lineText.slice(field.span.end);
}

export function planMigration(inputFiles) {
  const files = inputFiles.map((file) => ({ ...file }));
  const index = getTaskIndex(files);
  const encodingCollisions = [...index.byCanonicalId.entries()]
    .map(([id, tasks]) => [
      id,
      [...new Map(
        tasks.map((task) => [`${task.filePath}#^${task.blockId}`, task]),
      ).values()],
    ])
    .filter(([id, tasks]) => id && tasks.length > 1)
    .map(([id, tasks]) => ({ id, tasks }));
  const unsupported = index.tasks.filter((task) => !task.canonicalId);
  const targetUpdates = new Map();
  const parentUpdates = new Map();
  const unresolved = [];
  const ambiguous = [];
  let resolvedEdges = 0;

  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    lines.forEach((lineText, parentLine) => {
      const field = helpers.findBulletPropertyField(lineText, "dependsOn");
      if (!field) return;
      const ids = helpers.parseLocalTaskIdList(field.value);
      const transclusions = directTransclusionTargets(
        lines,
        parentLine,
        file.relativePath,
        index,
      );
      const resolvedIds = [];
      ids.forEach((id, position) => {
        const resolution = resolveEdge(
          id,
          position,
          ids,
          transclusions,
          file.relativePath,
          index,
        );
        if (resolution.task && resolution.task.canonicalId) {
          resolvedIds[position] = resolution.task.canonicalId;
          targetUpdates.set(
            `${resolution.task.filePath}:${resolution.task.line}`,
            resolution.task,
          );
          resolvedEdges += 1;
        } else if (resolution.ambiguous) {
          ambiguous.push({ filePath: file.relativePath, line: parentLine + 1, id, tasks: resolution.ambiguous });
        } else {
          unresolved.push({ filePath: file.relativePath, line: parentLine + 1, id });
        }
      });
      if (resolvedIds.some(Boolean)) {
        parentUpdates.set(`${file.relativePath}:${parentLine}`, {
          filePath: file.relativePath,
          line: parentLine,
          resolvedIds,
        });
      }
    });
  }

  const outputs = [];
  for (const file of files) {
    const newline = file.content.includes("\r\n") ? "\r\n" : "\n";
    const lines = file.content.split(/\r?\n/);
    for (let line = 0; line < lines.length; line += 1) {
      const target = targetUpdates.get(`${file.relativePath}:${line}`);
      if (target) {
        const withBlock = target.needsBlockId
          ? helpers.appendBlockIdToLine(lines[line], target.blockId)
          : lines[line];
        lines[line] = helpers.upsertBulletProperty(withBlock, "id", target.canonicalId).line;
      }
      const parent = parentUpdates.get(`${file.relativePath}:${line}`);
      if (parent) lines[line] = rewriteDependencyFieldLine(lines[line], parent.resolvedIds);
    }
    let content = lines.join(newline);
    const resolutions = new Map();
    for (const task of index.tasks) {
      if (!task.canonicalId) continue;
      const resolution = {
        filePath: task.filePath,
        blockId: task.blockId,
        note: task.filePath.replace(/\.md$/i, ""),
      };
      resolutions.set(task.canonicalId, resolution);
      if ((index.byExistingId.get(task.existingId) || []).length === 1) {
        resolutions.set(task.existingId, resolution);
      }
    }
    const navigation = helpers.transformDependencyBulletsInContent(
      content,
      file.relativePath,
      resolutions,
    );
    content = navigation.content;
    outputs.push({
      ...file,
      nextContent: content,
      changed: content !== file.content,
      navigationTasks: navigation.changedTasks,
    });
  }

  return {
    files: outputs,
    targetUpdates: targetUpdates.size,
    resolvedEdges,
    unresolved,
    ambiguous,
    encodingCollisions,
    unsupported,
  };
}

export async function runMigration(options) {
  const markdownPaths = await listMarkdownFiles(options.vault);
  const files = await Promise.all(markdownPaths.map(async (absolutePath) => ({
    absolutePath,
    relativePath: path.relative(options.vault, absolutePath).split(path.sep).join("/"),
    content: await fs.readFile(absolutePath, "utf8"),
  })));
  const plan = planMigration(files);
  for (const collision of plan.encodingCollisions) {
    console.error(`encoding collision ${collision.id}: ${collision.tasks.map((task) => `${task.filePath}#^${task.blockId}`).join(", ")}`);
  }
  for (const item of plan.ambiguous) {
    console.error(`ambiguous ${item.filePath}:${item.line}: ${item.id} -> ${item.tasks.map((task) => `${task.filePath}#^${task.blockId}`).join(", ")}`);
  }
  for (const item of plan.unresolved) {
    console.warn(`unresolved ${item.filePath}:${item.line}: ${item.id}`);
  }
  for (const item of plan.unsupported) {
    console.error(`unsupported ${item.filePath}:${item.line + 1}#^${item.blockId}`);
  }

  const fatal = plan.encodingCollisions.length + plan.ambiguous.length + plan.unsupported.length;
  if (options.write && fatal > 0) {
    throw new Error("write refused: dependency identity preflight reported collisions, ambiguity, or unsupported paths");
  }
  for (const file of plan.files.filter((candidate) => candidate.changed)) {
    console.log(`${options.write ? "updated" : "would update"} ${file.relativePath}`);
    if (options.write) await fs.writeFile(file.absolutePath, file.nextContent, "utf8");
  }
  const changedFiles = plan.files.filter((file) => file.changed).length;
  console.log(
    `${options.write ? "Migration" : "Dry run"}: ${changedFiles} file(s), ${plan.targetUpdates} target ID(s), ${plan.resolvedEdges} dependency value(s), ${plan.unresolved.length} unresolved, ${plan.ambiguous.length} ambiguous, ${plan.encodingCollisions.length} encoding collision(s), ${plan.unsupported.length} unsupported path(s).`,
  );
  return plan;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: migrate-task-dependency-identities.mjs [--vault DIR] [--write]\n\nDry-run is the default; --write performs a preflight and updates Markdown files.");
    return;
  }
  await runMigration(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
