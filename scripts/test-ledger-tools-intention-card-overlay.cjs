// Applied-write overlays through the real intention-card host: a modal write
// runs the guarded session, pushes the overlay, and the Reading and Live
// Preview display model must bridge deliberately delayed metadata (match,
// still-prior, later conflict, expiry, parent refresh, first add, last
// remove) without painting a pending preview or bypassing a gate.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  loadLedgerTools, editorLivePreviewField, fakeTimers, fakeVault, flush, installBobSimulator, simulatorDigest,
} = require("./intention-card-test-helpers.cjs");

const LedgerToolsPlugin = loadLedgerTools();
const H = LedgerToolsPlugin.helpers;

const DAY = "2026/20261119.md";
const WEEK = "2026/2026-W47.md";
const SUBJECTS = { "2026-11-19": DAY, "2026-W47": WEEK };

function hostPlugin(vault) {
  const plugin = new LedgerToolsPlugin(vault.app);
  const timers = fakeTimers(plugin);
  plugin.intentionCardToday = () => "2026-11-19";
  plugin.intentionCardEditorToday = () => "2026-11-19";
  plugin.setupIntentionCard();
  plugin.setupIntentionUpdate();
  plugin.setupIntentionCardEditor();
  return { plugin, timers };
}

function modalFor(plugin, vault, path = DAY, subject = "2026-11-19") {
  const read = plugin.intentionCardEditorReadFields(path);
  return new H.IntentionCardModal(vault.app, {
    plugin, subject, subjectPath: path, state: "open", fields: read.ok ? read.fields : null, fingerprint: "",
  });
}

// What Reading paints: the host model from cached/confirmed source.
function readingModel(plugin, path = DAY) {
  return plugin.intentionCardModelFor(path)?.model || null;
}

// What Live Preview paints: the decoration widget built from editor text.
function liveModel(plugin, vault, path = DAY) {
  const view = {
    dom: { closest: () => null, ownerDocument: vault.app.document },
    state: {
      doc: { toString: () => vault.disk.get(path) },
      field: (field) => field === editorLivePreviewField,
    },
  };
  plugin.notebookCatalogLivePath = () => path;
  const built = plugin.buildIntentionCardDecorations(view);
  const range = built?.ranges?.[0];
  if (!range) return null;
  const signature = JSON.parse(range.value.spec.widget.signature);
  return signature[2];
}

async function saveIntention(modal, key, value) {
  assert.equal(modal.intentionOpenStage("intention", key), true);
  modal.stageDraft = value;
  return modal.intentionSaveStage();
}

test("an applied write paints at once while metadata lags, survives still-prior metadata, and settles on match", async () => {
  const vault = fakeVault();
  vault.seed(DAY, { intentions: ["Old"] });
  const { plugin } = hostPlugin(vault);
  installBobSimulator(plugin, vault, SUBJECTS);
  await plugin.intentionCardEnsureSource(DAY);
  assert.deepEqual(readingModel(plugin).intentions, ["Old"]);

  const modal = modalFor(plugin, vault);
  await modal.intentionInitialRead();
  const applied = await saveIntention(modal, "intention:0", "Saved");
  assert.equal(applied.ok, true);
  assert.deepEqual(vault.caches.get(DAY).frontmatter.intentions, ["Old"], "metadata is still the prior snapshot");
  assert.ok(plugin.intentionCardOverlayFor(DAY), "the applied write pushed an overlay");
  assert.deepEqual(readingModel(plugin).intentions, ["Saved"], "Reading paints the applied value, not the stale cache");
  assert.deepEqual(liveModel(plugin, vault).intentions, ["Saved"], "Live Preview paints it from the rewritten editor text");

  // A metadata event that still describes the prior snapshot (the pane flush
  // before the write, say) keeps the overlay; the display never regresses.
  vault.index(DAY, { intentions: ["Old"] });
  await flush();
  assert.ok(plugin.intentionCardOverlayFor(DAY), "still-prior metadata keeps the overlay");
  assert.deepEqual(readingModel(plugin).intentions, ["Saved"]);

  vault.index(DAY);
  await flush();
  assert.equal(plugin.intentionCardOverlayFor(DAY), null, "matching metadata settles the overlay");
  assert.deepEqual(readingModel(plugin).intentions, ["Saved"], "confirmed source now paints the same value");
  modal.close();
  plugin.teardownIntentionCardEditor();
  plugin.teardownIntentionCard();
});

test("a later conflicting owned-field update discards the overlay", async () => {
  const vault = fakeVault();
  vault.seed(DAY, { intentions: ["Old"] });
  const { plugin } = hostPlugin(vault);
  installBobSimulator(plugin, vault, SUBJECTS);
  await plugin.intentionCardEnsureSource(DAY);
  const modal = modalFor(plugin, vault);
  await modal.intentionInitialRead();
  await saveIntention(modal, "intention:0", "Saved");
  assert.deepEqual(readingModel(plugin).intentions, ["Saved"]);

  vault.write(DAY, { intentions: ["Edited in another pane"] });
  vault.index(DAY);
  await flush();
  assert.equal(plugin.intentionCardOverlayFor(DAY), null);
  assert.deepEqual(readingModel(plugin).intentions, ["Edited in another pane"]);
  modal.close();
  plugin.teardownIntentionCard();
});

test("an overlay expires on its bounded timer when metadata never arrives", async () => {
  const vault = fakeVault();
  vault.seed(DAY, { intentions: ["Old"] });
  const { plugin, timers } = hostPlugin(vault);
  installBobSimulator(plugin, vault, SUBJECTS);
  await plugin.intentionCardEnsureSource(DAY);
  const modal = modalFor(plugin, vault);
  await modal.intentionInitialRead();
  await saveIntention(modal, "intention:0", "Saved");
  const expiry = [...timers.entries()].find(([, timer]) => timer.ms === 8000);
  assert.ok(expiry, "an 8s overlay expiry is armed");
  timers.delete(expiry[0]);
  expiry[1].fn();
  assert.equal(plugin.intentionCardOverlayFor(DAY), null);
  assert.deepEqual(readingModel(plugin).intentions, ["Old"], "after expiry only confirmed metadata paints");
  modal.close();
  plugin.teardownIntentionCard();
});

test("the first field on an empty note mounts the card; removing the last one unmounts it", async () => {
  const vault = fakeVault();
  vault.seed(DAY, {});
  const { plugin } = hostPlugin(vault);
  installBobSimulator(plugin, vault, SUBJECTS);
  await plugin.intentionCardEnsureSource(DAY);
  assert.equal(readingModel(plugin), null, "an empty note shows no card");

  const modal = modalFor(plugin, vault);
  await modal.intentionInitialRead();
  assert.equal(modal.selectedKey, "add");
  await saveIntention(modal, "add", "First");
  assert.deepEqual(readingModel(plugin).intentions, ["First"], "the first add paints before metadata catches up");
  assert.deepEqual(liveModel(plugin, vault).intentions, ["First"]);
  vault.index(DAY);
  await flush();
  assert.equal(plugin.intentionCardOverlayFor(DAY), null);

  modal.intentionSelect("intention:0");
  await modal.intentionRemove();
  assert.deepEqual(vault.caches.get(DAY).frontmatter.intentions, ["First"], "metadata still lists the removed intention");
  assert.equal(readingModel(plugin), null, "removing the last visible field removes the card at once");
  assert.equal(liveModel(plugin, vault), null);
  modal.close();
  plugin.teardownIntentionCard();
});

test("a parent overlay refreshes the child card's parent line before metadata catches up", async () => {
  const vault = fakeVault();
  vault.seed(DAY, { intentions: ["Day work"] });
  vault.seed(WEEK, { intentions: ["Old week"] }, "# 2026-W47\n");
  const { plugin } = hostPlugin(vault);
  installBobSimulator(plugin, vault, SUBJECTS);
  await plugin.intentionCardEnsureSource(WEEK);
  await plugin.intentionCardEnsureSource(DAY);
  assert.deepEqual(readingModel(plugin).parentIntentions, ["Old week"]);
  const week = modalFor(plugin, vault, WEEK, "2026-W47");
  await week.intentionInitialRead();
  await saveIntention(week, "intention:0", "Protect a quiet morning");
  assert.deepEqual(readingModel(plugin).parentIntentions, ["Protect a quiet morning"]);
  vault.index(WEEK);
  await flush();
  assert.equal(plugin.intentionCardOverlayFor(WEEK), null);
  assert.deepEqual(readingModel(plugin).parentIntentions, ["Protect a quiet morning"]);
  week.close();
  plugin.teardownIntentionCard();
});

test("summary provenance follows the writer: Undo restores agent stamps, edits never reuse an old digest", async () => {
  const vault = fakeVault();
  const drafted = "Shipped the card; the rest waits.";
  vault.seed(DAY, { intentions: ["One"], summary: drafted, summary_digest: simulatorDigest(drafted), summary_drafted: "2026-11-18" });
  const { plugin } = hostPlugin(vault);
  installBobSimulator(plugin, vault, SUBJECTS);
  await plugin.intentionCardEnsureSource(DAY);
  assert.equal(readingModel(plugin).summaryState, "agent");

  const modal = modalFor(plugin, vault);
  await modal.intentionInitialRead();
  assert.equal(modal.fields.summaryState, "agent");
  assert.equal(modal.intentionOpenStage("summary", "summary"), true);
  modal.stageDraft = "My own words.";
  await modal.intentionSaveStage();
  assert.equal(modal.fields.summaryState, "edited");
  let model = readingModel(plugin);
  assert.equal(model.summary, "My own words.");
  assert.equal(model.summaryState, "edited", "the old metadata digest never vouches for new text");
  assert.equal(model.summaryDrafted, "");

  vault.index(DAY);
  await flush();
  await modal.intentionUndo();
  assert.equal(modal.fields.summary, drafted);
  assert.equal(modal.fields.summaryState, "agent", "Undo's reported provenance reaches the open modal");
  assert.equal(modal.fields.summaryDrafted, "2026-11-18", "the restore op's date shows without a reopen");
  model = readingModel(plugin);
  assert.equal(model.summary, drafted);
  assert.equal(model.summaryState, "agent", "the overlay keeps the restored provenance over edited metadata");
  assert.equal(model.summaryDrafted, "2026-11-18");
  modal.close();
  plugin.teardownIntentionCard();
});

test("overlays never bypass display gates or paint previews", async () => {
  const vault = fakeVault();
  vault.seed(DAY, { intentions: ["Old"] });
  const { plugin } = hostPlugin(vault);
  const calls = installBobSimulator(plugin, vault, SUBJECTS);
  await plugin.intentionCardEnsureSource(DAY);
  const modal = modalFor(plugin, vault);
  await modal.intentionInitialRead();
  modal.intentionOpenStage("intention", "intention:0");
  modal.stageDraft = "Previewed only";
  const session = modal.ensureIntentionSession();
  session.setDraft([{ op: "intentions.replace", index: 0, value: "Previewed only" }]);
  await session.previewNow();
  assert.ok(calls.some((call) => call.dryRun), "a preview ran");
  assert.equal(plugin.intentionCardOverlayFor(DAY), null, "a preview pushes no overlay");
  assert.deepEqual(readingModel(plugin).intentions, ["Old"]);

  modal.stageDraft = "Saved";
  await modal.intentionSaveStage();
  // Malformed editor source stays a fail-open refusal even with an overlay.
  const broken = "---\n{not json\n---\n\n# Thu\n";
  const view = { dom: { closest: () => null, ownerDocument: vault.app.document }, state: { doc: { toString: () => broken }, field: (f) => f === editorLivePreviewField } };
  plugin.notebookCatalogLivePath = () => DAY;
  assert.deepEqual(plugin.buildIntentionCardDecorations(view).ranges, []);
  // Embeds, Source mode, and mobile gates still refuse before any model.
  assert.equal(plugin.intentionCardCanDisplay(DAY, { closest: () => ({}) }), false);
  plugin.intentionCardDesktop = () => false;
  assert.equal(plugin.intentionCardCanDisplay(DAY, { closest: () => null }), false);
  assert.equal(plugin.intentionCardLivePath(view), null);
  modal.close();
  plugin.teardownIntentionCard();
});

test("a source read that outlives a metadata change or unload never resurrects old content", async () => {
  const vault = fakeVault();
  vault.seed(DAY, { intentions: ["Old"] });
  const { plugin } = hostPlugin(vault);
  const gate = vault.holdNextRead();
  const late = plugin.intentionCardEnsureSource(DAY);
  vault.seed(DAY, { intentions: ["New"] });
  vault.index(DAY);
  gate.resolve();
  assert.equal(await late, null, "the superseded read is dropped");
  await flush();
  assert.deepEqual(plugin.intentionCardSourceCache.get(DAY)?.frontmatter?.intentions, ["New"]);

  const unloadGate = vault.holdNextRead();
  plugin.intentionCardInvalidateSource(DAY);
  const orphan = plugin.intentionCardEnsureSource(DAY);
  plugin.teardownIntentionCard();
  unloadGate.resolve();
  assert.equal(await orphan, null);
  assert.equal(plugin.intentionCardSourceCache.size, 0, "unload leaves no late cache entry");
});
