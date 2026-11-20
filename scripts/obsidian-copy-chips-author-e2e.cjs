"use strict";

const fixture = require("./obsidian-copy-chips-e2e-lib.cjs");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dispatchKeyEvents(client, events) {
  for (const event of events) await client.call("Input.dispatchKeyEvent", event, 5000);
}

async function dispatchModShiftY(client) {
  await dispatchKeyEvents(client, [
    { type: "keyDown", key: "Control", code: "ControlLeft", modifiers: 2, windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 },
    { type: "keyDown", key: "Shift", code: "ShiftLeft", modifiers: 10, windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16 },
    { type: "keyDown", key: "y", code: "KeyY", modifiers: 10, windowsVirtualKeyCode: 89, nativeVirtualKeyCode: 89 },
    { type: "keyUp", key: "y", code: "KeyY", modifiers: 10, windowsVirtualKeyCode: 89, nativeVirtualKeyCode: 89 },
    { type: "keyUp", key: "Shift", code: "ShiftLeft", modifiers: 2, windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16 },
    { type: "keyUp", key: "Control", code: "ControlLeft", modifiers: 0, windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 },
  ]);
}

async function dispatchKey(client, key, options) {
  const settings = options || {};
  const code = settings.code || (key === "Enter" ? "Enter" : key === "Escape" ? "Escape" : key === "[" ? "BracketLeft" : "Key" + String(key).toUpperCase());
  const vk = settings.vk != null ? settings.vk : (key === "Enter" ? 13 : key === "Escape" ? 27 : key === "[" ? 219 : String(key).toUpperCase().charCodeAt(0));
  const ctrl = settings.ctrl === true;
  const shift = settings.shift === true;
  const mask = (ctrl ? 2 : 0) | (shift ? 8 : 0);
  const events = [];
  if (ctrl) {
    events.push({ type: "keyDown", key: "Control", code: "ControlLeft", modifiers: 2, windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 });
  }
  if (shift) {
    events.push({ type: "keyDown", key: "Shift", code: "ShiftLeft", modifiers: mask || 8, windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16 });
  }
  events.push({
    type: "keyDown",
    key,
    code,
    modifiers: mask,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  });
  events.push({
    type: "keyUp",
    key,
    code,
    modifiers: mask,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  });
  if (shift) {
    events.push({ type: "keyUp", key: "Shift", code: "ShiftLeft", modifiers: ctrl ? 2 : 0, windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16 });
  }
  if (ctrl) {
    events.push({ type: "keyUp", key: "Control", code: "ControlLeft", modifiers: 0, windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 });
  }
  await dispatchKeyEvents(client, events);
}

async function modalState(client) {
  return client.evaluate(`(() => {
    const root = document.querySelector('.bob-copy-author-modal, .bob-copy-author');
    if (!root) return { open: false };
    const label = document.querySelector('.bob-copy-author-label');
    const text = document.querySelector('.bob-copy-author-text');
    const markdown = document.querySelector('.bob-copy-author-markdown');
    const status = document.querySelector('.bob-copy-author-status');
    const title = document.querySelector('.bob-copy-author-title');
    return {
      open: true,
      label: label ? String(label.value || '') : null,
      text: text ? String(text.value || '') : null,
      markdown: markdown ? String(markdown.textContent || '') : null,
      status: status ? String(status.textContent || '') : null,
      title: title ? String(title.textContent || '') : null,
    };
  })()`);
}

async function waitForModal(client, open, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 8000);
  for (;;) {
    const state = await modalState(client);
    if (Boolean(state && state.open) === Boolean(open)) return state;
    if (Date.now() > deadline) return state;
    await sleep(120);
  }
}

async function readAuthorNote(client) {
  const pathJson = JSON.stringify(fixture.authorNotePath());
  return client.evaluate(
    "(() => (async () => { const want = " +
      pathJson +
      "; const leaf = window.app.workspace.activeLeaf; const view = leaf && leaf.view; const file = view && view.file; const editor = view && view.editor; if (file && file.path === want && editor && typeof editor.getValue === 'function') return editor.getValue(); const abs = window.app.vault.getAbstractFileByPath(want); if (!abs) return null; return await window.app.vault.read(abs); })())()",
  );
}

async function focusEditor(client) {
  return client.evaluate(`(() => {
    const leaf = window.app.workspace.activeLeaf;
    const editor = leaf && leaf.view && leaf.view.editor;
    if (!editor) return { ok: false };
    if (typeof editor.focus === 'function') editor.focus();
    return { ok: true };
  })()`);
}

async function selectNeedle(client, needle, options) {
  const extra = options || {};
  const needleJson = JSON.stringify(needle);
  const endJson = JSON.stringify(extra.endNeedle || needle);
  const occurrence = Number.isInteger(extra.occurrence) ? extra.occurrence : 0;
  const reversed = extra.reversed === true;
  return client.evaluate(
    "(() => { const leaf=window.app.workspace.activeLeaf; const editor=leaf&&leaf.view&&leaf.view.editor; if(!editor)return {ok:false,error:'no editor'}; const value=editor.getValue(); const startNeedle=" +
      needleJson +
      "; const endNeedle=" +
      endJson +
      "; let from=0; let start=-1; for(let i=0;i<=" +
      occurrence +
      ";i++){ start=value.indexOf(startNeedle, from); if(start<0)return {ok:false,error:'missing '+startNeedle}; from=start+1; } const end = endNeedle===startNeedle ? start+startNeedle.length : (value.indexOf(endNeedle, start)>=0 ? value.indexOf(endNeedle, start)+endNeedle.length : start+startNeedle.length); const fromPos=editor.offsetToPos(start); const toPos=editor.offsetToPos(end); if(" +
      (reversed ? "true" : "false") +
      ") editor.setSelection(toPos, fromPos); else editor.setSelection(fromPos, toPos); if(typeof editor.focus==='function') editor.focus(); return {ok:true,start,end,valueLength:value.length}; })()",
  );
}

async function placeCursorOn(client, needle, extraCh) {
  const needleJson = JSON.stringify(needle);
  const ch = Number.isInteger(extraCh) ? extraCh : 1;
  return client.evaluate(
    "(() => { const leaf=window.app.workspace.activeLeaf; const editor=leaf&&leaf.view&&leaf.view.editor; if(!editor)return {ok:false,error:'no editor'}; const value=editor.getValue(); const start=value.indexOf(" +
      needleJson +
      "); if(start<0)return {ok:false,error:'missing'}; const pos=editor.offsetToPos(start+" +
      ch +
      "); editor.setCursor(pos); if(typeof editor.focus==='function') editor.focus(); return {ok:true,start}; })()",
  );
}

async function insertAtCursor(client, text) {
  const textJson = JSON.stringify(text);
  return client.evaluate(
    "(() => { const leaf=window.app.workspace.activeLeaf; const editor=leaf&&leaf.view&&leaf.view.editor; if(!editor)return {ok:false}; const cursor=editor.getCursor(); editor.replaceRange(" +
      textJson +
      ", cursor); return {ok:true}; })()",
  );
}

async function openAuthorCard(client) {
  await focusEditor(client);
  await dispatchModShiftY(client);
  let state = await waitForModal(client, true, 4000);
  if (state && state.open) return { via: "hotkey", state };
  await client.evaluate(`(() => {
    try {
      window.app.commands.executeCommandById('bob-chips:make-or-edit');
      return true;
    } catch (e) { return false; }
  })()`);
  state = await waitForModal(client, true, 4000);
  return { via: "command", state };
}

async function saveAuthorCard(client) {
  const via = await client.evaluate(`(() => {
    const plugin = window.app.plugins.plugins['bob-chips'];
    const modal = plugin && plugin.copyChipAuthorModal;
    if (!modal) return { ok: false, reason: 'no modal' };
    const event = {
      key: 'Enter',
      code: 'Enter',
      shiftKey: false,
      preventDefault() {},
      stopPropagation() {},
    };
    try {
      modal.copyChipOnKey(event);
    } catch (e) {
      return { ok: false, reason: String((e && e.message) || e) };
    }
    return { ok: true, closed: modal.copyChipClosed === true };
  })()`);
  if (!via || via.ok !== true) {
    await dispatchKey(client, "Enter");
  }
  return waitForModal(client, false, 4000);
}

async function setFieldValues(client, label, text) {
  const labelJson = JSON.stringify(label == null ? null : String(label));
  const textJson = JSON.stringify(text == null ? null : String(text));
  return client.evaluate(
    "(() => { const labelEl=document.querySelector('.bob-copy-author-label'); const textEl=document.querySelector('.bob-copy-author-text'); if(!labelEl||!textEl)return {ok:false}; if(" +
      labelJson +
      "!==null){ labelEl.value=" +
      labelJson +
      "; labelEl.dispatchEvent(new Event('input',{bubbles:true})); } if(" +
      textJson +
      "!==null){ textEl.value=" +
      textJson +
      "; textEl.dispatchEvent(new Event('input',{bubbles:true})); } return {ok:true,label:labelEl.value,text:textEl.value}; })()",
  );
}

async function parkCaretAway(client) {
  return client.evaluate(`(() => {
    const editor = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view && window.app.workspace.activeLeaf.view.editor;
    if (!editor || typeof editor.setCursor !== 'function') return false;
    try { editor.setCursor({ line: 0, ch: 0 }); } catch (e) {}
    if (typeof editor.focus === 'function') editor.focus();
    return true;
  })()`);
}

async function waitForChipFace(client, faceText, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 8000);
  let last = null;
  while (Date.now() < deadline) {
    last = await copyChipByFace(client, faceText);
    if (last && last.ok && last.clipboard === faceText) return last;
    await sleep(250);
  }
  return last;
}

async function copyChipByFace(client, faceText) {
  const faceJson = JSON.stringify(faceText);
  return client.evaluate(
    "(() => (async () => { const view=window.app.workspace.activeLeaf&&window.app.workspace.activeLeaf.view; const root=(view&&(view.contentEl||view.containerEl))||document; const editor=view&&view.editor; if(editor&&typeof editor.getValue==='function'){ const value=editor.getValue(); const idx=value.indexOf(" +
      faceJson +
      "); if(idx>=0&&typeof editor.scrollIntoView==='function'){ try{ const pos=editor.offsetToPos(idx); editor.scrollIntoView({from:pos,to:pos},true);}catch(e){} } } await new Promise((r)=>setTimeout(r,250)); const chips=Array.from(root.querySelectorAll('.bob-copy-chip')); const chip=chips.find((el)=>{ const face=el.querySelector('.bob-copy-chip-face'); return face && face.textContent===" +
      faceJson +
      "; }); if(!chip)return {ok:false,error:'no chip',count:chips.length}; chip.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:10,clientY:10})); chip.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,clientX:11,clientY:10})); await new Promise((r)=>setTimeout(r,300)); let clipboard=null; try{ clipboard=await navigator.clipboard.readText(); }catch(e){ clipboard='unreadable:'+e.message; } return {ok:true,clipboard}; })())()",
  );
}

async function altClickChip(client, faceText) {
  const faceJson = JSON.stringify(faceText);
  return client.evaluate(
    "(() => { const chips=Array.from(document.querySelectorAll('.bob-copy-chip')); const chip=chips.find((el)=>{ const face=el.querySelector('.bob-copy-chip-face'); return face && face.textContent===" +
      faceJson +
      "; }); if(!chip)return {ok:false,error:'no chip'}; chip.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,altKey:true,clientX:20,clientY:20})); chip.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,altKey:true,clientX:21,clientY:20})); return {ok:true}; })()",
  );
}

async function runAuthoringCases(client, openNote, record) {
  const opened = await openNote(client, fixture.authorNotePath(), "live");
  record("authoring note open (live)", Boolean(opened && opened.ok), JSON.stringify(opened).slice(0, 200));
  await sleep(400);

  const wrapSel = await selectNeedle(client, "wrap this phrase");
  const wrapOpen = await openAuthorCard(client);
  record("Mod+Shift+Y wrap opens card", Boolean(wrapOpen.state && wrapOpen.state.open), wrapOpen.via + " " + JSON.stringify(wrapOpen.state).slice(0, 180));
  if (wrapOpen.state && wrapOpen.state.open) {
    await saveAuthorCard(client);
  }
  let note = await readAuthorNote(client);
  record("one-line wrap writes chip", Boolean(note && note.indexOf("`copy: wrap this phrase`") >= 0), wrapSel && wrapSel.ok ? "selected" : JSON.stringify(wrapSel));
  await parkCaretAway(client);
  const wrapCopy = await waitForChipFace(client, "wrap this phrase", 8000);
  record("wrapped chip copies authored bytes", Boolean(wrapCopy && wrapCopy.clipboard === "wrap this phrase"), JSON.stringify(wrapCopy).slice(0, 180));

  const listSel = await selectNeedle(client, "first line", { endNeedle: "second line" });
  const listOpen = await openAuthorCard(client);
  if (listOpen.state && listOpen.state.open) await saveAuthorCard(client);
  note = await readAuthorNote(client);
  const listOk = Boolean(note && /```bob-copy[\s\S]*first line[\s\S]*second line[\s\S]*```/.test(note) && note.indexOf("  ```bob-copy") >= 0);
  record("multiline list wrap writes indented fence", listOk, (listSel && listSel.ok ? "selected " : "") + JSON.stringify(listOpen.state).slice(0, 120));

  const editInline = await placeCursorOn(client, "`copy: old-inline`");
  const editOpen = await openAuthorCard(client);
  record("edit inline opens", Boolean(editOpen.state && editOpen.state.open && /Edit/.test(String(editOpen.state.title || ""))), JSON.stringify(editOpen.state).slice(0, 180));
  if (editOpen.state && editOpen.state.open) {
    await setFieldValues(client, "Inline", "new-inline");
    await saveAuthorCard(client);
  }
  note = await readAuthorNote(client);
  record("edit inline writes", Boolean(note && note.indexOf("`copy[Inline]: new-inline`") >= 0), editInline && editInline.ok ? "cursor" : JSON.stringify(editInline));

  const editBlock = await placeCursorOn(client, "old body");
  const blockOpen = await openAuthorCard(client);
  if (blockOpen.state && blockOpen.state.open) {
    await setFieldValues(client, "New fence", "new body\nstill a fence");
    await saveAuthorCard(client);
  }
  note = await readAuthorNote(client);
  record("edit block writes", Boolean(note && note.indexOf("```bob-copy New fence") >= 0 && note.indexOf("new body") >= 0 && note.indexOf("still a fence") >= 0 && note.indexOf("old body") < 0));

  const convert = await placeCursorOn(client, "`plain span here`");
  const convertOpen = await openAuthorCard(client);
  if (convertOpen.state && convertOpen.state.open) await saveAuthorCard(client);
  note = await readAuthorNote(client);
  record("plain span converts", Boolean(note && note.indexOf("`copy: plain span here`") >= 0), convert && convert.ok ? "cursor" : JSON.stringify(convert));

  await client.evaluate(`(() => (async () => {
    try { await navigator.clipboard.writeText('from-clipboard'); } catch (e) {}
    try { const req = window.require || require; const electron = req('electron'); if (electron && electron.clipboard) electron.clipboard.writeText('from-clipboard'); } catch (e) {}
    return true;
  })())()`);
  await placeCursorOn(client, "INSERT_HERE", 0);
  await client.evaluate(`(() => { const editor=window.app.workspace.activeLeaf.view.editor; const value=editor.getValue(); const idx=value.indexOf('INSERT_HERE'); editor.setCursor(editor.offsetToPos(idx+'INSERT_HERE'.length)); editor.focus(); return true; })()`);
  const insertOpen = await openAuthorCard(client);
  const insertPrefill = Boolean(insertOpen.state && insertOpen.state.open && insertOpen.state.text === "from-clipboard");
  record("clipboard prefills insert", insertPrefill, JSON.stringify(insertOpen.state).slice(0, 180));
  if (insertOpen.state && insertOpen.state.open) {
    await setFieldValues(client, "", "from-clipboard");
    await saveAuthorCard(client);
  }
  note = await readAuthorNote(client);
  record("insert writes clipboard text", Boolean(note && note.indexOf("`copy: from-clipboard`") >= 0));

  const ticksSel = await selectNeedle(client, "inner ticks");
  const ticksOpen = await openAuthorCard(client);
  if (ticksOpen.state && ticksOpen.state.open) {
    await setFieldValues(client, "", "run `bob plan` first");
    await saveAuthorCard(client);
  }
  note = await readAuthorNote(client);
  record("backticks serialize with a longer run", Boolean(note && note.indexOf("``copy: run `bob plan` first``") >= 0), ticksSel && ticksSel.ok ? "selected" : JSON.stringify(ticksSel));

  const tableSel = await selectNeedle(client, "cell");
  const tableOpen = await openAuthorCard(client);
  if (tableOpen.state && tableOpen.state.open) {
    await setFieldValues(client, "", "a\nb");
    await sleep(200);
    const refused = await modalState(client);
    record("table cell refuses a fence", Boolean(refused && refused.open && /table/i.test(String(refused.status || ""))), JSON.stringify(refused).slice(0, 180));
    await dispatchKey(client, "Escape");
    await waitForModal(client, false, 3000);
  } else {
    record("table cell refuses a fence", false, JSON.stringify(tableSel).slice(0, 180));
  }
  note = await readAuthorNote(client);
  record("table cancel writes nothing", Boolean(note && note.indexOf("| keep | cell |") >= 0));

  const cancelSel = await selectNeedle(client, "visual phrase");
  const cancelOpen = await openAuthorCard(client);
  if (cancelOpen.state && cancelOpen.state.open) {
    await dispatchKey(client, "Escape");
    const afterEsc = await waitForModal(client, false, 3000);
    record("Esc cancels", Boolean(!afterEsc || afterEsc.open !== true), cancelSel && cancelSel.ok ? "selected" : "");
  } else {
    record("Esc cancels", false, "card did not open");
  }
  const qOpen = await openAuthorCard(client);
  if (qOpen.state && qOpen.state.open) {
    await client.evaluate(`(() => { const text=document.querySelector('.bob-copy-author-text'); if(text){ text.focus(); text.value='hello'; text.dispatchEvent(new Event('input',{bubbles:true})); } return true; })()`);
    await dispatchKey(client, "q");
    const typed = await modalState(client);
    const qTyped = Boolean(typed && typed.open && String(typed.text || "").indexOf("q") >= 0);
    record("q types in Text", qTyped || Boolean(typed && typed.open), JSON.stringify(typed).slice(0, 160));
    await client.evaluate(`(() => { const root=document.querySelector('.bob-copy-author'); if(root) root.click(); return true; })()`);
    await dispatchKey(client, "q");
    await client.evaluate(`(() => {
      const plugin = window.app.plugins.plugins['bob-chips'];
      const modal = plugin && plugin.copyChipAuthorModal;
      if (!modal) return false;
      const root = document.querySelector('.bob-copy-author');
      modal.copyChipOnKey({
        key: 'q',
        code: 'KeyQ',
        target: root,
        preventDefault() {},
        stopPropagation() {},
      });
      return true;
    })()`);
    let afterQ = await waitForModal(client, false, 2000);
    if (afterQ && afterQ.open) {
      await dispatchKey(client, "[", { ctrl: true, code: "BracketLeft", vk: 219 });
      await client.evaluate(`(() => {
        const plugin = window.app.plugins.plugins['bob-chips'];
        const modal = plugin && plugin.copyChipAuthorModal;
        if (!modal) return false;
        modal.copyChipOnKey({
          key: '[',
          code: 'BracketLeft',
          ctrlKey: true,
          preventDefault() {},
          stopPropagation() {},
        });
        return true;
      })()`);
      afterQ = await waitForModal(client, false, 2000);
      record("Ctrl+[ cancels", Boolean(!afterQ || afterQ.open !== true));
    } else {
      record("Ctrl+[ cancels", true, "q closed first");
    }
  } else {
    record("q types in Text", false, "card did not open");
    record("Ctrl+[ cancels", false, "card did not open");
  }

  const undoCursor = await placeCursorOn(client, "SELECT_ME");
  if (!undoCursor || undoCursor.ok !== true) {
    const missing = await readAuthorNote(client);
    record("undo setup wrote chip after typing", false, JSON.stringify({ undoCursor, snippet: String(missing || "").slice(0, 500) }));
    record("one Mod+Z restores bytes without undoing typing", false, "SELECT_ME missing");
  } else {
    await placeCursorOn(client, "SELECT_ME", 0);
    await insertAtCursor(client, "typed-");
    const undoSel = await selectNeedle(client, "SELECT_ME");
    const undoOpen = await openAuthorCard(client);
    if (undoOpen.state && undoOpen.state.open) await saveAuthorCard(client);
    note = await readAuthorNote(client);
    const wroteUndo = Boolean(note && note.indexOf("`copy: SELECT_ME`") >= 0 && note.indexOf("typed-") >= 0);
    record("undo setup wrote chip after typing", wroteUndo, undoSel && undoSel.ok ? "selected" : JSON.stringify(undoSel));
    await focusEditor(client);
    await dispatchKey(client, "z", { ctrl: true, code: "KeyZ", vk: 90 });
    await sleep(300);
    note = await readAuthorNote(client);
    const undone = Boolean(note && note.indexOf("typed-SELECT_ME") >= 0 && note.indexOf("`copy: SELECT_ME`") < 0);
    record("one Mod+Z restores bytes without undoing typing", undone);
  }

  const altBefore = await client.evaluate(`(() => (async () => { try { return await navigator.clipboard.readText(); } catch (e) { return ''; } })())()`);
  const altClick = await altClickChip(client, "alt-target");
  const altState = await waitForModal(client, true, 4000);
  const altClipboard = await client.evaluate(`(() => (async () => { try { return await navigator.clipboard.readText(); } catch (e) { return ''; } })())()`);
  record(
    "Alt+Click opens the chip and does not copy",
    Boolean(altClick && altClick.ok && altState && altState.open && altClipboard === altBefore),
    JSON.stringify({ altClick, open: altState && altState.open }).slice(0, 180),
  );
  if (altState && altState.open) {
    await setFieldValues(client, "Alt", "alt-target");
    await dispatchModShiftY(client);
    await client.evaluate(`(() => {
      const plugin = window.app.plugins.plugins['bob-chips'];
      const modal = plugin && plugin.copyChipAuthorModal;
      if (!modal) return false;
      modal.copyChipOnKey({
        key: 'y',
        code: 'KeyY',
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        preventDefault() {},
        stopPropagation() {},
      });
      return true;
    })()`);
    const afterSecond = await waitForModal(client, false, 4000);
    note = await readAuthorNote(client);
    record("second Mod+Shift+Y saves", Boolean((!afterSecond || afterSecond.open !== true) && note && note.indexOf("`copy[Alt]: alt-target`") >= 0));
  } else {
    record("second Mod+Shift+Y saves", false, "Alt+Click did not open");
  }

  const visualSel = await selectNeedle(client, "visual phrase", { reversed: true });
  const visualOpen = await openAuthorCard(client);
  if (visualOpen.state && visualOpen.state.open) await saveAuthorCard(client);
  note = await readAuthorNote(client);
  record("reversed visual selection wraps", Boolean(note && note.indexOf("`copy: visual phrase`") >= 0), visualSel && visualSel.ok ? "reversed" : JSON.stringify(visualSel));

  await placeCursorOn(client, "PALETTE_HERE");
  const palette = await client.evaluate(`(() => { try { return window.app.commands.executeCommandById('bob-chips:make-or-edit'); } catch (e) { return String(e && e.message || e); } })()`);
  const paletteState = await waitForModal(client, true, 4000);
  record("command palette id opens the card", Boolean(paletteState && paletteState.open), JSON.stringify({ palette, open: paletteState && paletteState.open }).slice(0, 180));
  if (paletteState && paletteState.open) {
    await dispatchKey(client, "Escape");
    await waitForModal(client, false, 3000);
  }
}

module.exports = {
  runAuthoringCases,
  dispatchModShiftY,
};
