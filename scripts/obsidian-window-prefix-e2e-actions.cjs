"use strict";
// Real-Obsidian window-prefix actions group, driven through the shipped
// executor (`runWindowPrefixPaletteKey`) against every DECISION_VECTORS entry.
// The main harness (`obsidian-window-prefix-e2e.cjs`) requires this module for
// its vector-to-key table and DOM probes, and implements the runner there so
// it can reuse the main harness's CDP helpers (buildFromSignature, readLive,
// keymapFinger/sameKeymap, reloadAndReconnect) without a require cycle.

const ACTIONS_KEY_TABLE = Object.freeze({
  "create-right": Object.freeze(["L"]),
  "join-right": Object.freeze(["L"]),
  "last-tab-out": Object.freeze(["L"]),
  "pinned-stays-pinned": Object.freeze(["L"]),
  "unpinned-after-pins": Object.freeze(["L"]),
  "create-left": Object.freeze(["H"]),
  "join-left": Object.freeze(["H"]),
  "middle-out": Object.freeze(["H"]),
  "edge-sole-tab": Object.freeze(["H"]),
  "only-tab": Object.freeze(["H", "L"]),
  split: Object.freeze(["v"]),
  focus: Object.freeze(["l"]),
});

const ACTIONS_COLLAPSE_VECTORS = Object.freeze(["last-tab-out", "middle-out"]);

const ACTIONS_DOM_PROBE = [
  '(()=>{try{const root=document.querySelector(".workspace-split.mod-root");',
  'if(!root)return{ok:false,error:"no mod-root"};',
  'const tabs=Array.from(root.querySelectorAll(":scope > .workspace-tabs, .workspace-tabs"));',
  'const scoped=Array.from(root.querySelectorAll(".workspace-tabs"));',
  'const list=scoped.map((t)=>{let leaves=0;try{leaves=t.querySelectorAll(".workspace-leaf").length;}catch(_){}',
  'let headers=0;try{headers=t.querySelectorAll(".workspace-tab-header").length;}catch(_){}',
  'return{leaves,headers,empty:leaves===0&&headers===0};});',
  'return{ok:true,tabs:scoped.length,empty:list.filter((x)=>x.empty).length,detail:list};}',
  'catch(e){return{ok:false,error:String(e&&e.message||e)};}})()',
].join("");

function actionKeysForVector(name) {
  return ACTIONS_KEY_TABLE[name] ? [...ACTIONS_KEY_TABLE[name]] : null;
}

const ACTIONS_FIXTURES = Object.freeze(["WP-A", "WP-B", "WP-C", "WP-D", "WP-E", "WP-F"]);

function collectAbstractTitles(signature) {
  const titles = [];
  const parts = String(signature).split("|");
  for (const part of parts) {
    const match = part.trim().match(/^\[(.*)\]$/s);
    if (!match) continue;
    for (const token of match[1].trim().split(/\s+/).filter(Boolean)) {
      const tokenMatch = token.match(/^([^!*']+)(!)?([*'])?$/);
      if (!tokenMatch) continue;
      const title = tokenMatch[1];
      if (!titles.includes(title)) titles.push(title);
    }
  }
  return titles;
}

function translateDecisionVector(vector) {
  const all = [...collectAbstractTitles(vector.from)];
  for (const title of collectAbstractTitles(vector.to)) {
    if (!all.includes(title)) all.push(title);
  }
  const mapping = new Map();
  all.forEach((title, index) => {
    const fixture = ACTIONS_FIXTURES[index % ACTIONS_FIXTURES.length];
    mapping.set(title, fixture);
  });
  const translateSignature = (signature) => String(signature).split("|").map((part) => {
    const match = part.trim().match(/^\[(.*)\]$/s);
    if (!match) return part.trim();
    const tokens = match[1].trim().split(/\s+/).filter(Boolean).map((token) => {
      const tokenMatch = token.match(/^([^!*']+)(!)?([*'])?$/);
      if (!tokenMatch) return token;
      const mapped = mapping.get(tokenMatch[1]) || tokenMatch[1];
      return `${mapped}${tokenMatch[2] || ""}${tokenMatch[3] || ""}`;
    });
    return `[ ${tokens.join("  ")} ]`;
  }).join(" | ");
  return { from: translateSignature(vector.from), to: translateSignature(vector.to), mapping: Object.fromEntries(mapping) };
}

module.exports = {
  ACTIONS_KEY_TABLE,
  ACTIONS_COLLAPSE_VECTORS,
  ACTIONS_DOM_PROBE,
  ACTIONS_FIXTURES,
  actionKeysForVector,
  collectAbstractTitles,
  translateDecisionVector,
};
