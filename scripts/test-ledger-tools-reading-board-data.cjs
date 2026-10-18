// Reading Board data path: argv, defensive decode, shared bob spawn,
// stale-while-revalidate cache, coalescing, and mounted-only triggers.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  LedgerToolsPlugin,
  makeFreshnessApp,
  withMissingConfig,
} = require("./ledger-tools-harness.cjs");

const {
  BOB_SPAWN_MAX_BUFFER,
  BOB_SPAWN_TIMEOUT_MS,
  READING_BOARD_CACHE_SIZE,
  READING_BOARD_REVALIDATE_DEBOUNCE_MS,
  READING_BOARD_SCHEMA_VERSION,
  readingBoardBuildArgs,
  readingBoardCacheKey,
  readingBoardDecodeReport,
  readingBoardErrorModel,
  readingBoardModel,
} = LedgerToolsPlugin.helpers;

const fixturePath = path.join(
  __dirname,
  "../plugins/bob-ledger-tools/scripts/fixtures/reading-board/ref-list.json",
);
const fixtureDocument = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const fixtureDecoded = readingBoardDecodeReport(JSON.stringify(fixtureDocument), "");

function makePlugin({ load = true } = {}) {
  const plugin = new LedgerToolsPlugin(makeFreshnessApp({ tasks: [] }), {});
  if (load) {
    plugin.onload();
  }
  return plugin;
}

test("Reading Board argv carries bob's fixed queue and optional fence filters", () => {
  assert.deepEqual(readingBoardBuildArgs({}), [
    "ref", "list", "-s", "ready,next,wip", "-A", "-f", "json",
  ]);
  assert.deepEqual(readingBoardBuildArgs({ parent: "sase", type: ["ai", "papers"] }), [
    "ref", "list", "-s", "ready,next,wip", "-A", "-f", "json",
    "-P", "sase", "-t", "ai,papers",
  ]);
  assert.equal(
    readingBoardCacheKey(readingBoardBuildArgs({ parent: "sase" })),
    JSON.stringify(["ref", "list", "-s", "ready,next,wip", "-A", "-f", "json", "-P", "sase"]),
  );
});

test("Reading Board decoder accepts the shared bob fixture and normalizes optional fields", () => {
  assert.equal(fixtureDecoded.ok, true);
  assert.equal(fixtureDecoded.report.schema_version, READING_BOARD_SCHEMA_VERSION);
  assert.equal(fixtureDecoded.report.refs.length, fixtureDocument.refs.length);
  const row = fixtureDecoded.report.refs.find((entry) => entry.path === "ref/papers/two_trackers.md");
  assert.equal(row.type, "papers");
  assert.deepEqual(row.blocked_by, []);
  assert.equal(row.task, null);
  const taskRow = fixtureDecoded.report.refs.find((entry) => entry.path === "ref/papers/blocked_mark.md");
  assert.equal(taskRow.task.priority, null);
  assert.equal(taskRow.task.scheduled, null);
  const audioRow = fixtureDecoded.report.refs.find((entry) => entry.path === "ref/papers/synced_paper.md");
  assert.equal(audioRow.audio, true, "the JSON audio path becomes an audio-presence flag");
  assert.ok(fixtureDecoded.report.generated_at);
});

test("Reading Board audio presence survives raw JSON decoding and model construction", () => {
  const raw = JSON.parse(JSON.stringify(fixtureDocument));
  const row = raw.refs.find((entry) => entry.path === "ref/papers/synced_paper.md");
  assert.equal(row.audio, "lib/papers/synced_paper.mp3");
  const decoded = readingBoardDecodeReport(JSON.stringify(raw), "");
  assert.equal(decoded.ok, true);
  const card = readingBoardModel(decoded.report, { today: "2026-10-20" })
    .lanes.ready.cards.find((entry) => entry.path === row.path);
  assert.equal(card.audio, true);

  row.audio = null;
  const nullAudio = readingBoardDecodeReport(JSON.stringify(raw), "");
  assert.equal(
    readingBoardModel(nullAudio.report, { today: "2026-10-20" }).lanes.ready.cards
      .find((entry) => entry.path === row.path).audio,
    false,
  );
  delete row.audio;
  const absentAudio = readingBoardDecodeReport(JSON.stringify(raw), "");
  assert.equal(
    readingBoardModel(absentAudio.report, { today: "2026-10-20" }).lanes.ready.cards
      .find((entry) => entry.path === row.path).audio,
    false,
  );
});

test("Reading Board decoder rejects malformed JSON, shapes, schema, and bob errors", () => {
  assert.equal(readingBoardDecodeReport("not json", "first stderr").code, "bad-json");
  assert.equal(readingBoardDecodeReport("[]", "").code, "bad-shape");
  assert.equal(
    readingBoardDecodeReport(JSON.stringify({ ok: true, schema_version: 2, refs: [] }), "").code,
    "schema-mismatch",
  );
  assert.equal(
    readingBoardDecodeReport(JSON.stringify({ ok: true, schema_version: 1 }), "").code,
    "bad-shape",
  );
  const bobError = readingBoardDecodeReport(
    JSON.stringify({ ok: false, schema_version: 1, error: { code: "usage", message: "bad filter" } }),
    "",
  );
  assert.equal(bobError.code, "usage");
  assert.equal(bobError.message, "bad filter");
});

test("shared bob spawn passes the vault environment, timeout, and buffer", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      const seen = {};
      const result = await plugin.readingBoardSpawnFetch(readingBoardBuildArgs({}), {
        execFile: (command, args, options, callback) => {
          seen.command = command;
          seen.args = args;
          seen.options = options;
          callback(null, JSON.stringify(fixtureDocument), "");
        },
        resolved: { path: "/home/b/.local/bin/bob", source: "candidate" },
        tried: ["bob candidate"],
        vaultPath: "/fixture-vault",
      });
      assert.equal(result.ok, true);
      assert.equal(seen.command, "/home/b/.local/bin/bob");
      assert.deepEqual(seen.args, readingBoardBuildArgs({}));
      assert.equal(seen.options.env.BOB_DIR, "/fixture-vault");
      assert.equal(seen.options.env.NO_COLOR, "1");
      assert.equal(seen.options.timeout, BOB_SPAWN_TIMEOUT_MS);
      assert.equal(seen.options.maxBuffer, BOB_SPAWN_MAX_BUFFER);
    } finally {
      plugin.onunload();
    }
  });
});

test("shared bob spawn maps missing binary and timeout failures", async () => {
  await withMissingConfig(async () => {
    const plugin = makePlugin();
    try {
      const missing = await plugin.readingBoardSpawnFetch([], {
        execFile: (command, args, options, callback) => {
          const error = new Error("spawn ENOENT");
          error.code = "ENOENT";
          callback(error, "", "");
        },
        resolved: { path: "bob", source: "path" },
        tried: ["bob (PATH)"],
      });
      assert.equal(missing.code, "bob-not-found");
      const timedOut = await plugin.readingBoardSpawnFetch([], {
        execFile: (command, args, options, callback) => {
          const error = new Error("timeout");
          error.killed = true;
          callback(error, "", "first stderr line\nsecond line");
        },
        resolved: { path: "bob", source: "path" },
      });
      assert.equal(timedOut.code, "timeout");
      assert.equal(timedOut.detail, "first stderr line");
    } finally {
      plugin.onunload();
    }
  });
});

test("Reading Board error cards explain not-found, timeout, schema, and bob errors", () => {
  const notFound = readingBoardErrorModel(
    { code: "bob-not-found" },
    { tried: ["/home/b/.local/bin/bob", "bob (PATH)"] },
  );
  assert.match(notFound.hint, /stats\.bob_path/);
  assert.match(notFound.hint, /bob \(PATH\)/);
  const desktopOnly = readingBoardErrorModel({
    code: "bob-not-found",
    message: "Spawning bob needs the desktop app.",
    tried: [],
  });
  assert.equal(desktopOnly.code, "desktop-only");
  assert.match(desktopOnly.title, /needs the desktop app/);
  assert.equal(desktopOnly.retry, false);
  assert.match(readingBoardErrorModel({ code: "timeout" }).title, /timed out/);
  assert.match(readingBoardErrorModel({ code: "schema-mismatch" }).hint, /update bob-cli/i);
  assert.equal(readingBoardErrorModel({ code: "bob-error", message: "No vault" }).hint, "No vault");
});

test("Reading Board cache returns stale data while revalidating and keeps a four-entry LRU", async () => {
  const plugin = makePlugin();
  try {
    let spawns = 0;
    plugin.readingBoardSpawnFetch = async () => {
      spawns += 1;
      return { ok: true, report: fixtureDecoded.report };
    };
    plugin.repaintReadingBoardBlocks = () => {};
    const first = await plugin.apiReadingBoardFetch({ parent: "sase" });
    assert.equal(first.stale, false);
    const second = await plugin.apiReadingBoardFetch({ parent: "sase" });
    assert.equal(second.stale, true);
    await plugin.readingBoardFlight.promise;
    assert.equal(spawns, 2);
    const manual = await plugin.apiReadingBoardRefresh({ parent: "sase" });
    assert.equal(manual.stale, false);
    assert.equal(spawns, 3);

    for (let index = 0; index < READING_BOARD_CACHE_SIZE + 1; index += 1) {
      const result = await plugin.apiReadingBoardFetch({ parent: `note-${index}` });
      assert.equal(result.stale, false);
    }
    assert.equal(plugin.readingBoardCache.size, READING_BOARD_CACHE_SIZE);
  } finally {
    plugin.onunload();
  }
});

test("Reading Board shares identical flights and coalesces one different follow-up", async () => {
  const plugin = makePlugin();
  try {
    let spawns = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    plugin.readingBoardSpawnFetch = async () => {
      spawns += 1;
      if (spawns === 1) {
        await gate;
      }
      return { ok: true, report: fixtureDecoded.report };
    };
    plugin.repaintReadingBoardBlocks = () => {};
    const first = plugin.apiReadingBoardFetch({ parent: "one" });
    const same = plugin.apiReadingBoardFetch({ parent: "one" });
    const queued = plugin.apiReadingBoardFetch({ parent: "two" });
    const queuedAgain = plugin.apiReadingBoardFetch({ parent: "two" });
    release();
    const results = await Promise.all([first, same, queued, queuedAgain]);
    assert.equal(spawns, 2);
    assert.ok(results.every((result) => result.report === fixtureDecoded.report));
  } finally {
    plugin.onunload();
  }
});

test("Reading Board refresh is mounted-only, debounced, and reacts to rollover and stale active leaves", () => {
  const plugin = makePlugin({ load: false });
  const oldWindow = global.window;
  let nextId = 0;
  const timers = new Map();
  global.window = {
    setTimeout(callback, delay) {
      nextId += 1;
      timers.set(nextId, { callback, delay });
      return nextId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  try {
    let refreshes = 0;
    plugin.revalidateReadingBoardBlocks = () => { refreshes += 1; };
    plugin.readingBoardViews = new Set();
    plugin.scheduleReadingBoardRevalidate("unmounted");
    assert.equal(timers.size, 0);

    const view = { sourcePath: "dash_references.md", dataGeneration: 0 };
    plugin.readingBoardViews.add(view);
    plugin.scheduleReadingBoardRevalidate("first");
    const firstTimer = plugin.readingBoardRevalidateTimer;
    plugin.scheduleReadingBoardRevalidate("second");
    assert.equal(timers.has(firstTimer), false);
    assert.equal(timers.get(plugin.readingBoardRevalidateTimer).delay, READING_BOARD_REVALIDATE_DEBOUNCE_MS);
    timers.get(plugin.readingBoardRevalidateTimer).callback();
    assert.equal(refreshes, 1);

    plugin.refreshReadingBoardsForRollover(new Date(2026, 9, 18, 23, 59));
    plugin.refreshReadingBoardsForRollover(new Date(2026, 9, 19, 0, 0));
    assert.ok(plugin.readingBoardRevalidateTimer);
    timers.get(plugin.readingBoardRevalidateTimer).callback();
    assert.equal(refreshes, 2);

    plugin.readingBoardVaultGeneration = 4;
    view.dataGeneration = 3;
    plugin.readingBoardActiveLeafChanged({ view: { file: { path: "dash_references.md" } } });
    assert.ok(plugin.readingBoardRevalidateTimer);
    assert.equal(plugin.readingBoardVaultGeneration, 4);
  } finally {
    plugin.teardownReadingBoardData();
    if (oldWindow === undefined) {
      delete global.window;
    } else {
      global.window = oldWindow;
    }
  }
});
