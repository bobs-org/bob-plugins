// Content providers belong to the plugin generation that registered them.
// A late teardown from an older registration cannot erase its replacement.
// `applies` stays synchronous and may use only confirmed source and cached
// reports; `buildBody` is the separately lazy, potentially async operation.
const propertyCardCabinetProviders = new Map();
let propertyCardCabinetProviderGeneration = 0;

function propertyCardRegisterCabinetProvider(plugin, kind, provider) {
  const spec = PROPERTY_CARD_CABINET_KINDS[kind];
  if (!plugin || !spec || spec.role !== "content" || !provider || typeof provider !== "object"
    || typeof provider.applies !== "function" || typeof provider.buildBody !== "function"
    || typeof provider.paintKey !== "function") return () => false;
  propertyCardCabinetProviderGeneration += 1;
  const entry = { plugin, kind, generation: propertyCardCabinetProviderGeneration, provider };
  propertyCardCabinetProviders.set(kind, entry);
  let live = true;
  return () => {
    if (!live) return false;
    live = false;
    if (propertyCardCabinetProviders.get(kind) !== entry
      || entry.generation !== propertyCardCabinetProviderGenerationFor(kind)) return false;
    propertyCardCabinetProviders.delete(kind);
    return true;
  };
}

function propertyCardCabinetProviderGenerationFor(kind) {
  return propertyCardCabinetProviders.get(kind)?.generation || 0;
}

function propertyCardCabinetProviderFor(kind) {
  return propertyCardCabinetProviders.get(kind)?.provider || null;
}

function propertyCardCabinetProviderApplies(kind, context = {}) {
  const provider = propertyCardCabinetProviderFor(kind);
  if (!provider) return null;
  try {
    const result = provider.applies(context);
    if (result && typeof result.then === "function") {
      Promise.resolve(result).catch(() => {});
      return null;
    }
    return result && typeof result === "object" && !Array.isArray(result) ? result : null;
  } catch (_) {
    return null;
  }
}

function propertyCardCabinetProvidersReleasePlugin(plugin) {
  let count = 0;
  for (const [kind, entry] of Array.from(propertyCardCabinetProviders.entries())) {
    if (entry.plugin !== plugin) continue;
    if (propertyCardCabinetProviders.get(kind) === entry) {
      propertyCardCabinetProviders.delete(kind);
      count += 1;
    }
  }
  return count;
}

function propertyCardCabinetProvidersResetForTests() {
  propertyCardCabinetProviders.clear();
  propertyCardCabinetProviderGeneration = 0;
}
