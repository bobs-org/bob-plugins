// Frozen cabinet vocabulary and the canonical top-to-bottom stack order.
// Numbers count upward from the bottom extra, so they stay useful when one
// host owns only a subset of the family.
const PROPERTY_CARD_CABINET_KINDS = Object.freeze({
  areas: Object.freeze({ noun: "Areas", role: "content", rank: 10, defaultOpen: false }),
  projects: Object.freeze({ noun: "Projects", role: "content", rank: 20, defaultOpen: false }),
  notebooks: Object.freeze({ noun: "Notebooks", role: "content", rank: 30, defaultOpen: false }),
  albums: Object.freeze({ noun: "Albums", role: "content", rank: 40, defaultOpen: false }),
  records: Object.freeze({ noun: "Records", role: "content", rank: 50, defaultOpen: false }),
  outline: Object.freeze({ noun: "Outline", role: "content", rank: 60, defaultOpen: false }),
  schema: Object.freeze({ noun: "Schema", role: "config", rank: 70, defaultOpen: false }),
  setup: Object.freeze({ noun: "Setup", role: "config", rank: 80, defaultOpen: false }),
  properties: Object.freeze({ noun: "Properties", role: "properties", rank: 100, defaultOpen: false }),
});

const PROPERTY_CARD_CABINET_FOLD_KINDS = Object.freeze({
  album: "schema",
  bank: "setup",
  prose: "outline",
});

function propertyCardCabinetKindForFold(foldKind) {
  return typeof foldKind === "string" && Object.prototype.hasOwnProperty.call(PROPERTY_CARD_CABINET_FOLD_KINDS, foldKind)
    ? PROPERTY_CARD_CABINET_FOLD_KINDS[foldKind]
    : null;
}

function propertyCardCabinetOrder(kinds) {
  const input = Array.isArray(kinds) ? kinds : [];
  const seen = new Set();
  const valid = [];
  for (const item of input) {
    const kind = typeof item === "string" ? item : item?.kind;
    if (!Object.prototype.hasOwnProperty.call(PROPERTY_CARD_CABINET_KINDS, kind) || seen.has(kind)) continue;
    seen.add(kind);
    valid.push(kind);
  }
  return valid.sort((a, b) => PROPERTY_CARD_CABINET_KINDS[a].rank - PROPERTY_CARD_CABINET_KINDS[b].rank);
}

function propertyCardCabinetDefaultOpen(kind, options = {}) {
  const spec = PROPERTY_CARD_CABINET_KINDS[kind];
  if (!spec) return false;
  try {
    if (typeof propertyCardCabinetConfiguredOpen === "function") {
      return propertyCardCabinetConfiguredOpen(options.species, kind, options) === true;
    }
  } catch (_) {}
  return false;
}

function propertyCardCabinetNumbering(extras) {
  const ordered = propertyCardCabinetOrder(extras)
    .filter((kind) => PROPERTY_CARD_CABINET_KINDS[kind].role !== "properties");
  const numbered = ordered.slice(-9);
  return numbered.map((kind, index) => ({ kind, number: numbered.length - index }));
}
