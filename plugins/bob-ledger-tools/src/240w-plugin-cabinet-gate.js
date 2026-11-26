// Cabinet-owned preview switch. The absent setting keeps every existing card
// byte-identical until the cabinets go-live phase explicitly opens the gate.
// The gate reads only bob-ledger-tools plugin data and never inspects DOM.
const PROPERTY_CARD_CABINETS_PREVIEW_KEY = "cabinetsPreview";
let propertyCardCabinetsLive = false;
let propertyCardCabinetsOwner = null;

function propertyCardCabinetsFromData(data) {
  try {
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    return data[PROPERTY_CARD_CABINETS_PREVIEW_KEY] === true;
  } catch (_) {
    return false;
  }
}

function propertyCardCabinetsRemember(plugin, data) {
  const live = propertyCardCabinetsFromData(data);
  propertyCardCabinetsLive = live;
  propertyCardCabinetsOwner = plugin && typeof plugin === "object" ? plugin : null;
  try {
    if (plugin && typeof plugin === "object") {
      plugin.propertyCardCabinetsLive = live;
      plugin.propertyCardCabinetsLoaded = true;
    }
  } catch (_) {}
  return live;
}

async function propertyCardCabinetsLoad(plugin) {
  if (!plugin || typeof plugin !== "object") return false;
  try {
    if (plugin.propertyCardCabinetsLoaded === true) {
      propertyCardCabinetsLive = plugin.propertyCardCabinetsLive === true;
      return propertyCardCabinetsLive;
    }
    if (plugin.propertyCardCabinetsLoadPromise) return await plugin.propertyCardCabinetsLoadPromise;
  } catch (_) {
    return false;
  }
  // A newly loaded instance must never inherit the previous instance's gate
  // while its own plugin data is still resolving.
  propertyCardCabinetsLive = false;
  propertyCardCabinetsOwner = plugin;
  try { plugin.propertyCardCabinetsLive = false; } catch (_) {}
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
    return propertyCardCabinetsRemember(plugin, stored);
  })();
  try { plugin.propertyCardCabinetsLoadPromise = load; } catch (_) {}
  try {
    return await load;
  } catch (_) {
    return propertyCardCabinetsRemember(plugin, null);
  } finally {
    try {
      if (plugin.propertyCardCabinetsLoadPromise === load) plugin.propertyCardCabinetsLoadPromise = null;
    } catch (_) {}
  }
}

function propertyCardCabinetsGateLive() {
  return propertyCardCabinetsLive === true;
}

function propertyCardCabinetsUnload(plugin) {
  if (!plugin || propertyCardCabinetsOwner !== plugin) return false;
  propertyCardCabinetsLive = false;
  propertyCardCabinetsOwner = null;
  try {
    plugin.propertyCardCabinetsLive = false;
    plugin.propertyCardCabinetsLoaded = false;
    plugin.propertyCardCabinetsLoadPromise = null;
  } catch (_) {}
  return true;
}

// Tests reset the module flag without mutating stored plugin data.
function propertyCardCabinetsSetGateForTests(live) {
  propertyCardCabinetsLive = live === true;
  return propertyCardCabinetsLive;
}
