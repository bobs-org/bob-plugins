"use strict";
// Real-Obsidian proof of the intention card landing repairs: applied-write
// overlays across deliberately held metadata (first add, Reading, settlement,
// last remove), reviewed stale retries that keep the remove and its target,
// canceled retries, the shared busy window under a slowed writer, Undo's
// restored provenance in the open modal, the summary shown above Reflection
// with auto-growth, and the shared arrange animation for Alt+J.

const assert = require("node:assert/strict");
const fs = require("node:fs");

const LANDING_CHECKS = [
  "landing-overlay-first-add-live", "landing-overlay-reading-delayed-metadata", "landing-overlay-settles-on-metadata",
  "landing-overlay-last-remove-live", "landing-cancel-leaves-no-retry", "landing-stale-remove-retargets",
  "landing-undo-busy-guard", "landing-undo-restores-modal-provenance", "landing-reflection-summary-context",
  "landing-reflection-autogrow", "landing-reorder-arrange-animation",
];

const PLUGIN = "app.plugins.plugins['bob-ledger-tools']";
const shared = require("./obsidian-record-card-e2e.cjs");

// A screenshot in the requested theme and viewport width, restored after.
async function styledShot(ctx, name, mode, theme = "light", width = 1400) {
  const setTheme = (dark) => ctx.client.evaluate(`(() => {
    document.body.classList.toggle("theme-dark", ${dark ? "true" : "false"});
    document.body.classList.toggle("theme-light", ${dark ? "false" : "true"});
    return true;
  })()`);
  await setTheme(theme === "dark");
  if (width !== 1400) await shared.setViewport(ctx.client, width);
  await ctx.sleep(300);
  try {
    return await ctx.shot(name, mode, { theme, width });
  } finally {
    await setTheme(false);
    if (width !== 1400) await shared.setViewport(ctx.client, 1400);
  }
}

// Holds metadataCache for one path: reads return the frozen snapshot and its
// "changed" events wait, so the card must bridge with the applied overlay.
function holdMetadata(notePath) {
  return `(() => {
    if (window.__heldMeta) return { ok: false, reason: "already held" };
    const mc = app.metadataCache;
    const path = ${JSON.stringify(notePath)};
    const file = app.vault.getAbstractFileByPath(path);
    const frozen = JSON.parse(JSON.stringify(mc.getFileCache(file) || {}));
    const names = ["getFileCache", "getCache", "trigger"];
    const own = Object.fromEntries(names.map((name) => [name, Object.prototype.hasOwnProperty.call(mc, name) ? mc[name] : undefined]));
    const proto = Object.fromEntries(names.map((name) => [name, mc[name]]));
    const held = [];
    mc.getFileCache = function (f) { return f && f.path === path ? frozen : proto.getFileCache.call(this, f); };
    mc.getCache = function (p) { return p === path ? frozen : proto.getCache.call(this, p); };
    mc.trigger = function (name, ...args) {
      if (name === "changed" && args[0] && args[0].path === path) { held.push(args); return; }
      return proto.trigger.call(this, name, ...args);
    };
    window.__heldMeta = { path, held, own, names };
    return { ok: true, frozen: frozen.frontmatter || null };
  })()`;
}

const RELEASE_METADATA = `(() => {
  const hold = window.__heldMeta;
  if (!hold) return { ok: false };
  const mc = app.metadataCache;
  for (const name of hold.names) {
    if (hold.own[name] === undefined) delete mc[name];
    else mc[name] = hold.own[name];
  }
  delete window.__heldMeta;
  for (const args of hold.held) mc.trigger("changed", ...args);
  const file = app.vault.getAbstractFileByPath(hold.path);
  mc.trigger("changed", file, "", mc.getFileCache(file));
  return { ok: true, released: hold.held.length };
})()`;

const overlayFor = (notePath) => `Boolean(${PLUGIN}.intentionCardOverlayFor(${JSON.stringify(notePath)}))`;

const LANDING_MODAL = `(() => {
  const m = ${PLUGIN}?.intentionCardEditorModal;
  if (!m || m.closed) return null;
  const stage = m.contentEl.querySelector('.bob-intention-editor-stage');
  const area = m.contentEl.querySelector('textarea[data-intention-input]');
  const rows = Array.from(m.contentEl.querySelectorAll('.bob-intention-row'));
  return {
    retained: m.retained ? { kind: m.retained.intent.kind, index: m.retained.intent.index, note: m.retained.note } : null,
    closeRequested: m.closeRequested, lastArrangePlan: m.lastArrangePlan || null,
    stageOrder: stage ? Array.from(stage.children).map((node) => node.className) : [],
    context: stage?.querySelector('[data-intention-context]')?.textContent || '',
    area: area ? { height: area.offsetHeight, scroll: area.scrollHeight, client: area.clientHeight, styleHeight: area.style.height,
      start: area.selectionStart, end: area.selectionEnd, length: area.value.length, focused: document.activeElement === area } : null,
    rows: rows.map((row) => ({ key: row.getAttribute('data-intention-key'), arrange: row.getAttribute('data-arrange-id'),
      current: row.getAttribute('aria-current') === 'true', text: row.textContent })),
    status: m.contentEl.querySelector('.bob-intention-editor-status')?.textContent || '',
  };
})()`;

async function runLandingWorkflows(ctx, h) {
  const { client, plan, key, keys, open, waitCard, waitNoCard, shot, vault, writerApplies, sleep, waitFor } = ctx;
  const { evidence, step, modal, ready, closed, closeAll, liveReady, doubleEquals, typeText, selectAll, disk, onlyChanged, writeStep } = h;
  const landing = evidence.landing = {};
  const extra = () => client.evaluate(LANDING_MODAL);
  const metadataIntentions = (notePath) => client.evaluate(`JSON.stringify(app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(${JSON.stringify(notePath)}))?.frontmatter?.intentions ?? null)`);
  const release = async () => client.evaluate(RELEASE_METADATA);
  const landingPath = plan.paths.landing;

  // ---- Applied-write overlay with metadata held back ----
  await step("landing-overlay-first-add-live", async () => {
    await liveReady(landingPath);
    // The empty landing day shows the identity-only day card: no bands, no
    // owned rows, and (a past day) no set-intentions ghost.
    const identity = await waitCard(landingPath, (value) => value?.cardCount === 1 && value.card?.intentions?.length === 0
      && value.ownedAnywhere === 0 && value.card?.ghost === false, "the empty landing day has an identity-only card");
    assert.equal(identity.card.kind, "day");
    const held = await client.evaluate(holdMetadata(landingPath));
    assert.ok(held.ok, JSON.stringify(held));
    const before = vault();
    await doubleEquals(landingPath);
    await ready((value) => value.path === landingPath, "card editor on the landing day");
    await key("i");
    await ready((value) => value.stage === "intention" && value.stageField === "add" && value.focus?.input === "intention", "first add stage");
    await typeText("First landing intention");
    await key("Enter");
    await ready((value) => value.stage === null && value.status === "saved", "first add saved");
    await closeAll();
    onlyChanged(before, landingPath, "first add");
    assert.equal(await metadataIntentions(landingPath), "null", "metadata is still held at the empty snapshot");
    const card = await waitCard(landingPath, (value) => value?.cardCount === 1
      && JSON.stringify(value.card?.intentions) === JSON.stringify(["First landing intention"]), "first add mounts the card before metadata");
    assert.equal(await client.evaluate(overlayFor(landingPath)), true);
    await shot("intention-landing-first-add-overlay", "Live Preview");
    landing.firstAdd = card.card;
    return card.card;
  });
  await step("landing-overlay-reading-delayed-metadata", async () => {
    assert.ok(await client.evaluate("Boolean(window.__heldMeta)"), "metadata hold was lost");
    await open(landingPath, "reading");
    await waitCard(landingPath, (value) => value?.cardCount === 1
      && JSON.stringify(value.card?.intentions) === JSON.stringify(["First landing intention"]), "Reading paints the held write");
    const since = ctx.invocations().length;
    await client.evaluate("app.commands.executeCommandById('bob-ledger-tools:edit-intentions')");
    await ready((value) => value.path === landingPath, "palette editor in Reading");
    await key("1");
    await key("Enter");
    await ready((value) => value.stage === "intention" && value.focus?.input === "intention", "replace stage in Reading");
    await selectAll(); await typeText("Second landing value");
    await key("Enter");
    await ready((value) => value.stage === null && value.status === "saved", "Reading replace saved");
    await closeAll();
    assert.equal(writerApplies(since).length, 1);
    assert.equal(await metadataIntentions(landingPath), "null", "metadata still held");
    const card = await waitCard(landingPath, (value) => value?.cardCount === 1
      && JSON.stringify(value.card?.intentions) === JSON.stringify(["Second landing value"]), "Reading paints the second held write");
    await shot("intention-landing-reading-overlay", "Reading");
    return card.card;
  });
  await step("landing-overlay-settles-on-metadata", async () => {
    const released = await release();
    assert.ok(released.ok);
    await waitFor(client, overlayFor(landingPath), (value) => value === false, "overlay settles on matching metadata", 15_000);
    await waitFor(client, `JSON.stringify(app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(${JSON.stringify(landingPath)}))?.frontmatter?.intentions ?? null)`,
      (value) => value === JSON.stringify(["Second landing value"]), "metadata caught up", 15_000);
    const card = await waitCard(landingPath, (value) => value?.cardCount === 1
      && JSON.stringify(value.card?.intentions) === JSON.stringify(["Second landing value"]), "confirmed metadata keeps the value");
    return { released: released.released, card: card.card };
  });
  await step("landing-overlay-last-remove-live", async () => {
    await liveReady(landingPath);
    const held = await client.evaluate(holdMetadata(landingPath));
    assert.ok(held.ok, JSON.stringify(held));
    try {
      await doubleEquals(landingPath);
      await ready((value) => value.path === landingPath);
      await key("1");
      await ready((value) => value.selected === "intention:0");
      await key("d", 2);
      await ready((value) => value.status === "saved" && value.fields?.intentions?.length === 0, "last remove saved");
      await closeAll();
      assert.equal(await metadataIntentions(landingPath), JSON.stringify(["Second landing value"]), "metadata still lists the removed intention");
      // The card stays as the title block; the intention bands disappear
      // (and the rows are released) before metadata catches up.
      const bare = await waitCard(landingPath, (value) => value?.cardCount === 1 && value.card?.intentions?.length === 0
        && !value.rows.some((row) => row.owned), "removing the last field drops the bands before metadata");
      await shot("intention-landing-last-remove-overlay", "Live Preview");
      return { cardCount: bare.cardCount, intentions: bare.card.intentions, title: bare.card.title };
    } finally {
      await release();
      await waitFor(client, overlayFor(landingPath), (value) => value === false, "overlay settles after the remove", 15_000).catch(() => null);
    }
  });

  // ---- Reviewed stale retries on today, with a second Source pane ----
  const todaySubject = ctx.seeded.today.id;
  const openSourcePane = async () => {
    await liveReady(plan.paths.today);
    await client.evaluate(`(async () => {
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(plan.paths.today)});
      const leaf = app.workspace.getLeaf("split", "vertical");
      await leaf.openFile(file, { state: { mode: "source", source: true } });
      window.__landingSourceLeaf = leaf;
      const first = app.workspace.getLeavesOfType("markdown").find((item) => item !== leaf && item.view?.file?.path === file.path);
      app.workspace.setActiveLeaf(first, { focus: true });
    })()`);
    await sleep(600);
  };
  const insertElsewhere = async (text) => {
    const done = await client.evaluate(`(async () => {
      const view = window.__landingSourceLeaf.view;
      const disk = await app.vault.adapter.read(${JSON.stringify(plan.paths.today)});
      if (view.editor.getValue() !== disk) view.editor.setValue(disk);
      const value = view.editor.getValue();
      const next = value.replace(/^intentions:\\n([ \\t]*)- /m, (_match, indent) =>
        "intentions:\\n" + indent + "- " + JSON.stringify(${JSON.stringify(text)}) + "\\n" + indent + "- ");
      if (next === value) return { ok: false };
      view.editor.setValue(next);
      await view.save();
      return { ok: true };
    })()`);
    assert.ok(done.ok, "external insert failed");
    await waitFor(client, `JSON.stringify(app.metadataCache.getCache(${JSON.stringify(plan.paths.today)})?.frontmatter?.intentions || [])`,
      (value) => value.includes(text), "external insert metadata", 15_000);
  };
  await step("landing-cancel-leaves-no-retry", async () => {
    await openSourcePane();
    await doubleEquals(plan.paths.today);
    let state = await ready((value) => value.path === plan.paths.today);
    landing.todayBefore = state.fields.intentions;
    await key("2");
    await ready((value) => value.selected === "intention:1");
    await insertElsewhere("Inserted elsewhere first");
    const since = ctx.invocations().length;
    await key("d", 2);
    state = await ready((value) => value.status === "stale" && value.retained, "stale remove retained");
    let more = await extra();
    assert.equal(more.retained.kind, "remove");
    await key("q");
    state = await ready((value) => value.retained === null && value.status === "browsing", "q discards the retained retry");
    assert.ok(await modal(), "q discarded one layer instead of closing");
    await key("Enter");
    state = await ready((value) => value.stage === "intention", "Enter edits instead of running a discarded write");
    await key("Escape");
    await ready((value) => value.stage === null);
    assert.equal(writerApplies(since).length, 0, "a discarded retry reached the writer");
    more = await extra();
    return { status: state.status, retained: more.retained };
  });
  await step("landing-stale-remove-retargets", async () => {
    let state = await ready((value) => value.path === plan.paths.today);
    const target = state.fields.intentions[2];
    await key("3");
    await ready((value) => value.selected === "intention:2");
    await insertElsewhere("Inserted elsewhere second");
    const before = vault();
    const since = ctx.invocations().length;
    await key("d", 2);
    state = await ready((value) => value.status === "stale" && value.retained, "second stale remove retained");
    const more = await extra();
    assert.equal(more.retained.kind, "remove");
    assert.equal(state.selected, "intention:3", "the target is selected against the refreshed list");
    assert.ok(state.hint.includes("Enter removes “" + target + "” (#4)"), "retry target not shown: " + state.hint);
    assert.equal(writerApplies(since).length, 0, "the stale remove reached the writer");
    await ctx.shot("intention-landing-stale-remove-retained", "Card editor");
    await key("Enter");
    await ready((value) => value.status === "saved" && value.retained === null, "reviewed retry saved");
    const applies = writerApplies(since);
    assert.equal(applies.length, 1);
    const envelope = JSON.parse(applies[0].input);
    assert.deepEqual(envelope.ops, [{ op: "intentions.remove", index: 3 }], "the retry kept the remove and its target");
    const after = onlyChanged(before, plan.paths.today, "stale remove retry");
    const intentions = ctx.readFields(todaySubject).after.intentions;
    assert.ok(!intentions.includes(target), "the target survived");
    assert.ok(intentions.includes("Inserted elsewhere second") && intentions.includes("Inserted elsewhere first"), "an elsewhere insert was lost");
    await closeAll();
    await client.evaluate("window.__landingSourceLeaf?.detach?.(); delete window.__landingSourceLeaf;");
    landing.staleRemove = { target, ops: envelope.ops, intentions, bytes: after[plan.paths.today].length };
    return landing.staleRemove;
  });

  // ---- Busy window: a slowed Undo against competing keys and clicks ----
  await step("landing-undo-busy-guard", async () => {
    await liveReady(plan.paths.today);
    await doubleEquals(plan.paths.today);
    await ready((value) => value.path === plan.paths.today);
    const since = ctx.invocations().length;
    fs.writeFileSync(ctx.delayFlag, "2500");
    try {
      await key("u");
      await waitFor(client, `${PLUGIN}.intentionCardEditorModal?.pendingApply === true`, Boolean, "Undo pending", 5000);
      await key("d", 2); await key("j", 1); await key("]"); await key("="); await key("y");
      await key("Escape"); await key("q"); await key("Enter");
      const during = await client.evaluate(`(() => {
        const m = ${PLUGIN}.intentionCardEditorModal;
        const pendingBefore = m.pendingApply;
        m.contentEl.querySelector('[data-intention-key="intention:0"]')?.click();
        // The modal's X: '.modal-close-button' on older Obsidian, an x-icon
        // '.modal-header-button' on current builds.
        const button = m.modalEl.querySelector('.modal-close-button')
          || m.modalEl.querySelector('.modal-header-button .lucide-x')?.closest('.modal-header-button') || null;
        button?.click();
        return { path: m.subjectPath, stage: m.stage ? m.stage.kind : null, closed: m.closed, closeRequested: m.closeRequested,
          pending: m.pendingApply, pendingBefore, button: button ? button.className : null };
      })()`);
      assert.equal(during.path, plan.paths.today, "travel superseded the in-flight Undo");
      assert.equal(during.stage, null);
      assert.equal(during.pendingBefore, true, "the Undo settled before the competing input: " + JSON.stringify(during));
      assert.ok(during.button, "no modal close button: " + JSON.stringify(during));
      assert.equal(during.closed, false, "a pointer close superseded the in-flight Undo");
      assert.equal(during.closeRequested, true, "the X click did not request a deferred close: " + JSON.stringify(during));
      assert.equal(during.pending, true);
      await closed();
      const applies = writerApplies(since);
      assert.equal(applies.length, 1, "a competing key or click started a second mutation");
      assert.deepEqual(JSON.parse(applies[0].input).ops.map((op) => op.op), ["intentions.set"], "only the Undo inverse op ran");
      const intentions = ctx.readFields(todaySubject).after.intentions;
      assert.ok(intentions.includes(landing.staleRemove.target), "Undo did not restore the removed intention");
      return { during, intentions };
    } finally {
      fs.rmSync(ctx.delayFlag, { force: true });
    }
  });

  // ---- Undo restores agent provenance inside the open modal ----
  await step("landing-undo-restores-modal-provenance", async () => {
    await ctx.open(plan.paths.stamped, "live");
    await doubleEquals(plan.paths.stamped);
    await ready((value) => value.path === plan.paths.stamped && value.fields?.summaryState === "agent", "agent summary");
    await key("s"); await key("Enter");
    await ready((value) => value.stage === "summary");
    await selectAll(); await typeText("Edited for the landing proof.");
    await key("Enter");
    let state = await ready((value) => value.stage === null && value.status === "saved" && value.fields?.summaryState === "edited", "edited summary");
    let row = (await extra()).rows.find((item) => item.key === "summary");
    assert.match(row.text, /Summary ✎ edited — Edited for the landing proof\./);
    await key("u");
    state = await ready((value) => value.fields?.summaryState === "agent" && value.fields.summary === plan.stampedSummary, "undo restored agent text");
    row = (await extra()).rows.find((item) => item.key === "summary");
    const date = lib.monthDayLabel(plan.stampedDrafted);
    assert.ok(row.text.includes("Summary ✦ agent · " + date), "restored provenance missing without a reopen: " + row.text);
    assert.equal(state.fields.summaryDrafted, plan.stampedDrafted);
    await ctx.shot("intention-landing-undo-provenance", "Card editor");
    return { row: row.text };
  });

  // ---- Reflection: summary context above, auto-growth, caret ----
  await step("landing-reflection-summary-context", async () => {
    await ready((value) => value.path === plan.paths.stamped && value.stage === null);
    await key("r");
    await ready((value) => value.stage === "reflection" && value.focus?.input === "reflection", "reflection stage");
    const more = await extra();
    const contextIndex = more.stageOrder.indexOf("bob-intention-stage-context");
    const areaIndex = more.stageOrder.findIndex((name) => /is-reflection/.test(name));
    assert.ok(contextIndex >= 0 && contextIndex < areaIndex, "summary context is not above the textarea: " + JSON.stringify(more.stageOrder));
    assert.ok(more.context.startsWith("Summary · ✦ agent"), "context lacks provenance: " + more.context);
    assert.ok(more.context.includes(plan.stampedSummary), "context lacks the summary text");
    for (const [theme, width, name] of [["light", 1400, "light"], ["dark", 1400, "dark"], ["light", 420, "narrow"]]) {
      await styledShot(ctx, "intention-landing-reflection-context-" + name, "Card editor", theme, width);
    }
    return { order: more.stageOrder, context: more.context };
  });
  await step("landing-reflection-autogrow", async () => {
    const start = (await extra()).area;
    await key("End", 2);
    for (let line = 0; line < 5; line += 1) {
      await key("Enter", 8);
      await typeText("Autogrow line " + (line + 1));
    }
    const grown = (await extra()).area;
    assert.ok(grown.height > start.height + 40, "textarea did not grow on input: " + JSON.stringify({ start, grown }));
    assert.ok(grown.scroll <= grown.client + 2, "grown textarea still scrolls: " + JSON.stringify(grown));
    assert.equal(grown.start, grown.length, "caret moved while growing");
    await client.evaluate(`require('electron').clipboard.writeText(${JSON.stringify("\nPasted one\nPasted two\nPasted three")})`);
    await key("v", 2);
    await sleep(150);
    const pasted = (await extra()).area;
    assert.ok(pasted.height > grown.height + 30, "textarea did not grow on paste: " + JSON.stringify({ grown, pasted }));
    await client.evaluate(`${PLUGIN}.intentionCardEditorModal.paintIntentionCard()`);
    const repainted = (await extra()).area;
    assert.equal(repainted.styleHeight, pasted.styleHeight, "repaint lost the grown height");
    assert.equal(repainted.start, pasted.start, "repaint moved the caret");
    assert.ok(repainted.focused, "repaint lost focus");
    for (const [theme, width, name] of [["light", 1400, "light"], ["dark", 1400, "dark"], ["light", 420, "narrow"]]) {
      await styledShot(ctx, "intention-landing-reflection-grown-" + name, "Card editor", theme, width);
    }
    const before = vault();
    await key("Escape");
    await ready((value) => value.stage === null, "canceled reflection draft");
    assert.equal(JSON.stringify(vault()), JSON.stringify(before), "a canceled reflection wrote");
    await closeAll();
    return { start, grown, pasted, repainted };
  });

  // ---- Alt+J: shared arrange animation on stable rows ----
  await step("landing-reorder-arrange-animation", async () => {
    await liveReady(plan.paths.today);
    await doubleEquals(plan.paths.today);
    const state = await ready((value) => value.path === plan.paths.today && value.fields?.intentions?.length >= 2);
    const list = state.fields.intentions;
    await key("1");
    await ready((value) => value.selected === "intention:0");
    await client.evaluate(`(() => {
      const m = ${PLUGIN}.intentionCardEditorModal;
      window.__arrangeMoves = [];
      window.__arrangeObserver?.disconnect?.();
      window.__arrangeObserver = new MutationObserver((records) => {
        for (const record of records) {
          const node = record.target;
          if (node.classList?.contains('bob-intention-row') && /translate\\(/.test(node.style.transform || '')) {
            window.__arrangeMoves.push({ id: node.getAttribute('data-arrange-id'), transform: node.style.transform });
          }
        }
      });
      window.__arrangeObserver.observe(m.contentEl, { subtree: true, attributes: true, attributeFilter: ['style'] });
    })()`);
    const expected = [list[1], list[0], ...list.slice(2)];
    const result = await writeStep("landing-reorder-arrange-animation", plan.paths.today, todaySubject, async () => {
      await key("j", 1);
      return ready((value) => value.status === "saved" && value.selected === "intention:1", "reorder saved with selection kept");
    }, { intentions: expected });
    const moves = await client.evaluate("(() => { window.__arrangeObserver?.disconnect?.(); return window.__arrangeMoves || []; })()");
    const ids = new Set(moves.map((move) => move.id));
    assert.ok(ids.size >= 2, "the swapped rows did not animate: " + JSON.stringify(moves));
    const more = await extra();
    assert.equal(more.rows[1].current, true, "selection left the moved row");
    assert.ok(more.rows[1].arrange.endsWith(":" + list[0]), "rows lack stable arrange ids: " + JSON.stringify(more.rows));
    for (const [theme, width, name] of [["light", 1400, "light"], ["dark", 1400, "dark"], ["light", 420, "narrow"]]) {
      await styledShot(ctx, "intention-landing-reorder-" + name, "Card editor", theme, width);
    }
    await closeAll();
    return { moves, applies: result.applies, rows: more.rows };
  });
}

const lib = require("./obsidian-intention-card-e2e-lib.cjs");

function selfTest() {
  new Function("return " + holdMetadata("2026/20261119.md"));
  new Function("return " + RELEASE_METADATA);
  new Function("return " + LANDING_MODAL);
  assert.equal(new Set(LANDING_CHECKS).size, LANDING_CHECKS.length);
  return true;
}

module.exports = { LANDING_CHECKS, LANDING_MODAL, holdMetadata, runLandingWorkflows, selfTest };
