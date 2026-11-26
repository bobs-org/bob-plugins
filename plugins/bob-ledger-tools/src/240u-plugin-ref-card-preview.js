// Ref preview gate (bob-cli-qp ref-kit): a ref-owned switch keeps Ref Cards
// off in the live vault until `ref-go-live`. It is `refCardPreview: true` in
// bob-ledger-tools plugin data, read once at load. It gates the mount, the
// `==` registration, and every ref UI. It never reads or writes qm's
// `cardPreviewKinds`, and ref code never calls `propertyCardKindLive`, which
// qm.7 deletes. A closed gate gives exactly today's rendering: native
// Properties and the plain H1. Pure: no DOM, no spawns, never throws.
const REF_CARD_PREVIEW_KEY = "refCardPreview";

function refCardPreviewFromData(data) {
  try {
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    return data[REF_CARD_PREVIEW_KEY] === true;
  } catch (_) {
    return false;
  }
}

function refCardPreviewRemember(plugin, data) {
  const live = refCardPreviewFromData(data);
  try {
    if (plugin && typeof plugin === "object") plugin.refCardPreview = live;
  } catch (_) {}
  return live;
}

async function refCardPreviewLoad(plugin) {
  if (!plugin || typeof plugin !== "object") return false;
  if (plugin.refCardPreviewLoaded === true) {
    return plugin.refCardPreview === true;
  }
  if (plugin.refCardPreviewLoadPromise) return plugin.refCardPreviewLoadPromise;
  const load = (async () => {
    let stored = null;
    try {
      if (plugin.ledgerToolsPluginDataLoaded === true
        && plugin.ledgerToolsPluginData && typeof plugin.ledgerToolsPluginData === "object") {
        stored = plugin.ledgerToolsPluginData;
      } else if (typeof plugin.loadLedgerToolsPluginData === "function") {
        stored = await plugin.loadLedgerToolsPluginData();
      } else if (typeof plugin.loadData === "function") {
        stored = await plugin.loadData();
      }
    } catch (_) {
      stored = null;
    }
    const live = refCardPreviewRemember(plugin, stored);
    plugin.refCardPreviewLoaded = true;
    return live;
  })();
  plugin.refCardPreviewLoadPromise = load;
  try {
    return await load;
  } finally {
    if (plugin.refCardPreviewLoadPromise === load) plugin.refCardPreviewLoadPromise = null;
  }
}

function refCardPreviewLive(plugin) {
  try {
    if (!plugin || typeof plugin !== "object") return false;
    return plugin.refCardPreview === true;
  } catch (_) {
    return false;
  }
}
