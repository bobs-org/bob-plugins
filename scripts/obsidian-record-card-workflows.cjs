"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const proof = require("./obsidian-record-card-workflow-lib.cjs");

const CARD = `(() => {
  const m = app.plugins.plugins['bob-ledger-tools']?.recordCardModal;
  if (!m || m.closed) return null;
  return { path: m.recordPath, field: m.selectedKey, stage: m.stage?.kind || null,
    busy: m.pendingApply, ready: Boolean(m.session), status: m.statusKind,
    draft: m.stageDraftText, list: m.stageList, item: m.stageItemDraft,
    sessionStatus: m.sessionState?.status, canApply: m.sessionState?.canApply, retainedOps: m.retainedOps,
    expect: m.sessionState?.expect, draftOps: m.sessionState?.draftOps,
    fingerprint: m.latestReport?.record?.fingerprint,
    refusal: m.refusalMessage, targets: m.recordTargets().map(t => ({key:t.key, value:t.value})),
    text: m.contentEl.textContent, focus: document.activeElement?.getAttribute('data-record-input'),
    focusField: document.activeElement?.getAttribute('data-target-key'),
    activePath: app.workspace.activeLeaf?.view?.file?.path };
})()`;

async function runWorkflows(ctx) {
  const { client, report, vaultDir, profileDir, open, waitSheet, waitFor, sleep, capture, outDir, check } = ctx;
  const snapshot = () => proof.snapshotMarkdown(vaultDir);
  const invocations = () => {
    const log = path.join(profileDir, "bob-invocations.jsonl");
    return fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
  };
  const evidence = report.workflows = { byteChecks: [], writerCalls: [], samples: [], inputs: [], focus: [] };
  const verify = (name, assertion, detail = {}) => {
    try { assertion(); check(report, name, true, detail); }
    catch (error) { check(report, name, false, { ...detail, error: error.message }); throw error; }
  };
  const neutral = (name, before, detail = {}) => {
    const after = snapshot();
    const bytes = { name, before: proof.hashes(before), after: proof.hashes(after) };
    evidence.byteChecks.push(bytes);
    verify(name, () => assert.deepEqual(after, before), { ...detail, ...bytes });
  };
  const key = async (key, modifiers = 0) => {
    const events = proof.keyEvents(key, modifiers);
    evidence.inputs.push({ events, focus: await client.evaluate(`(() => {
      const el=document.activeElement; return el ? {tag:el.tagName,classes:el.className,
        input:el.getAttribute('data-record-input'),field:el.getAttribute('data-target-key'),
        activePath:app.workspace.activeLeaf?.view?.file?.path,label:el.getAttribute('aria-label')} : null;
    })()`) });
    for (const event of events) await client.call("Input.dispatchKeyEvent", event);
  };
  const focus = async (selector) => {
    const result = await client.evaluate(proof.focusControlSource(selector));
    evidence.focus.push(result);
    assert.ok(result.ok, "Could not focus connected control " + selector + ": " + JSON.stringify(result));
  };
  const click = async (selector, text = null) => {
    const point = await client.evaluate(`(() => {
      const el = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e =>
        e.getClientRects().length && (${JSON.stringify(text)} === null || e.textContent.includes(${JSON.stringify(text)})));
      if (!el) return null; el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect();
      return {x:r.x+r.width/2,y:r.y+r.height/2};
    })()`);
    assert.ok(point, "Missing connected control " + selector + " " + text);
    await client.call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
    await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
  };
  const card = (predicate = value => value?.ready && !value.busy, label = "ready Record Card") =>
    waitFor(client, CARD, predicate, label, 30_000);
  const close = async () => {
    for (let i = 0; i < 4 && await client.evaluate(CARD); i++) { await key("Escape"); await sleep(80); }
    await waitFor(client, CARD, value => value === null, "Record Card closed");
  };
  const readyNote = async (note) => { await open(note); await waitSheet(note); };
  const toolbar = async (note) => {
    await readyNote(note);
    await click(".workspace-leaf.mod-active [data-record-sheet-focus='edit']");
    return card();
  };
  const select = field => proof.selectCardField({ click, card, field });
  const stage = async (field, kind) => {
    await select(field); await key("Enter");
    return card(value => value?.field === field && value.stage === kind && value.ready, kind + " stage");
  };
  const type = async (text, selector = ".bob-record-card-modal [data-record-input^='stage-']:not(button)") => {
    await focus(selector); await key("a", 2); await client.call("Input.insertText", { text });
    if (!text) await key("Backspace");
  };
  const shot = async (name, mode = "Record Card") => report.screenshots.push(await capture(client, outDir, name, 1400, "light", mode));
  const valueOf = (state, field) => state.targets.find(t => t.key === field)?.value;
  const persisted = async (note, field) => client.evaluate(`(() => {
    const file=app.vault.getAbstractFileByPath(${JSON.stringify(note)});
    return app.metadataCache.getFileCache(file)?.frontmatter?.[${JSON.stringify(field)}] ?? null;
  })()`);
  const assertPersisted = async (note, field, expected, before, name) => {
    await waitFor(client, `app.metadataCache.getCache(${JSON.stringify(note)})?.frontmatter?.[${JSON.stringify(field)}] ?? null`,
      value => JSON.stringify(value) === JSON.stringify(expected), "persisted " + field);
    const current = await card();
    const after = snapshot();
    const album = note.split("/")[0] + ".md";
    // A fresh real-bob process reads disk independently of the modal/cache.
    const diskReport = ctx.readRecord(note);
    const diskValue = diskReport.record.properties.find(row => row.key === field)?.value ?? null;
    const sheet = await client.evaluate(`(() => {
      const model=app.plugins.plugins['bob-ledger-tools'].recordSheetModelFor(${JSON.stringify(note)});
      return model ? {row:model.rows.find(r=>r.key===${JSON.stringify(field)}) ?? null,
        ghost:model.ghosts.some(r=>r.key===${JSON.stringify(field)})} : null;
    })()`);
    verify(name, () => {
      assert.deepEqual(diskValue, expected);
      assert.deepEqual(valueOf(current, field), expected);
      proof.assertSheetValue(sheet, expected);
      proof.assertOnlyPaths(before, after, [note, album]);
      assert.notEqual(after[note], before[note], "save did not change record bytes");
    }, { field, expected, sheet, cache: await persisted(note, field), before: proof.hashes(before), after: proof.hashes(after) });
  };

  try {
    // Every sheet entry uses a connected control; observing modal state is read-only.
    const passive = snapshot();
    for (const entry of proof.ENTRY_CASES) {
      for (const keyboard of [false, true]) {
        await readyNote(entry.note);
        let selector = ".workspace-leaf.mod-active " + entry.selector;
        if (keyboard && entry.name === "row") selector = ".workspace-leaf.mod-active .bob-record-sheet-row[data-record-key='claim']";
        if (keyboard) {
          await focus(selector);
          if (entry.name === "row") await shot("record-sheet-row-keyboard-focus", "Live Preview");
          await key("Enter");
        }
        else await click(selector);
        const state = await card();
        verify("entry-" + (keyboard ? "keyboard-" : "click-") + entry.name, () => {
          assert.equal(state.path, entry.note); assert.equal(state.field, entry.field);
          assert.equal(state.stage, entry.stage || null);
          if (entry.stage === "text") assert.notEqual(state.status, "saving", "entry preview must not claim a save");
        }, state);
        if (!keyboard && ["toolbar", "ghost", "missing"].includes(entry.name)) await shot("record-card-entry-" + entry.name);
        await close();
      }
    }
    await readyNote("zettels/bead_lifecycle.md");
    await client.evaluate(`(() => { const v=app.workspace.activeLeaf.view; v.editor.setCursor({line:v.editor.lineCount()-1,ch:0}); v.editor.focus(); })()`);
    await key("P", 10);
    let state = await card();
    verify("entry-control-shift-p", () => { assert.equal(state.path, "zettels/bead_lifecycle.md"); assert.equal(state.field, "status"); }, state);
    await close();

    const palette = async (query) => {
      await key("p", 2);
      await waitFor(client, "Boolean(document.querySelector('.prompt-input'))", Boolean, "command palette");
      await focus(".prompt-input"); await client.call("Input.insertText", { text: query });
      // Confirm what Enter will activate. A mouse release that replaces the
      // palette with another modal can lose its CDP acknowledgement in Electron.
      const selectionTrail = await proof.activatePaletteCommand({client, key, waitFor, query, title:query});
      evidence.inputs.push({ palette: query, selectionTrail });
    };
    await palette("Edit record"); state = await card();
    verify("entry-palette", () => assert.equal(state.path, "zettels/bead_lifecycle.md"), state);
    await close();
    await palette("Bob: Command mode");
    await waitFor(client, "Boolean(document.querySelector('.bob-cmd-sheet-input'))", Boolean, "Command Mode input");
    await focus(".bob-cmd-sheet-input"); await client.call("Input.insertText", { text: "Edit record" });
    const commandSelection = await waitFor(client, `(() => {
      const row=Array.from(document.querySelectorAll('.bob-cmd-row.is-selected'))
        .find(el=>el.isConnected && el.getClientRects().length);
      const input=document.querySelector('.bob-cmd-sheet-input');
      return row ? {title:row.querySelector('.bob-cmd-row-title')?.textContent,
        focused:Boolean(input && document.activeElement===input)} : null;
    })()`, row => row?.focused && row.title === "Edit record", "actual selected Command Mode record row");
    evidence.inputs.push({commandSelection});
    await key("Enter"); state = await card();
    verify("entry-command-mode", () => assert.equal(state.path, "zettels/bead_lifecycle.md"), {state,commandSelection});

    await key("J", 8); const next = await card(); await key("K", 8); state = await card();
    verify("record-shift-j-k", () => { assert.equal(next.field, "claim"); assert.equal(state.field, "status"); }, { next, state });
    const keycaps = await client.evaluate("Array.from(document.querySelectorAll('.bob-record-card-modal kbd')).map(e=>e.textContent)");
    verify("record-has-no-schema-keycaps", () => assert.ok(!keycaps.some(k => /(?:Ctrl|⌃).*?[jk]/i.test(k))), { keycaps });
    await select("claim"); await key("y");
    // Done mounts before the asynchronous Source jump finishes. Observe the
    // completed jump, including its selected YAML line, before invoking Done.
    const excursion = await waitFor(client, `(() => {
      const v=app.workspace.activeLeaf.view, e=v.editor, cursor=e?.getCursor();
      return {path:v.file?.path, source:v.getState().source, mode:v.getMode(),
        cursor, line:cursor ? e.getLine(cursor.line) : null,
        done:Boolean(v.containerEl.querySelector('[data-album-yaml-done]')),
        sheets:v.containerEl.querySelectorAll('.bob-record-sheet').length};
    })()`, value => value.path === "zettels/bead_lifecycle.md" && value.source === true &&
      value.mode === "source" && value.done && value.sheets === 0 && /^claim:/.test(value.line || ""),
    "YAML Source jump to Claim", 15_000);
    await shot("record-card-yaml-source", "Source");
    await click("[data-album-yaml-done]"); state = await card();
    const returnedView = await client.evaluate("app.workspace.activeLeaf.view.getState()");
    verify("yaml-done-returns", () => {
      assert.equal(excursion.path, "zettels/bead_lifecycle.md"); assert.equal(excursion.source, true);
      assert.equal(state.path, excursion.path); assert.equal(state.field, "claim");
      assert.equal(returnedView.source, false);
    }, { excursion, state, returnedView });
    await key("=");
    const schemaExpr = `(() => { const m=app.plugins.plugins['bob-ledger-tools'].albumSchemaCardModal; return m && !m.closed ? {path:m.schemaModel?.path,key:m.selectedKey,stage:m.stage,ready:Boolean(m.session),focusedKey:document.activeElement?.getAttribute('data-target-key')} : null; })()`;
    let schema = await waitFor(client, schemaExpr, value => value?.ready, "Schema Card");
    verify("schema-same-field", () => { assert.equal(schema.path, "zettels.md"); assert.equal(schema.key, "field:claim"); assert.equal(schema.focusedKey, schema.key); }, schema);
    await shot("record-card-schema-claim", "Schema Card");
    await key("j", 2); const schemaNext = await client.evaluate(schemaExpr);
    await key("k", 2); const schemaBack = await client.evaluate(schemaExpr);
    await key("3"); const schemaThree = await client.evaluate(schemaExpr);
    verify("schema-control-j-k-digit-three", () => {
      assert.equal(schemaNext.key, "field:section"); assert.equal(schemaBack.key, "field:claim");
      assert.equal(schemaThree.key, "field:section"); assert.ok(!schemaThree.stage);
    }, { schemaNext, schemaBack, schemaThree });
    const beforeShift = snapshot(); await key("J", 8); await sleep(300);
    neutral("schema-shift-j-byte-neutral", beforeShift, await client.evaluate(schemaExpr));
    await key("Escape");
    neutral("opening-navigation-cancel-byte-neutral", passive);

    // A disposable misindented body makes every Vim fall-through observable.
    const vimBody = proof.VIM_PROBE_BODY;
    const vimCase = async (name, note, mode, keys, opens) => {
      const original = fs.readFileSync(path.join(vaultDir, note), "utf8");
      await open(note, "source");
      await client.evaluate(`(async () => { const v=app.workspace.activeLeaf.view; v.editor.setValue(${JSON.stringify(original + vimBody)}); await v.save(); })()`);
      await open(note, mode); if (mode === "live" && note !== "ordinary.md") await waitSheet(note);
      await client.evaluate(proof.vimProbeCursorSource());
      await key("Escape"); await sleep(100);
      const historyExpr = `(() => { const cm=app.workspace.activeLeaf.view.editor.cm; const h=cm.state.values.find(v=>v && Array.isArray(v.done) && Array.isArray(v.undone)); return h ? {undo:h.done.length,redo:h.undone.length} : null; })()`;
      const before = snapshot(); const history = await client.evaluate(historyExpr);
      for (const k of keys) await key(k);
      if (opens) {
        const opened = await card();
        verify("entry-double-equals", () => assert.equal(opened.path, note), opened);
        await close();
        const afterHistory = await client.evaluate(historyExpr);
        verify("double-equals-no-indent-or-undo", () => { assert.ok(history, "CM history state unavailable"); assert.deepEqual(snapshot(), before); assert.deepEqual(afterHistory, history); }, { history, afterHistory });
      } else {
        await sleep(250);
        const text = await client.evaluate("app.workspace.activeLeaf.view.editor.getValue()");
        const modal = await client.evaluate(CARD);
        verify(name, () => { assert.equal(modal, null); proof.assertVimReindent(original + vimBody, text); },
          { before: original + vimBody, after: text });
      }
      await open(note, "source");
      await client.evaluate(`(async () => {const v=app.workspace.activeLeaf.view; v.editor.setValue(${JSON.stringify(original)}); await v.save();})()`);
    };
    await vimCase("entry-double-equals", "zettels/bead_lifecycle.md", "live", ["=", "="], true);
    await vimCase("counted-equals-reindents", "zettels/bead_lifecycle.md", "live", ["3", "=", "="], false);
    await vimCase("source-equals-reindents", "zettels/bead_lifecycle.md", "source", ["=", "="], false);
    await vimCase("ordinary-equals-reindents", "ordinary.md", "live", ["=", "="], false);

    // The shim records real child invocations, including stdin and dry-run flags.
    await toolbar("zettels/bead_lifecycle.md"); await select("status");
    const beforeStatus = snapshot(); const callStart = invocations().length;
    await client.evaluate(`(() => {
      window.__recordSamples=[];
      window.__recordSampleTimer=setInterval(()=> {
        const sheets=Array.from(document.querySelectorAll('.workspace-leaf.mod-active .bob-record-sheet'));
        const row=sheets[0]?.querySelector('[data-record-key="status"] .bob-record-sheet-value');
        window.__recordSamples.push({at:Date.now(),value:row?.textContent?.trim() || null,sheets:sheets.length});
      },20);
    })()`);
    await key("2");
    await card(v => v?.status === "saved" && !v.busy, "digit saved");
    await sleep(2500);
    const afterStatus = snapshot();
    const calls = invocations().slice(callStart); evidence.writerCalls.push(...calls);
    verify("digit-one-guarded-write", () => {
      const writers=proof.writerCalls(calls); assert.equal(writers.length, 1);
      const envelope=JSON.parse(writers[0].input); assert.ok(envelope.expect);
      assert.deepEqual(envelope.ops, [{op:"field.set",field:"status",value:"ready"}]);
    }, { calls });
    verify("digit-only-status-and-callout", () => proof.assertStatusWrite(beforeStatus, afterStatus,
      "zettels/bead_lifecycle.md", "zettels.md", "draft", "ready"), { before: proof.hashes(beforeStatus), after: proof.hashes(afterStatus) });
    verify("digit-regroups", () => assert.notEqual(proof.splitCallout(beforeStatus["zettels.md"]).callout, proof.splitCallout(afterStatus["zettels.md"]).callout));
    const samples = await client.evaluate("(() => {clearInterval(window.__recordSampleTimer); return window.__recordSamples;})()");
    evidence.samples = samples;
    verify("sheet-no-old-value-flash", () => proof.assertNoFlash(samples, "Ready"), { samples });
    verify("no-duplicate-album-sync", () => assert.equal(calls.filter(c=>c.event==='start' && c.args[0]==='albums' && c.args[1]==='sync').length, 0), { calls });
    await shot("record-card-status-saved");
    await key("u"); await card(v => !v?.busy && valueOf(v || {targets:[]}, "status") === "draft", "Undo restored status");
    await sleep(500);
    const undone = snapshot();
    verify("undo-restores-value-and-group", () => {
      proof.assertStatusRestored(beforeStatus, undone, "zettels/bead_lifecycle.md", "zettels.md", "draft");
    }, { before: proof.hashes(beforeStatus), after: proof.hashes(undone) });
    await close();

    const movie = "movies/equilibrium.md";
    await toolbar(movie); await stage("year", "number");
    for (let index=0; index<proof.TYPED_FIELDS.length; index++) {
      const spec=proof.TYPED_FIELDS[index];
      await card(v=>v?.stage===spec.kind && v.field===spec.field, "Tab entered " + spec.kind);
      const before=snapshot(); await type(spec.value);
      if (spec.kind === "list") { await key("Enter"); await card(v=>v?.list?.includes(spec.value), "comma list chip"); }
      await shot("record-card-stage-" + spec.kind);
      await key("Tab");
      const nextField = proof.TYPED_FIELDS[index+1]?.field || "status";
      await card(v=>!v?.busy && v?.field===nextField && Boolean(v.stage), "Tab saved " + spec.kind);
      await assertPersisted(movie, spec.field, spec.persisted, before, "typed-tab-" + spec.kind);
    }
    await key("Escape"); await stage("reference", "link");
    const backward=snapshot(); await type("[[body]]"); await key("Tab", 8);
    await card(v=>v?.field==='category' && v.stage==='suggest' && !v.busy, "Shift Tab previous stage");
    await assertPersisted(movie, "reference", "[[body]]", backward, "typed-shift-tab");
    await key("Escape"); await select("watched_on");
    const today = await client.evaluate(`(() => { const d=new Date(); return [d.getFullYear(),
      String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); })()`);
    let before=snapshot(); await key("t"); await card(v=>v?.status==='saved' && !v.busy, "today saved");
    await assertPersisted(movie, "watched_on", today, before, "today-shortcut");
    await select("watched_on"); before=snapshot(); await key("d", 2);
    await card(v=>!v?.busy && valueOf(v || {targets:[]}, 'watched_on')===null, "optional cleared");
    await assertPersisted(movie, "watched_on", null, before, "optional-clear");

    await stage("year", "number"); await type("1800");
    await card(v=>!v?.busy && v?.status==='refusal' && v?.sessionStatus==='refused', "invalid preview refusal");
    before=snapshot();
    const invalidCallStart=invocations().length;
    evidence.invalid=[];
    for (const [name, modifiers] of [["Enter",0],["Tab",0],["Tab",8]]) {
      await key(name,modifiers); await sleep(150);
      state=await card(v=>!v?.busy && v?.status==='refusal', "settled refusal after " + (modifiers ? "Shift+" : "") + name);
      evidence.invalid.push({key:name,modifiers,state});
    }
    verify("invalid-refuses-and-keeps-draft", () => {
      assert.deepEqual(snapshot(),before);
      for (const {state} of evidence.invalid) {
        assert.equal(state.draft,"1800"); assert.equal(state.stage,"number");
        assert.equal(state.field,"year"); assert.equal(state.focusField,"year");
        assert.equal(state.status,"refusal"); assert.equal(state.sessionStatus,"refused");
        assert.equal(state.canApply,false); assert.ok(state.refusal);
      }
      assert.equal(proof.writerCalls(invocations().slice(invalidCallStart)).length,0);
    },evidence.invalid);
    await shot("record-card-invalid"); await close();
    await toolbar("zettels/bead_lifecycle.md"); await stage("claim", "text"); await type("");
    before=snapshot(); await key("Enter"); await sleep(250); state=await card();
    verify("required-empty-refuses-and-keeps-draft", () => {assert.deepEqual(snapshot(),before); assert.equal(state.draft,""); assert.equal(state.stage,"text"); assert.equal(state.status,"refusal");},state);
    await shot("record-card-required-empty"); await close();

    // Arrange another genuine Source editor before opening the card. The edit occurs
    // only after its guarded session/preview exists, with no mock fingerprint or writer.
    await readyNote(movie);
    const sourceLeaf=await client.evaluate(`(async()=>{const primary=app.workspace.activeLeaf; const leaf=app.workspace.getLeaf('split'); await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(movie)}),{state:{mode:'source',source:true}}); await leaf.view.setState({...leaf.view.getState(),mode:'source',source:true},{history:false}); app.workspace.setActiveLeaf(primary,{focus:true}); return leaf.id;})()`);
    await toolbar(movie); await stage("service", "text"); await type("Retain my stale draft");
    const staleOps=[{op:'field.set',field:'service',value:'Retain my stale draft'}];
    const currentPreview=await card(v=>v?.canApply && v.sessionStatus==='preview-ready' &&
      JSON.stringify(v.draftOps)===JSON.stringify(staleOps), "stale fixture current preview");
    evidence.stale={currentPreview};
    const staleCallStart=invocations().length;
    const external=await client.evaluate(`(async()=>{
      const leaf=app.workspace.getLeavesOfType('markdown').find(l=>l.id===${JSON.stringify(sourceLeaf)});
      const view=leaf.view; const old=view.editor.getValue();
      view.editor.setValue(old.replace(/^year:.*$/m,'year: 2004')); await view.save();
      return {source:view.getState().source,path:view.file.path,changed:old!==view.editor.getValue()};
    })()`);
    evidence.stale.external=external;
    assert.equal(external.changed,true,"the second Source pane must change the record");
    before=snapshot();
    // A notified external edit is already refused before the next key. Enter
    // after that warning is a retry, so first prove the warning and no write.
    state=await card(v=>!v?.busy && v?.status==='stale' && v.retainedOps &&
      v.fingerprint!==currentPreview.fingerprint, "stale refusal");
    await sleep(500);
    state=await card();
    evidence.stale.refused=state;
    verify("stale-refuses-and-keeps-draft", () => {
      assert.equal(external.source,true); assert.equal(external.changed,true);
      assert.deepEqual(snapshot(),before); assert.equal(state.draft,"Retain my stale draft"); assert.equal(state.stage,"text");
      assert.equal(state.status,"stale");
      assert.equal(state.canApply,false);
      assert.deepEqual(state.retainedOps,staleOps);
      assert.equal(proof.writerCalls(invocations().slice(staleCallStart)).length,0);
    },{external,state,before:proof.hashes(before),after:proof.hashes(snapshot())});
    await shot("record-card-stale");
    await focus(".bob-record-card-modal [data-record-input='stage-text']"); await key("Enter");
    const retry=await card(v=>v?.canApply && v.sessionStatus==='preview-ready' &&
      v.expect===state.fingerprint && JSON.stringify(v.draftOps)===JSON.stringify(staleOps), "explicit stale retry preview");
    evidence.stale.retry=retry;
    assert.deepEqual(snapshot(),before,"retry preview must not write");
    await key("Enter"); await card(v=>v?.status==='saved' && !v.busy, "stale retry saved");
    await assertPersisted(movie,"service","Retain my stale draft",before,"stale-retry-saves-after-preview");
    await shot("record-card-stale-retried"); await close();
    await client.evaluate(`app.workspace.getLeavesOfType('markdown').find(l=>l.id===${JSON.stringify(sourceLeaf)})?.detach()`);
  } finally {
    // A failed early workflow must still preserve the real subprocess evidence.
    evidence.writerCalls = invocations();
    evidence.finalMarkdownHashes = proof.hashes(snapshot());
  }
}

module.exports = { runWorkflows, CARD };
