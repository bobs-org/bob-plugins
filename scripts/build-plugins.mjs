#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = dirname(dirname(SCRIPT_PATH));
const MAX_FRAGMENT_LINES = 1000;

function isInside(parent, candidate) {
  const rel = relative(parent, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function physicalLineCount(text) {
  if (text.length === 0) return 0;
  const endings = text.match(/\r\n|\r|\n/g)?.length ?? 0;
  const endsWithLineEnding = /(?:\r\n|\r|\n)$/.test(text);
  return endings + (endsWithLineEnding ? 0 : 1);
}

function syntaxCheck(source, label, filename = null) {
  try {
    if (filename) {
      execFileSync(process.execPath, ["--check", filename], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else {
      execFileSync(process.execPath, ["--check"], {
        input: source,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    }
  } catch (error) {
    const detail = String(error.stderr || error.message || "").trim().split("\n").slice(0, 5).join("\n");
    throw new Error(`${label} does not parse under Node: ${detail}`);
  }
}

function pluginDirectories(pluginsRoot) {
  if (!existsSync(pluginsRoot)) return [];
  return readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function assertManifestPath(rawPath, pluginId) {
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    throw new Error(`[${pluginId}] manifest paths must be nonempty strings`);
  }
  if (rawPath.includes("\\") || rawPath.includes("\0")) {
    throw new Error(`[${pluginId}] invalid fragment path ${JSON.stringify(rawPath)}`);
  }
  if (isAbsolute(rawPath) || rawPath.startsWith("/") || rawPath.split("/").some((part) => part === ".." || part === "." || part === "")) {
    throw new Error(`[${pluginId}] fragment path must be a normalized relative path under src/: ${rawPath}`);
  }
  if (extname(rawPath) !== ".js") {
    throw new Error(`[${pluginId}] fragment path must end in .js: ${rawPath}`);
  }
  return rawPath;
}

function sourceJavaScriptPaths(srcRoot, srcReal, pluginId) {
  const found = [];
  function visit(directory, relativeDirectory, ancestors) {
    const canonicalDirectory = realpathSync(directory);
    if (!isInside(srcReal, canonicalDirectory)) {
      throw new Error(`[${pluginId}] source symlink escapes src/: ${relativeDirectory || "."}`);
    }
    if (ancestors.has(canonicalDirectory)) {
      throw new Error(`[${pluginId}] source directory symlink cycle at src/${relativeDirectory}`);
    }
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(canonicalDirectory);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const absolutePath = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = realpathSync(absolutePath);
        if (!isInside(srcReal, target)) {
          throw new Error(`[${pluginId}] source symlink escapes src/: src/${relativePath}`);
        }
        const targetStats = statSync(absolutePath);
        if (targetStats.isDirectory()) {
          visit(absolutePath, relativePath, nextAncestors);
        } else if (targetStats.isFile() && extname(entry.name) === ".js") {
          found.push(relativePath);
        }
      } else if (entry.isDirectory()) {
        visit(absolutePath, relativePath, nextAncestors);
      } else if (entry.isFile() && extname(entry.name) === ".js") {
        found.push(relativePath);
      }
    }
  }
  visit(srcRoot, "", new Set());
  return found.sort();
}

function validatePlugin(root, pluginId) {
  const pluginRoot = join(root, "plugins", pluginId);
  const srcRoot = join(pluginRoot, "src");
  const manifestPath = join(srcRoot, "fragments.json");
  let manifestBytes;
  try {
    manifestBytes = readFileSync(manifestPath);
  } catch (error) {
    throw new Error(`[${pluginId}] cannot read src/fragments.json: ${error.message}`);
  }

  const srcReal = realpathSync(srcRoot);
  const manifestReal = realpathSync(manifestPath);
  if (!isInside(srcReal, manifestReal)) {
    throw new Error(`[${pluginId}] src/fragments.json resolves outside src/`);
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`[${pluginId}] src/fragments.json is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(manifest) || manifest.length === 0) {
    throw new Error(`[${pluginId}] src/fragments.json must be a nonempty JSON array of paths`);
  }

  const seen = new Set();
  const fragments = [];
  for (const rawPath of manifest) {
    const fragmentPath = assertManifestPath(rawPath, pluginId);
    if (seen.has(fragmentPath)) {
      throw new Error(`[${pluginId}] duplicate fragment entry: src/${fragmentPath}`);
    }
    seen.add(fragmentPath);
    const absolutePath = resolve(srcRoot, ...fragmentPath.split("/"));
    if (!isInside(srcReal, absolutePath)) {
      throw new Error(`[${pluginId}] fragment escapes src/: src/${fragmentPath}`);
    }
    let realPath;
    try {
      realPath = realpathSync(absolutePath);
    } catch {
      throw new Error(`[${pluginId}] missing fragment: src/${fragmentPath}`);
    }
    if (!isInside(srcReal, realPath)) {
      throw new Error(`[${pluginId}] fragment symlink escapes src/: src/${fragmentPath}`);
    }
    let stats;
    try {
      stats = statSync(absolutePath);
    } catch (error) {
      throw new Error(`[${pluginId}] cannot stat src/${fragmentPath}: ${error.message}`);
    }
    if (!stats.isFile()) {
      throw new Error(`[${pluginId}] fragment is not a file: src/${fragmentPath}`);
    }

    const bytes = readFileSync(absolutePath);
    const text = bytes.toString("utf8");
    const lineCount = physicalLineCount(text);
    if (lineCount > MAX_FRAGMENT_LINES) {
      throw new Error(`[${pluginId}] src/${fragmentPath} has ${lineCount} lines; limit is ${MAX_FRAGMENT_LINES}`);
    }
    syntaxCheck(text, `[${pluginId}] src/${fragmentPath}`, absolutePath);
    fragments.push({ path: fragmentPath, bytes });
  }

  const discovered = sourceJavaScriptPaths(srcRoot, srcReal, pluginId);
  const omitted = discovered.filter((path) => !seen.has(path));
  if (omitted.length) {
    throw new Error(`[${pluginId}] src/ JavaScript fragments omitted from manifest: ${omitted.map((path) => `src/${path}`).join(", ")}`);
  }

  const header = Buffer.from(
    `// Generated by scripts/build-plugins.mjs from plugins/${pluginId}/src/fragments.json. Do not edit directly.\n`,
    "utf8",
  );
  const parts = [header];
  for (const fragment of fragments) {
    parts.push(Buffer.from(`// ---- src/${fragment.path} ----\n`, "utf8"));
    parts.push(fragment.bytes);
    if (fragment.bytes.length > 0 && !/[\r\n]$/.test(fragment.bytes.toString("utf8"))) {
      parts.push(Buffer.from("\n"));
    }
  }
  const bundle = Buffer.concat(parts);
  syntaxCheck(bundle, `[${pluginId}] assembled main.js`);
  return {
    id: pluginId,
    outputPath: join(pluginRoot, "main.js"),
    bundle,
  };
}

export function buildPlugins(repositoryRoot = DEFAULT_ROOT, options = {}) {
  if (typeof repositoryRoot === "object" && repositoryRoot !== null) {
    options = repositoryRoot;
    repositoryRoot = options.repositoryRoot ?? DEFAULT_ROOT;
  }
  const root = resolve(repositoryRoot);
  const check = Boolean(options.check);
  const pluginsRoot = join(root, "plugins");
  const optedIn = pluginDirectories(pluginsRoot).filter((pluginId) =>
    existsSync(join(pluginsRoot, pluginId, "src", "fragments.json")),
  );
  const outputs = [];
  const errors = [];

  for (const pluginId of optedIn) {
    try {
      outputs.push(validatePlugin(root, pluginId));
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (errors.length) {
    throw new Error(errors.join("\n"));
  }

  const stale = [];
  for (const output of outputs) {
    let current = null;
    try {
      current = readFileSync(output.outputPath);
    } catch {}
    if (check && (!current || !current.equals(output.bundle))) {
      stale.push(`[${output.id}] ${current ? "stale" : "missing"} generated bundle: ${relative(root, output.outputPath)}`);
    }
  }
  if (stale.length) {
    throw new Error(`${stale.join("\n")}\nRun npm run build to regenerate opted-in plugins.`);
  }

  if (!check) {
    for (const output of outputs) {
      let current = null;
      try {
        current = readFileSync(output.outputPath);
      } catch {}
      if (current && current.equals(output.bundle)) {
        console.log(`  unchanged ${output.id}`);
        continue;
      }
      const tempPath = `${output.outputPath}.${process.pid}.tmp`;
      writeFileSync(tempPath, output.bundle);
      renameSync(tempPath, output.outputPath);
      console.log(`  built     ${output.id}`);
    }
  } else {
    for (const output of outputs) console.log(`  checked   ${output.id}`);
  }
  return outputs.map(({ id }) => id);
}

function main(argv) {
  const unknown = argv.filter((arg) => arg !== "--check");
  if (unknown.length || argv.filter((arg) => arg === "--check").length > 1) {
    console.error("Usage: node scripts/build-plugins.mjs [--check]");
    process.exitCode = 2;
    return;
  }
  try {
    buildPlugins(DEFAULT_ROOT, { check: argv.includes("--check") });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2));
}
