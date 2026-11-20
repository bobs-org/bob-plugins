"use strict";
// Real-input intention card editor workflows for the isolated Obsidian proof:
// entry gestures, close aliases, the yesterday compositions, guarded writes
// with Undo, navigation, palette/Command Mode/Ctrl+Shift+P entries, the YAML
// excursion, two-pane stale drafts, body-edit survival, and old-bob refusal.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const lib = require("./obsidian-intention-card-e2e-lib.cjs");
const proof = require("./obsidian-record-card-workflow-lib.cjs");
const landing = require("./obsidian-intention-card-landing-workflows.cjs");

// One authored intention line, quoted or bare, as the writer may serialize it.
const WALK_LINE = String.raw`^(\s*-\s*)(["']?)Walk after lunch\2[ \t]*$`;

const MODAL = `(() => {
  const m = app.plugins.plugins['bob-ledger-tools']?.intentionCardEditorModal;
  if (!m || m.closed) return null;
  const input = m.contentEl.querySelector('[data-intention-input]');
  const active = document.activeElement;
  const textual = active && typeof active.value === 'string';
  return {
    path: m.subjectPath, subject: m.subject, state: m.subjectState, selected: m.selectedKey,
    stage: m.stage ? m.stage.kind : null, stageField: m.stage ? m.stage.field : null, stageIndex: m.stage ? m.stage.index : null,
    draft: m.stageDraft, note: m.stageNote, status: m.statusKind, writable: m.writable,
    missing: m.missing, malformed: m.malformed, pending: m.pendingApply,
    refusal: m.refusalMessage, hint: m.refusalHint, fields: m.fields, fingerprint: m.fingerprint, retained: m.retained,
    text: m.contentEl.textContent,
    hint4: m.contentEl.querySelector('.bob-intention-editor-hint')?.textContent || '',
    focus: active ? { tag: active.tagName, key: active.getAttribute('data-intention-key'), input: active.getAttribute('data-intention-input'),
      inModal: m.contentEl.contains(active), start: textual ? active.selectionStart : null, end: textual ? active.selectionEnd : null,
      value: textual ? active.value : null } : null,
    inputValue: input ? input.value : null,
    activePath: app.workspace.activeLeaf?.view?.file?.path || null,
  };
})()`;

async function runWorkflows(ctx) {
  const { client, report, plan, attempt, key, keys, open, waitCard, shot, vault, writerApplies, placeCursor, sleep, waitFor, readFields } = ctx;
  const evidence = report.workflows = { steps: [], writes: [], recoveries: [] };
  // A failed step must not leak its modal or panes into the next step.
  const recover = async (name) => {
    const state = await client.evaluate(`(() => {
      const before = { modal: Boolean(app.plugins.plugins['bob-ledger-tools']?.intentionCardEditorModal && !app.plugins.plugins['bob-ledger-tools'].intentionCardEditorModal.closed),
        containers: document.querySelectorAll('.modal-container').length };
      try { app.plugins.plugins['bob-ledger-tools'].intentionCardEditorModal?.close(); } catch (_) {}
      for (const el of Array.from(document.querySelectorAll('.modal-container .modal-close-button'))) { try { el.click(); } catch (_) {} }
      return before;
    })()`).catch((error) => ({ error: String(error.message || error) }));
    evidence.recoveries.push({ after: name, state });
    await sleep(300);
  };
  const step = async (name, fn) => {
    let failed = false;
    await attempt(name, async () => {
      try { return await fn(); } catch (error) { failed = true; throw error; }
    });
    if (failed) await recover(name);
  };
  // Opens the card editor on a note unless it is already open there.
  const ensureModal = async (notePath) => {
    const current = await client.evaluate(MODAL);
    if (current && current.path === notePath && !current.stage) return ready();
    if (current) await closeAll();
    await liveReady(notePath);
    await doubleEquals(notePath);
    return ready((value) => value.path === notePath, "card editor on " + notePath);
  };
  const modal = () => client.evaluate(MODAL);
  const ready = (predicate = () => true, label = "ready card editor") => waitFor(client, MODAL,
    (value) => value && !value.pending && value.status !== "reading" && value.status !== "saving" && predicate(value), label, 30_000);
  const closed = () => waitFor(client, MODAL, (value) => value === null, "card editor closed", 15_000);
  const closeAll = async () => {
    for (let i = 0; i < 4 && await modal(); i += 1) { await key("Escape"); await sleep(120); }
    await closed();
    for (let i = 0; i < 3; i += 1) {
      const open = await client.evaluate("document.querySelectorAll('.modal-container').length");
      if (!open) break;
      await key("Escape"); await sleep(150);
    }
  };
  const normal = async (notePath, needle) => {
    const placed = await placeCursor(needle, notePath);
    assert.ok(placed.ok, "cursor placement failed: " + JSON.stringify(placed));
    await key("Escape"); await sleep(80);
  };
  const liveReady = async (notePath) => { await open(notePath, "live"); await waitCard(notePath).catch(() => null); };
  const doubleEquals = async (notePath, needle = "Body sentinel") => {
    await normal(notePath, needle);
    await keys(["=", "="]);
  };
  const typeText = async (text) => { await client.call("Input.insertText", { text }); await sleep(60); };
  const selectAll = async () => key("a", 2);
  const disk = (notePath) => fs.readFileSync(path.join(ctx.vaultDir, notePath), "utf8");
  const sameVault = (before, label) => {
    const after = vault();
    assert.deepEqual(Object.keys(after), Object.keys(before), label + ": Markdown inventory changed");
    for (const name of Object.keys(before)) assert.equal(after[name], before[name], label + ": bytes changed in " + name);
  };
  const onlyChanged = (before, allowed, label) => {
    const after = vault();
    assert.deepEqual(Object.keys(after), Object.keys(before), label + ": Markdown inventory changed");
    for (const name of Object.keys(before)) if (name !== allowed) assert.equal(after[name], before[name], label + ": wrong-note write in " + name);
    return after;
  };
  const writeStep = async (name, notePath, subject, action, expectFields, options = {}) => {
    const before = vault();
    const since = ctx.invocations().length;
    const state = await action();
    const fresh = await waitFor(client, `(() => {
      const fm = app.metadataCache.getCache(${JSON.stringify(notePath)})?.frontmatter || {};
      return { intentions: fm.intentions ?? null, summary: fm.summary ?? null, reflection: fm.reflection ?? null };
    })()`, (value) => Object.entries(expectFields).every(([field, want]) => JSON.stringify(value[field]) === JSON.stringify(want)), name + " metadata", 20_000);
    const after = onlyChanged(before, notePath, name);
    const bobRead = readFields(subject);
    for (const [field, want] of Object.entries(expectFields)) {
      assert.deepEqual(bobRead.after[field] ?? null, want, name + ": bob read of " + field);
    }
    lib.assertUnownedBytesKept(before[notePath], after[notePath], options.extraBody || null);
    const applies = writerApplies(since);
    assert.ok(applies.length >= 1, name + ": no real writer apply was invoked");
    for (const entry of applies) {
      const envelope = JSON.parse(entry.input);
      assert.match(envelope.expect || "", /^sha256:[0-9a-f]{64}$/, name + ": apply envelope lacks the server fingerprint");
    }
    evidence.writes.push({ name, notePath, applies: applies.map((entry) => ({ args: entry.args, input: entry.input })), fields: bobRead.after });
    return { state, fresh, bobRead: bobRead.after, applies: applies.length };
  };

  // ---- Entry and initial selection ----
  await step("editor-empty-double-equals", async () => {
    await open(plan.paths.empty, "live");
    const before = vault();
    await doubleEquals(plan.paths.empty);
    const state = await ready();
    assert.equal(state.path, plan.paths.empty);
    // The empty day is closed: it lands on Reflection, with Add available.
    assert.equal(state.state, "closed");
    assert.equal(state.selected, "reflection");
    assert.equal(state.stage, null);
    assert.equal(state.focus?.key, "reflection", "browse focus is not on the selected row");
    assert.match(state.text, /Add intention/);
    assert.deepEqual(state.fields.intentions, []);
    await shot("intention-editor-empty-add", "Card editor");
    await closeAll();
    sameVault(before, "empty ==");
    return state;
  });
  await step("editor-open-initial-selection", async () => {
    await liveReady(plan.paths.today);
    await doubleEquals(plan.paths.today);
    const state = await ready();
    assert.equal(state.path, plan.paths.today);
    assert.equal(state.state, "open");
    assert.equal(state.selected, "intention:0");
    assert.equal(state.focus?.key, "intention:0");
    assert.equal(state.stage, null);
    await shot("intention-editor-open-browse", "Card editor");
    return state;
  });
  await step("close-q-browse", async () => {
    await key("q"); await closed();
    return { closedBy: "q" };
  });
  await step("editor-closed-initial-selection", async () => {
    await liveReady(plan.paths.yesterday);
    await doubleEquals(plan.paths.yesterday);
    const state = await ready();
    assert.equal(state.state, "closed");
    assert.equal(state.selected, "reflection");
    assert.equal(state.focus?.key, "reflection");
    await shot("intention-editor-closed-browse", "Card editor");
    return state;
  });
  await step("close-ctrl-bracket-browse", async () => {
    await key("[", 2); await closed();
    return { closedBy: "Ctrl+[" };
  });
  await step("close-escape-browse", async () => {
    await liveReady(plan.paths.today);
    await doubleEquals(plan.paths.today);
    await ready();
    await key("Escape"); await closed();
    return { closedBy: "Escape" };
  });

  // ---- Close aliases inside a stage: q types, Ctrl+[ and Esc back out one layer ----
  const stageBefore = vault();
  await step("close-q-types-in-stage", async () => {
    await ensureModal(plan.paths.today);
    await key("Enter");
    let state = await ready((value) => value.stage === "intention" && value.focus?.input === "intention", "intention stage focus");
    assert.equal(state.focus.start, state.focus.value.length, "caret is not at the end of the intention");
    await key("q");
    state = await ready((value) => value.stage === "intention" && /q$/.test(value.inputValue || ""), "q typed into stage");
    assert.equal(state.draft, plan.intentions.today[0] + "q");
    return { inputValue: state.inputValue };
  });
  await step("close-ctrl-bracket-stage", async () => {
    let open = await modal();
    if (!open || open.stage !== "intention") {
      await ensureModal(plan.paths.today);
      await key("Enter");
      await ready((value) => value.stage === "intention" && value.focus?.input === "intention", "stage for Ctrl+[");
    }
    await key("[", 2);
    const state = await ready((value) => value.stage === null, "Ctrl+[ backs out of stage");
    assert.equal(state.path, plan.paths.today);
    return { stage: state.stage };
  });
  await step("close-escape-stage", async () => {
    await ensureModal(plan.paths.today);
    await key("Enter");
    await ready((value) => value.stage === "intention", "stage reopened");
    await key("Escape");
    const state = await ready((value) => value.stage === null, "Esc backs out of stage");
    await key("Escape"); await closed();
    sameVault(stageBefore, "stage close aliases");
    return { stage: state.stage };
  });

  // ---- Yesterday compositions ----
  const caretInYesterday = (state) => {
    assert.equal(state.path, plan.paths.yesterday, "modal is not pinned to yesterday");
    assert.equal(state.stage, "reflection");
    assert.equal(state.focus?.input, "reflection", "focus is not in the reflection textarea");
    assert.equal(state.focus.tag, "TEXTAREA");
    assert.equal(state.focus.start, state.focus.value.length, "caret is not at the end");
    assert.equal(state.focus.end, state.focus.value.length, "caret is a selection");
    assert.ok(!/r$/.test(state.focus.value), "a literal r reached the textarea");
  };
  await step("yesterday-prev-note-double-equals-r", async () => {
    await liveReady(plan.paths.today);
    const before = vault();
    await normal(plan.paths.today, "Body sentinel");
    await keys(["[", "n"]);
    await waitFor(client, "app.workspace.activeLeaf?.view?.file?.path", (value) => value === plan.paths.yesterday, "[n opened yesterday", 15_000);
    await waitFor(client, "app.workspace.activeLeaf?.view?.editor?.hasFocus?.() === true", Boolean, "yesterday editor focus", 10_000).catch(() => null);
    await key("Escape"); await sleep(60);
    await keys(["=", "=", "r"]);
    const state = await ready((value) => value.stage === "reflection" && value.focus?.input === "reflection", "[n==r reflection stage");
    caretInYesterday(state);
    await shot("intention-editor-prev-note-reflection", "Card editor");
    await key("Escape"); await key("Escape"); await closed();
    sameVault(before, "[n==r");
    return state;
  });
  await step("yesterday-double-equals-bracket-r", async () => {
    await liveReady(plan.paths.today);
    const before = vault();
    await normal(plan.paths.today, "Body sentinel");
    await keys(["=", "=", "[", "r"]);
    const state = await ready((value) => value.stage === "reflection" && value.focus?.input === "reflection", "==[r reflection stage");
    caretInYesterday(state);
    assert.equal(state.activePath, plan.paths.today, "the underlying active note changed");
    await shot("intention-editor-bracket-reflection", "Card editor");
    await key("Escape"); await key("Escape"); await closed();
    sameVault(before, "==[r");
    return state;
  });

  // ---- Field edits on today with real bob ----
  const todaySubject = plan.today;
  let list = plan.intentions.today.slice();
  await step("edit-add-below", async () => {
    await ensureModal(plan.paths.today);
    await key("2"); await ready((value) => value.selected === "intention:1");
    list = [...list, "Read one chapter"];
    return writeStep("edit-add-below", plan.paths.today, todaySubject, async () => {
      await key("o");
      await ready((value) => value.stage === "intention" && value.stageField === "add" && value.focus?.input === "intention", "insert-below stage");
      await typeText("Read one chapter");
      await key("Enter");
      return ready((value) => value.stage === null && value.status === "saved", "add saved");
    }, { intentions: list });
  });
  await step("edit-replace", async () => {
    await ensureModal(plan.paths.today);
    await key("1"); await ready((value) => value.selected === "intention:0");
    list = ["Ship the intention card today", ...list.slice(1)];
    return writeStep("edit-replace", plan.paths.today, todaySubject, async () => {
      await key("Enter");
      await ready((value) => value.stage === "intention" && value.focus?.input === "intention", "replace stage");
      await selectAll(); await typeText("Ship the intention card today");
      await key("Enter");
      return ready((value) => value.stage === null && value.status === "saved", "replace saved");
    }, { intentions: list });
  });
  await step("edit-paste-one-line", async () => {
    await ensureModal(plan.paths.today);
    await key("3"); await ready((value) => value.selected === "intention:2");
    list = [...list, "Pasted first line pasted second line"];
    return writeStep("edit-paste-one-line", plan.paths.today, todaySubject, async () => {
      await key("o");
      await ready((value) => value.stage === "intention" && value.focus?.input === "intention", "paste stage");
      await client.evaluate(`require('electron').clipboard.writeText(${JSON.stringify("Pasted first line\npasted second line")})`);
      await key("v", 2);
      const pasted = await ready((value) => value.inputValue === "Pasted first line pasted second line", "pasted one line");
      assert.ok(pasted.note && /space/i.test(pasted.note), "no quiet paste note: " + JSON.stringify(pasted.note));
      evidence.steps.push({ paste: { inputValue: pasted.inputValue, note: pasted.note } });
      await shot("intention-editor-paste-note", "Card editor");
      await key("Enter");
      return ready((value) => value.stage === null && value.status === "saved", "paste saved");
    }, { intentions: list });
  });
  await step("edit-soft-cap-hint", async () => {
    await ensureModal(plan.paths.today);
    const state = await ready((value) => value.fields?.intentions?.length === 4);
    assert.match(state.hint4, /Three is plenty — what can go\?/);
    await shot("intention-editor-soft-cap", "Card editor");
    return { hint: state.hint4 };
  });
  await step("edit-reorder", async () => {
    await ensureModal(plan.paths.today);
    await key("4"); await ready((value) => value.selected === "intention:3");
    list = [list[0], list[1], list[3], list[2]];
    return writeStep("edit-reorder", plan.paths.today, todaySubject, async () => {
      await key("k", 1);
      return ready((value) => value.selected === "intention:2" && value.fields?.intentions?.[2] === list[2], "reorder settled");
    }, { intentions: list });
  });
  await step("edit-remove", async () => {
    await ensureModal(plan.paths.today);
    await key("2"); await ready((value) => value.selected === "intention:1");
    const removed = list[1];
    list = list.filter((_, index) => index !== 1);
    return writeStep("edit-remove", plan.paths.today, todaySubject, async () => {
      await key("d", 2);
      return ready((value) => value.fields?.intentions?.length === 3 && !value.fields.intentions.includes(removed), "remove settled");
    }, { intentions: list });
  });
  await step("edit-undo", async () => {
    await ensureModal(plan.paths.today);
    list = [list[0], "Walk after lunch", ...list.slice(1)];
    return writeStep("edit-undo", plan.paths.today, todaySubject, async () => {
      await key("u");
      return ready((value) => value.fields?.intentions?.length === 4, "undo settled");
    }, { intentions: list });
  });
  await step("edit-card-repaints", async () => {
    await ensureModal(plan.paths.today);
    await shot("intention-editor-after-edits", "Card editor");
    await closeAll();
    const card = await waitCard(plan.paths.today, (value) => value?.cardCount === 1 && JSON.stringify(value.card?.intentions) === JSON.stringify(list), "card shows edited intentions");
    await shot("intention-card-live-today-after-edits", "Live Preview");
    return card.card;
  });

  // ---- Reflection: multiline + save-and-close on yesterday ----
  await step("edit-reflection-multiline-save-close", async () => {
    await liveReady(plan.paths.yesterday);
    return writeStep("edit-reflection-multiline-save-close", plan.paths.yesterday, plan.yesterday, async () => {
      await doubleEquals(plan.paths.yesterday);
      await ready();
      await key("r");
      await ready((value) => value.stage === "reflection" && value.focus?.input === "reflection", "reflection stage");
      await typeText("First line of the reflection.");
      await key("Enter", 8);
      await typeText("Second line after Shift+Enter.");
      const state = await ready((value) => value.inputValue === "First line of the reflection.\nSecond line after Shift+Enter.", "multiline draft");
      await shot("intention-editor-reflection-multiline", "Card editor");
      await key("Enter", 2);
      await closed();
      return state;
    }, { reflection: "First line of the reflection.\nSecond line after Shift+Enter." });
  });
  await step("edit-reflection-repaints-card", async () => {
    const card = await waitCard(plan.paths.yesterday, (value) => value?.cardCount === 1 && /Second line/.test(value.card?.reflection || "") && !/reflection r/.test(value.card?.missing || ""), "card shows reflection");
    await shot("intention-card-live-yesterday-reflected", "Live Preview");
    return { reflection: card.card.reflection, missing: card.card.missing };
  });

  // ---- Summary: explainer, edited provenance, stamp-restoring Undo ----
  const stampedOriginal = disk(plan.paths.stamped);
  await step("edit-summary-explainer", async () => {
    await ensureModal(plan.paths.stamped);
    await key("s");
    let state = await ready((value) => value.selected === "summary", "summary selected");
    await key("Enter");
    state = await ready((value) => value.stage === "summary", "summary stage");
    assert.match(state.note || state.text, /agent drafted this; your edit makes it yours/);
    // The current summary shows read-only above the stage, with provenance.
    assert.match(state.text, new RegExp("Summary · ✦ agent · [A-Z][a-z]{2} \\d{1,2}" + plan.stampedSummary.replace(/[.]/g, "\\.")));
    await shot("intention-editor-summary-explainer", "Card editor");
    return { note: state.note };
  });
  await step("edit-summary-provenance-edited", async () => {
    const result = await writeStep("edit-summary-provenance-edited", plan.paths.stamped, plan.stamped, async () => {
      await selectAll(); await typeText("Shipped the card, the editor, and the docs.");
      await key("Enter");
      return ready((value) => value.stage === null && value.status === "saved", "summary saved");
    }, { summary: "Shipped the card, the editor, and the docs." });
    const text = disk(plan.paths.stamped);
    assert.ok(!/^summary_digest:/m.test(text) && !/^summary_drafted:/m.test(text), "summary edit kept the agent stamps");
    assert.equal(result.bobRead.summary_state, "edited");
    await key("Escape"); await closed();
    const card = await waitCard(plan.paths.stamped, (value) => value?.cardCount === 1 && /✎ edited/.test(value.card?.summary || ""), "edited provenance");
    await shot("intention-card-summary-edited", "Live Preview");
    return { ...result, card: card.card.summary };
  });
  await step("edit-summary-undo-restores-stamps", async () => {
    const before = vault();
    await ensureModal(plan.paths.stamped);
    await key("u");
    await waitFor(client, `app.metadataCache.getCache(${JSON.stringify(plan.paths.stamped)})?.frontmatter?.summary_digest ?? null`,
      (value) => value === plan.stampedDigest, "restored summary digest", 20_000);
    onlyChanged(before, plan.paths.stamped, "summary undo");
    const text = disk(plan.paths.stamped);
    const blocksNow = lib.frontmatterBlocks(text);
    const blocksThen = lib.frontmatterBlocks(stampedOriginal);
    for (const name of ["summary", "summary_digest", "summary_drafted"]) {
      assert.ok(blocksNow.has(name), "undo did not restore " + name);
      assert.equal(blocksNow.get(name).replace(/["']/g, ""), blocksThen.get(name).replace(/["']/g, ""), "undo restored a different " + name);
    }
    lib.assertUnownedBytesKept(stampedOriginal, text);
    const fresh = readFields(plan.stamped);
    assert.equal(fresh.after.summary_state, "drafted");
    await key("Escape"); await closed();
    const card = await waitCard(plan.paths.stamped, (value) => value?.cardCount === 1 && /✦ agent/.test(value.card?.summary || ""), "agent provenance restored");
    return { summaryState: fresh.after.summary_state, card: card.card.summary, bytesEqual: text === stampedOriginal };
  });

  // ---- Navigation inside the modal ----
  const navBefore = vault();
  await step("nav-next-missing-day-disabled", async () => {
    await ensureModal(plan.paths.today);
    await key("]");
    let state = await ready((value) => value.path === plan.paths.tomorrow, "tomorrow subject");
    assert.equal(state.status, "missing");
    assert.equal(state.writable, false);
    assert.match(state.text, new RegExp("no note for " + lib.shortDayLabel(plan.tomorrow) + " yet"));
    await shot("intention-editor-missing-day", "Card editor");
    for (const name of ["i", "Enter", "r", "o"]) {
      await key(name); await sleep(150);
      state = await modal();
      assert.equal(state.stage, null, name + " opened a stage on a missing day");
    }
    assert.ok(!fs.existsSync(path.join(ctx.vaultDir, plan.paths.tomorrow)), "navigation created the missing note");
    await key("[");
    state = await ready((value) => value.path === plan.paths.today, "back to today");
    assert.equal(state.selected, "intention:0");
    return state;
  });
  await step("nav-parent-chain", async () => {
    const current = await modal();
    if (!current || current.path !== plan.paths.today) await ensureModal(plan.paths.today);
    await key("=");
    const week = await ready((value) => value.path === plan.paths.week && value.status !== "missing", "week subject");
    assert.equal(week.subject, plan.week);
    assert.deepEqual(week.fields.intentions, plan.intentions.week);
    await key("=");
    const quarter = await ready((value) => value.path === plan.paths.quarter, "quarter subject");
    assert.equal(quarter.subject, plan.quarter);
    assert.deepEqual(quarter.fields.intentions, plan.intentions.quarter);
    await shot("intention-editor-quarter", "Card editor");
    return { week: week.subject, quarter: quarter.subject };
  });
  await step("nav-missing-period-hint", async () => {
    await key("=");
    const year = await ready((value) => value.path === plan.paths.year, "year subject");
    assert.equal(year.status, "missing");
    assert.equal(year.writable, false);
    assert.match(year.text, /bob periods ensure/);
    await shot("intention-editor-missing-year", "Card editor");
    await key("=");
    await sleep(200);
    const still = await modal();
    assert.equal(still.path, plan.paths.year, "year climbed past its top");
    return { year: year.subject, text: year.refusal };
  });
  await step("nav-active-note-unchanged", async () => {
    const state = await modal();
    assert.ok(state, "card editor closed during navigation");
    assert.equal(state.activePath, plan.paths.today);
    await key("Escape"); await closed();
    sameVault(navBefore, "navigation");
    return { activePath: state.activePath };
  });
  await step("nav-boundary-walk", async () => {
    await open(plan.paths.boundaryDay, "live");
    await waitCard(plan.paths.boundaryDay).catch(() => null);
    const before = vault();
    await doubleEquals(plan.paths.boundaryDay);
    await ready((value) => value.path === plan.paths.boundaryDay);
    const trail = [];
    const step = async (name, expectPath, extra = () => {}) => {
      await key(name);
      const state = await ready((value) => value.path === expectPath, name + " → " + expectPath);
      extra(state);
      trail.push({ key: name, path: state.path, subject: state.subject, status: state.status });
      return state;
    };
    await step("[", plan.paths.boundaryPrevDay, (state) => {
      assert.equal(state.status, "missing");
      assert.match(state.text, /no note for Wed Dec 31 yet/);
    });
    await step("]", plan.paths.boundaryDay);
    await step("=", plan.paths.boundaryWeek, (state) => assert.equal(state.subject, "2026-W01"));
    await step("[", plan.paths.boundaryPrevWeek, (state) => assert.equal(state.subject, "2025-W52"));
    await step("=", plan.paths.boundaryQuarter, (state) => assert.equal(state.subject, "2025-Q4"));
    await step("]", plan.paths.boundaryNextQuarter, (state) => { assert.equal(state.subject, "2026-Q1"); assert.equal(state.status, "missing"); });
    await step("=", "2026.md", (state) => assert.equal(state.subject, "2026"));
    await key("Escape"); await closed();
    sameVault(before, "boundary walk");
    return trail;
  });

  // ---- Palette, Command Mode, and Ctrl+Shift+P entries ----
  const palette = async (query) => {
    await key("p", 2);
    await waitFor(client, "Boolean(document.querySelector('.prompt-input'))", Boolean, "command palette");
    await client.evaluate("document.querySelector('.prompt-input').focus()");
    await typeText(query);
    // Confirm the real selection Enter will activate before pressing it.
    const trail = await proof.activatePaletteCommand({ client, key, waitFor, query, title: query });
    evidence.steps.push({ palette: query, trail });
  };
  const commandModeRow = async (query, title) => {
    await palette("Bob: Command mode");
    await waitFor(client, "Boolean(document.querySelector('.bob-cmd-sheet-input'))", Boolean, "Command Mode input");
    await client.evaluate("document.querySelector('.bob-cmd-sheet-input').focus()");
    await typeText(query);
    const rowsExpr = `Array.from(document.querySelectorAll('.bob-cmd-row')).filter((el) => el.getClientRects().length)
      .map((el) => ({ title: el.querySelector('.bob-cmd-row-title')?.textContent || '', selected: el.classList.contains('is-selected') }))`;
    let rows = await waitFor(client, rowsExpr, (value) => value.some((row) => row.title === title), "Command Mode row " + title);
    for (let i = 0; i < rows.length && !rows.some((row) => row.title === title && row.selected); i += 1) {
      const selected = rows.findIndex((row) => row.selected);
      const wanted = rows.findIndex((row) => row.title === title);
      await key(selected < wanted ? "ArrowDown" : "ArrowUp");
      await sleep(120);
      rows = await client.evaluate(rowsExpr);
    }
    assert.ok(rows.some((row) => row.title === title && row.selected), "Command Mode never selected " + title);
    return rows;
  };
  await step("entry-palette-edit-intentions", async () => {
    await liveReady(plan.paths.today);
    await palette("Edit intentions");
    const state = await ready();
    assert.equal(state.path, plan.paths.today);
    assert.equal(state.selected, "intention:0");
    await closeAll();
    return state;
  });
  await step("entry-palette-reflect-yesterday", async () => {
    await liveReady(plan.paths.today);
    await palette("Reflect on yesterday");
    const state = await ready((value) => value.stage === "reflection" && value.focus?.input === "reflection", "reflect-on-yesterday stage");
    assert.equal(state.path, plan.paths.yesterday);
    assert.equal(state.activePath, plan.paths.today, "Reflect on yesterday navigated the active note");
    assert.equal(state.focus.start, state.focus.value.length);
    await shot("intention-editor-reflect-yesterday-palette", "Card editor");
    await closeAll();
    return state;
  });
  await step("entry-command-mode-rows", async () => {
    await liveReady(plan.paths.today);
    const rows = await commandModeRow("intentions", "Edit intentions");
    await shot("intention-command-mode-row", "Command Mode");
    await key("Enter");
    const state = await ready();
    assert.equal(state.path, plan.paths.today);
    await closeAll();
    const rows2 = await commandModeRow("yesterday", "Reflect on yesterday");
    await key("Enter");
    const reflect = await ready((value) => value.stage === "reflection", "Command Mode reflect stage");
    assert.equal(reflect.path, plan.paths.yesterday);
    assert.equal(reflect.activePath, plan.paths.today);
    await closeAll();
    return { rows, rows2, opened: state.path, reflect: reflect.path };
  });
  await step("entry-ctrl-shift-p-fallback", async () => {
    await liveReady(plan.paths.today);
    await normal(plan.paths.today, "# " + plan.today);
    await key("P", 10);
    const state = await ready();
    assert.equal(state.path, plan.paths.today);
    await closeAll();
    return state;
  });
  await step("entry-ctrl-shift-p-task-priority", async () => {
    await liveReady(plan.paths.today);
    await normal(plan.paths.today, "GTD-ANCHOR");
    await key("P", 10);
    await sleep(900);
    const state = await modal();
    const modals = await client.evaluate("Array.from(document.querySelectorAll('.modal-container .modal')).map((el) => String(el.className))");
    assert.equal(state, null, "Ctrl+Shift+P on a task opened the intention card editor");
    assert.ok(modals.length >= 1, "Ctrl+Shift+P on a task opened no task route");
    await shot("intention-ctrl-shift-p-task-route", "Task route");
    await closeAll();
    return { modals };
  });

  // ---- YAML excursion: Done returns; invalid YAML stays recoverable ----
  const yamlJump = async () => waitFor(client, `(() => {
    const v = app.workspace.activeLeaf.view, e = v.editor, cursor = e?.getCursor();
    return { path: v.file?.path, source: v.getState().source, mode: v.getMode(), line: cursor ? e.getLine(cursor.line) : null,
      done: Boolean(v.containerEl.querySelector('[data-album-yaml-done]')) };
  })()`, (value) => value.path === plan.paths.today && value.source === true && value.mode === "source" && value.done && /^intentions:/.test(value.line || ""),
  "YAML Source jump to intentions", 15_000);
  const clickDone = async () => {
    const point = await client.evaluate(`(() => {
      const el = app.workspace.activeLeaf.view.containerEl.querySelector('[data-album-yaml-done]');
      if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    assert.ok(point, "Done control missing");
    await client.call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
    await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
  };
  await step("yaml-done-returns", async () => {
    await liveReady(plan.paths.today);
    const before = vault();
    await doubleEquals(plan.paths.today);
    await ready();
    await key("2"); await ready((value) => value.selected === "intention:1");
    await key("y");
    const excursion = await yamlJump();
    await shot("intention-yaml-source", "Source");
    await clickDone();
    const state = await ready((value) => value.path === plan.paths.today, "reopened after Done");
    const view = await client.evaluate("app.workspace.activeLeaf.view.getState()");
    assert.equal(state.selected, "intention:1");
    assert.equal(view.source, false, "Done did not restore Live Preview");
    await closeAll();
    sameVault(before, "YAML excursion");
    return { excursion, selected: state.selected, view };
  });
  await step("yaml-invalid-stays-recoverable", async () => {
    await liveReady(plan.paths.today);
    const original = disk(plan.paths.today);
    const restore = async () => client.evaluate(`(async () => {
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(plan.paths.today)});
      if ((await app.vault.read(file)) !== ${JSON.stringify(original)}) await app.vault.modify(file, ${JSON.stringify(original)});
    })()`);
    try {
      await doubleEquals(plan.paths.today);
      await ready();
      await key("y");
      await yamlJump();
      const broken = original.replace(/^intentions:\n/m, "intentions: [unclosed\n");
      assert.notEqual(broken, original, "could not build invalid YAML");
      await client.evaluate(`(async () => { const v = app.workspace.activeLeaf.view; v.editor.setValue(${JSON.stringify(broken)}); await v.save(); })()`);
      await clickDone();
      await sleep(1500);
      const stuck = await client.evaluate(`(() => { const v = app.workspace.activeLeaf.view; return { mode: v.getMode(), source: v.getState().source,
        done: Boolean(v.containerEl.querySelector('[data-album-yaml-done]')), notices: Array.from(document.querySelectorAll('.notice')).map((n) => n.textContent) }; })()`);
      assert.equal(await modal(), null, "Done reopened the card on invalid YAML");
      assert.equal(stuck.source, true, "invalid YAML left Source");
      assert.ok(stuck.done, "Done control disappeared after refusal");
      assert.ok(stuck.notices.some((text) => /frontmatter|YAML|fix it before Done/i.test(text)), "no visible refusal notice: " + JSON.stringify(stuck.notices));
      await shot("intention-yaml-invalid-refused", "Source");
      await client.evaluate(`(async () => { const v = app.workspace.activeLeaf.view; v.editor.setValue(${JSON.stringify(original)}); await v.save(); })()`);
      await clickDone();
      const state = await ready((value) => value.path === plan.paths.today, "reopened after repair");
      await closeAll();
      assert.equal(disk(plan.paths.today), original, "repair did not restore exact bytes");
      return { stuck, reopened: state.path };
    } finally {
      await restore().catch(() => null);
    }
  });

  // ---- Two panes: stale refusal keeps the draft; body edits stay safe ----
  await step("stale-refusal-keeps-draft", async () => {
    await liveReady(plan.paths.today);
    await client.evaluate(`(async () => {
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(plan.paths.today)});
      const leaf = app.workspace.getLeaf("split", "vertical");
      await leaf.openFile(file, { state: { mode: "source", source: true } });
      window.__intentionSourceLeaf = leaf;
      const first = app.workspace.getLeavesOfType("markdown").find((item) => item !== leaf && item.view?.file?.path === file.path);
      app.workspace.setActiveLeaf(first, { focus: true });
    })()`);
    await sleep(600);
    await doubleEquals(plan.paths.today);
    await ready();
    await key("1"); await key("Enter");
    await ready((value) => value.stage === "intention" && value.focus?.input === "intention");
    await selectAll(); await typeText("Draft held across a stale write");
    const since = ctx.invocations().length;
    const external = await client.evaluate(`(async () => {
      const view = window.__intentionSourceLeaf.view;
      const text = view.editor.getValue();
      const next = text.replace(new RegExp(${JSON.stringify(WALK_LINE)}, "m"), '$1"Walk after lunch (edited elsewhere)"');
      if (next === text) return { ok: false };
      view.editor.setValue(next);
      await view.save();
      return { ok: true };
    })()`);
    assert.ok(external.ok, "external Source edit failed");
    await waitFor(client, `JSON.stringify(app.metadataCache.getCache(${JSON.stringify(plan.paths.today)})?.frontmatter?.intentions || [])`,
      (value) => /edited elsewhere/.test(value), "external edit metadata", 15_000);
    const afterExternal = vault();
    await key("Enter");
    const state = await ready((value) => value.status === "stale", "stale refusal");
    await sleep(800);
    const settled = await modal();
    assert.equal(settled.status, "stale");
    assert.equal(settled.stage, "intention", "stale refusal dropped the stage");
    assert.equal(settled.inputValue, "Draft held across a stale write", "draft text lost");
    assert.equal(settled.selected, "intention:0");
    assert.ok(settled.fields.intentions.some((item) => /edited elsewhere/.test(item)), "card did not refresh to the external list");
    sameVault(afterExternal, "stale refusal");
    assert.equal(writerApplies(since).length, 0, "a stale refusal reached the writer");
    await shot("intention-editor-stale-refusal", "Card editor");
    ctx.staleState = settled;
    return { status: state.status, draft: settled.inputValue, fields: settled.fields };
  });
  await step("stale-explicit-retry-saves", async () => {
    const expected = ["Draft held across a stale write", ...ctx.staleState.fields.intentions.slice(1)];
    const result = await writeStep("stale-explicit-retry-saves", plan.paths.today, todaySubject, async () => {
      await key("Enter");
      return ready((value) => value.status === "saved" && value.stage === null, "retry saved");
    }, { intentions: expected });
    await shot("intention-editor-stale-retry-saved", "Card editor");
    return result;
  });
  await step("body-edit-survives-save", async () => {
    const since = ctx.invocations().length;
    // The Source pane reloads bob's retry write asynchronously; edit only once
    // it shows the current disk bytes, as a person would.
    await waitFor(client, `(async () => {
      const view = window.__intentionSourceLeaf.view;
      return view.editor.getValue() === await app.vault.adapter.read(${JSON.stringify(plan.paths.today)});
    })()`, Boolean, "Source pane shows the retry write", 15_000);
    await client.evaluate(`(() => {
      const view = window.__intentionSourceLeaf.view;
      const text = view.editor.getValue();
      view.editor.setValue(text.replace("## Notes\\n", "## Notes\\n\\n- Body edit survives the save.\\n"));
      return view.editor.getValue().includes("Body edit survives");
    })()`);
    const expected = ["Draft held across a stale write", ...ctx.staleState.fields.intentions.slice(1), "Body-safe intention"];
    const result = await writeStep("body-edit-survives-save", plan.paths.today, todaySubject, async () => {
      await key(String(expected.length - 1));
      await ready((value) => value.selected === "intention:" + (expected.length - 2), "last intention selected");
      await key("o");
      await ready((value) => value.stage === "intention" && value.focus?.input === "intention");
      await typeText("Body-safe intention");
      await key("Enter");
      return ready((value) => value.status === "saved" && value.stage === null, "body-safe save");
    }, { intentions: expected }, { extraBody: "- Body edit survives the save." });
    const stale = ctx.invocations().slice(since).filter((entry) => entry.event === "finish" && /stale_note/.test(entry.stdout || ""));
    assert.equal(stale.length, 0, "body-only edit produced a field-stale error");
    await closeAll();
    await client.evaluate("window.__intentionSourceLeaf?.detach?.(); delete window.__intentionSourceLeaf;");
    return result;
  });

  // ---- Old bob: refusal keeps the rendered card and native recovery ----
  await step("old-bob-keeps-card-and-recovery", async () => {
    fs.writeFileSync(ctx.oldBobFlag, "1");
    try {
      await liveReady(plan.paths.today);
      const before = vault();
      await doubleEquals(plan.paths.today);
      const state = await waitFor(client, MODAL, (value) => value && value.status === "needs-update", "old-bob refusal", 30_000);
      assert.match(state.text, /Update bob to edit intentions/);
      assert.equal(state.writable, false);
      await key("Enter"); await sleep(200);
      assert.equal((await modal()).stage, null, "old bob still opened an edit stage");
      const card = await ctx.probe(plan.paths.today);
      assert.equal(card.cardCount, 1, "old-bob refusal removed the display card");
      await shot("intention-editor-old-bob", "Card editor");
      await closeAll();
      await ctx.open(plan.paths.today, "source");
      const source = await client.evaluate("app.workspace.activeLeaf.view.editor.getValue().includes('intentions:')");
      assert.ok(source, "Source recovery does not show the YAML");
      await ctx.open(plan.paths.today, "live");
      const after = await waitCard(plan.paths.today);
      sameVault(before, "old bob");
      return { status: state.status, cardCount: after.cardCount, source };
    } finally {
      fs.rmSync(ctx.oldBobFlag, { force: true });
    }
  });

  await landing.runLandingWorkflows(ctx, {
    evidence, step, ensureModal, modal, ready, closed, closeAll, normal, liveReady, doubleEquals,
    typeText, selectAll, disk, sameVault, onlyChanged, writeStep,
  });
}

function selfTest() {
  new Function("return " + MODAL);
  return true;
}

module.exports = { MODAL, runWorkflows, selfTest };
