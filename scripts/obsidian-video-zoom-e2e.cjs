#!/usr/bin/env node
// Real-Obsidian e2e for inline video sizing and Z media dispatch.
// Runs only in an owned scratch vault and removes its process and files.
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const smoke = require("./obsidian-startup-smoke-lib.cjs");
const lib = require("./obsidian-video-zoom-e2e-lib.cjs");

const repoRoot = path.resolve(__dirname, "..");
const NOTE_PATH = "video-zoom-e2e.md";
const VIEWER_PROBE = `(() => {
  const plugin = window.app && window.app.plugins && window.app.plugins.plugins && window.app.plugins.plugins["bob-navigation-hotkeys"];
  const modal = plugin && plugin.activeImageZoomModal;
  const video = modal && modal.imgEl;
  if (!modal || !video) return null;
  return {
    title: modal.imageTitle || "",
    path: modal.imageZoomContext && modal.imageZoomContext.vaultPath || "",
    ready: Boolean(modal.videoZoomReady),
    hasAudio: Boolean(modal.videoZoomHasAudio),
    failed: Boolean(modal.videoZoomFailed),
    paused: Boolean(video.paused),
    currentTime: Number(video.currentTime || 0),
    duration: Number(video.duration || 0),
    readyState: Number(video.readyState || 0),
    playbackRate: Number(video.playbackRate || 1),
    muted: Boolean(video.muted),
    fullscreen: Boolean(document.fullscreenElement),
    source: video.getAttribute("src"),
    failureCard: Boolean(modal.containerEl && modal.containerEl.querySelector(".bob-video-zoom-failure")),
    scrubber: Boolean(modal.containerEl && modal.containerEl.querySelector(".bob-video-zoom-scrubber:not(.is-hidden)")),
    flashVisible: Boolean(modal.containerEl && modal.containerEl.querySelector(".bob-video-zoom-flash.is-visible")),
    readout: (modal.readoutEl && modal.readoutEl.textContent) || "",
    classes: modal.contentEl && modal.contentEl.className || ""
  };
})()`;

function runSelfTest() {
  const parsed = lib.parseArgs(["--self-test"]);
  if (!parsed.selfTest) throw new Error("--self-test was not parsed");
  const note = lib.videoZoomNote("/tmp/video-source.mp4");
  for (const required of [
    "![[vid/silent.mp4|400]]",
    "![[vid/audible.mp4|400]]",
    "![[vid/clip.webm]]",
    "[[file/legacy.mp4]]",
    "![[vid/corrupt.mp4]]",
    "- /tmp/video-source.mp4",
  ]) {
    if (!note.includes(required)) throw new Error(`fixture note is missing ${required}`);
  }
  if (!note.includes("- ")) throw new Error("fixture note needs a path-only bullet");
  console.log("offline self-test complete (not an Obsidian pass)");
}

function assertResult(result, label) {
  if (!result || result.ok !== true) {
    throw new Error(`${label}: ${result && result.error ? result.error : "operation failed"}`);
  }
}

async function startViewer(client, needle) {
  const opened = await lib.openNote(client, NOTE_PATH, "source");
  assertResult(opened, "open source note");
  const cursor = await lib.placeCaretOn(client, needle);
  assertResult(cursor, `place cursor on ${needle}`);
  const command = await lib.executeZoomCommand(client);
  assertResult(command, "execute zoom-image-on-line");
  return cursor;
}

async function closeViewer(client) {
  const present = await client.evaluate(VIEWER_PROBE).catch(() => null);
  if (!present) return;
  await lib.dispatchKey(client, "Escape");
  await lib.waitFor(
    client,
    VIEWER_PROBE,
    (value) => value === null,
    "video viewer close",
    5000,
  );
}

async function runCase(client, cases, name, run) {
  try {
    const detail = await run();
    cases.push({ name, status: "pass", detail: detail || "" });
    console.log(`PASS ${name}${detail ? ` (${detail})` : ""}`);
  } catch (error) {
    const detail = error && error.message ? error.message : String(error);
    cases.push({ name, status: "fail", detail });
    console.error(`FAIL ${name}: ${detail}`);
  }
  finally {
    try { await closeViewer(client); } catch { /* cleanup is best effort after a recorded failure */ }
  }
}

async function runE2e(args) {
  if (!process.env.DISPLAY) {
    lib.fail("unrun: no X display; run under xvfb-run -a node scripts/obsidian-video-zoom-e2e.cjs", 2);
  }
  const ffmpegProbe = spawnSync("ffmpeg", ["-version"], { encoding: "utf8", timeout: 10_000 });
  if (ffmpegProbe.error || ffmpegProbe.status !== 0) {
    lib.fail("unrun: ffmpeg is unavailable; install ffmpeg before the real-Obsidian video e2e", 2);
  }
  const executable = lib.findExecutable(args.executable, "OBSIDIAN_BIN", "/snap/bin/obsidian");
  const executableProbe = lib.probeObsidian(executable);
  if (!executableProbe.ok) {
    lib.fail(`unrun: ${executableProbe.reason}; run on a host with Obsidian Electron`, 2);
  }
  const bobBin = process.env.BOB_BIN ? path.resolve(process.env.BOB_BIN) : "";
  if (bobBin) {
    try { fs.accessSync(bobBin, fs.constants.X_OK); }
    catch { lib.fail(`BOB_BIN is not executable: ${bobBin}`, 2); }
  }

  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bob-video-zoom-e2e-"));
  const vaultDir = path.join(runRoot, "vault");
  const profileDir = path.join(runRoot, "profile");
  const homeDir = path.join(runRoot, "home");
  const importSourcePath = path.join(runRoot, "outside", "import-source.mp4");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  const cases = [];
  let child = null;
  let client = null;
  let exitInfo = "";
  let childOutput = "";
  try {
    lib.generateMediaFixtures("ffmpeg", vaultDir, importSourcePath);
    fs.writeFileSync(path.join(vaultDir, NOTE_PATH), lib.videoZoomNote(importSourcePath));
    const enabled = lib.installPlugins(vaultDir, repoRoot, Boolean(bobBin));
    lib.seedProfile(profileDir, fs.realpathSync(vaultDir));

    const cdpPort = await lib.freePort();
    const env = { ...process.env, BOB_DIR: fs.realpathSync(vaultDir), TMPDIR: os.tmpdir() };
    delete env.ELECTRON_RUN_AS_NODE;
    if (bobBin) {
      const bobCandidateDir = path.join(homeDir, ".cargo", "bin");
      fs.mkdirSync(bobCandidateDir, { recursive: true });
      fs.symlinkSync(bobBin, path.join(bobCandidateDir, "bob"));
      // bob-ledger-tools follows its production discovery order, beginning at
      // $HOME/.cargo/bin. Give this isolated app profile its own Home so it
      // resolves the exact CLI under test instead of the host's installed Bob.
      env.HOME = homeDir;
      env.BOB_BIN = bobBin;
    }
    child = spawn(executable, [
      "--no-sandbox",
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${cdpPort}`,
      "--remote-allow-origins=http://127.0.0.1/*",
      fs.realpathSync(vaultDir),
    ], { cwd: vaultDir, env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => { childOutput = (childOutput + chunk.toString()).slice(-8000); });
    child.stderr.on("data", (chunk) => { childOutput = (childOutput + chunk.toString()).slice(-8000); });
    child.once("exit", (code, signal) => { exitInfo = `code=${code} signal=${signal || "none"}`; });

    const target = await lib.selectOwnedTarget(cdpPort, fs.realpathSync(vaultDir), () => Boolean(exitInfo));
    client = await lib.CdpClient.connect(target.webSocketDebuggerUrl);
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await lib.waitFor(
      client,
      "Boolean(window.app && window.app.workspace && window.app.workspace.layoutReady)",
      Boolean,
      "Obsidian layout",
      30_000,
    );
    // Obsidian stores the profile-wide community-plugin consent in localStorage.
    // A fresh isolated profile has no Settings UI history, so set that same flag
    // and ask Obsidian's plugin manager to load the enabled fixture plugins.
    await client.evaluate(`(() => (async () => {
      const app = window.app;
      const plugins = app && app.plugins;
      if (!plugins) throw new Error("Obsidian plugin manager unavailable");
      if (!plugins.isEnabled()) {
        localStorage.setItem("enable-plugin-" + app.appId, "true");
        for (const id of ${JSON.stringify(enabled)}) await plugins.loadPlugin(id);
      }
      return Object.keys(plugins.plugins || {});
    })())()`);
    try {
      await lib.waitFor(
        client,
        `Boolean(window.app.plugins.plugins && window.app.plugins.plugins["bob-navigation-hotkeys"])`,
        Boolean,
        "navigation hotkeys plugin",
        15_000,
      );
    } catch (error) {
      const state = await client.evaluate(`(() => {
        const plugins = window.app && window.app.plugins;
        const manifest = plugins && plugins.manifests && plugins.manifests["bob-navigation-hotkeys"] || null;
        const enabled = plugins && plugins.enabledPlugins;
        return {
          keys: plugins ? Object.keys(plugins) : [],
          loaded: plugins ? Object.keys(plugins.plugins || {}) : [],
          enabled: enabled ? Array.from(enabled) : [],
          enabledGlobally: plugins && typeof plugins.isEnabled === "function" ? plugins.isEnabled() : null,
          manifest: manifest ? { id: manifest.id, version: manifest.version, minAppVersion: manifest.minAppVersion, dir: manifest.dir } : null,
          userAgent: navigator.userAgent
        };
      })()`);
      throw new Error(`${error.message}; Obsidian plugin state=${JSON.stringify(state)}; renderer errors=${JSON.stringify(client.events)}; process output=${childOutput}`);
    }
    if (bobBin) {
      await lib.waitFor(
        client,
        `Boolean(window.app.plugins.plugins && window.app.plugins.plugins["bob-ledger-tools"] && window.app.plugins.plugins["bob-ledger-tools"].api && window.app.plugins.plugins["bob-ledger-tools"].api.attachments)`,
        Boolean,
        "bob-ledger-tools attachments API",
        30_000,
      );
    }
    await lib.sleep(1200);
    await client.evaluate(`(() => {
      window.__bobVideoZoomNotices = [];
      new MutationObserver(() => {
        const notices = [...document.querySelectorAll(".notice")].map((item) => item.textContent.trim()).filter(Boolean);
        for (const notice of notices) {
          if (window.__bobVideoZoomNotices[window.__bobVideoZoomNotices.length - 1] !== notice) window.__bobVideoZoomNotices.push(notice);
        }
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    })()`);
    console.log(`Scratch vault plugins: ${enabled.join(", ")}`);

    await runCase(client, cases, "inline video width is 400 px", async () => {
      const opened = await lib.openNote(client, NOTE_PATH, "preview");
      assertResult(opened, "open Reading view");
      const measured = await lib.waitFor(
        client,
        `(() => {
          const video = [...document.querySelectorAll(".internal-embed.video-embed > video")]
            .find((item) => /silent\\.mp4(?:$|[?#])/.test(String(item.currentSrc || item.src || "")));
          return video ? {
            width: video.clientWidth,
            computedWidth: getComputedStyle(video).width,
            rectWidth: video.getBoundingClientRect().width,
            parentWidth: video.parentElement && video.parentElement.clientWidth,
            attr: video.parentElement && video.parentElement.getAttribute("width"),
            parentClass: video.parentElement && video.parentElement.className,
            source: video.currentSrc || video.src
          } : null;
        })()`,
        (value) => value && value.computedWidth !== "0px",
        "inline video render",
        15_000,
      );
      if (measured.computedWidth !== "400px") throw new Error(`expected 400 px, got ${JSON.stringify(measured)}`);
      return `computed width=${measured.computedWidth}; client width=${measured.width}`;
    });

    await runCase(client, cases, "silent H.264 opens in Z and advances", async () => {
      await startViewer(client, "Silent:");
      const state = await lib.waitFor(client, VIEWER_PROBE, (value) => value && value.ready && !value.paused && value.currentTime > 0.25, "silent video autoplay", 15_000);
      if (!String(state.classes).includes("bob-video-zoom")) throw new Error(`video modal class missing: ${state.classes}`);
      await closeViewer(client);
      return `currentTime=${state.currentTime.toFixed(2)}s`;
    });

    await runCase(client, cases, "audible H.264 opens paused", async () => {
      await startViewer(client, "Audible:");
      const state = await lib.waitFor(client, VIEWER_PROBE, (value) => value && value.ready && value.hasAudio, "audible video metadata", 15_000);
      if (!state.paused) throw new Error("audible clip started playing");
      await closeViewer(client);
      return "audio detected; paused at open";
    });

    await runCase(client, cases, "Space toggles playback and Right seeks", async () => {
      await startViewer(client, "Audible:");
      await lib.waitFor(client, VIEWER_PROBE, (value) => value && value.ready && value.hasAudio && value.paused, "audible paused video", 15_000);
      await lib.dispatchKey(client, " ");
      await lib.waitFor(client, VIEWER_PROBE, (value) => value && !value.paused, "Space playback", 5000);
      await lib.dispatchKey(client, " ");
      const before = await lib.waitFor(client, VIEWER_PROBE, (value) => value && value.paused, "Space pause", 5000);
      await lib.dispatchKey(client, "ArrowRight");
      const after = await lib.waitFor(client, VIEWER_PROBE, (value) => value && value.currentTime >= before.currentTime + 0.85, "Right seek", 5000);
      await closeViewer(client);
      return `seek ${before.currentTime.toFixed(1)}s → ${after.currentTime.toFixed(1)}s`;
    });

    await runCase(client, cases, "period steps exactly one frame", async () => {
      await startViewer(client, "Audible:");
      await lib.waitFor(client, VIEWER_PROBE, (value) => value && value.ready && value.hasAudio && value.paused, "audible paused video", 15_000);
      await lib.dispatchKey(client, ".");
      const first = await lib.waitFor(client, VIEWER_PROBE, (value) => value && value.currentTime > 0.01, "first frame step", 5000);
      await lib.dispatchKey(client, ".");
      const second = await lib.waitFor(client, VIEWER_PROBE, (value) => value && value.currentTime > first.currentTime + 0.005, "second frame step", 5000);
      const delta = second.currentTime - first.currentTime;
      if (Math.abs(delta - 1 / 30) > 0.012) throw new Error(`expected one 30fps frame, got ${delta}`);
      if (!second.paused) throw new Error("frame stepping resumed playback");
      await closeViewer(client);
      return `step ${delta.toFixed(4)}s`;
    });

    await runCase(client, cases, "right bracket raises the speed to 1.25x", async () => {
      await startViewer(client, "Audible:");
      await lib.waitFor(client, VIEWER_PROBE, (value) => value && value.ready && value.hasAudio && value.paused, "audible paused video", 15_000);
      await lib.dispatchKey(client, "]");
      const state = await lib.waitFor(client, VIEWER_PROBE, (value) => value && value.playbackRate === 1.25, "1.25x speed", 5000);
      if (!String(state.readout).includes("1.25×")) throw new Error(`readout misses the rate: ${state.readout}`);
      await closeViewer(client);
      return `playbackRate=${state.playbackRate}`;
    });

    await runCase(client, cases, "m toggles mute on the audible clip", async () => {
      await startViewer(client, "Audible:");
      await lib.waitFor(client, VIEWER_PROBE, (value) => value && value.ready && value.hasAudio && value.paused, "audible paused video", 15_000);
      await lib.dispatchKey(client, "m");
      await lib.waitFor(client, VIEWER_PROBE, (value) => value && value.muted === true, "mute on", 5000);
      await lib.dispatchKey(client, "m");
      await lib.waitFor(client, VIEWER_PROBE, (value) => value && value.muted === false, "mute off", 5000);
      await closeViewer(client);
      return "muted then unmuted";
    });

    await runCase(client, cases, "f enters fullscreen and Esc leaves it with the viewer open", async () => {
      await startViewer(client, "Audible:");
      await lib.waitFor(client, VIEWER_PROBE, (value) => value && value.ready, "video ready", 15_000);
      await lib.dispatchKey(client, "f");
      await lib.waitFor(client, VIEWER_PROBE, (value) => value && value.fullscreen === true, "fullscreen on", 5000);
      await lib.dispatchKey(client, "Escape");
      const state = await lib.waitFor(client, VIEWER_PROBE, (value) => value && value.fullscreen === false, "fullscreen off", 5000);
      if (!state) throw new Error("viewer closed along with fullscreen");
      await closeViewer(client);
      return "fullscreen on; Esc exited first";
    });

    await runCase(client, cases, "scrubber drag seeks", async () => {
      await startViewer(client, "Audible:");
      const ready = await lib.waitFor(client, VIEWER_PROBE, (value) => value && value.ready && value.hasAudio && value.paused, "audible paused video", 15_000);
      if (!ready.scrubber) throw new Error("transport scrubber is missing");
      const rect = await client.evaluate(`(() => {
        const el = document.querySelector(".bob-video-zoom-scrubber");
        if (!el) return null;
        const box = el.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      })()`);
      if (!rect || !(rect.width > 0)) throw new Error("scrubber is not laid out");
      const y = rect.y + rect.height / 2;
      await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x + rect.width * 0.2, y, button: "left", clickCount: 1 });
      await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x + rect.width * 0.8, y, button: "left", buttons: 1 });
      await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x + rect.width * 0.8, y, button: "left", clickCount: 1 });
      const state = await lib.waitFor(client, VIEWER_PROBE, (value) => value && value.currentTime > 3, "scrubber seek", 5000);
      await closeViewer(client);
      return `drag seeked to ${state.currentTime.toFixed(1)}s`;
    });

    await runCase(client, cases, "reduced motion shows no flash", async () => {
      await client.evaluate(`(() => {
        if (window.__bobVideoZoomMatchMedia) return "already stubbed";
        window.__bobVideoZoomMatchMedia = window.matchMedia.bind(window);
        window.matchMedia = (query) => String(query).indexOf("prefers-reduced-motion") >= 0
          ? { matches: true, media: String(query), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } }
          : window.__bobVideoZoomMatchMedia(query);
        return "stubbed";
      })()`);
      try {
        await startViewer(client, "Audible:");
        await lib.waitFor(client, VIEWER_PROBE, (value) => value && value.ready && value.hasAudio && value.paused, "reduced-motion paused video", 15_000);
        const state = await client.evaluate(VIEWER_PROBE);
        if (state.flashVisible) throw new Error("flash showed under reduced motion");
      } finally {
        await client.evaluate(`(() => {
          if (window.__bobVideoZoomMatchMedia) {
            window.matchMedia = window.__bobVideoZoomMatchMedia;
            delete window.__bobVideoZoomMatchMedia;
          }
          return "restored";
        })()`);
        await closeViewer(client);
      }
      return "no flash while paused under reduced motion";
    });

    await runCase(client, cases, "VP9 WebM opens and plays", async () => {
      await startViewer(client, "WebM:");
      const state = await lib.waitFor(client, VIEWER_PROBE, (value) => value && value.ready && !value.paused && value.currentTime > 0.1, "WebM playback", 15_000);
      await closeViewer(client);
      return `currentTime=${state.currentTime.toFixed(2)}s`;
    });

    await runCase(client, cases, "legacy file/ video link opens in Z", async () => {
      await startViewer(client, "Legacy:");
      const state = await lib.waitFor(client, VIEWER_PROBE, (value) => value && value.ready && !value.paused && value.currentTime > 0.1, "legacy video playback", 15_000);
      if (state.path !== "file/legacy.mp4") throw new Error(`legacy path resolved to ${state.path}`);
      await closeViewer(client);
      return "legacy plain wikilink played";
    });

    await runCase(client, cases, "corrupt video shows failure and close releases the decoder", async () => {
      const cursor = await startViewer(client, "Corrupt:");
      await lib.waitFor(client, VIEWER_PROBE, (value) => value && value.failed && value.failureCard, "in-place failure card", 15_000);
      const beforeClose = await client.evaluate(`(() => {
        const plugin = window.app.plugins.plugins["bob-navigation-hotkeys"];
        const view = window.app.workspace.activeLeaf.view;
        window.__bobVideoZoomLastVideo = plugin.activeImageZoomModal.imgEl;
        return { line: cursorLine(view.editor.getValue()), cursor: view.editor.getCursor("head") };
        function cursorLine(text) { return String(text).split("\\n")[view.editor.getCursor("head").line] || ""; }
      })()`);
      await lib.dispatchKey(client, "Escape");
      await lib.waitFor(client, VIEWER_PROBE, (value) => value === null, "failed viewer close", 5000);
      await lib.sleep(180);
      const after = await client.evaluate(`(() => {
        const view = window.app.workspace.activeLeaf.view;
        const video = window.__bobVideoZoomLastVideo;
        return {
          source: video && video.getAttribute("src"),
          connected: Boolean(video && video.isConnected),
          cursor: view.editor.getCursor("head"),
          line: String(view.editor.getValue()).split("\\n")[view.editor.getCursor("head").line] || ""
        };
      })()`);
      if (after.source) throw new Error(`video src was not cleared: ${after.source}`);
      if (after.cursor.line !== cursor.line || after.cursor.ch !== cursor.ch) throw new Error("editor cursor was not restored");
      if (after.line !== beforeClose.line) throw new Error("source note changed while viewing the corrupt video");
      return "failure card stayed open; src cleared and cursor restored";
    });

    if (bobBin) {
      await runCase(client, cases, "path bullet imports video and r restores it", async () => {
        await startViewer(client, importSourcePath);
        const state = await lib.waitFor(
          client,
          `(() => {
            const plugin = window.app.plugins.plugins["bob-navigation-hotkeys"];
            const ledger = window.app.plugins.plugins["bob-ledger-tools"];
            const view = window.app.workspace.activeLeaf.view;
            const modal = plugin && plugin.activeImageZoomModal;
            return {
              text: view.editor.getValue(),
              video: Boolean(modal && modal.imgEl && modal.imgEl.tagName === "VIDEO"),
              path: modal && modal.imageZoomContext && modal.imageZoomContext.vaultPath || "",
              importing: Boolean(plugin && plugin.imageZoomImporting),
              attachments: Boolean(ledger && ledger.api && ledger.api.attachments),
              notices: window.__bobVideoZoomNotices || [],
              bobPath: ledger && ledger.api && ledger.api.stats && ledger.api.stats.bobPath ? ledger.api.stats.bobPath() : null,
              home: window.require && window.require("os").homedir(),
              homeEnv: window.require && window.require("process").env.HOME
            };
          })()`,
          (value) => value && value.video && value.text.includes("![[vid/import-source.mp4|400]]"),
          "video path import",
          30_000,
        );
        if (state.path !== "vid/import-source.mp4") throw new Error(`imported path is ${state.path}`);
        await lib.dispatchKey(client, "r");
        await lib.waitFor(
          client,
          `window.app.workspace.activeLeaf.view.editor.getValue()`,
          (value) => value.includes(importSourcePath),
          "r restores imported path",
          15_000,
        );
        if (!fs.existsSync(path.join(vaultDir, state.path))) throw new Error(`vault copy missing: ${state.path}`);
        await closeViewer(client);
        return `${state.path} imported and restored`;
      });
    } else {
      cases.push({ name: "path bullet imports video and r restores it", status: "skip", detail: "set BOB_BIN to a bob-cli master executable" });
      console.log("UNRUN path bullet import: set BOB_BIN to a bob-cli master executable");
    }

    const report = {
      executable,
      vault: fs.realpathSync(vaultDir),
      bobBin: bobBin || null,
      cases,
      pass: cases.every((item) => item.status !== "fail"),
    };
    if (args.report) {
      const reportPath = path.resolve(args.report);
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    }
    console.log(JSON.stringify({ pass: report.pass, failed: cases.filter((item) => item.status === "fail").map((item) => item.name), skipped: cases.filter((item) => item.status === "skip").map((item) => item.name) }, null, 2));
    if (!report.pass) lib.fail(`e2e failed: ${cases.filter((item) => item.status === "fail").map((item) => item.name).join(", ")}`);
  } finally {
    if (client) client.close();
    if (child) {
      try { if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM"); } catch { /* already exited */ }
      await new Promise((resolve) => {
        if (child.exitCode != null || child.signalCode != null) return resolve();
        const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve(); }, 4000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    }
    for (const target of smoke.planOwnedCleanup([runRoot], [runRoot]).removable) {
      try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
}

async function main() {
  const args = lib.parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(lib.HELP_TEXT);
    return;
  }
  if (args.selfTest) {
    runSelfTest();
    return;
  }
  await runE2e(args);
}

main().catch((error) => {
  console.error((error && error.stack) || error);
  process.exitCode = error && error.exitCode ? error.exitCode : 1;
});
