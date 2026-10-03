#!/usr/bin/env node
// Batch migration: fold R8 legacy dependency children (and any legacy-label
// 🔗/DEPENDENCIES row) into one canonical ⛓️ **DEPENDS ON:** line per
// dependent, project `[dependsOn::]`/`[id::]` for open dependents per R1,
// and adopt field-only lines per R2 (`docs/task-dependencies.md` §§2-4).
//
// Modeled on the retired `migrate-task-dependency-identities.mjs`. Grammar,
// link form, and formatting come from nav's exported `helpers`
// (`parseDependencyLine`, `parseDependencyLegacyChildDetails`,
// `canonicalDependencyLink`, `formatDependencyNavigationBullet`); the batch
// planner below is migration-specific because status effects stay with the
// hooks (the migration must prove zero Blocked flips in rehearsal).
//
// Dry-run is the default; `--write` performs a preflight and updates files.
// `--write` is refused when ambiguous resolutions exist.

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

const REQUIRED_HELPERS = [
  "isObsidianTaskLine",
  "isOpenObsidianTaskLine",
  "getMarkdownLineContexts",
  "findCurrentBulletChildBlock",
  "getDependencyInsertLine",
  "findBulletPropertyField",
  "parseLocalTaskIdList",
  "upsertBulletProperty",
  "deleteBulletProperty",
  "getTrailingBlockId",
  "getBulletIndent",
  "tryDependencyId",
  "parseDependencyLine",
  "parseDependencyNavigationBulletDetails",
  "parseDependencyLegacyChildDetails",
  "canonicalDependencyLink",
  "formatDependencyNavigationBullet",
  "normalizeVaultRelativePath",
];
for (const name of REQUIRED_HELPERS) {
  if (typeof helpers[name] !== "function") {
    throw new Error(`migration requires nav helper ${name}`);
  }
}

// Directory segments never migrated: the same exclusions as the hooks.
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".obsidian",
  "_conflicts",
  "_generated",
  "_templates",
  "done",
]);

const LIST_ITEM_RE = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+/;
const VALID_ID_RE = /^[A-Za-z0-9_-]+$/;
const BLOCK_ID_RE = /^[A-Za-z0-9-]+$/;

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

function isExcludedRelative(relativePath) {
  return String(relativePath || "")
    .split("/")
    .some((segment) => SKIPPED_DIRECTORIES.has(segment) || segment.startsWith("."));
}

async function listMarkdownFiles(root) {
  const files = [];
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path
        .relative(root, absolutePath)
        .split(path.sep)
        .join("/");
      if (isExcludedRelative(relativePath)) continue;
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(absolutePath);
      }
    }
  }
  await visit(root);
  return files;
}

function indentWidth(indentText) {
  let width = 0;
  for (const character of String(indentText || "")) {
    if (character === "\t") {
      width += 4 - (width % 4);
    } else if (character === ">") {
      // Same logical-stop convention as nav's getBulletIndentWidth, so
      // quoted children stay inside their quote context here too.
      width += 4;
    } else {
      width += 1;
    }
  }
  return width;
}

// Local mirror of nav's (unexported) findNearestParentListItem: the nearest
// preceding list-item line with a strictly smaller indent width.
function nearestParentListItem(lines, childLine) {
  if (!Number.isInteger(childLine) || childLine <= 0) return null;
  const childIndent = indentWidth(helpers.getBulletIndent(lines[childLine] || ""));
  for (let line = childLine - 1; line >= 0; line -= 1) {
    const text = String(lines[line] || "");
    if (!text.trim()) continue;
    if (indentWidth(helpers.getBulletIndent(text)) >= childIndent) continue;
    if (LIST_ITEM_RE.test(text)) return line;
  }
  return null;
}

// True when the candidate legacy child owns sub-bullets: any later line
// whose ancestor chain passes through it before dedenting back.
function legacyChildHasSubBullets(lines, candidate) {
  const baseWidth = indentWidth(helpers.getBulletIndent(lines[candidate] || ""));
  for (let line = candidate + 1; line < lines.length; line += 1) {
    const text = String(lines[line] || "");
    if (!text.trim()) continue;
    if (indentWidth(helpers.getBulletIndent(text)) <= baseWidth) return false;
    if (!LIST_ITEM_RE.test(text)) continue;
    let current = nearestParentListItem(lines, line);
    while (current !== null && current > candidate) {
      current = nearestParentListItem(lines, current);
    }
    if (current === candidate) return true;
  }
  return false;
}

// Strict R8 shape check on top of nav's grammar: mirrors Rust
// `legacy_child_reference` (no aliases, no backticks, block id bytes only),
// including the contract's `~~![[…]]~~` form that nav's transclusion
// recogniser excludes.
function strictLegacyChild(lineText) {
  const leg = helpers.parseDependencyLegacyChildDetails(lineText);
  if (!leg) return null;
  const text = String(lineText || "");
  if (text.includes("`")) return null;
  const marker = LIST_ITEM_RE.exec(text);
  if (!marker) return null;
  let body = text.slice(marker[0].length).trim();
  if (body.startsWith("~~") && body.endsWith("~~")) {
    body = body.slice(2, -2).trim();
  } else if (body.includes("~~")) {
    return null;
  }
  if (body.startsWith("!")) body = body.slice(1).trim();
  const token = /^\[\[([^\]|#]*?)#\^([A-Za-z0-9-]+)\]\]$/.exec(body);
  if (!token) return null;
  void leg;
  return { note: token[1].trim(), blockId: token[2] };
}

function addIndexValue(index, key, value) {
  if (!key) return;
  const values = index.get(key) || [];
  values.push(value);
  index.set(key, values);
}

// Vault-wide task index. `done/` notes are indexed resolution-only
// (archive targets): their lines never become dependents and are never
// stamped, mirroring the hooks' archive catalog.
function buildTaskIndex(prepped) {
  const byExistingId = new Map();
  const byCanonicalId = new Map();
  const byPathBlock = new Map();
  const notePaths = new Set(prepped.map((file) => file.relativePath));
  const basenamePaths = new Map();
  for (const file of prepped) {
    const basename = file.relativePath
      .split("/")
      .pop()
      .replace(/\.md$/i, "")
      .toLowerCase();
    addIndexValue(basenamePaths, basename, file.relativePath);
    file.lines.forEach((lineText, line) => {
      const context = file.contexts[line] || {};
      if (!context.valid || context.inFrontmatter || context.inFence) return;
      if (!LIST_ITEM_RE.test(lineText)) return;
      const actualBlockId = helpers.getTrailingBlockId(lineText) || "";
      const idField = helpers.findBulletPropertyField(lineText, "id");
      const rawExisting = idField ? String(idField.value || "").trim() : "";
      const existingId = VALID_ID_RE.test(rawExisting) ? rawExisting : "";
      const blockId =
        actualBlockId || (BLOCK_ID_RE.test(existingId) ? existingId : "");
      if (!blockId && !existingId) return;
      let canonicalId = null;
      try {
        canonicalId = helpers.tryDependencyId(file.relativePath, blockId);
      } catch {
        canonicalId = null;
      }
      const task = {
        filePath: file.relativePath,
        line,
        lineText,
        blockId,
        actualBlockId,
        existingId,
        canonicalId,
        isTask: helpers.isObsidianTaskLine(lineText),
        archive: file.relativePath === "done" || file.relativePath.startsWith("done/"),
      };
      if (actualBlockId) {
        addIndexValue(byPathBlock, `${file.relativePath}#^${blockId}`, task);
      }
      addIndexValue(byExistingId, existingId, task);
      addIndexValue(byCanonicalId, canonicalId, task);
    });
  }
  return { byExistingId, byCanonicalId, byPathBlock, notePaths, basenamePaths };
}

// Resolve a `{note, blockId}` link from a dependent's note: vault-relative
// path first, then the unique vault basename (case-insensitive), mirroring
// the hooks' note index. Same-note links resolve to the source note.
function resolveLinkTarget(note, blockId, sourcePath, index) {
  let targetPath;
  if (!note) {
    targetPath = sourcePath;
  } else {
    const candidate = helpers.normalizeVaultRelativePath(`${note}.md`);
    if (index.notePaths.has(candidate)) {
      targetPath = candidate;
    } else if (/[/\\]/.test(note)) {
      return { status: "missing", path: null };
    } else {
      const rivals = index.basenamePaths.get(String(note).toLowerCase()) || [];
      if (rivals.length !== 1) {
        return { status: rivals.length > 1 ? "ambiguous" : "missing", path: null };
      }
      targetPath = rivals[0];
    }
  }
  const entries = index.byPathBlock.get(`${targetPath}#^${blockId}`) || [];
  if (entries.length === 0) return { status: "missing", path: targetPath };
  return { status: "found", path: targetPath, entry: entries[0] };
}

// Resolve one `[dependsOn::]` id to the task carrying it that has a
// `^block-id` (R2 adoption gate). Existing ids first, then canonical ids,
// then same-note bare block ids.
function resolveFieldId(id, sourcePath, index) {
  const withBlock = (tasks) => (tasks || []).filter((task) => task.isTask && task.blockId);
  const deduped = (tasks) => [
    ...new Map(tasks.map((task) => [`${task.filePath}:${task.line}`, task])).values(),
  ];
  let candidates = deduped(withBlock(index.byExistingId.get(id)));
  if (candidates.length === 0) {
    candidates = deduped(withBlock(index.byCanonicalId.get(id)));
  }
  if (candidates.length === 0 && BLOCK_ID_RE.test(id)) {
    candidates = deduped(
      withBlock(index.byPathBlock.get(`${sourcePath}#^${id}`)),
    );
  }
  if (candidates.length === 0) return { status: "missing" };
  if (candidates.length > 1) return { status: "ambiguous", candidates };
  return { status: "found", entry: candidates[0] };
}

function isArchivePath(relativePath) {
  return relativePath === "done" || String(relativePath || "").startsWith("done/");
}

function linkRefForTarget(target, sourcePath, allPaths) {
  if (target.kind === "unresolved") {
    const note = target.note || "";
    return {
      note,
      text: note ? `[[${note}#^${target.block}]]` : `[[#^${target.block}]]`,
    };
  }
  // Archive targets keep the explicit `done/` path: `done/` lives outside
  // the note index, so only the full path re-resolves on the next run.
  if (isArchivePath(target.path)) {
    const note = target.path.replace(/\.md$/i, "");
    return { note, text: `[[${note}#^${target.block}]]` };
  }
  const canonical = helpers.canonicalDependencyLink(
    { path: target.path, blockId: target.block },
    sourcePath,
    allPaths,
  );
  return { note: canonical.note, text: canonical.text };
}

function usableLine(prep, line) {
  const context = prep.contexts[line] || {};
  return Boolean(context.valid && !context.inFrontmatter && !context.inFence);
}

// As-written id guesses for one legacy link: the same-note bare block id
// plus the canonical guesses for its note spellings. Any guess naming a
// field id is an R8 coverage hit.
function asWrittenCoveredIds(legacy, relativePath) {
  const guesses = [legacy.blockId];
  try {
    if (legacy.note) guesses.push(helpers.tryDependencyId(`${legacy.note}.md`, legacy.blockId));
  } catch {
    // Unencodable note spelling: no qualified guess.
  }
  try {
    guesses.push(helpers.tryDependencyId(relativePath, legacy.blockId));
  } catch {
    // Unencodable dependent path: no same-note guess.
  }
  return guesses.filter(Boolean);
}

function directChildLines(prep, parent) {
  const block = helpers.findCurrentBulletChildBlock(prep.lines, parent);
  const children = [];
  for (let line = block.startLine; line < block.endLineExclusive; line += 1) {
    if (!usableLine(prep, line)) continue;
    if (nearestParentListItem(prep.lines, line) !== parent) continue;
    children.push(line);
  }
  return children;
}

// Pure batch plan over in-memory files. `files` are the migrated notes
// (`{relativePath, content}`); `archiveFiles` (default `[]`) are
// resolution-only notes such as `done/` that never gain lines.
export function planMigration(inputFiles, archiveFiles = []) {
  const files = inputFiles.map((file) => ({ ...file }));
  const prepped = [...files, ...archiveFiles].map((file) => {
    const content = String(file.content || "");
    return {
      ...file,
      content,
      lines: content.split(/\r?\n/),
      contexts: helpers.getMarkdownLineContexts(content),
      migrate: files.includes(file),
    };
  });
  const index = buildTaskIndex(prepped);
  const allPaths = prepped.map((prep) => prep.relativePath);

  const report = {
    files: [],
    createdLines: 0,
    foldedChildren: 0,
    adoptedLines: 0,
    fieldUpdates: 0,
    targetIdUpdates: 0,
    removedRows: 0,
    conflicts: [],
    unresolved: [],
    unadoptable: [],
    ambiguous: [],
    droppedFieldIds: [],
    leftAlone: [],
    warnings: [],
  };

  // Per-file edit ops in original coordinates.
  const opsByFile = new Map();
  const opsFor = (relativePath) => {
    if (!opsByFile.has(relativePath)) {
      opsByFile.set(relativePath, { deletes: new Set(), inserts: [], fields: new Map() });
    }
    return opsByFile.get(relativePath);
  };
  const setFieldOp = (relativePath, line, name, value) => {
    const ops = opsFor(relativePath);
    if (!ops.fields.has(line)) ops.fields.set(line, {});
    ops.fields.get(line)[name] = value;
  };

  const warn = (kind, filePath, line, detail) => {
    report.warnings.push({ kind, filePath, line: line + 1, detail });
  };

  for (const prep of prepped) {
    if (!prep.migrate) continue;
    prep.lines.forEach((lineText, parent) => {
      if (!usableLine(prep, parent)) return;
      if (!helpers.isObsidianTaskLine(lineText)) return;
      planDependent(prep, parent);
    });
  }

  function planDependent(prep, parent) {
    const relativePath = prep.relativePath;
    const lineText = prep.lines[parent];
    const open = helpers.isOpenObsidianTaskLine(lineText);
    const field = helpers.findBulletPropertyField(lineText, "dependsOn");
    const fieldIds = field ? helpers.parseLocalTaskIdList(field.value) : [];
    const children = directChildLines(prep, parent);

    let rowIndex = null;
    let rowDetails = null;
    let emptyIndex = null;
    let malformed = false;
    for (const child of children) {
      const verdict = helpers.parseDependencyLine(prep.lines[child], {
        isDirectChildOfTask: true,
      }).verdict;
      if (verdict === "accept") {
        rowIndex = child;
        rowDetails = helpers.parseDependencyNavigationBulletDetails(prep.lines[child]);
        if (!rowDetails) malformed = true;
        break;
      }
      if (verdict === "malformed" || verdict === "empty") {
        if (verdict === "malformed") malformed = true;
        else emptyIndex = child;
        break;
      }
    }
    if (malformed) {
      // R10: no change for that dependent.
      report.conflicts.push({
        filePath: relativePath,
        line: parent + 1,
        reason: "malformed_dependency_line",
      });
      warn("malformed_dependency_line", relativePath, parent, "Depends-On line has trailing prose or residue; left alone");
      return;
    }

    // Resolve the existing row's links, if any.
    const rowTargets = [];
    if (rowIndex !== null && rowDetails) {
      for (const link of rowDetails.links) {
        const resolution = resolveLinkTarget(link.note, link.blockId, relativePath, index);
        if (resolution.status === "found") {
          rowTargets.push({
            kind: "link",
            path: resolution.path,
            block: link.blockId,
            entry: resolution.entry,
          });
        } else {
          if (resolution.status === "ambiguous") {
            report.ambiguous.push({
              filePath: relativePath,
              line: parent + 1,
              id: `${link.note}#^${link.blockId}`,
            });
            report.conflicts.push({
              filePath: relativePath,
              line: parent + 1,
              reason: "ambiguous_row_link",
            });
            return;
          }
          rowTargets.push({ kind: "unresolved", note: link.note, block: link.blockId });
          report.unresolved.push({
            filePath: relativePath,
            line: parent + 1,
            link: link.note ? `${link.note}#^${link.blockId}` : `#^${link.blockId}`,
          });
        }
      }
    }

    // R8 coverage gate: the field plus the row's resolved ids.
    const managedIds = new Set(fieldIds);
    const managedKeys = new Set(
      (rowDetails ? rowDetails.links : []).map((link) => `${link.note}#^${link.blockId}`),
    );
    for (const target of rowTargets) {
      if (target.kind !== "link" || !target.entry) continue;
      if (target.entry.existingId) managedIds.add(target.entry.existingId);
      if (target.entry.canonicalId) managedIds.add(target.entry.canonicalId);
    }

    // Fold covered legacy children in document order.
    const folded = [];
    // Field ids covered by conflict (never flattened) children: live R8
    // edges for the hooks, so R2 adoption must not adopt them either.
    const conflictCoveredIds = new Set();
    for (const child of children) {
      if (child === rowIndex || child === emptyIndex) continue;
      const legacy = strictLegacyChild(prep.lines[child]);
      if (!legacy) continue;
      if (legacyChildHasSubBullets(prep.lines, child)) {
        report.conflicts.push({
          filePath: relativePath,
          line: child + 1,
          reason: "legacy_child_has_sub_bullets",
        });
        warn("legacy_child_has_sub_bullets", relativePath, child, "legacy child owns sub-bullets; never flattened");
        for (const id of asWrittenCoveredIds(legacy, relativePath)) {
          if (fieldIds.includes(id)) conflictCoveredIds.add(id);
        }
        continue;
      }
      let covered = managedKeys.has(`${legacy.note}#^${legacy.blockId}`);
      if (!covered) {
        covered = asWrittenCoveredIds(legacy, relativePath).some((id) => managedIds.has(id));
      }
      const resolution = covered
        ? resolveLinkTarget(legacy.note, legacy.blockId, relativePath, index)
        : { status: "skipped" };
      if (covered && resolution.status === "found") {
        const { entry } = resolution;
        // Confirm against the resolved target's own ids (R8's precise
        // gate): an as-written guess can name a different note than the
        // vault resolver picks (basename fallback). Same-note bare block
        // ids confirm directly.
        const confirmed =
          managedIds.has(entry.existingId) ||
          managedIds.has(entry.canonicalId) ||
          (!legacy.note && managedIds.has(entry.blockId));
        if (!confirmed) {
          report.leftAlone.push({
            filePath: relativePath,
            line: child + 1,
            text: prep.lines[child].trim().slice(0, 80),
          });
          warn("legacy_link_target_id_mismatch", relativePath, child, "as-written id names another note than the resolver; left alone");
          continue;
        }
        folded.push({
          kind: "link",
          path: resolution.path,
          block: legacy.blockId,
          entry,
          fromLine: child,
        });
        if (entry.existingId) managedIds.add(entry.existingId);
        if (entry.canonicalId) managedIds.add(entry.canonicalId);
      } else if (covered && resolution.status === "ambiguous") {
        report.ambiguous.push({
          filePath: relativePath,
          line: child + 1,
          id: `${legacy.note}#^${legacy.blockId}`,
        });
        report.conflicts.push({
          filePath: relativePath,
          line: child + 1,
          reason: "ambiguous_legacy_link",
        });
        return;
      } else if (covered) {
        folded.push({
          kind: "unresolved",
          note: legacy.note,
          block: legacy.blockId,
          fromLine: child,
        });
        report.unresolved.push({
          filePath: relativePath,
          line: child + 1,
          link: legacy.note ? `${legacy.note}#^${legacy.blockId}` : `#^${legacy.blockId}`,
        });
      } else {
        // Unmanaged embeds (`#^ref` reading embeds and friends) are
        // content, not edges: left alone.
        report.leftAlone.push({
          filePath: relativePath,
          line: child + 1,
          text: prep.lines[child].trim().slice(0, 80),
        });
      }
    }

    // Deduplicate the ordered set by resolved identity.
    const seen = new Set();
    const targets = [...rowTargets, ...folded].filter((target) => {
      const key = target.kind === "link"
        ? `P:${target.path}#^${target.block}`
        : `U:${target.note}#^${target.block}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (targets.length === 0) {
      if (emptyIndex !== null) {
        // R9: a label-only line with nothing behind it is deleted.
        opsFor(relativePath).deletes.add(emptyIndex);
        report.removedRows += 1;
        if (open) setFieldOp(relativePath, parent, "dependsOn", null);
      } else if (rowIndex === null && field && open) {
        adoptFieldOnly(prep, parent, fieldIds, conflictCoveredIds);
      }
      return;
    }

    // One canonical line: existing row links first, then legacy children
    // in document order.
    const refs = targets.map((target) => linkRefForTarget(target, relativePath, allPaths));
    const childIndent = folded.length > 0
      ? helpers.getBulletIndent(prep.lines[folded[0].fromLine] || "")
      : "";
    const indent = (rowDetails && rowDetails.indent) || childIndent
      || `${helpers.getBulletIndent(lineText)}\t`;
    const newLine = helpers.formatDependencyNavigationBullet(
      refs.map((ref, position) => ({
        note: ref.note,
        blockId: targets[position].block,
      })),
      indent,
    );
    // R1 projection for open dependents only. Closed dependents keep
    // their field untouched; the hooks never reconcile them.
    const projection = open
      ? computeProjection(prep, parent, fieldIds, targets, false)
      : null;
    const foldedLines = folded.filter((target) => target.fromLine !== undefined);
    if (
      rowIndex !== null &&
      emptyIndex === null &&
      foldedLines.length === 0 &&
      newLine === prep.lines[rowIndex] &&
      (!projection || (projection.clean && projection.stamps.length === 0))
    ) {
      // Already migrated: a canonical row, nothing left to fold, and the
      // field already projects. Re-running changes nothing.
      return;
    }
    const insertAt = helpers.getDependencyInsertLine(prep.lines, parent);
    const ops = opsFor(relativePath);
    if (rowIndex !== null) ops.deletes.add(rowIndex);
    if (emptyIndex !== null) {
      ops.deletes.add(emptyIndex);
      report.removedRows += 1;
    }
    for (const target of foldedLines) {
      ops.deletes.add(target.fromLine);
      report.foldedChildren += 1;
    }
    ops.inserts.push({ pos: insertAt, text: newLine });
    report.createdLines += 1;
    if (projection) applyProjection(prep, parent, projection);
  }

  // Pure R1 computation: the dependent's projected field ids, target id
  // stamps, and warnings. `keepUnaccounted` keeps ids no target accounts
  // for (R2 adoption and R4 breadcrumbs); otherwise they are dropped.
  function computeProjection(prep, parent, fieldIds, targets, keepUnaccounted) {
    const relativePath = prep.relativePath;
    const projectedIds = [];
    const stamps = [];
    const notices = [];
    const seenKeys = new Set();
    let hasUnresolved = false;
    for (const target of targets) {
      if (target.kind === "unresolved") {
        hasUnresolved = true;
        notices.push({
          kind: "unresolved_dependency_link",
          detail: `kept verbatim: ${target.note ? `${target.note}#^` : "#^"}${target.block}`,
        });
        continue;
      }
      const { entry } = target;
      const key = `${entry.filePath}#^${entry.blockId}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      if (entry.filePath === relativePath && entry.line === parent) {
        notices.push({ kind: "self_dependency", detail: "link points to its own task; not projected" });
        continue;
      }
      if (!entry.isTask) {
        notices.push({ kind: "non_task_dependency", detail: `resolves to a non-task block: ${entry.filePath}#^${entry.blockId}` });
        continue;
      }
      let id = entry.existingId || null;
      if (!id) {
        let canonical = null;
        try {
          canonical = helpers.tryDependencyId(entry.filePath, entry.blockId);
        } catch {
          canonical = null;
        }
        if (!canonical) {
          notices.push({ kind: "unencodable_target", detail: `${entry.filePath}#^${entry.blockId} has no [id::] and its path cannot be encoded` });
          continue;
        }
        id = canonical;
        if (!entry.archive) {
          stamps.push({ filePath: entry.filePath, line: entry.line, id: canonical });
        }
      }
      projectedIds.push(id);
    }
    const inProjected = new Set(projectedIds);
    const unaccounted = fieldIds.filter((id) => !inProjected.has(id));
    // R4: while any unresolved link remains, unaccounted field ids stay on
    // as heal breadcrumbs so a cut-and-pasted task still heals.
    const keepAll = keepUnaccounted || hasUnresolved;
    const kept = keepAll ? unaccounted : [];
    const dropped = keepAll ? [] : unaccounted;
    const next = [...projectedIds, ...kept];
    return {
      next,
      clean: next.join("\n") === fieldIds.join("\n"),
      stamps,
      notices,
      dropped,
    };
  }

  function applyProjection(prep, parent, projection) {
    const relativePath = prep.relativePath;
    for (const stamp of projection.stamps) {
      setFieldOp(stamp.filePath, stamp.line, "id", stamp.id);
      report.targetIdUpdates += 1;
    }
    for (const notice of projection.notices) {
      warn(notice.kind, relativePath, parent, notice.detail);
    }
    if (projection.dropped.length > 0) {
      report.droppedFieldIds.push({
        filePath: relativePath,
        line: parent + 1,
        ids: projection.dropped,
      });
    }
    if (!projection.clean) {
      setFieldOp(
        relativePath,
        parent,
        "dependsOn",
        projection.next.length > 0 ? projection.next.join(", ") : null,
      );
      report.fieldUpdates += 1;
    }
  }

  // R2 adoption for open field-only dependents: no line and no legacy
  // children. Never infers a removal from the missing line. Ids covered
  // by conflict children (`skipIds`) stay in the field untouched: they
  // remain live R8 edges for the hooks.
  function adoptFieldOnly(prep, parent, fieldIds, skipIds = new Set()) {
    const relativePath = prep.relativePath;
    const adopted = [];
    for (const id of fieldIds) {
      if (skipIds.has(id)) continue;
      const resolution = resolveFieldId(id, relativePath, index);
      if (resolution.status === "found") {
        const { entry } = resolution;
        adopted.push({
          kind: "link",
          path: entry.filePath,
          block: entry.blockId,
          entry,
        });
      } else {
        report.unadoptable.push({ filePath: relativePath, line: parent + 1, id });
        warn("unadoptable_dependency_id", relativePath, parent, `no task with ^block-id carries [${id}]`);
        if (resolution.status === "ambiguous") {
          report.ambiguous.push({ filePath: relativePath, line: parent + 1, id });
        }
      }
    }
    if (adopted.length === 0) return;
    const refs = adopted.map((target) => linkRefForTarget(target, relativePath, allPaths));
    const indent = `${helpers.getBulletIndent(prep.lines[parent])}\t`;
    const newLine = helpers.formatDependencyNavigationBullet(
      refs.map((ref, position) => ({ note: ref.note, blockId: adopted[position].block })),
      indent,
    );
    const ops = opsFor(relativePath);
    ops.inserts.push({ pos: helpers.getDependencyInsertLine(prep.lines, parent), text: newLine });
    report.createdLines += 1;
    report.adoptedLines += 1;
    // Unadoptable ids stay in the field with their warning (R2); only a
    // present line ever drops ids.
    applyProjection(prep, parent, computeProjection(prep, parent, fieldIds, adopted, true));
  }

  // Apply every op. Replaces and deletes address original coordinates;
  // inserts are re-based past deletions, then one ascending merge rebuilds
  // each note, preserving its line endings and final-newline state.
  for (const prep of prepped) {
    if (!prep.migrate) continue;
    const ops = opsByFile.get(prep.relativePath);
    const original = prep.lines;
    let nextLines = original.slice();
    let changed = false;
    if (ops) {
      const deletes = [...ops.deletes].sort((left, right) => left - right);
      const adjustedInserts = ops.inserts.map((insert) => ({
        text: insert.text,
        at: insert.pos - deletes.filter((line) => line < insert.pos).length,
      }));
      const replaced = new Map();
      for (const [line, fields] of ops.fields) {
        if (deletes.includes(line)) continue;
        let text = original[line];
        if (Object.prototype.hasOwnProperty.call(fields, "id") && fields.id !== undefined) {
          text = helpers.upsertBulletProperty(text, "id", fields.id).line;
        }
        if (Object.prototype.hasOwnProperty.call(fields, "dependsOn")) {
          const value = fields.dependsOn;
          text = value === null
            ? helpers.deleteBulletProperty(text, "dependsOn").line
            : helpers.upsertBulletProperty(text, "dependsOn", value).line;
        }
        if (text !== original[line]) replaced.set(line, text);
      }
      const merged = [];
      const pendingInserts = [...adjustedInserts].sort((left, right) => left.at - right.at);
      let kept = 0;
      for (let line = 0; line <= original.length; line += 1) {
        while (pendingInserts.length > 0 && pendingInserts[0].at === kept) {
          merged.push(pendingInserts.shift().text);
          changed = true;
        }
        if (line === original.length) break;
        if (deletes.includes(line)) {
          changed = true;
          continue;
        }
        merged.push(replaced.has(line) ? replaced.get(line) : original[line]);
        if (replaced.has(line)) changed = true;
        kept += 1;
      }
      nextLines = merged;
    }
    const eol = prep.content.includes("\r\n") ? "\r\n" : "\n";
    const nextContent = nextLines.join(eol);
    const file = files.find((candidate) => candidate.relativePath === prep.relativePath);
    report.files.push({
      ...file,
      nextContent,
      changed: nextContent !== file.content,
    });
  }

  return report;
}

export async function runMigration(options) {
  const markdownPaths = await listMarkdownFiles(options.vault);
  const readOne = async (absolutePath, archive) => ({
    absolutePath,
    archive,
    relativePath: path.relative(options.vault, absolutePath).split(path.sep).join("/"),
    content: await fs.readFile(absolutePath, "utf8"),
  });
  // `done/` notes are resolution-only (archive targets); they are read
  // separately so the walker exclusions stay identical to the hooks'.
  const archivedPaths = [];
  async function visitArchived(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visitArchived(absolutePath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        archivedPaths.push(absolutePath);
      }
    }
  }
  try {
    await visitArchived(path.join(options.vault, "done"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const files = await Promise.all(markdownPaths.map((absolutePath) => readOne(absolutePath, false)));
  const archiveFiles = await Promise.all(archivedPaths.map((absolutePath) => readOne(absolutePath, true)));
  const plan = planMigration(files, archiveFiles);

  for (const item of plan.ambiguous) {
    console.error(`ambiguous ${item.filePath}:${item.line}: ${item.id}`);
  }
  for (const item of plan.conflicts) {
    console.error(`conflict ${item.filePath}:${item.line}: ${item.reason}`);
  }
  for (const item of plan.unresolved) {
    console.warn(`unresolved ${item.filePath}:${item.line}: ${item.link}`);
  }
  for (const item of plan.unadoptable) {
    console.warn(`unadoptable ${item.filePath}:${item.line}: ${item.id}`);
  }
  for (const item of plan.droppedFieldIds) {
    console.warn(`field ids dropped ${item.filePath}:${item.line}: ${item.ids.join(", ")}`);
  }

  const fatal = plan.ambiguous.length;
  if (options.write && fatal > 0) {
    throw new Error("write refused: migration preflight reported ambiguous resolutions");
  }
  for (const file of plan.files.filter((candidate) => candidate.changed)) {
    console.log(`${options.write ? "updated" : "would update"} ${file.relativePath}`);
    if (options.write) await fs.writeFile(file.absolutePath, file.nextContent, "utf8");
  }
  const changedFiles = plan.files.filter((file) => file.changed).length;
  console.log(
    `${options.write ? "Migration" : "Dry run"}: ${changedFiles} file(s), `
    + `${plan.createdLines} Depends-On line(s), ${plan.foldedChildren} folded child(ren), `
    + `${plan.adoptedLines} adopted line(s), ${plan.fieldUpdates} field update(s), `
    + `${plan.targetIdUpdates} target id(s), ${plan.removedRows} removed row(s), `
    + `${plan.conflicts.length} conflict(s), ${plan.unresolved.length} unresolved, `
    + `${plan.unadoptable.length} unadoptable, ${plan.ambiguous.length} ambiguous.`,
  );
  return plan;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: migrate-dependency-lines.mjs [--vault DIR] [--write]\n\nDry-run is the default; --write performs a preflight and updates Markdown files.");
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


