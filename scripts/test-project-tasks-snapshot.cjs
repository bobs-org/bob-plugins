const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const notices = [];

class MockTFile {
  constructor(filePath, extension = "md") {
    this.path = filePath;
    this.extension = extension;
    this.basename = path.posix.basename(filePath, `.${extension}`);
  }
}

class MockPlugin {
  constructor() {
    this.commands = [];
  }

  addCommand(command) {
    this.commands.push(command);
  }

  registerEvent() {}

  register() {}
}

class MockNotice {
  constructor(message, duration) {
    this.message = message;
    this.duration = duration;
    this.hidden = false;
    notices.push(this);
  }

  hide() {
    this.hidden = true;
  }
}

const mockObsidian = {
  Notice: MockNotice,
  Platform: { isDesktopApp: true },
  Plugin: MockPlugin,
  TFile: MockTFile,
};

const originalLoad = Module._load;
Module._load = function loadWithObsidian(request, parent, isMain) {
  if (request === "obsidian") {
    return mockObsidian;
  }
  return originalLoad.call(this, request, parent, isMain);
};
let BobProjectTasksPlugin;
try {
  BobProjectTasksPlugin = require(
    "../plugins/bob-project-tasks/main.js",
  );
} finally {
  Module._load = originalLoad;
}

function makePlugin(activeFile) {
  const plugin = new BobProjectTasksPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => activeFile },
    plugins: { plugins: {} },
    vault: { adapter: { basePath: "/vault" } },
    metadataCache: { on: () => ({}) },
  };
  plugin.onload();
  return plugin;
}

test.afterEach(() => {
  notices.length = 0;
  mockObsidian.Platform.isDesktopApp = true;
});

test("snapshot commands are available only for active Markdown files", () => {
  const plugin = makePlugin(new MockTFile("area/sase_blog.md"));
  const commands = plugin.commands.filter((command) =>
    command.id.startsWith("snapshot-note-to-highlights"),
  );

  assert.deepEqual(
    commands.map((command) => command.name),
    [
      "Snapshot note to Highlights",
      "Snapshot note to Highlights (with closed tasks)",
    ],
  );
  assert.equal(commands[0].checkCallback(true), true);
  const nonMarkdownPlugin = makePlugin(new MockTFile("image.png", "png"));
  const nonMarkdownCommand = nonMarkdownPlugin.commands.find(
    (command) => command.id === "snapshot-note-to-highlights",
  );
  assert.equal(nonMarkdownCommand.checkCallback(true), false);
});

test("commands run bob ref create on the active path, with -C for closed tasks", async () => {
  const plugin = makePlugin(new MockTFile("area/sase_blog.md"));
  const commands = plugin.commands.filter((command) =>
    command.id.startsWith("snapshot-note-to-highlights"),
  );
  const calls = [];
  plugin.snapshotSpawnBob = async (args) => {
    calls.push(args);
    return {
      ok: true,
      stdout: "pdf: lib/notes/sase_blog_261016.pdf\nnext: bob ref scan\n",
      stderr: "",
    };
  };

  commands[0].checkCallback(false);
  commands[1].checkCallback(false);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, [
    ["ref", "create", "area/sase_blog.md"],
    ["ref", "create", "area/sase_blog.md", "-C"],
  ]);
  assert.ok(notices.some((notice) => notice.message.includes("Snapshotting sase_blog…")));
  assert.ok(
    notices.some((notice) =>
      notice.message.includes("pdf: lib/notes/sase_blog_261016.pdf") &&
      notice.message.includes("next: bob ref scan"),
    ),
  );
  assert.ok(notices.filter((notice) => notice.message.startsWith("Snapshotting ")).every((notice) => notice.hidden));
});

test("bob spawn uses the resolved path, vault environment, timeout, and NO_COLOR", async () => {
  const plugin = makePlugin(new MockTFile("sase_blog.md"));
  const seen = {};
  const result = await plugin.snapshotSpawnBob(["ref", "create", "sase_blog.md"], {
    resolved: { path: "/home/b/.cargo/bin/bob", source: "candidate" },
    execFile: (binary, args, options, callback) => {
      seen.binary = binary;
      seen.args = args;
      seen.options = options;
      callback(null, "pdf: lib/notes/sase_blog.pdf\nnext: bob ref scan\n", "");
    },
  });

  assert.equal(result.ok, true);
  assert.equal(seen.binary, "/home/b/.cargo/bin/bob");
  assert.deepEqual(seen.args, ["ref", "create", "sase_blog.md"]);
  assert.equal(seen.options.env.BOB_DIR, "/vault");
  assert.equal(seen.options.env.NO_COLOR, "1");
  assert.equal(seen.options.timeout, 120000);
  assert.ok(seen.options.maxBuffer >= 1024 * 1024);
});

test("failure notices retain bob error and hint lines verbatim", async () => {
  const plugin = makePlugin(new MockTFile("sase_blog.md"));
  plugin.snapshotSpawnBob = async () => ({
    ok: false,
    stdout: "",
    stderr: "ref create: error: missing pandoc\nhint: install pandoc\n",
  });

  await plugin.snapshotActiveNote(new MockTFile("sase_blog.md"), false);

  assert.ok(
    notices.some(
      (notice) =>
        notice.message ===
        "ref create: error: missing pandoc\nhint: install pandoc",
    ),
  );
});

test("off desktop, bob spawning is refused with the desktop-app explanation", async () => {
  mockObsidian.Platform.isDesktopApp = false;
  const plugin = makePlugin(new MockTFile("sase_blog.md"));
  let called = false;
  const result = await plugin.snapshotSpawnBob(["ref", "create", "sase_blog.md"], {
    execFile: () => {
      called = true;
    },
  });

  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.message, "Spawning bob needs the desktop app.");
});
