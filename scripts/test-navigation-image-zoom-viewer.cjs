const test = require("node:test");
const assert = require("node:assert/strict");
const {
  helpers,
  notices,
} = require("./navigation-hotkeys-harness.cjs");

const {
  ImageZoomModal,
  IMAGE_ZOOM_STEP,
  IMAGE_ZOOM_PADDING,
  IMAGE_ZOOM_MAX_FACTOR,
  computeImageZoomFitScale,
  computeImageZoomBounds,
  zoomImageZoomState,
  clampImageZoomPan,
  imageZoomKeyAction,
} = helpers;

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

function makeApp() {
  const calls = [];
  return { calls, vault: throwingVault(calls) };
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

function openViewer(options = {}) {
  const pending = [];
  const closed = { count: 0 };
  const app = options.app || makeApp();
  const scope = options.scope || makeScope();
  const modal = new ImageZoomModal(app, {
    src: options.src || "app://local/img/x.png",
    title: options.title || "x.png",
    onClosed: () => {
      closed.count += 1;
    },
    defer: (cb) => pending.push(cb),
  });
  modal.scope = scope;
  modal.open();
  const viewport = options.viewport || { width: 800, height: 600 };
  modal.viewportEl.clientWidth = viewport.width;
  modal.viewportEl.clientHeight = viewport.height;
  return { modal, pending, closed, app, scope };
}

function arm(session) {
  while (session.pending.length) {
    session.pending.shift()();
  }
}

function fireLoad(modal, natural = { width: 2000, height: 1000 }) {
  modal.imgEl.naturalWidth = natural.width;
  modal.imgEl.naturalHeight = natural.height;
  const handlers = (modal.imgEl._listeners && modal.imgEl._listeners.load) || [];
  for (const handler of handlers) {
    handler.call(modal.imgEl);
  }
}

function fireError(modal) {
  const handlers = (modal.imgEl._listeners && modal.imgEl._listeners.error) || [];
  for (const handler of handlers) {
    handler.call(modal.imgEl);
  }
}

function sendKey(modal, event) {
  const handle = modal.scopeHandler;
  if (handle && typeof handle.fn === "function") {
    return handle.fn(event);
  }
  modal.handleImageZoomKey(event);
  return false;
}

// --- Geometry ---

test("fit never exceeds 1 and respects padding for landscape, portrait, and tiny images", () => {
  const viewport = { width: 800, height: 600 };
  const landscape = computeImageZoomFitScale(
    { width: 2000, height: 1000 },
    viewport,
    IMAGE_ZOOM_PADDING,
  );
  const portrait = computeImageZoomFitScale(
    { width: 1000, height: 2000 },
    viewport,
    IMAGE_ZOOM_PADDING,
  );
  const tiny = computeImageZoomFitScale(
    { width: 100, height: 50 },
    viewport,
    IMAGE_ZOOM_PADDING,
  );
  const boxW = 800 - 2 * IMAGE_ZOOM_PADDING;
  const boxH = 600 - 2 * IMAGE_ZOOM_PADDING;
  assert.equal(landscape, Math.min(1, boxW / 2000, boxH / 1000));
  assert.equal(portrait, Math.min(1, boxW / 1000, boxH / 2000));
  assert.equal(tiny, 1);
  assert.ok(landscape < 1);
  assert.ok(portrait < 1);
  assert.ok(tiny <= 1);
});

test("min and max bounds follow fit, 1:1, and the max factor", () => {
  const retina = computeImageZoomBounds(0.5, 0.5);
  assert.equal(retina.min, 0.5);
  assert.equal(retina.max, IMAGE_ZOOM_MAX_FACTOR * 1);
  const fitted = computeImageZoomBounds(1, 0.5);
  assert.equal(fitted.min, 0.5);
  assert.equal(fitted.max, IMAGE_ZOOM_MAX_FACTOR);
  const smallOnOneX = computeImageZoomBounds(0.25, 1);
  assert.equal(smallOnOneX.min, 0.25);
  assert.equal(smallOnOneX.max, IMAGE_ZOOM_MAX_FACTOR);
});

test("stepping clamps at both bounds", () => {
  const bounds = computeImageZoomBounds(0.5, 0.5);
  let zoomedIn = { scale: bounds.min, x: 0, y: 0 };
  for (let i = 0; i < 40; i += 1) {
    zoomedIn = zoomImageZoomState(zoomedIn, IMAGE_ZOOM_STEP, { x: 0, y: 0 }, bounds);
  }
  assert.equal(zoomedIn.scale, bounds.max);
  let zoomedOut = { scale: bounds.max, x: 0, y: 0 };
  for (let i = 0; i < 40; i += 1) {
    zoomedOut = zoomImageZoomState(
      zoomedOut,
      1 / IMAGE_ZOOM_STEP,
      { x: 0, y: 0 },
      bounds,
    );
  }
  assert.equal(zoomedOut.scale, bounds.min);
});

test("zoom-at-point keeps the point fixed", () => {
  const state = { scale: 1, x: 10, y: -4 };
  const point = { x: 40, y: -20 };
  const bounds = { min: 0.1, max: 8 };
  const next = zoomImageZoomState(state, IMAGE_ZOOM_STEP, point, bounds);
  const beforeX = (point.x - state.x) / state.scale;
  const beforeY = (point.y - state.y) / state.scale;
  const afterX = (point.x - next.x) / next.scale;
  const afterY = (point.y - next.y) / next.scale;
  assert.ok(Math.abs(beforeX - afterX) < 1e-10);
  assert.ok(Math.abs(beforeY - afterY) < 1e-10);
});

test("clamp centres small axes and limits large ones", () => {
  const centered = clampImageZoomPan(
    { scale: 1, x: 40, y: -30 },
    { width: 100, height: 80 },
    { width: 800, height: 600 },
  );
  assert.equal(centered.x, 0);
  assert.equal(centered.y, 0);
  const scaled = { width: 2000, height: 400 };
  const viewport = { width: 800, height: 600 };
  const limitX = (2000 - 800) / 2;
  const clamped = clampImageZoomPan(
    { scale: 1, x: 5000, y: 40 },
    scaled,
    viewport,
  );
  assert.equal(clamped.x, limitX);
  assert.equal(clamped.y, 0);
  const clampedLow = clampImageZoomPan(
    { scale: 1, x: -5000, y: 0 },
    scaled,
    viewport,
  );
  assert.equal(clampedLow.x, -limitX);
});

// --- Key table ---

const KEY_CASES = [
  [{ key: "Escape" }, { action: "close" }],
  [{ key: "q" }, { action: "close" }],
  [{ key: "Q" }, { action: "close" }],
  [{ key: "[", ctrlKey: true }, { action: "close" }],
  [{ key: "Z" }, { action: "close" }],
  [{ key: "+" }, { action: "zoomIn" }],
  [{ key: "=" }, { action: "zoomIn" }],
  [{ key: "=", shiftKey: true }, { action: "zoomIn" }],
  [{ key: "+" , shiftKey: true }, { action: "zoomIn" }],
  [{ key: "-" }, { action: "zoomOut" }],
  [{ key: "0" }, { action: "fit" }],
  [{ key: "1" }, { action: "actual" }],
  [{ key: "h" }, { action: "pan", dir: "left", large: false }],
  [{ key: "j" }, { action: "pan", dir: "down", large: false }],
  [{ key: "k" }, { action: "pan", dir: "up", large: false }],
  [{ key: "l" }, { action: "pan", dir: "right", large: false }],
  [{ key: "H", shiftKey: true }, { action: "pan", dir: "left", large: true }],
  [{ key: "J", shiftKey: true }, { action: "pan", dir: "down", large: true }],
  [{ key: "K", shiftKey: true }, { action: "pan", dir: "up", large: true }],
  [{ key: "L", shiftKey: true }, { action: "pan", dir: "right", large: true }],
  [{ key: "ArrowLeft" }, { action: "pan", dir: "left", large: false }],
  [{ key: "ArrowDown" }, { action: "pan", dir: "down", large: false }],
  [{ key: "ArrowUp" }, { action: "pan", dir: "up", large: false }],
  [{ key: "ArrowRight" }, { action: "pan", dir: "right", large: false }],
  [{ key: "ArrowLeft", shiftKey: true }, { action: "pan", dir: "left", large: true }],
  [{ key: "q", ctrlKey: true }, { action: "ignore" }],
  [{ key: "z", metaKey: true }, { action: "ignore" }],
  [{ key: "Z", metaKey: true }, { action: "ignore" }],
  [{ key: "a", isComposing: true }, { action: "ignore" }],
  [{ key: "a", keyCode: 229 }, { action: "ignore" }],
  [{ key: "x" }, { action: "ignore" }],
];

for (const [event, expected] of KEY_CASES) {
  const label = [
    event.ctrlKey ? "Ctrl+" : "",
    event.metaKey ? "Meta+" : "",
    event.shiftKey ? "Shift+" : "",
    event.key,
    event.isComposing ? " composing" : "",
    event.keyCode === 229 ? " keyCode 229" : "",
  ].join("");
  test(`key ${label} → ${expected.action}${expected.dir ? ":" + expected.dir : ""}`, () => {
    assert.deepEqual(imageZoomKeyAction(keyEvent(event.key, event)), expected);
  });
}

// --- Lifecycle ---

test("keys before arming are ignored", () => {
  notices.length = 0;
  const session = openViewer();
  assert.equal(session.modal.armed, false);
  assert.equal(sendKey(session.modal, keyEvent("Z")), false);
  assert.equal(sendKey(session.modal, keyEvent("Escape")), false);
  assert.equal(sendKey(session.modal, keyEvent("q")), false);
  assert.equal(session.modal.isOpen, true);
  assert.equal(session.closed.count, 0);
});

test("Z closes after arming, and a repeated Z does not", () => {
  const session = openViewer();
  arm(session);
  assert.equal(session.modal.armed, true);
  sendKey(session.modal, keyEvent("Z", { repeat: true }));
  assert.equal(session.modal.isOpen, true);
  assert.equal(session.closed.count, 0);
  sendKey(session.modal, keyEvent("Z"));
  assert.equal(session.modal.isOpen, false);
  assert.equal(session.closed.count, 1);
  sendKey(session.modal, keyEvent("Z"));
  sendKey(session.modal, keyEvent("Z", { repeat: true }));
  assert.equal(session.closed.count, 1);
});

test("load sets fit state and dimensions", () => {
  const session = openViewer({ viewport: { width: 800, height: 600 } });
  arm(session);
  fireLoad(session.modal, { width: 2000, height: 1000 });
  const fit = computeImageZoomFitScale(
    { width: 2000, height: 1000 },
    { width: 800, height: 600 },
    IMAGE_ZOOM_PADDING,
  );
  assert.equal(session.modal.fitMode, true);
  assert.equal(session.modal.state.scale, fit);
  assert.equal(session.modal.state.x, 0);
  assert.equal(session.modal.state.y, 0);
  assert.equal(session.modal.imgEl.style.width, `${2000 * fit}px`);
  assert.equal(session.modal.imgEl.style.height, `${1000 * fit}px`);
  assert.equal(session.modal.readoutEl.textContent, `${Math.round(fit * 100)}%`);
});

test("a load error shows a notice, closes, and calls onClosed once", () => {
  notices.length = 0;
  const session = openViewer({ title: "shot.png" });
  arm(session);
  fireError(session.modal);
  assert.deepEqual(notices, ["Could not load image: shot.png"]);
  assert.equal(session.modal.isOpen, false);
  assert.equal(session.closed.count, 1);
  fireError(session.modal);
  assert.equal(session.closed.count, 1);
});

const CLOSE_KEYS = [
  keyEvent("Escape"),
  keyEvent("q"),
  keyEvent("Q"),
  keyEvent("[", { ctrlKey: true, code: "BracketLeft" }),
  keyEvent("Z"),
];

for (const event of CLOSE_KEYS) {
  const label = `${event.ctrlKey ? "Ctrl+" : ""}${event.key}`;
  test(`${label} closes once, unregisters the scope handler, and aborts the signal`, () => {
    notices.length = 0;
    const session = openViewer();
    arm(session);
    const handle = session.scope.registered[0];
    const signal = session.modal.abortController.signal;
    assert.equal(session.scope.registered.length, 1);
    sendKey(session.modal, event);
    assert.equal(session.modal.isOpen, false);
    assert.equal(session.closed.count, 1);
    assert.deepEqual(session.scope.unregistered, [handle]);
    assert.equal(signal.aborted, true);
    sendKey(session.modal, event);
    assert.equal(session.closed.count, 1);
  });
}

test("a stray x key changes nothing", () => {
  const session = openViewer();
  arm(session);
  fireLoad(session.modal);
  const before = { ...session.modal.state };
  sendKey(session.modal, keyEvent("x"));
  assert.equal(session.modal.isOpen, true);
  assert.equal(session.closed.count, 0);
  assert.deepEqual(session.modal.state, before);
});

test("the app's vault stubs throw and are never called", () => {
  notices.length = 0;
  const app = makeApp();
  const session = openViewer({ app });
  arm(session);
  fireLoad(session.modal);
  sendKey(session.modal, keyEvent("Z"));
  assert.equal(session.closed.count, 1);
  assert.deepEqual(app.calls, []);
});
