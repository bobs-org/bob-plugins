// Command-entry flushing for the navigation settle adapter.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  NavigationHotkeysPlugin,
  helpers,
} = require("./navigation-hotkeys-harness.cjs");

function makeFlushPlugin() {
  const flushes = [];
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    plugins: {
      plugins: {
        "bob-ledger-tools": {
          api: {
            taskSettle: {
              version: 1,
              settleNote() {
                return { contents: "", changed: false, lineMap: {}, warnings: [] };
              },
              applyToEditor() {
                return { applied: false, changed: false, reason: "noop" };
              },
              flushPending() {
                flushes.push("flush");
                return [];
              },
            },
          },
        },
      },
    },
    workspace: {},
    vault: { on() { return { unload() {} }; } },
  };
  plugin.vimJumpHistory = helpers.createVimJumpHistory();
  return { plugin, flushes };
}

test("wrapNavCommandForSettleFlush runs before callbacks and skips checking-only probes", () => {
  const { plugin, flushes } = makeFlushPlugin();
  const order = [];
  const wrapped = helpers.wrapNavCommandForSettleFlush(plugin, {
    id: "demo",
    callback() {
      order.push("callback");
    },
    editorCallback() {
      order.push("editor");
    },
    checkCallback(checking) {
      order.push(checking === true ? "check-true" : "check-run");
      return true;
    },
    editorCheckCallback(checking) {
      order.push(checking === true ? "editor-true" : "editor-run");
      return true;
    },
  });
  wrapped.checkCallback(true);
  wrapped.editorCheckCallback(true);
  assert.deepEqual(flushes, []);
  wrapped.checkCallback(false);
  wrapped.editorCheckCallback(false);
  wrapped.callback();
  wrapped.editorCallback();
  assert.deepEqual(flushes, ["flush", "flush", "flush", "flush"]);
  assert.deepEqual(order, [
    "check-true",
    "editor-true",
    "check-run",
    "editor-run",
    "callback",
    "editor",
  ]);
});

test("installNavTaskSettleCommandFlush wraps registered command callbacks", () => {
  const { plugin, flushes } = makeFlushPlugin();
  plugin.manifest = { id: "bob-navigation-hotkeys" };
  const command = {
    id: "open-parent-note",
    callback() {
      flushes.push("ran");
    },
    checkCallback(checking) {
      flushes.push(checking === true ? "probe" : "run-check");
      return true;
    },
  };
  plugin.app.commands = {
    commands: {
      "bob-navigation-hotkeys:open-parent-note": command,
    },
  };
  assert.equal(plugin.installNavTaskSettleCommandFlush(), 1);
  command.checkCallback(true);
  assert.deepEqual(flushes, ["probe"]);
  command.callback();
  assert.deepEqual(flushes, ["probe", "flush", "ran"]);
  assert.equal(plugin.installNavTaskSettleCommandFlush(), 0);
});

test("nested command routes do not flush twice under the reentrancy guard", () => {
  const { plugin, flushes } = makeFlushPlugin();
  const settle = plugin.app.plugins.plugins["bob-ledger-tools"].api.taskSettle;
  settle.flushPending = () => {
    flushes.push("outer");
    plugin.flushPendingNavSettles();
    return [];
  };
  plugin.flushPendingNavSettles();
  assert.deepEqual(flushes, ["outer"]);
});

test("public capture and claim APIs flush before they read the editor", () => {
  const { plugin, flushes } = makeFlushPlugin();
  const seen = [];
  plugin.captureReviewGesture = () => {
    seen.push(flushes.slice());
    return { key: "row" };
  };
  plugin.claimReviewWalkCtrlEnter = () => {
    seen.push(flushes.slice());
    return Promise.resolve({ ok: true });
  };
  const api = helpers.createDependencyNavApi(plugin);
  const captured = api.reviewWalk.capture({});
  assert.deepEqual(captured, { key: "row" });
  assert.deepEqual(flushes, ["flush"]);
  const claimed = api.claimReviewWalkCompletion({});
  assert.ok(claimed && typeof claimed.then === "function");
  assert.deepEqual(flushes, ["flush", "flush"]);
  assert.equal(seen[0].length, 1);
  assert.equal(seen[1].length, 2);
});

test("vim defineAction wrappers flush before the action runs", () => {
  const { plugin, flushes } = makeFlushPlugin();
  const order = [];
  const wrapped = helpers.wrapNavFunctionForSettleFlush(plugin, () => {
    order.push("action");
  });
  wrapped();
  assert.deepEqual(flushes, ["flush"]);
  assert.deepEqual(order, ["action"]);
});

test("physical-key inventory names the acting handlers and skips every keydown", () => {
  const routes = helpers.NAV_TASK_SETTLE_FLUSH_ROUTES;
  assert.equal(routes.physical.length, 8);
  assert.ok(routes.skipped.includes("arbitrary typing / every keydown"));
  assert.ok(routes.skipped.includes("checkCallback when checking === true"));
});
