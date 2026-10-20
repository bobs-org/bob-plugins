const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");

const vaultRoot = path.join(os.homedir(), "bob");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bob-relation-index-"));

function collectMarkdown(sourceRoot, destinationRoot) {
  const files = [];
  const walk = (sourceDirectory, relativeDirectory = "") => {
    for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && [".obsidian", ".trash", "lit_review", "xlib"].includes(entry.name)) continue;
      const relative = path.posix.join(relativeDirectory, entry.name);
      const sourcePath = path.join(sourceDirectory, entry.name);
      const destinationPath = path.join(destinationRoot, ...relative.split("/"));
      if (entry.isDirectory()) {
        fs.mkdirSync(destinationPath, { recursive: true });
        walk(sourcePath, relative);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.copyFileSync(sourcePath, destinationPath);
        const content = fs.readFileSync(destinationPath, "utf8");
        files.push({ path: relative, content, size: Buffer.byteLength(content) });
      }
    }
  };
  walk(sourceRoot);
  return files;
}

function metadataFor(content) {
  const links = [];
  for (const match of String(content).matchAll(/\[\[([^\]]+)\]\]/gu)) {
    const target = match[1].split("|")[0];
    if (/#\^[A-Za-z0-9-]+/u.test(target)) links.push({ link: target });
  }
  const blocks = {};
  for (const match of String(content).matchAll(/(?:^|\s)\^([A-Za-z0-9-]+)(?=\s|$)/gmu)) blocks[match[1]] = { id: match[1] };
  return { links, blocks };
}

function makeApp(files) {
  const byPath = new Map();
  const aliases = new Map();
  for (const row of files) {
    const file = { path: row.path, content: row.content, cache: metadataFor(row.content) };
    byPath.set(file.path, file);
    const noExtension = file.path.replace(/\.md$/iu, "");
    if (!aliases.has(noExtension)) aliases.set(noExtension, file);
    const basename = path.posix.basename(noExtension);
    if (!aliases.has(basename)) aliases.set(basename, file);
  }
  return {
    metadataCache: {
      getFileCache: (file) => (typeof file === "string" ? byPath.get(file) : file)?.cache || null,
      getCache: (relativePath) => byPath.get(relativePath)?.cache || null,
      getFirstLinkpathDest: (target, sourcePath) => {
        if (!target) return byPath.get(sourcePath) || null;
        const clean = String(target).replace(/\.md$/iu, "");
        const relative = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), clean)).replace(/\.md$/iu, "");
        return aliases.get(clean) || aliases.get(relative) || null;
      },
    },
    vault: {
      getMarkdownFiles: () => Array.from(byPath.values()),
      getAbstractFileByPath: (relativePath) => byPath.get(relativePath) || null,
      cachedRead: async (file) => file.content,
    },
    plugins: { plugins: {} },
  };
}

async function waitForIndex(api, plugin) {
  const deadline = Date.now() + 120000;
  while ((!api.ready() || plugin.relationIndexPendingTargetReads.size) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (!api.ready()) throw new Error("relation index scan did not finish within 120 seconds");
}

async function main() {
try {
  if (!fs.existsSync(vaultRoot)) throw new Error("~/bob vault was not found");
  const copied = collectMarkdown(vaultRoot, temporaryRoot);
  const daily = copied
    .filter((file) => /(?:^|\/)\d{4}\/\d{8}\.md$/u.test(file.path))
    .sort((a, b) => b.size - a.size)[0];
  if (!daily) throw new Error("No daily note found for the warm update measurement");

  const app = makeApp(copied);
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.initializeRelationIndex();
  const api = plugin.relationIndexApi();
  const coldStart = performance.now();
  plugin.startRelationIndexScan();
  await waitForIndex(api, plugin);
  const coldMs = performance.now() - coldStart;
  const edgeCount = Array.from(plugin.relationIndexState.forward.values()).reduce((sum, rows) => sum + rows.length, 0);

  const dailyFile = app.vault.getAbstractFileByPath(daily.path);
  const relationCount = 250;
  const filler = "<!-- temporary relation-index benchmark padding -->\n";
  const fillerCount = Math.ceil(Math.max(0, 256 * 1024 - daily.content.length) / filler.length);
  const syntheticRelations = [
    "- [ ] #task Index benchmark target ^relation-index-target",
    ...Array.from({ length: relationCount }, (_, index) => [
      `- [ ] #task Index benchmark source ${index + 1} ^relation-index-source-${index + 1}`,
      "  - 🪢 **LINKS:** benchmark [[#^relation-index-target]]",
    ].join("\n")),
  ].join("\n");
  const warmContent = daily.content + filler.repeat(fillerCount) + syntheticRelations;
  dailyFile.content = warmContent;
  dailyFile.cache = metadataFor(warmContent);

  const warmStart = performance.now();
  plugin.relationIndexApplyFile(daily.path, warmContent);
  const warmMs = performance.now() - warmStart;
  console.log(JSON.stringify({
    copied_markdown_files: copied.length,
    prefiltered_relation_sources: plugin.relationIndexFiles.size,
    cold_relation_edges: edgeCount,
    cold_scan_ms: Number(coldMs.toFixed(2)),
    warm_daily_update_ms: Number(warmMs.toFixed(2)),
    warm_daily_bytes: Buffer.byteLength(warmContent),
    warm_synthetic_relations: relationCount,
  }, null, 2));
  plugin.teardownRelationIndex();
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
