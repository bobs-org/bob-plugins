#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import Module from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = dirname(dirname(SCRIPT_PATH));
const GIT_SHOW_MAX_BUFFER = 64 * 1024 * 1024;

function sameKeys(left, right) {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function compareDescriptorFlags(name, left, right, mismatches) {
  for (const flag of ["enumerable", "configurable", "writable"]) {
    if (left[flag] !== right[flag]) {
      mismatches.push(`${name} descriptor ${flag} differs`);
    }
  }
}

function compareClassMethods(name, left, right, { skipConstructorSource = false } = {}) {
  const mismatches = [];
  if (typeof left !== "function" || typeof right !== "function") {
    return [`${name} is not a class/function on both sides`];
  }

  const leftKeys = Reflect.ownKeys(left.prototype);
  const rightKeys = Reflect.ownKeys(right.prototype);
  if (!sameKeys(leftKeys, rightKeys)) {
    mismatches.push(
      `${name}.prototype own keys differ (base: ${leftKeys.map(String).join(", ")}; built: ${rightKeys.map(String).join(", ")})`,
    );
  }

  for (const key of leftKeys) {
    if (!rightKeys.includes(key)) continue;
    const label = `${name}.prototype.${String(key)}`;
    const leftDescriptor = Object.getOwnPropertyDescriptor(left.prototype, key);
    const rightDescriptor = Object.getOwnPropertyDescriptor(right.prototype, key);
    compareDescriptorFlags(label, leftDescriptor, rightDescriptor, mismatches);
    if (skipConstructorSource && key === "constructor") continue;
    if (typeof leftDescriptor.value === "function" || typeof rightDescriptor.value === "function") {
      if (typeof leftDescriptor.value !== typeof rightDescriptor.value) {
        mismatches.push(`${label} type differs`);
      } else if (String(leftDescriptor.value) !== String(rightDescriptor.value)) {
        mismatches.push(`${label} source differs`);
      }
    } else if (!valuesStructurallyEqual(leftDescriptor.value, rightDescriptor.value)) {
      mismatches.push(`${label} value differs`);
    }
  }
  return mismatches;
}

function valuesStructurallyEqual(left, right) {
  try {
    assert.deepStrictEqual(left, right);
    return true;
  } catch {
    return false;
  }
}

export function comparePluginExports(baseExport, builtExport, options = {}) {
  const additionalSplitHelpers = new Set(options.additionalSplitHelpers ?? []);
  const mismatches = [];

  if (baseExport?.name !== builtExport?.name) {
    mismatches.push(`default export name differs (base: ${baseExport?.name}; built: ${builtExport?.name})`);
  }

  const baseHelpers = baseExport?.helpers;
  const builtHelpers = builtExport?.helpers;
  if (!baseHelpers || !builtHelpers || typeof baseHelpers !== "object" || typeof builtHelpers !== "object") {
    mismatches.push("helpers export is missing or is not an object");
  } else {
    const baseKeys = Object.keys(baseHelpers);
    const builtKeys = Object.keys(builtHelpers);
    if (!sameKeys(baseKeys, builtKeys)) {
      mismatches.push(`helpers keys differ (base: ${baseKeys.join(", ")}; built: ${builtKeys.join(", ")})`);
    }
    for (const key of baseKeys) {
      if (!Object.hasOwn(builtHelpers, key)) continue;
      const left = baseHelpers[key];
      const right = builtHelpers[key];
      const label = `helpers.${key}`;
      if (typeof left !== typeof right) {
        mismatches.push(`${label} type differs (base: ${typeof left}; built: ${typeof right})`);
      } else if (typeof left === "function") {
        if (additionalSplitHelpers.has(key)) {
          mismatches.push(...compareClassMethods(label, left, right));
        } else if (String(left) !== String(right)) {
          mismatches.push(`${label} source differs`);
        }
      } else if (!valuesStructurallyEqual(left, right)) {
        mismatches.push(`${label} value differs`);
      }
    }
  }

  if (typeof baseExport === "function" && typeof builtExport === "function") {
    mismatches.push(
      ...compareClassMethods("default export", baseExport, builtExport, {
        skipConstructorSource: true,
      }),
    );
  } else if (typeof baseExport !== typeof builtExport) {
    mismatches.push("default export type differs");
  }
  return mismatches;
}

function createDependencyStubs(mode) {
  const calls = [];
  const obsidian = {
    MarkdownView: class MarkdownView {},
    Modal: class Modal {},
    Notice: class Notice {
      constructor(message) {
        calls.push(["Notice", String(message)]);
      }
    },
    Plugin: class Plugin {},
    setIcon(...args) {
      calls.push(["setIcon", args.length]);
    },
  };
  const codeMirror = {
    EditorView: class EditorView {},
  };
  return { calls, obsidian, codeMirror, mode };
}

function loadIsolated(source, filename, mode) {
  const dependencyStubs = createDependencyStubs(mode);
  const loadCalls = [];
  const originalLoad = Module._load;
  const entryDirectory = dirname(filename);
  let loadedModule = null;
  let loadError = null;

  Module._load = function recordedLoad(request, parent, isMain) {
    loadCalls.push({
      request,
      parent: parent?.filename ? relative(entryDirectory, parent.filename) : null,
      isMain: Boolean(isMain),
    });
    if (request === "obsidian") return dependencyStubs.obsidian;
    if (request === "@codemirror/view") {
      if (mode === "missing-codemirror") {
        const error = new Error("Cannot find module '@codemirror/view'");
        error.code = "MODULE_NOT_FOUND";
        error.request = request;
        throw error;
      }
      return dependencyStubs.codeMirror;
    }
    return Reflect.apply(originalLoad, this, [request, parent, isMain]);
  };

  try {
    const currentModule = new Module(filename);
    currentModule.filename = filename;
    currentModule.paths = Module._nodeModulePaths(entryDirectory);
    currentModule._compile(source, filename);
    loadedModule = currentModule.exports;
  } catch (error) {
    loadError = {
      name: error.name,
      message: String(error.message),
      code: error.code,
      request: error.request,
    };
  } finally {
    Module._load = originalLoad;
  }

  return {
    exports: loadedModule,
    error: loadError,
    loadCalls,
    stubCalls: dependencyStubs.calls,
  };
}

function compareLoadResults(label, base, built, additionalSplitHelpers) {
  const mismatches = [];
  if (!valuesStructurallyEqual(base.loadCalls, built.loadCalls)) {
    mismatches.push(`${label} require/load calls differ`);
  }
  if (!valuesStructurallyEqual(base.stubCalls, built.stubCalls)) {
    mismatches.push(`${label} dependency-stub calls differ`);
  }
  if (base.error || built.error) {
    if (!valuesStructurallyEqual(base.error, built.error)) {
      mismatches.push(`${label} load error differs (base: ${JSON.stringify(base.error)}; built: ${JSON.stringify(built.error)})`);
    }
    return mismatches;
  }
  return mismatches.concat(
    comparePluginExports(base.exports, built.exports, { additionalSplitHelpers }),
  );
}

function readBaseSource(root, plugin, base) {
  try {
    return execFileSync("git", ["show", `${base}:plugins/${plugin}/main.js`], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: GIT_SHOW_MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(
      `could not read ${base}:plugins/${plugin}/main.js: ${String(error.stderr || error.message).trim()}`,
    );
  }
}

export function checkSplitParity({
  plugin,
  base,
  repositoryRoot = DEFAULT_ROOT,
  additionalSplitHelpers = [],
}) {
  if (!plugin || !/^[a-z0-9][a-z0-9-]*$/.test(plugin)) {
    throw new Error("--plugin must be a plugin directory name");
  }
  if (!base) throw new Error("--base <git-sha> is required");
  const root = resolve(repositoryRoot);
  const builtPath = join(root, "plugins", plugin, "main.js");
  if (!existsSync(builtPath)) throw new Error(`missing built entrypoint: ${builtPath}`);

  const baseSource = readBaseSource(root, plugin, base);
  const builtSource = readFileSync(builtPath, "utf8");
  const tempRoot = mkdtempSync(join(tmpdir(), "bob-plugin-parity-"));
  const baseFilename = join(tempRoot, "base", "plugins", plugin, "main.js");
  const builtFilename = join(tempRoot, "built", "plugins", plugin, "main.js");
  mkdirSync(dirname(baseFilename), { recursive: true });
  mkdirSync(dirname(builtFilename), { recursive: true });
  writeFileSync(baseFilename, baseSource);
  writeFileSync(builtFilename, builtSource);

  try {
    const baseAvailable = loadIsolated(baseSource, baseFilename, "available");
    const builtAvailable = loadIsolated(builtSource, builtFilename, "available");
    const mismatches = compareLoadResults(
      "CodeMirror available",
      baseAvailable,
      builtAvailable,
      additionalSplitHelpers,
    );

    // Plugins that use CodeMirror optionally must preserve their no-CodeMirror path too.
    const baseWithoutCodeMirror = loadIsolated(baseSource, baseFilename, "missing-codemirror");
    const builtWithoutCodeMirror = loadIsolated(builtSource, builtFilename, "missing-codemirror");
    if (baseWithoutCodeMirror.error || builtWithoutCodeMirror.error) {
      const bothMissingDependency = [baseWithoutCodeMirror, builtWithoutCodeMirror].every(
        (result) =>
          result.error?.code === "MODULE_NOT_FOUND" &&
          result.error?.request === "@codemirror/view",
      );
      if (!bothMissingDependency) {
        mismatches.push(
          ...compareLoadResults(
            "CodeMirror unavailable",
            baseWithoutCodeMirror,
            builtWithoutCodeMirror,
            additionalSplitHelpers,
          ),
        );
      } else if (!valuesStructurallyEqual(baseWithoutCodeMirror.loadCalls, builtWithoutCodeMirror.loadCalls)) {
        mismatches.push("CodeMirror unavailable require/load calls differ");
      }
    } else {
      mismatches.push(
        ...compareLoadResults(
          "CodeMirror unavailable",
          baseWithoutCodeMirror,
          builtWithoutCodeMirror,
          additionalSplitHelpers,
        ),
      );
    }

    if (mismatches.length) {
      throw new Error(mismatches.map((item) => `- ${item}`).join("\n"));
    }

    const pluginPrototypeMethods =
      Reflect.ownKeys(baseAvailable.exports.prototype).filter((key) => key !== "constructor").length;
    const helperCount = Object.keys(baseAvailable.exports.helpers ?? {}).length;
    return {
      helperCount,
      pluginPrototypeMethods,
      additionalSplitHelpers,
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const args = { additionalSplitHelpers: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--plugin" || arg === "--base" || arg === "--split-helper") {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} needs a value`);
      if (arg === "--plugin") args.plugin = value;
      else if (arg === "--base") args.base = value;
      else args.additionalSplitHelpers.push(value);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function main(argv) {
  try {
    const args = parseArgs(argv);
    const result = checkSplitParity(args);
    console.log(
      `Parity passed for ${args.plugin}: ${result.helperCount} helpers, ${result.pluginPrototypeMethods} own prototype methods`,
    );
  } catch (error) {
    console.error(
      `Usage: node scripts/check-split-parity.mjs --plugin <id> --base <git-sha> [--split-helper <exported-class>]\n${error.message}`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2));
}
