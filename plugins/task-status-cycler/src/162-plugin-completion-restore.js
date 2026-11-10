// Archived-task reopen through `bob task restore` (done-archive phase
// plugins, plugin_reopen = restore). Pure argv, report decoding, and the
// desktop spawn boundary live here so 160-plugin-completion.js stays under
// the fragment line cap. Shared scope with 160: the completion mixin calls
// `this.reopenArchivedTranscludedTaskTarget` below.
const CYCLER_BOB_SPAWN_TIMEOUT_MS = 20000;
const CYCLER_BOB_SPAWN_MAX_BUFFER = 32 * 1024 * 1024;
const CYCLER_RESTORE_SCHEMA_VERSION = 1;

function cyclerRequireOptionalNodeModule(name) {
  try {
    if (typeof require !== "function") {
      return null;
    }
    return require(name);
  } catch (error) {
    return null;
  }
}

function cyclerVaultBasePath(app) {
  try {
    const adapter = app && app.vault && app.vault.adapter;
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
    // Fall through to null below.
  }
  return null;
}

function cyclerFirstLine(text) {
  const line = String(text || "")
    .split(/\r?\n/)
    .find((entry) => entry.trim().length > 0);
  return line ? line.trim() : "";
}

// Pure `bob task restore` argv for one archived task: offline like the
// plugins' other bob write calls, reopened, machine-readable. The source is
// the archive path and the task rides `-b` without its leading `^`, per
// `bob task restore --help`.
function cyclerRestoreArchiveArgs(archivePath, blockId) {
  return [
    "task",
    "restore",
    "-o",
    "-r",
    "-f",
    "json",
    String(archivePath || ""),
    "-b",
    String(blockId || "").replace(/^\^/, ""),
  ];
}

// Decode one `bob task restore -f json` report. Success resolves the
// restored identity from the reported move so reference restoration can
// follow the task to its destination note; every failure shape carries
// bob's message for the Notice.
function cyclerDecodeRestoreReport(stdout, stderr, blockId) {
  const label = "bob task restore";
  let body = null;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (error) {
    return {
      ok: false,
      code: "unsupported",
      message: "Update bob to restore archived tasks.",
      detail: cyclerFirstLine(stderr),
    };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      code: "bad-shape",
      message: `${label} returned an unexpected JSON shape.`,
      detail: cyclerFirstLine(stderr),
    };
  }
  if (body.schema_version !== CYCLER_RESTORE_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "bad-version",
      message: `${label} returned an unsupported schema version.`,
      detail: cyclerFirstLine(stderr),
    };
  }
  if (body.ok === false) {
    const error =
      body.error && typeof body.error === "object" && !Array.isArray(body.error)
        ? body.error
        : {};
    return {
      ok: false,
      code:
        typeof error.code === "string" && error.code ? error.code : "bob-error",
      message:
        typeof error.message === "string" && error.message
          ? error.message
          : `${label} reported an error.`,
      detail: cyclerFirstLine(stderr),
      error,
    };
  }
  const moves = Array.isArray(body.moves) ? body.moves : [];
  const wanted = String(blockId || "").replace(/^\^/, "");
  const move =
    moves.find(
      (entry) =>
        entry &&
        (entry.old_block_id === wanted || entry.new_block_id === wanted),
    ) || moves[0] || null;
  const destinationPath =
    move && typeof move.destination_path === "string"
      ? move.destination_path
      : null;
  const destinationId =
    move && typeof move.new_block_id === "string" && move.new_block_id
      ? move.new_block_id
      : wanted;
  return {
    ok: true,
    report: body,
    identity:
      destinationPath && destinationId
        ? { path: destinationPath, blockId: destinationId }
        : null,
  };
}

class TaskStatusCyclerCompletionRestoreMixin {
  // Archived-target reopen (done-archive phase plugins, plugin_reopen =
  // restore): an open task must never be left inside done/, so a done/
  // target is restored to its bound source with `bob task restore -r`
  // instead of being reopened in place. Callers unstrike the link on
  // `changed` exactly as they do for today's reopen. On failure the
  // archived task stays closed and the Notice carries bob's message.
  async reopenArchivedTranscludedTaskTarget(resolvedTarget, context) {
    const archivePath = resolvedTarget.file.path;
    const blockId = String(resolvedTarget.blockId || "").replace(/^\^/, "");
    if (!blockId) {
      new Notice(
        "bob task restore needs a block id to reopen this archived task.",
      );
      return { resolved: true, changed: false };
    }
    let result = null;
    try {
      result = await this.spawnBobTaskRestore(archivePath, blockId, context);
    } catch (error) {
      result = {
        ok: false,
        message:
          error && error.message
            ? String(error.message)
            : "bob task restore failed to run.",
      };
    }
    if (!result || !result.ok) {
      new Notice(
        result && result.message
          ? String(result.message)
          : "bob task restore failed.",
      );
      return { resolved: true, changed: false };
    }
    await this.restoreReopenedTaskReferences(
      [result.identity || { path: archivePath, blockId }],
      context,
    );
    return { resolved: true, changed: true };
  }

  // Desktop `bob task restore` spawn for one archived task. Mirrors the
  // bob-resolution and child_process boundary in bob-ledger-tools
  // 236-plugin-stats-data.js. Like the plugins' other bob write calls this
  // passes `-o` (offline): it keeps the lock and the scoped local commit
  // while skipping both sync cycles. Never throws.
  async spawnBobTaskRestore(archivePath, blockId, context) {
    const args = cyclerRestoreArchiveArgs(archivePath, blockId);
    let execFile =
      context && typeof context.bobExecFile === "function"
        ? context.bobExecFile
        : null;
    if (!execFile) {
      const childProcess = cyclerRequireOptionalNodeModule("child_process");
      execFile =
        childProcess && typeof childProcess.execFile === "function"
          ? childProcess.execFile
          : null;
    }
    if (typeof execFile !== "function") {
      return {
        ok: false,
        code: "bob-not-found",
        message: "Spawning bob needs the desktop app.",
        detail: "",
      };
    }
    let env = {};
    try {
      const base = (typeof process !== "undefined" && process.env) || {};
      env = { ...base };
    } catch (error) {
      env = {};
    }
    try {
      const vaultPath = cyclerVaultBasePath(this.app);
      if (vaultPath) {
        env.BOB_DIR = vaultPath;
      }
      env.NO_COLOR = "1";
    } catch (error) {
      // Environment augmentation is best-effort.
    }
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
        const child = execFile(
          "bob",
          args,
          {
            env,
            timeout: CYCLER_BOB_SPAWN_TIMEOUT_MS,
            maxBuffer: CYCLER_BOB_SPAWN_MAX_BUFFER,
          },
          (error, stdout, stderr) => {
            if (error && error.code === "ENOENT") {
              finish({
                ok: false,
                code: "bob-not-found",
                message: "bob was not found on PATH.",
                detail: "",
              });
              return;
            }
            if (error && error.killed) {
              finish({
                ok: false,
                code: "timeout",
                message: `bob task restore timed out after ${Math.round(CYCLER_BOB_SPAWN_TIMEOUT_MS / 1000)} s.`,
                detail: cyclerFirstLine(stderr),
              });
              return;
            }
            finish(cyclerDecodeRestoreReport(stdout, stderr, blockId));
          },
        );
        void child;
      } catch (error) {
        finish({
          ok: false,
          code: "failed",
          message:
            error && error.message
              ? String(error.message)
              : "bob task restore failed to run.",
          detail: "",
        });
      }
    });
  }
}
