const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers } = require("./navigation-hotkeys-harness.cjs");

const {
  createSectionMapLifecycle,
  SECTION_MAP_LINGER_MS,
  SECTION_MAP_HOLD_CAP_MS,
  SECTION_MAP_FADE_MS,
  SECTION_MAP_DISMISS_MS,
} = helpers;

function fakeClock() {
  let now = 0;
  const timers = [];
  let nextId = 1;

  function fireDue() {
    timers.sort((left, right) => left.at - right.at || left.id - right.id);
    while (timers.length > 0 && timers[0].at <= now) {
      const timer = timers.shift();
      timer.fn();
    }
  }

  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId;
      nextId += 1;
      timers.push({ id, at: now + Number(ms) || 0, fn });
      return id;
    },
    clearTimeout(id) {
      const index = timers.findIndex((timer) => timer.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
    advance(ms) {
      now += ms;
      fireDue();
    },
    pending() {
      return timers.map((timer) => ({ id: timer.id, at: timer.at }));
    },
  };
}

function machine(extra = {}) {
  const clock = extra.clock || fakeClock();
  const changes = [];
  const life = createSectionMapLifecycle({
    now: clock.now,
    setTimeout: extra.setTimeout || clock.setTimeout.bind(clock),
    clearTimeout: extra.clearTimeout || clock.clearTimeout.bind(clock),
    onChange: (snapshot) => changes.push(snapshot),
  });
  return { life, clock, changes };
}

test("holding, linger, fade, and hidden follow the named timings", () => {
  const { life, clock } = machine();
  life.showJump({ ctrlDown: true });
  assert.equal(life.getState(), "holding");

  clock.advance(SECTION_MAP_HOLD_CAP_MS - 1);
  assert.equal(life.getState(), "holding");
  clock.advance(1);
  assert.equal(life.getState(), "lingering");

  clock.advance(SECTION_MAP_LINGER_MS - 1);
  assert.equal(life.getState(), "lingering");
  clock.advance(1);
  assert.equal(life.getState(), "fading");
  assert.equal(life.snapshot().fadeKind, "exit");
  assert.equal(life.snapshot().fadeMs, SECTION_MAP_FADE_MS);

  clock.advance(SECTION_MAP_FADE_MS - 1);
  assert.equal(life.getState(), "fading");
  clock.advance(1);
  assert.equal(life.getState(), "hidden");
  assert.equal(life.isVisible(), false);
});

test("ctrl release and window blur end holding into lingering", () => {
  const { life, clock } = machine();
  life.showJump({ ctrlDown: true });
  life.ctrlReleased();
  assert.equal(life.getState(), "lingering");
  clock.advance(SECTION_MAP_LINGER_MS);
  assert.equal(life.getState(), "fading");

  life.showJump({ ctrlDown: true });
  assert.equal(life.getState(), "holding");
  life.windowBlur();
  assert.equal(life.getState(), "lingering");
});

test("the six-second hold cap forces lingering", () => {
  const { life, clock } = machine();
  life.showJump({ ctrlDown: true });
  clock.advance(SECTION_MAP_HOLD_CAP_MS);
  assert.equal(life.getState(), "lingering");
});

test("a jump with Ctrl up starts lingering, not holding", () => {
  const { life } = machine();
  life.showJump({ ctrlDown: false });
  assert.equal(life.getState(), "lingering");
  assert.equal(life.snapshot().replayEntrance, true);
});

test("a repeat during fading restores without an entrance replay", () => {
  const { life, clock } = machine();
  life.showJump({ ctrlDown: false });
  clock.advance(SECTION_MAP_LINGER_MS);
  assert.equal(life.getState(), "fading");
  assert.equal(life.snapshot().replayEntrance, false);

  life.showJump({ ctrlDown: false });
  assert.equal(life.getState(), "lingering");
  assert.equal(life.snapshot().replayEntrance, false);
  assert.equal(life.snapshot().source, "jump");
});

test("an old-generation timer is a no-op even when clearTimeout leaks", () => {
  const leaked = [];
  let now = 0;
  const { life } = machine({
    setTimeout(fn, ms) {
      leaked.push({ fn, at: now + ms });
      return leaked.length;
    },
    clearTimeout() {
      // Intentionally leak so the generation guard is the only protection.
    },
    clock: {
      now: () => now,
      setTimeout() {},
      clearTimeout() {},
    },
  });

  life.showJump({ ctrlDown: false });
  const firstGen = life.getGeneration();
  life.showJump({ ctrlDown: true });
  assert.notEqual(life.getGeneration(), firstGen);
  assert.equal(life.getState(), "holding");

  now += SECTION_MAP_LINGER_MS;
  leaked[0].fn();
  assert.equal(life.getState(), "holding");
  assert.equal(life.getGeneration() !== firstGen, true);
});

test("activity dismissal fades for 90 ms from every visible state", () => {
  for (const start of ["holding", "lingering", "pinned", "fading"]) {
    const { life, clock } = machine();
    if (start === "holding") life.showJump({ ctrlDown: true });
    else if (start === "lingering") life.showJump({ ctrlDown: false });
    else if (start === "pinned") life.showPeek();
    else {
      life.showJump({ ctrlDown: false });
      clock.advance(SECTION_MAP_LINGER_MS);
    }
    assert.notEqual(life.getState(), "hidden");
    life.dismiss();
    assert.equal(life.getState(), "fading");
    assert.equal(life.snapshot().fadeKind, "dismiss");
    assert.equal(life.snapshot().fadeMs, SECTION_MAP_DISMISS_MS);
    clock.advance(SECTION_MAP_DISMISS_MS);
    assert.equal(life.getState(), "hidden");
  }
});

test("peek is pinned: no linger timer, only activity dismissal leaves", () => {
  const { life, clock } = machine();
  life.showPeek();
  assert.equal(life.getState(), "pinned");
  assert.equal(life.snapshot().source, "peek");
  clock.advance(SECTION_MAP_HOLD_CAP_MS + SECTION_MAP_LINGER_MS + SECTION_MAP_FADE_MS);
  assert.equal(life.getState(), "pinned");
  life.ctrlReleased();
  life.windowBlur();
  assert.equal(life.getState(), "pinned");
  life.dismiss();
  assert.equal(life.getState(), "fading");
  clock.advance(SECTION_MAP_DISMISS_MS);
  assert.equal(life.getState(), "hidden");
});

test("a jump from a pinned peek follows the normal jump lifecycle", () => {
  const { life } = machine();
  life.showPeek();
  life.showJump({ ctrlDown: true });
  assert.equal(life.getState(), "holding");
  assert.equal(life.snapshot().source, "jump");
  assert.equal(life.snapshot().replayEntrance, false);
});
