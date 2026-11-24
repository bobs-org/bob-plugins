const { Notice, Platform, Plugin, TFile } = require("obsidian");

const SNAPSHOT_TIMEOUT_MS = 120000;
const SNAPSHOT_MAX_BUFFER = 2 * 1024 * 1024;

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

module.exports = class BobProjectTasksPlugin extends Plugin {
  onload() {
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

};
