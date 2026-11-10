// Archived-task reopen through `bob task restore` (done-archive phase
// plugins, plugin_reopen = restore): a done/ transclusion target is restored
// to its bound source reopened instead of being reopened in place, so no
// open task is ever left inside done/.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TaskStatusCyclerPlugin,
  helpers,
  notices,
} = require("./task-status-cycler-harness.cjs");

function reopenableStatus() {
  const taskStatus = helpers.getTaskStatusForLine(
    "- [x] #task Archived work ^abc123",
  );
  assert.ok(
    helpers.isTranscludedReopenableStatus(taskStatus),
    "fixture status is reopenable",
  );
  return taskStatus;
}

function archivedTarget(path = "done/work_done.md") {
  return {
    file: { path },
    blockId: "abc123",
    taskStatus: reopenableStatus(),
  };
}

function installPluginDouble() {
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = { vault: { adapter: { basePath: "/vault" } } };
  const calls = { replaced: [], restored: [] };
  plugin.replaceResolvedTranscludedTaskLine = async (target) => {
    calls.replaced.push(target);
    return true;
  };
  plugin.restoreReopenedTaskReferences = async (identities) => {
    calls.restored.push(identities);
    return { restored: identities.length, failures: [] };
  };
  return { plugin, calls };
}

function successStdout() {
  return JSON.stringify({
    schema_version: 1,
    ok: true,
    dry_run: false,
    moves: [
      {
        source_path: "done/work_done.md",
        destination_path: "work.md",
        old_block_id: "abc123",
        new_block_id: "abc123",
      },
    ],
  });
}

test("restore argv is offline, reopened, JSON, with the archive source and -b id", () => {
  assert.deepEqual(helpers.cyclerRestoreArchiveArgs("done/work_done.md", "^abc123"), [
    "task",
    "restore",
    "-o",
    "-r",
    "-f",
    "json",
    "done/work_done.md",
    "-b",
    "abc123",
  ]);
});

test("decoder resolves the restored identity from the reported move", () => {
  const decoded = helpers.cyclerDecodeRestoreReport(
    successStdout(),
    "",
    "abc123",
  );
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.identity, {
    path: "work.md",
    blockId: "abc123",
  });
});

test("decoder carries bob's message on a refused restore", () => {
  const decoded = helpers.cyclerDecodeRestoreReport(
    JSON.stringify({
      schema_version: 1,
      ok: false,
      error: {
        stage: "plan",
        code: "refused",
        message: "Refusing recurring occurrence.",
        hint: null,
      },
    }),
    "restore: refusing recurring occurrence\n",
    "abc123",
  );
  assert.equal(decoded.ok, false);
  assert.equal(decoded.message, "Refusing recurring occurrence.");
});

test("decoder rejects non-JSON output", () => {
  const decoded = helpers.cyclerDecodeRestoreReport("not json\n", "boom\n", "abc123");
  assert.equal(decoded.ok, false);
  assert.match(decoded.message, /Update bob/);
});

test("archived reopen restores through bob and follows the task home", async () => {
  const { plugin, calls } = installPluginDouble();
  const seen = {};
  const context = {
    bobExecFile: (command, args, options, callback) => {
      seen.command = command;
      seen.args = args;
      seen.options = options;
      callback(null, successStdout(), "");
      return {};
    },
  };
  const result = await plugin.reopenResolvedTranscludedTaskTarget(
    archivedTarget(),
    context,
  );
  assert.deepEqual(result, { resolved: true, changed: true });
  assert.equal(seen.command, "bob");
  assert.deepEqual(seen.args, [
    "task",
    "restore",
    "-o",
    "-r",
    "-f",
    "json",
    "done/work_done.md",
    "-b",
    "abc123",
  ]);
  assert.equal(seen.options.env.BOB_DIR, "/vault");
  assert.equal(calls.replaced.length, 0, "never reopened in place");
  assert.deepEqual(calls.restored, [[{ path: "work.md", blockId: "abc123" }]]);
});

test("archived reopen leaves the task closed and notices bob's message on failure", async () => {
  const { plugin, calls } = installPluginDouble();
  const context = {
    bobExecFile: (command, args, options, callback) => {
      callback(
        null,
        JSON.stringify({
          schema_version: 1,
          ok: false,
          error: {
            stage: "plan",
            code: "refused",
            message: "Task is a merged-task tombstone.",
            hint: null,
          },
        }),
        "",
      );
      return {};
    },
  };
  const before = notices.length;
  const result = await plugin.reopenResolvedTranscludedTaskTarget(
    archivedTarget(),
    context,
  );
  assert.deepEqual(result, { resolved: true, changed: false });
  assert.equal(calls.replaced.length, 0, "never reopened in place");
  assert.equal(calls.restored.length, 0, "no reference pass on failure");
  assert.deepEqual(
    notices.slice(before),
    ["Task is a merged-task tombstone."],
  );
});

test("live targets still reopen in place without spawning bob", async () => {
  const { plugin, calls } = installPluginDouble();
  const context = {
    bobExecFile: () => {
      throw new Error("must not spawn for a live target");
    },
  };
  const result = await plugin.reopenResolvedTranscludedTaskTarget(
    archivedTarget("projects/launch.md"),
    context,
  );
  assert.deepEqual(result, { resolved: true, changed: true });
  assert.equal(calls.replaced.length, 1, "reopened in place");
  assert.deepEqual(calls.restored, [
    [{ path: "projects/launch.md", blockId: "abc123" }],
  ]);
});

test("nested done/ folders and Done/ stay in place like the Rust contract", async () => {
  const { plugin, calls } = installPluginDouble();
  const context = {
    bobExecFile: () => {
      throw new Error("must not spawn for a non-archive path");
    },
  };
  for (const path of ["projects/done/nested.md", "Done/work_done.md"]) {
    const result = await plugin.reopenResolvedTranscludedTaskTarget(
      archivedTarget(path),
      context,
    );
    assert.deepEqual(result, { resolved: true, changed: true }, path);
  }
  assert.equal(calls.replaced.length, 2, "both reopened in place");
});
