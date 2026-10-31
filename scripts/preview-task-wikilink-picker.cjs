#!/usr/bin/env node
// Capture the Task Wikilink Picker from production view fragments and
// styles.css in Chromium (dev-only; never part of `npm test`).
//
//   node scripts/preview-task-wikilink-picker.cjs [--out DIRECTORY]
//
// Writes 9 states × 2 widths (900, 600) × 2 themes = 36 PNGs.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const repoRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(repoRoot, "plugins/block-id-prompt");
const srcRoot = path.join(pluginRoot, "src");

const BASELINE = [
  ":root {",
  "  --input-height: 30px;",
  "  --font-interface: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;",
  "  --font-monospace: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;",
  "  --font-ui-smaller: 12px; --font-ui-small: 13px; --font-ui-medium: 15px; --font-ui-large: 20px;",
  "  --font-normal: 400; --font-semibold: 500; --font-bold: 600;",
  "  --radius-s: 4px; --radius-m: 8px; --radius-l: 12px;",
  "  --size-2-1: 2px; --size-2-2: 4px; --size-2-3: 6px;",
  "  --size-4-1: 4px; --size-4-2: 8px; --size-4-3: 12px; --size-4-4: 16px;",
  "  --line-height-normal: 1.5;",
  "}",
  "button { display:inline-flex; align-items:center; justify-content:center; height:var(--input-height); padding:4px 12px; border:1px solid var(--background-modifier-border); border-radius:5px; background:var(--interactive-normal); color:var(--text-normal); font:500 13px var(--font-interface); white-space:nowrap; }",
].join("\n");

const STATES = [
  "grouped",
  "filtered",
  "idless",
  "guarded",
  "completed",
  "indexing",
  "pomodoro",
  "raised",
  "naming",
];
const WIDTHS = [900, 600];
const THEMES = ["light", "dark"];

function parseArgs(argv) {
  const result = { out: path.join(os.tmpdir(), "bob-task-wikilink-preview") };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out" && argv[index + 1]) result.out = path.resolve(argv[++index]);
    else if (argv[index] === "--help" || argv[index] === "-h") {
      console.log("Usage: node scripts/preview-task-wikilink-picker.cjs [--out DIRECTORY]");
      process.exit(0);
    } else throw new Error("Unknown argument: " + argv[index]);
  }
  return result;
}

function findChromium() {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const found = spawnSync("which", [name], { encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  throw new Error("Could not find Chromium. Set CHROMIUM_PATH to a browser executable.");
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function row(overrides) {
  const notePath = overrides.notePath || "Tasks.md";
  const line = overrides.line ?? 0;
  const status = overrides.status ?? " ";
  const open = overrides.open ?? !["x", "X", "-"].includes(status);
  const displayText = overrides.displayText || "Do the thing";
  const blockId = Object.prototype.hasOwnProperty.call(overrides, "blockId")
    ? overrides.blockId
    : "do-the-thing";
  const locator = overrides.locator || notePath.replace(/\.md$/i, "");
  return {
    notePath,
    line,
    rawLine: `- [${status}] #task ${displayText}${blockId ? ` ^${blockId}` : ""}`,
    status,
    blockId,
    hidden: false,
    prjBlocked: false,
    section: overrides.section || "Inbox",
    depth: 0,
    searchText: displayText,
    displayText,
    duplicateId: false,
    open,
    locator,
    linkTarget: overrides.linkTarget || locator.split("/").pop(),
    ...overrides,
  };
}

function vaultRows() {
  return [
    row({
      notePath: "sase_cleanup.md",
      line: 3,
      displayText: "Stop idling when no agents run",
      blockId: "no-idle",
      locator: "sase_cleanup",
      linkTarget: "sase_cleanup",
      section: "Work",
    }),
    row({
      notePath: "sase_cleanup.md",
      line: 8,
      displayText: "Keep the walk parked after a move",
      blockId: "park-walk",
      locator: "sase_cleanup",
      linkTarget: "sase_cleanup",
      section: "Work",
    }),
    row({
      notePath: "Work.md",
      line: 0,
      displayText: "Render the Blender turntable",
      blockId: "turntable",
      status: "/",
      locator: "Work",
      linkTarget: "Work",
      section: "Now",
    }),
    row({
      notePath: "Work.md",
      line: 4,
      displayText: "Ship the picker card",
      blockId: "ship-card",
      status: "*",
      locator: "Work",
      linkTarget: "Work",
      section: "Next",
    }),
    row({
      notePath: "mac_inbox.md",
      line: 12,
      displayText: "Try Opus with Blender. 💡",
      blockId: null,
      locator: "mac_inbox",
      linkTarget: "mac_inbox",
      section: "Inbox",
    }),
    row({
      notePath: "projects/blender.md",
      line: 0,
      displayText: "Finish the turntable lighting",
      blockId: "lighting",
      locator: "projects/blender",
      linkTarget: "blender",
      section: "Build",
    }),
    row({
      notePath: "projects/blender.md",
      line: 6,
      displayText: "Hidden blender leftover",
      blockId: "hidden-blend",
      hidden: true,
      locator: "projects/blender",
      linkTarget: "blender",
      section: "Build",
    }),
    row({
      notePath: "ref/opus-notes.md",
      line: 2,
      displayText: "Read Opus with Blender notes 📖",
      blockId: "opus-notes",
      locator: "ref/opus-notes",
      linkTarget: "opus-notes",
      section: "Reading",
    }),
    row({
      notePath: "areas/deep/nested/path/alpha.md",
      line: 0,
      displayText: "A very long nested note filename must survive truncation",
      blockId: "survive",
      locator: "areas/deep/nested/path/alpha",
      linkTarget: "alpha",
      section: "Notes",
    }),
    row({
      notePath: "jobs.md",
      line: 1,
      displayText: "Launch the application",
      blockId: "launch",
      status: "?",
      locator: "jobs",
      linkTarget: "jobs",
      section: "Hiring",
    }),
    row({
      notePath: "jobs.md",
      line: 2,
      displayText: "Review the application",
      blockId: "review",
      status: "*",
      locator: "jobs",
      linkTarget: "jobs",
      section: "Hiring",
    }),
    row({
      notePath: "done/2026/blender.md",
      line: 0,
      displayText: "Install Blender on athena",
      blockId: "inst",
      status: "x",
      open: false,
      locator: "done/2026/blender",
      linkTarget: "done/2026/blender",
      section: "Archive",
    }),
    row({
      notePath: "done/2026/blender.md",
      line: 4,
      displayText: "Cancelled GPU driver chase",
      blockId: null,
      status: "-",
      open: false,
      locator: "done/2026/blender",
      linkTarget: "done/2026/blender",
      section: "Archive",
    }),
  ];
}

function blockIds() {
  return {
    "sase_cleanup.md": ["no-idle", "park-walk"],
    "Work.md": ["turntable", "ship-card"],
    "mac_inbox.md": [],
    "projects/blender.md": ["lighting", "prj", "hidden-blend"],
    "ref/opus-notes.md": ["opus-notes"],
    "areas/deep/nested/path/alpha.md": ["survive"],
    "jobs.md": ["launch", "review"],
    "done/2026/blender.md": ["inst"],
  };
}

function cases() {
  const rows = vaultRows();
  const source = { sourcePath: "sase_cleanup.md", line: 99, trigger: "((" };
  const pomodoro = { title: "FIX", range: "09:20–09:50" };
  return {
    grouped: {
      rows,
      query: "",
      ownerPath: "sase_cleanup.md",
      source,
      selectedKey: "sase_cleanup.md|3",
      blockIdsByPath: blockIds(),
      now: "2026-10-30T12:00:00",
    },
    filtered: {
      rows,
      query: "opus blen",
      ownerPath: "sase_cleanup.md",
      source,
      selectedKey: "mac_inbox.md|12",
      blockIdsByPath: blockIds(),
      now: "2026-10-30T12:00:00",
    },
    idless: {
      rows,
      query: "",
      ownerPath: "sase_cleanup.md",
      source,
      selectedKey: "mac_inbox.md|12",
      blockIdsByPath: blockIds(),
      now: "2026-10-30T12:00:00",
    },
    guarded: {
      rows,
      query: "",
      ownerPath: "sase_cleanup.md",
      source,
      selectedKey: "done/2026/blender.md|4",
      blockIdsByPath: blockIds(),
      now: "2026-10-30T12:00:00",
    },
    completed: {
      rows,
      query: "blender",
      ownerPath: "sase_cleanup.md",
      source,
      selectedKey: "done/2026/blender.md|0",
      blockIdsByPath: blockIds(),
      now: "2026-10-30T12:00:00",
    },
    indexing: {
      rows: rows.slice(0, 6),
      query: "",
      ownerPath: "sase_cleanup.md",
      source,
      selectedKey: "sase_cleanup.md|3",
      blockIdsByPath: blockIds(),
      progress: { ready: false, scanned: 812, total: 1104 },
      now: "2026-10-30T12:00:00",
    },
    pomodoro: {
      rows,
      query: "",
      ownerPath: "2026/20261030.md",
      source: { sourcePath: "2026/20261030.md", line: 4, trigger: "((" },
      selectedKey: "mac_inbox.md|12",
      blockIdsByPath: blockIds(),
      pomodoroContext: pomodoro,
      pomodoroDetail: {
        typeClause: "type becomes FIX",
        scheduledDate: "Nov 4",
        scheduleLogPresent: true,
      },
      now: "2026-10-30T12:00:00",
    },
    raised: {
      rows,
      query: "",
      ownerPath: "2026/20261030.md",
      source: { sourcePath: "2026/20261030.md", line: 4, trigger: "((" },
      selectedKey: "jobs.md|2",
      blockIdsByPath: blockIds(),
      pomodoroContext: pomodoro,
      pomodoroDetail: { waitingOn: 0, typeClause: "keeps WRITE" },
      pomodoroRaised: {
        taskTitle: "Launch the application",
        banner: "Raised 2 prerequisites to Next · pick one to link",
        rows: [
          row({
            notePath: "jobs.md",
            line: 2,
            displayText: "Review the application",
            blockId: "review",
            status: "*",
            locator: "jobs",
            linkTarget: "jobs",
            section: "Hiring",
          }),
        ],
      },
      now: "2026-10-30T12:00:00",
    },
    naming: {
      kind: "naming",
      suggestion: "try-opus-blender",
      notePath: "mac_inbox.md",
      targetText: "mac_inbox",
      preview: "Try Opus with Blender. 💡",
      validation: "",
    },
  };
}

function makeHtml() {
  const template = fs.readFileSync(path.join(__dirname, "preview-task-wikilink-picker.template.html"), "utf8");
  return template
    .replace("__OBSIDIAN_BASELINE_CSS__", () => BASELINE)
    .replace("__PRODUCTION_CSS__", () => fs.readFileSync(path.join(pluginRoot, "styles.css"), "utf8"))
    .replace("__NAMING_SOURCE__", () => fs.readFileSync(path.join(srcRoot, "015-prompt-block-id-naming.js"), "utf8"))
    .replace("__RULES_SOURCE__", () => fs.readFileSync(path.join(srcRoot, "031-task-wikilink-rules.js"), "utf8"))
    .replace("__RANK_SOURCE__", () => fs.readFileSync(path.join(srcRoot, "032-task-wikilink-rank.js"), "utf8"))
    .replace("__VIEW_SOURCE__", () => fs.readFileSync(path.join(srcRoot, "088-task-wikilink-picker-view.js"), "utf8"))
    .replace("__POMODORO_VIEW_SOURCE__", () => fs.readFileSync(path.join(srcRoot, "089-task-wikilink-picker-pomodoro-view.js"), "utf8"))
    .replace("__CASES_JSON__", () => safeJson(cases()));
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const wait = this.pending.get(message.id);
      if (!wait) return;
      this.pending.delete(message.id);
      if (message.error) wait.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else wait.resolve(message.result || {});
    });
  }

  static async connect(endpoint) {
    let Socket = typeof globalThis.WebSocket === "function" ? globalThis.WebSocket : null;
    if (!Socket) Socket = require("undici").WebSocket;
    const socket = new Socket(endpoint);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new CdpClient(socket);
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    }
    return response.result && response.result.value;
  }
}

async function waitFor(file, child, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(file)) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("Chromium exited before publishing its DevTools port (exit " + child.exitCode + ", signal " + child.signalCode + ").");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for Chromium's DevTools port file.");
}

async function capture(client, output) {
  await client.evaluate("document.fonts && document.fonts.ready");
  await client.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const metrics = await client.call("Page.getLayoutMetrics");
  const width = Math.ceil(metrics.cssContentSize.width);
  const height = Math.ceil(metrics.cssContentSize.height);
  const screenshot = await client.call("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  fs.writeFileSync(output, Buffer.from(screenshot.data, "base64"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });
  const htmlFile = path.join(args.out, "index.html");
  fs.writeFileSync(htmlFile, makeHtml());
  const chromium = findChromium();
  const profileRoot = fs.existsSync("/home/bryan/.cache") ? "/home/bryan/.cache" : os.tmpdir();
  const profile = fs.mkdtempSync(path.join(profileRoot, "bob-twl-preview-"));
  const child = spawn(chromium, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--force-color-profile=srgb",
    "--remote-debugging-port=0",
    "--user-data-dir=" + profile,
    "about:blank",
  ], { stdio: "ignore", env: { ...process.env, TMPDIR: "/tmp" } });
  let client = null;
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    await waitFor(portFile, child);
    const port = fs.readFileSync(portFile, "utf8").split(/\s+/)[0];
    const pages = await fetch("http://127.0.0.1:" + port + "/json/list").then((response) => response.json());
    const page = pages.find((item) => item.type === "page");
    if (!page) throw new Error("Chromium did not publish a DevTools page.");
    client = await CdpClient.connect(page.webSocketDebuggerUrl);
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await client.call("Page.navigate", { url: pathToFileURL(htmlFile).href });
    const start = Date.now();
    while (Date.now() - start < 15000) {
      if (await client.evaluate("Boolean(window.taskWikilinkPreviewReady)")) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!(await client.evaluate("Boolean(window.taskWikilinkPreviewReady)"))) {
      throw new Error("Preview page did not become ready.");
    }
    const screenshots = [];
    for (const theme of THEMES) {
      for (const width of WIDTHS) {
        await client.call("Emulation.setDeviceMetricsOverride", {
          width: Math.max(width + 80, 980),
          height: 900,
          deviceScaleFactor: 1,
          mobile: false,
        });
        for (const state of STATES) {
          await client.evaluate(
            `window.taskWikilinkPreview.render(${JSON.stringify(theme)}, ${JSON.stringify(state)}, ${width})`,
          );
          const output = path.join(args.out, `twl-${state}-${width}-${theme}.png`);
          await capture(client, output);
          screenshots.push(output);
        }
      }
    }
    const report = [
      "# Task Wikilink Picker preview",
      "",
      "Rendered from production view fragments (`088`, `089`, `015`, `031`, `032`) plus `styles.css` under Obsidian light and dark variables.",
      "",
      "Matrix: 9 states × 2 widths (900, 600) × 2 themes = 36 PNGs.",
      "",
      ...STATES.map((state) => `- ${state}`),
      "",
      ...screenshots.map((file) => "- " + path.basename(file)),
      "",
    ].join("\n");
    fs.writeFileSync(path.join(args.out, "matrix-report.md"), report);
    if (screenshots.length !== 36) {
      throw new Error(`expected 36 screenshots, wrote ${screenshots.length}`);
    }
    console.log(JSON.stringify({ output: args.out, html: htmlFile, chromium, count: screenshots.length, screenshots: screenshots.map((file) => path.basename(file)) }, null, 2));
  } finally {
    if (client) client.socket.close();
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once("exit", resolve);
    });
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold Default/ */ }
  }
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
