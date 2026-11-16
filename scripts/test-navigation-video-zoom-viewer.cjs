const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  helpers,
  notices,
} = require("./navigation-hotkeys-harness.cjs");

const {
  VideoZoomModal,
  VIDEO_ZOOM_EXTENSIONS,
  videoZoomKeyAction,
  formatVideoZoomTime,
  clampVideoZoomSeek,
  videoZoomStartPolicy,
  videoZoomReadout,
  videoZoomFailureCopy,
  computeImageZoomFitScale,
  IMAGE_ZOOM_PADDING,
} = helpers;

const PLAY_GLYPH = "\u25B6\uFE0E";
const PAUSE_GLYPH = "\u23F8\uFE0E";

function throwingVault(calls) {
  const thrower = (name) => () => {
    calls.push(name);
    throw new Error(`viewer must not call vault.${name}`);
  };
  return {
    read: thrower("read"),
    cachedRead: thrower("cachedRead"),
    modify: thrower("modify"),
    process: thrower("process"),
    create: thrower("create"),
    delete: thrower("delete"),
    getResourcePath: thrower("getResourcePath"),
  };
}

function makeApp(extras = {}) {
  const calls = [];
  return { calls, vault: throwingVault(calls), ...extras };
}

function makeScope() {
  return {
    registered: [],
    unregistered: [],
    register(modifiers, key, fn) {
      const handle = { modifiers, key, fn };
      this.registered.push(handle);
      return handle;
    },
    unregister(handle) {
      this.unregistered.push(handle);
    },
  };
}

function keyEvent(key, extras = {}) {
  return {
    key,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
    defaultPrevented: false,
    ...extras,
  };
}

function fire(el, type, event = {}) {
  const handlers = (el && el._listeners && el._listeners[type]) || [];
  for (const handler of handlers) {
    handler.call(el, event);
  }
}

function childText(element) {
  return (element && element.children || []).map((child) => child.textContent || "").join("");
}

function allByClass(root, className, found = []) {
  if (root && root.classList && root.classList.contains(className)) found.push(root);
  for (const child of (root && root.children) || []) allByClass(child, className, found);
  return found;
}

function installClipboard(writeText) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText } },
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
    else delete globalThis.navigator;
  };
}

function attachFakeVideo(modal, options = {}) {
  const video = modal.imgEl;
  video.paused = options.paused !== false;
  video.duration = options.duration ?? 6.2;
  video.currentTime = options.currentTime ?? 0;
  video.videoWidth = options.videoWidth ?? 2560;
  video.videoHeight = options.videoHeight ?? 1548;
  video.webkitAudioDecodedByteCount = Object.prototype.hasOwnProperty.call(options, "audioBytes")
    ? options.audioBytes
    : 0;
  video.readyState = options.readyState ?? 0;
  video.loop = false;
  video.muted = options.muted === true;
  video.error = options.error || null;
  video.playCalls = [];
  video.pauseCalls = [];
  video.loadCalls = [];
  video.playImpl = options.playImpl;
  video.play = function play() {
    this.playCalls.push(1);
    if (typeof this.playImpl === "function") {
      return this.playImpl();
    }
    this.paused = false;
    fire(this, "play");
    return Promise.resolve();
  };
  video.pause = function pause() {
    this.pauseCalls.push(1);
    this.paused = true;
    fire(this, "pause");
  };
  video.load = function load() {
    this.loadCalls.push(1);
  };
  return video;
}

function openViewer(options = {}) {
  const pending = [];
  const closed = { count: 0 };
  const frames = [];
  const app = options.app || makeApp();
  const scope = options.scope || makeScope();
  const reducedMotion = options.reducedMotion === true;
  const win = {
    devicePixelRatio: options.devicePixelRatio || 1,
    innerWidth: 800,
    innerHeight: 600,
    requestAnimationFrame(callback) {
      const id = frames.length + 1;
      frames.push({ id, callback });
      return id;
    },
    cancelAnimationFrame(id) {
      const index = frames.findIndex((frame) => frame.id === id);
      if (index >= 0) frames.splice(index, 1);
    },
    matchMedia(query) {
      return {
        matches: String(query).includes("prefers-reduced-motion: reduce") && reducedMotion,
      };
    },
  };
  const modal = new VideoZoomModal(app, {
    src: options.src || "app://local/vid/x.mp4",
    title: options.title || "x.mp4",
    context: options.context || {
      kind: "vault",
      vaultPath: "vid/x.mp4",
      absolutePath: "/vault/vid/x.mp4",
    },
    onClosed: () => {
      closed.count += 1;
    },
    defer: (cb) => pending.push(cb),
  });
  modal.scope = scope;
  modal.getImageZoomWindow = () => win;
  modal.open();
  const viewport = options.viewport || { width: 800, height: 600 };
  modal.viewportEl.clientWidth = viewport.width;
  modal.viewportEl.clientHeight = viewport.height;
  const video = attachFakeVideo(modal, options.video || {});
  return { modal, pending, closed, app, scope, video, frames, win };
}

function arm(session) {
  while (session.pending.length) {
    session.pending.shift()();
  }
}

function loadVideo(session, extras = {}) {
  const video = session.video;
  if (extras.videoWidth != null) video.videoWidth = extras.videoWidth;
  if (extras.videoHeight != null) video.videoHeight = extras.videoHeight;
  if (Object.prototype.hasOwnProperty.call(extras, "audioBytes")) {
    video.webkitAudioDecodedByteCount = extras.audioBytes;
  }
  if (extras.duration != null) video.duration = extras.duration;
  if (extras.error) video.error = extras.error;
  video.readyState = extras.readyState ?? 4;
  fire(video, "loadedmetadata");
  if (extras.skipLoadedData) return;
  fire(video, "loadeddata");
}

function sendKey(modal, event) {
  const handle = modal.scopeHandler;
  if (handle && typeof handle.fn === "function") {
    return handle.fn(event);
  }
  modal.handleImageZoomKey(event);
  return false;
}

test("VIDEO_ZOOM_EXTENSIONS matches the shared catalog", () => {
  assert.deepEqual([...VIDEO_ZOOM_EXTENSIONS].sort(), ["mkv", "mov", "mp4", "webm"]);
});

const KEY_CASES = [
  [{ key: "Escape" }, { action: "close" }],
  [{ key: "q" }, { action: "close" }],
  [{ key: "Q" }, { action: "close" }],
  [{ key: "[", ctrlKey: true }, { action: "close" }],
  [{ key: "Z" }, { action: "close" }],
  [{ key: " " }, { action: "togglePlay" }],
  [{ key: "Spacebar" }, { action: "togglePlay" }],
  [{ key: "ArrowLeft" }, { action: "seek", delta: -1 }],
  [{ key: "ArrowRight" }, { action: "seek", delta: 1 }],
  [{ key: "ArrowLeft", shiftKey: true }, { action: "seek", delta: -10 }],
  [{ key: "ArrowRight", shiftKey: true }, { action: "seek", delta: 10 }],
  [{ key: "o" }, { action: "openExternal" }],
  [{ key: "O" }, { action: "openExternal" }],
  [{ key: "o", repeat: true }, { action: "ignore" }],
  [{ key: "y" }, { action: "copySource" }],
  [{ key: "r" }, { action: "restoreSource" }],
  [{ key: "+" }, { action: "zoomIn" }],
  [{ key: "=" }, { action: "zoomIn" }],
  [{ key: "-" }, { action: "zoomOut" }],
  [{ key: "0" }, { action: "fit" }],
  [{ key: "1" }, { action: "actual" }],
  [{ key: "h" }, { action: "pan", dir: "left", large: false }],
  [{ key: "l" }, { action: "pan", dir: "right", large: false }],
  [{ key: "H", shiftKey: true }, { action: "pan", dir: "left", large: true }],
  [{ key: "ArrowDown" }, { action: "pan", dir: "down", large: false }],
  [{ key: " ", ctrlKey: true }, { action: "ignore" }],
  [{ key: "o", metaKey: true }, { action: "ignore" }],
  [{ key: "x" }, { action: "ignore" }],
];

for (const [event, expected] of KEY_CASES) {
  const label = [
    event.ctrlKey ? "Ctrl+" : "",
    event.metaKey ? "Meta+" : "",
    event.shiftKey ? "Shift+" : "",
    event.key === " " ? "Space" : event.key,
  ].join("");
  test(`video key ${label} → ${expected.action}${expected.delta ? ":" + expected.delta : ""}`, () => {
    assert.deepEqual(videoZoomKeyAction(keyEvent(event.key, event)), expected);
  });
}

test("time format is m:ss.d under an hour and h:mm:ss from an hour up", () => {
  assert.equal(formatVideoZoomTime(0, 6.2), "0:00.0");
  assert.equal(formatVideoZoomTime(3.2, 6.2), "0:03.2");
  assert.equal(formatVideoZoomTime(6.2, 6.2), "0:06.2");
  assert.equal(formatVideoZoomTime(65.4, 90), "1:05.4");
  assert.equal(formatVideoZoomTime(3599.4, 3599.9), "59:59.4");
  assert.equal(formatVideoZoomTime(3661, 7200), "1:01:01");
  assert.equal(formatVideoZoomTime(0, 3600), "0:00:00");
  assert.equal(formatVideoZoomTime(-4, 10), "0:00.0");
  assert.equal(formatVideoZoomTime(Number.NaN, 10), "0:00.0");
});

test("seek clamps to the clip", () => {
  assert.equal(clampVideoZoomSeek(3, 1, 6.2), 4);
  assert.equal(clampVideoZoomSeek(0, -1, 6.2), 0);
  assert.equal(clampVideoZoomSeek(6.2, 1, 6.2), 6.2);
  assert.equal(clampVideoZoomSeek(3, 10, 6.2), 6.2);
  assert.equal(clampVideoZoomSeek(3, -10, 6.2), 0);
  assert.equal(clampVideoZoomSeek(Number.NaN, 1, 6.2), 1);
  assert.equal(clampVideoZoomSeek(3, 1, Number.NaN), 0);
});

test("start-policy matrix: silent, audible, unknown, reduced motion", () => {
  assert.deepEqual(videoZoomStartPolicy({ audioBytes: 0, reducedMotion: false }), {
    autoplay: true,
    loop: true,
    hint: "",
  });
  assert.deepEqual(videoZoomStartPolicy({ audioBytes: 2334, reducedMotion: false }), {
    autoplay: false,
    loop: false,
    hint: "· Space to play",
  });
  assert.deepEqual(videoZoomStartPolicy({ audioBytes: undefined, reducedMotion: false }), {
    autoplay: false,
    loop: false,
    hint: "· Space to play",
  });
  assert.deepEqual(videoZoomStartPolicy({ audioBytes: Number.NaN, reducedMotion: false }), {
    autoplay: false,
    loop: false,
    hint: "· Space to play",
  });
  assert.deepEqual(videoZoomStartPolicy({ audioBytes: 0, reducedMotion: true }), {
    autoplay: false,
    loop: false,
    hint: "· Space to play",
  });
});

test("readout uses text-presentation glyphs and optional zoom, mute, and hint", () => {
  assert.equal(
    videoZoomReadout({ playing: true, currentTime: 3.2, duration: 6.2 }),
    `${PLAY_GLYPH} 0:03.2 / 0:06.2`,
  );
  assert.equal(
    videoZoomReadout({ playing: false, currentTime: 3.2, duration: 6.2 }),
    `${PAUSE_GLYPH} 0:03.2 / 0:06.2`,
  );
  assert.equal(
    videoZoomReadout({
      playing: true,
      currentTime: 3.2,
      duration: 6.2,
      zoomPercent: "150%",
    }),
    `${PLAY_GLYPH} 0:03.2 / 0:06.2 · 150%`,
  );
  assert.equal(
    videoZoomReadout({
      playing: true,
      currentTime: 3.2,
      duration: 6.2,
      muted: true,
    }),
    `${PLAY_GLYPH} 0:03.2 / 0:06.2 · muted`,
  );
  assert.equal(
    videoZoomReadout({
      playing: false,
      currentTime: 0,
      duration: 6.2,
      hint: "· Space to play",
    }),
    `${PAUSE_GLYPH} 0:00.0 / 0:06.2 · Space to play`,
  );
});

test("failure copy follows the media error code", () => {
  assert.deepEqual(videoZoomFailureCopy(4, "clip.mp4"), {
    title: "Can't play clip.mp4 here",
    reason: "Obsidian's player can't decode this file — the codec may be unsupported, or the file may be damaged.",
  });
  assert.deepEqual(videoZoomFailureCopy(3, "clip.mp4"), {
    title: "Can't play clip.mp4 here",
    reason: "Decoding stopped partway — the file may be damaged.",
  });
  assert.deepEqual(videoZoomFailureCopy(2, "clip.mp4"), {
    title: "Can't play clip.mp4 here",
    reason: "Obsidian couldn't read the file.",
  });
  assert.deepEqual(videoZoomFailureCopy(1, "clip.mp4"), {
    title: "Can't play clip.mp4 here",
    reason: "Playback failed.",
  });
});

test("the modal carries image and video chrome classes and a controls-free video", () => {
  const session = openViewer();
  arm(session);
  assert.ok(session.modal.containerEl.classList.contains("bob-image-zoom-container"));
  assert.ok(session.modal.containerEl.classList.contains("bob-video-zoom-container"));
  assert.ok(session.modal.modalEl.classList.contains("bob-image-zoom-modal"));
  assert.ok(session.modal.modalEl.classList.contains("bob-video-zoom-modal"));
  assert.ok(session.modal.contentEl.classList.contains("bob-image-zoom"));
  assert.ok(session.modal.contentEl.classList.contains("bob-video-zoom"));
  assert.equal(session.video.tagName, "VIDEO");
  assert.ok(session.video.classList.contains("bob-image-zoom-img"));
  assert.ok(session.video.classList.contains("bob-video-zoom-video"));
  assert.equal(session.video.getAttribute("preload"), "auto");
  assert.equal(session.video.getAttribute("playsinline"), "");
  assert.equal(session.video.controls, false);
  assert.equal(session.modal.mediaEl, session.video);
  session.modal.close();
});

test("silent clips autoplay and loop; readout ticks while playing", () => {
  const session = openViewer();
  arm(session);
  loadVideo(session, { audioBytes: 0 });
  assert.equal(session.video.loop, true);
  assert.equal(session.video.paused, false);
  assert.equal(session.video.playCalls.length, 1);
  assert.equal(session.modal.readoutEl.textContent, `${PLAY_GLYPH} 0:00.0 / 0:06.2`);
  session.video.currentTime = 3.2;
  assert.ok(session.frames.length > 0);
  session.frames[0].callback();
  assert.equal(session.modal.readoutEl.textContent, `${PLAY_GLYPH} 0:03.2 / 0:06.2`);
  session.modal.close();
});

test("audible clips and reduced-motion clips open paused with a Space hint", () => {
  const audible = openViewer({ video: { audioBytes: 2334 } });
  arm(audible);
  loadVideo(audible, { audioBytes: 2334 });
  assert.equal(audible.video.paused, true);
  assert.equal(audible.video.loop, false);
  assert.equal(audible.video.playCalls.length, 0);
  assert.equal(
    audible.modal.readoutEl.textContent,
    `${PAUSE_GLYPH} 0:00.0 / 0:06.2 · Space to play`,
  );
  audible.modal.close();

  const reduced = openViewer({ reducedMotion: true, video: { audioBytes: 0 } });
  arm(reduced);
  loadVideo(reduced, { audioBytes: 0 });
  assert.equal(reduced.video.paused, true);
  assert.equal(reduced.video.playCalls.length, 0);
  assert.equal(
    reduced.modal.readoutEl.textContent,
    `${PAUSE_GLYPH} 0:00.0 / 0:06.2 · Space to play`,
  );
  reduced.modal.close();

  const unknown = openViewer({ video: { audioBytes: undefined } });
  arm(unknown);
  loadVideo(unknown, { audioBytes: undefined });
  assert.equal(unknown.video.paused, true);
  assert.equal(unknown.video.playCalls.length, 0);
  unknown.modal.close();
});

test("Space and a click on the video toggle play and pause", () => {
  const session = openViewer({ video: { audioBytes: 2334 } });
  arm(session);
  loadVideo(session, { audioBytes: 2334 });
  sendKey(session.modal, keyEvent(" "));
  assert.equal(session.video.paused, false);
  assert.match(session.modal.readoutEl.textContent, new RegExp(`^${PLAY_GLYPH}`));
  sendKey(session.modal, keyEvent(" "));
  assert.equal(session.video.paused, true);
  session.modal.handleImageZoomClick({ target: session.video });
  assert.equal(session.video.paused, false);
  session.modal.suppressClick = true;
  session.modal.handleImageZoomClick({ target: session.video });
  assert.equal(session.video.paused, false);
  session.modal.close();
});

test("arrow keys seek by 1s and Shift seeks by 10s, clamped to the clip", () => {
  const session = openViewer({ video: { audioBytes: 2334, duration: 6.2, currentTime: 3 } });
  arm(session);
  loadVideo(session, { audioBytes: 2334, duration: 6.2 });
  session.video.currentTime = 3;
  sendKey(session.modal, keyEvent("ArrowRight"));
  assert.equal(session.video.currentTime, 4);
  sendKey(session.modal, keyEvent("ArrowLeft"));
  assert.equal(session.video.currentTime, 3);
  sendKey(session.modal, keyEvent("ArrowLeft", { shiftKey: true }));
  assert.equal(session.video.currentTime, 0);
  sendKey(session.modal, keyEvent("ArrowRight", { shiftKey: true }));
  assert.equal(session.video.currentTime, 6.2);
  session.modal.close();
});

test("a click on the backdrop closes; a drag-suppressed click does not toggle", () => {
  const session = openViewer({ video: { audioBytes: 2334 } });
  arm(session);
  loadVideo(session, { audioBytes: 2334 });
  assert.equal(session.modal.isOpen, true);
  session.modal.handleImageZoomClick({ target: session.modal.viewportEl });
  assert.equal(session.closed.count, 1);
});

test("footer chips drop hjkl pan and add Space, seek, and o", () => {
  const session = openViewer({
    context: {
      kind: "vault",
      vaultPath: "vid/x.mp4",
      absolutePath: "/vault/vid/x.mp4",
      origin: { display: "~/tmp/x.mp4", state: "present" },
      restore: { view: {}, editor: {}, filePath: "n.md", line: 0, lineText: "x", start: 0, end: 1 },
    },
  });
  arm(session);
  loadVideo(session);
  const chips = allByClass(session.modal.imageZoomFooterEl, "bob-image-zoom-chip").map(childText);
  assert.deepEqual(chips, [
    "Escclose",
    "Spaceplay",
    "← →seek",
    "+ −zoom",
    "0fit",
    "11:1",
    "ycopy original path",
    "rrestore path",
    "oopen",
  ]);
  assert.ok(!chips.some((chip) => chip.includes("hjkl")));
  session.modal.close();
});

test("zoom off fit appends a percent; muted appends only when the clip has audio", async () => {
  const session = openViewer({ video: { audioBytes: 2334 } });
  arm(session);
  loadVideo(session, { audioBytes: 2334 });
  session.modal.fitMode = false;
  session.modal.state = { scale: 1.5, x: 0, y: 0 };
  session.modal.updateVideoZoomReadout();
  assert.equal(
    session.modal.readoutEl.textContent,
    `${PAUSE_GLYPH} 0:00.0 / 0:06.2 · 150% · Space to play`,
  );
  session.video.muted = true;
  session.modal.videoZoomHasPlayed = true;
  session.modal.videoZoomHint = "";
  session.modal.updateVideoZoomReadout();
  assert.equal(
    session.modal.readoutEl.textContent,
    `${PAUSE_GLYPH} 0:00.0 / 0:06.2 · 150% · muted`,
  );
  session.modal.close();

  const silent = openViewer({ video: { audioBytes: 0 } });
  arm(silent);
  silent.video.playImpl = () => {
    silent.video.paused = false;
    fire(silent.video, "play");
    return Promise.resolve();
  };
  loadVideo(silent, { audioBytes: 0 });
  silent.video.muted = true;
  silent.modal.updateVideoZoomReadout();
  assert.equal(silent.modal.readoutEl.textContent.includes("muted"), false);
  silent.modal.close();
});

test("audio-only streams show a placeholder and keep transport without zoom", () => {
  const session = openViewer({ video: { videoWidth: 0, videoHeight: 0, audioBytes: 2334 } });
  arm(session);
  loadVideo(session, { videoWidth: 0, videoHeight: 0, audioBytes: 2334 });
  assert.equal(session.modal.videoZoomAudioOnly, true);
  assert.ok(session.modal.videoZoomPlaceholderEl.classList.contains("is-visible"));
  assert.equal(session.modal.videoZoomPlaceholderEl.textContent, "♪ Audio only");
  const before = session.modal.state.scale;
  sendKey(session.modal, keyEvent("+"));
  assert.equal(session.modal.state.scale, before);
  sendKey(session.modal, keyEvent("ArrowRight"));
  assert.equal(session.video.currentTime, 1);
  session.modal.close();
});

test("play() rejection shows the paused state, and NotSupportedError shows the failure card", async () => {
  const paused = openViewer({ video: { audioBytes: 2334 } });
  arm(paused);
  let rejectPlay;
  paused.video.playImpl = () => new Promise((_, reject) => {
    rejectPlay = reject;
  });
  loadVideo(paused, { audioBytes: 2334 });
  sendKey(paused.modal, keyEvent(" "));
  const other = new Error("interrupted");
  other.name = "AbortError";
  rejectPlay(other);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(paused.modal.videoZoomFailed, false);
  assert.equal(paused.video.paused, true);
  assert.equal(paused.modal.isOpen, true);
  paused.modal.close();

  const unsupported = openViewer({ video: { audioBytes: 2334 }, title: "clip.mp4" });
  arm(unsupported);
  let rejectUnsupported;
  unsupported.video.playImpl = () => new Promise((_, reject) => {
    rejectUnsupported = reject;
  });
  loadVideo(unsupported, { audioBytes: 2334 });
  sendKey(unsupported.modal, keyEvent(" "));
  const err = new Error("no decoder");
  err.name = "NotSupportedError";
  rejectUnsupported(err);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(unsupported.modal.videoZoomFailed, true);
  assert.equal(unsupported.modal.isOpen, true);
  const card = unsupported.modal.videoZoomFailureEl;
  assert.ok(card.classList.contains("is-visible"));
  assert.equal(card.children[0].textContent, "Can't play clip.mp4 here");
  assert.match(card.children[1].textContent, /can't decode/);
  const chips = allByClass(unsupported.modal.imageZoomFooterEl, "bob-image-zoom-chip").map(childText);
  assert.deepEqual(chips, [
    "oopen in default app",
    "ycopy path",
    "Escclose",
  ]);
  unsupported.modal.close();
});

test("an error event keeps the modal open and shows the in-place failure card", () => {
  notices.length = 0;
  const session = openViewer({ title: "broken.mp4" });
  arm(session);
  session.video.error = { code: 4 };
  fire(session.video, "error");
  assert.equal(session.modal.isOpen, true);
  assert.equal(session.closed.count, 0);
  assert.deepEqual(notices, []);
  assert.equal(
    session.modal.videoZoomFailureEl.children[0].textContent,
    "Can't play broken.mp4 here",
  );
  session.modal.close();
});

test("o pauses and toasts success, a missing opener, and a thrown opener", () => {
  const opened = [];
  const ok = openViewer({
    app: makeApp({
      openWithDefaultApp(vaultPath) {
        opened.push(vaultPath);
      },
    }),
    video: { audioBytes: 0 },
  });
  arm(ok);
  loadVideo(ok, { audioBytes: 0 });
  assert.equal(ok.video.paused, false);
  sendKey(ok.modal, keyEvent("o"));
  assert.equal(ok.video.paused, true);
  assert.deepEqual(opened, ["vid/x.mp4"]);
  assert.equal(childText(ok.modal.imageZoomToastEl), "✓Opened in default app");
  ok.modal.close();

  const missing = openViewer();
  arm(missing);
  loadVideo(missing, { audioBytes: 2334 });
  sendKey(missing.modal, keyEvent("o"));
  assert.equal(childText(missing.modal.imageZoomToastEl), "!Can't open outside Obsidian here");
  missing.modal.close();

  const throwing = openViewer({
    app: makeApp({
      openWithDefaultApp() {
        throw new Error("no helper");
      },
    }),
  });
  arm(throwing);
  loadVideo(throwing, { audioBytes: 2334 });
  sendKey(throwing.modal, keyEvent("o"));
  assert.equal(childText(throwing.modal.imageZoomToastEl), "!Can't open outside Obsidian here");
  throwing.modal.close();
});

test("inherited r restores the original path", async () => {
  notices.length = 0;
  const lineText = "- ![[vid/x.mp4|400]]";
  const editor = {
    content: lineText,
    transactions: [],
    cursor: { line: 0, ch: 0 },
    getLine(index) {
      return this.content.split(/\r?\n/)[index] ?? null;
    },
    transaction(transaction) {
      this.transactions.push(transaction);
      const change = transaction.changes[0];
      this.content = this.content.slice(0, change.from.ch) + change.text + this.content.slice(change.to.ch);
    },
  };
  const view = { file: { path: "notes/source.md" }, editor };
  const session = openViewer({
    app: makeApp({
      workspace: { getActiveViewOfType: () => view },
    }),
    context: {
      kind: "vault",
      vaultPath: "vid/x.mp4",
      absolutePath: "/vault/vid/x.mp4",
      origin: { display: "~/tmp/x.mp4", state: "present" },
      restore: {
        view,
        editor,
        filePath: "notes/source.md",
        line: 0,
        lineText,
        start: 2,
        end: lineText.length,
      },
    },
  });
  arm(session);
  loadVideo(session);
  await session.modal.handleImageZoomKey(keyEvent("r"));
  assert.equal(editor.content, "- ~/tmp/x.mp4");
  assert.equal(editor.transactions.length, 1);
  assert.equal(session.modal.isOpen, false);
  assert.deepEqual(notices, ["Restored ~/tmp/x.mp4 · vault copy kept at vid/x.mp4"]);
});

test("inherited y copies the original path", async () => {
  const copied = [];
  const restoreNavigator = installClipboard(async (text) => copied.push(text));
  const session = openViewer({
    context: {
      kind: "vault",
      vaultPath: "vid/x.mp4",
      absolutePath: "/vault/vid/x.mp4",
      origin: { display: "~/tmp/x.mp4", source: "/Users/bryan/tmp/x.mp4", state: "present" },
    },
  });
  arm(session);
  loadVideo(session);
  try {
    await session.modal.handleImageZoomKey(keyEvent("y"));
    assert.deepEqual(copied, ["~/tmp/x.mp4"]);
    assert.equal(childText(session.modal.imageZoomToastEl), "✓Copied ~/tmp/x.mp4");
  } finally {
    session.modal.close();
    restoreNavigator();
  }
});

test("close during load ignores a late play() resolution", async () => {
  let resolvePlay;
  const session = openViewer({
    video: {
      audioBytes: 0,
      playImpl() {
        return new Promise((resolve) => {
          resolvePlay = resolve;
        });
      },
    },
  });
  arm(session);
  loadVideo(session, { audioBytes: 0 });
  assert.equal(session.video.playCalls.length, 1);
  session.modal.close();
  assert.equal(session.video.getAttribute("src"), undefined);
  assert.ok(session.video.loadCalls.length >= 1);
  resolvePlay();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(session.frames.length, 0);
  assert.equal(session.closed.count, 1);
});

test("close during playback pauses, clears src, and calls load()", () => {
  const session = openViewer();
  arm(session);
  loadVideo(session, { audioBytes: 0 });
  assert.equal(session.video.paused, false);
  const signal = session.modal.abortController.signal;
  session.modal.close();
  assert.equal(session.video.paused, true);
  assert.ok(session.video.pauseCalls.length >= 1);
  assert.equal(session.video.getAttribute("src"), undefined);
  assert.ok(session.video.loadCalls.length >= 1);
  assert.equal(signal.aborted, true);
  assert.equal(session.closed.count, 1);
});

test("close during origin lookup never starts playback afterwards", async () => {
  let resolveOrigin;
  const origin = new Promise((resolve) => {
    resolveOrigin = resolve;
  });
  let resolvePlay;
  const session = openViewer({
    context: {
      kind: "vault",
      vaultPath: "vid/x.mp4",
      absolutePath: "/vault/vid/x.mp4",
      origin,
    },
    video: {
      audioBytes: 0,
      playImpl() {
        return new Promise((resolve) => {
          resolvePlay = resolve;
        });
      },
    },
  });
  arm(session);
  loadVideo(session, { audioBytes: 0 });
  session.modal.close();
  resolveOrigin({ display: "~/tmp/x.mp4", state: "present" });
  if (resolvePlay) resolvePlay();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(session.modal.imageZoomClosed, true);
  assert.equal(session.video.getAttribute("src"), undefined);
  assert.equal(session.frames.length, 0);
});

test("natural size comes from videoWidth/videoHeight at loadedmetadata", () => {
  const session = openViewer({ viewport: { width: 800, height: 600 } });
  arm(session);
  loadVideo(session, { videoWidth: 2000, videoHeight: 1000, audioBytes: 2334 });
  const fit = computeImageZoomFitScale(
    { width: 2000, height: 1000 },
    { width: 800, height: 600 },
    IMAGE_ZOOM_PADDING,
  );
  assert.equal(session.modal.fitMode, true);
  assert.equal(session.modal.state.scale, fit);
  assert.equal(session.modal.imgEl.style.width, `${2000 * fit}px`);
  session.modal.close();
});

test("video zoom CSS covers the player, placeholder, and failure card", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../plugins/bob-navigation-hotkeys/styles.css"),
    "utf8",
  );
  assert.match(css, /\.bob-video-zoom-video\s*\{/);
  assert.match(css, /\.bob-video-zoom-placeholder\s*\{/);
  assert.match(css, /\.bob-video-zoom-failure\s*\{/);
  assert.match(css, /max-width:\s*420px/);
  assert.match(css, /border-radius:\s*12px/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
