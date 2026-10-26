const { Notice, Platform, Plugin, TFile } = require("obsidian");

const DEBOUNCE_MS = 250;
const PROJECT_TYPE = "[[project]]";
const TASK_COUNT_FIELD = "task_count";
const OPEN_TASK_COUNT_FIELD = "open_task_count";
const TEMPLATE_PATH_PREFIX = "_templates/";
const SNAPSHOT_TIMEOUT_MS = 120000;
const SNAPSHOT_MAX_BUFFER = 2 * 1024 * 1024;

const FRONTMATTER_DELIMITER_RE = /^\s*(?:---|\.\.\.)\s*$/;
const TASK_SECTION_HEADING_RE = /^ {0,3}##[ \t]+Tasks(?:[ \t].*)?$/i;
const LEVEL_TWO_HEADING_RE = /^ {0,3}##[ \t]+/;
const FENCE_RE = /^( {0,3})(`{3,}|~{3,})/;
const TASK_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[([^\]\n])\][ \t]+(.*)$/;
const TASK_TAG_RE = /(^|[\s([{])#task(?=$|[\s\])}:.,;!?])/;
const OPEN_TASK_STATUSES = new Set([" ", "/", "*"]);

function isMarkdownFile(file) {
  return file instanceof TFile && file.extension === "md";
}

function snapshotOutputLines(output, prefixes) {
  return String(output || "")
    .split(/\r?\n/)
    .filter((line) => prefixes.some((prefix) => line.startsWith(prefix)));
}

function snapshotFailureLines(stdout, stderr) {
  return `${String(stdout || "")}\n${String(stderr || "")}`
    .split(/\r?\n/)
    .filter((line) => /(?:^|\s)error:/.test(line) || /^hint:/.test(line));
}

function isTemplatePath(file) {
  return isMarkdownFile(file) && file.path.startsWith(TEMPLATE_PATH_PREFIX);
}

function isProjectType(value) {
  if (typeof value === "string") {
    return value.trim() === PROJECT_TYPE;
  }

  if (Array.isArray(value)) {
    return value.some((item) => isProjectType(item));
  }

  return false;
}

function isProjectFrontmatter(frontmatter) {
  return Boolean(frontmatter) && isProjectType(frontmatter.type);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function hasTaskCountFields(frontmatter) {
  return (
    hasOwn(frontmatter, TASK_COUNT_FIELD) ||
    hasOwn(frontmatter, OPEN_TASK_COUNT_FIELD)
  );
}

function frontmatterNumberEquals(value, expected) {
  if (typeof value === "number") {
    return value === expected;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed === expected;
  }

  return false;
}

function countFieldsMatch(frontmatter, counts) {
  return (
    frontmatterNumberEquals(frontmatter[TASK_COUNT_FIELD], counts.taskCount) &&
    frontmatterNumberEquals(
      frontmatter[OPEN_TASK_COUNT_FIELD],
      counts.openTaskCount,
    )
  );
}

function bodyLinesFromContent(content) {
  const lines = String(content || "").split(/\r?\n/);
  if (lines.length === 0 || !FRONTMATTER_DELIMITER_RE.test(lines[0])) {
    return lines;
  }

  for (let index = 1; index < lines.length; index += 1) {
    if (FRONTMATTER_DELIMITER_RE.test(lines[index])) {
      return lines.slice(index + 1);
    }
  }

  return lines;
}

function taskSectionLines(content) {
  const lines = bodyLinesFromContent(content);
  const startIndex = lines.findIndex((line) =>
    TASK_SECTION_HEADING_RE.test(line),
  );
  if (startIndex === -1) {
    return [];
  }

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (LEVEL_TWO_HEADING_RE.test(lines[index])) {
      endIndex = index;
      break;
    }
  }

  return lines.slice(startIndex + 1, endIndex);
}

function updateFenceState(state, line) {
  const match = FENCE_RE.exec(line);
  if (!match) {
    return state;
  }

  const marker = match[2];
  const markerChar = marker[0];
  if (state.inFence) {
    if (markerChar === state.markerChar && marker.length >= state.markerLength) {
      return { inFence: false, markerChar: "", markerLength: 0 };
    }
    return state;
  }

  return {
    inFence: true,
    markerChar,
    markerLength: marker.length,
  };
}

function countProjectTasks(content) {
  let taskCount = 0;
  let openTaskCount = 0;
  let fenceState = { inFence: false, markerChar: "", markerLength: 0 };

  for (const line of taskSectionLines(content)) {
    const nextFenceState = updateFenceState(fenceState, line);
    if (nextFenceState !== fenceState) {
      fenceState = nextFenceState;
      continue;
    }

    if (fenceState.inFence) {
      continue;
    }

    const taskMatch = TASK_LINE_RE.exec(line);
    if (!taskMatch || !TASK_TAG_RE.test(taskMatch[2])) {
      continue;
    }

    taskCount += 1;
    if (OPEN_TASK_STATUSES.has(taskMatch[1])) {
      openTaskCount += 1;
    }
  }

  return { taskCount, openTaskCount };
}

module.exports = class BobProjectTasksPlugin extends Plugin {
  onload() {
    this.pendingTimers = new Map();

    this.addCommand({
      id: "recount-all-project-tasks",
      name: "Recount all project tasks",
      callback: () => this.recountAllProjectTasks(),
    });

    this.addCommand({
      id: "snapshot-note-to-highlights",
      name: "Snapshot note to Highlights",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!isMarkdownFile(file)) {
          return false;
        }
        if (!checking) {
          void this.snapshotActiveNote(file, false);
        }
        return true;
      },
    });

    this.addCommand({
      id: "snapshot-note-to-highlights-with-closed-tasks",
      name: "Snapshot note to Highlights (with closed tasks)",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!isMarkdownFile(file)) {
          return false;
        }
        if (!checking) {
          void this.snapshotActiveNote(file, true);
        }
        return true;
      },
    });

    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => this.queueFile(file)),
    );

    this.register(() => this.clearPendingTimers());
  }

  onunload() {
    this.clearPendingTimers();
  }

  queueFile(file) {
    if (!isMarkdownFile(file) || isTemplatePath(file)) {
      return;
    }

    const existingTimer = this.pendingTimers.get(file.path);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.pendingTimers.delete(file.path);
      this.refreshFile(file).catch((error) => {
        console.error("Failed to update project task counts", file.path, error);
      });
    }, DEBOUNCE_MS);

    this.pendingTimers.set(file.path, timer);
  }

  clearPendingTimers() {
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
  }

  async recountAllProjectTasks() {
    const files =
      typeof this.app.vault.getMarkdownFiles === "function"
        ? this.app.vault.getMarkdownFiles()
        : this.app.vault.getFiles().filter((file) => isMarkdownFile(file));

    let projectCount = 0;
    let updatedCount = 0;
    let cleanedCount = 0;

    for (const file of files) {
      if (isTemplatePath(file)) {
        continue;
      }

      const result = await this.refreshFile(file);
      if (result.project) {
        projectCount += 1;
      }
      if (result.changed) {
        updatedCount += 1;
      }
      if (result.cleaned) {
        cleanedCount += 1;
      }
    }

    const cleanupText = cleanedCount ? `, ${cleanedCount} cleaned` : "";
    new Notice(
      `Recounted ${projectCount} project notes (${updatedCount} updated${cleanupText})`,
    );
  }

  snapshotCommandMode() {
    try {
      const plugins =
        this.app && this.app.plugins && this.app.plugins.plugins;
      const commandMode =
        plugins &&
        plugins["bob-command-mode"] &&
        plugins["bob-command-mode"].api &&
        plugins["bob-command-mode"].api.commandMode;
      if (!commandMode || typeof commandMode.run !== "function") {
        return null;
      }
      if (typeof commandMode.version !== "number" || commandMode.version < 1) {
        return null;
      }
      return commandMode;
    } catch (error) {
      return null;
    }
  }

  async snapshotActiveNoteViaCommandMode(file, includeClosed) {
    const commandMode = this.snapshotCommandMode();
    const args = ["ref", "create", file.path];
    if (includeClosed) {
      args.push("-C");
    }
    let result = null;
    try {
      result = await commandMode.run(args, {
        presentation: "action",
        title: "Snapshot to Highlights",
        entryId: "ref-create",
        trigger: "api",
      });
    } catch (error) {
      result = {
        ok: false,
        reason:
          error && error.message ? String(error.message) : "bob ref create failed.",
      };
    }
    if (result && result.ok) {
      // The command-mode runner owns the toast for this run (outcome,
      // Output, Scan intake); a second notice here would double-notify.
      return;
    }
    new Notice(
      (result && result.reason) || "bob ref create failed.",
      10000,
    );
  }

  async snapshotActiveNote(file, includeClosed) {
    if (!isMarkdownFile(file)) {
      return;
    }

    if (this.snapshotCommandMode()) {
      await this.snapshotActiveNoteViaCommandMode(file, includeClosed);
      return;
    }

    const basename = file.basename || file.name || file.path;
    const progress = new Notice(`Snapshotting ${basename}…`, 0);
    let result;
    try {
      const args = ["ref", "create", file.path];
      if (includeClosed) {
        args.push("-C");
      }
      result = await this.snapshotSpawnBob(args);
    } catch (error) {
      result = {
        ok: false,
        message: error && error.message ? String(error.message) : "bob ref create failed.",
        stdout: "",
        stderr: "",
      };
    } finally {
      if (progress && typeof progress.hide === "function") {
        progress.hide();
      }
    }

    if (!result || !result.ok) {
      const lines = snapshotFailureLines(
        result && result.stdout,
        result && result.stderr,
      );
      if (lines.length) {
        new Notice(lines.join("\n"), 10000);
      } else {
        new Notice(
          (result && result.message) || "bob ref create failed.",
          10000,
        );
      }
      return;
    }

    const lines = snapshotOutputLines(result.stdout, ["pdf:", "next:"]);
    new Notice(
      lines.length ? lines.join("\n") : "Snapshot created by bob.",
      10000,
    );
  }

  snapshotResolveBobPath() {
    try {
      const ledgerTools =
        this.app && this.app.plugins && this.app.plugins.plugins
          ? this.app.plugins.plugins["bob-ledger-tools"]
          : null;
      const resolveFromLedger =
        ledgerTools &&
        ledgerTools.api &&
        ledgerTools.api.stats &&
        ledgerTools.api.stats.bobPath;
      if (typeof resolveFromLedger === "function") {
        const resolved = resolveFromLedger();
        if (resolved && typeof resolved.path === "string" && resolved.path) {
          return resolved;
        }
      }
    } catch (error) {
      // The snapshot command also works when Bob Ledger Tools is disabled.
    }

    let home = "";
    try {
      const os = require("os");
      home = typeof os.homedir === "function" ? os.homedir() : "";
    } catch (error) {
      try {
        home = typeof process !== "undefined" ? process.env.HOME || "" : "";
      } catch (ignored) {
        home = "";
      }
    }

    const candidates = [
      home ? `${home}/.cargo/bin/bob` : "",
      home ? `${home}/.local/bin/bob` : "",
      "/opt/homebrew/bin/bob",
      "/usr/local/bin/bob",
    ].filter(Boolean);
    try {
      const fs = require("fs");
      const candidate = candidates.find((path) => fs.existsSync(path));
      if (candidate) {
        return { path: candidate, source: "candidate" };
      }
    } catch (error) {
      // Fall back to bob on PATH below.
    }
    return { path: "bob", source: "path" };
  }

  snapshotVaultBasePath() {
    try {
      const adapter = this.app && this.app.vault && this.app.vault.adapter;
      if (adapter && typeof adapter.basePath === "string" && adapter.basePath) {
        return adapter.basePath;
      }
      if (adapter && typeof adapter.getBasePath === "function") {
        const basePath = adapter.getBasePath();
        if (typeof basePath === "string" && basePath) {
          return basePath;
        }
      }
    } catch (error) {
      // BOB_DIR is optional when the vault path cannot be read.
    }
    return "";
  }

  snapshotSpawnBob(args, options = {}) {
    if (Platform && Platform.isDesktopApp === false) {
      return Promise.resolve({
        ok: false,
        message: "Spawning bob needs the desktop app.",
        stdout: "",
        stderr: "",
      });
    }

    let execFile = options.execFile;
    if (typeof execFile !== "function") {
      try {
        const childProcess = require("child_process");
        execFile = childProcess && childProcess.execFile;
      } catch (error) {
        execFile = null;
      }
    }
    if (typeof execFile !== "function") {
      return Promise.resolve({
        ok: false,
        message: "Spawning bob needs the desktop app.",
        stdout: "",
        stderr: "",
      });
    }

    const resolved = options.resolved || this.snapshotResolveBobPath();
    let env = {};
    try {
      env = {
        ...(typeof process !== "undefined" && process.env ? process.env : {}),
      };
    } catch (error) {
      env = {};
    }
    const vaultPath =
      options.vaultPath !== undefined
        ? options.vaultPath
        : this.snapshotVaultBasePath();
    if (vaultPath) {
      env.BOB_DIR = vaultPath;
    }
    env.NO_COLOR = "1";

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(result);
      };
      try {
        execFile(
          resolved.path,
          args,
          {
            env,
            timeout: SNAPSHOT_TIMEOUT_MS,
            maxBuffer: SNAPSHOT_MAX_BUFFER,
          },
          (error, stdout, stderr) => {
            finish({
              ok: !error,
              message: error && error.message ? String(error.message) : "",
              stdout: String(stdout || ""),
              stderr: String(stderr || ""),
            });
          },
        );
      } catch (error) {
        finish({
          ok: false,
          message: error && error.message ? String(error.message) : "bob ref create failed.",
          stdout: "",
          stderr: "",
        });
      }
    });
  }

  async refreshFile(file) {
    if (!isMarkdownFile(file) || isTemplatePath(file)) {
      return { project: false, changed: false, cleaned: false };
    }

    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache && cache.frontmatter;

    if (!isProjectFrontmatter(frontmatter)) {
      if (!hasTaskCountFields(frontmatter)) {
        return { project: false, changed: false, cleaned: false };
      }

      await this.app.fileManager.processFrontMatter(file, (nextFrontmatter) => {
        delete nextFrontmatter[TASK_COUNT_FIELD];
        delete nextFrontmatter[OPEN_TASK_COUNT_FIELD];
      });
      return { project: false, changed: true, cleaned: true };
    }

    const content = await this.app.vault.cachedRead(file);
    const counts = countProjectTasks(content);
    if (countFieldsMatch(frontmatter, counts)) {
      return { project: true, changed: false, cleaned: false };
    }

    await this.app.fileManager.processFrontMatter(file, (nextFrontmatter) => {
      nextFrontmatter[TASK_COUNT_FIELD] = counts.taskCount;
      nextFrontmatter[OPEN_TASK_COUNT_FIELD] = counts.openTaskCount;
    });

    return { project: true, changed: true, cleaned: false };
  }
};
