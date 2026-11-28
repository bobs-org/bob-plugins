// Property-card identity kit (bob-cli-o6 identity-kit): species registry.
// Hue says where, form says what, and words say both. A species never gets a
// hue of its own: its tile form and kicker word carry it. Cards that adopt the
// kit carry `data-card-kind`; no adapter sets it yet, so current cards keep
// their exact pixels. Pure data plus one attribute writer. Never throws.
const PROPERTY_CARD_KIND_ATTR = "data-card-kind";
const PROPERTY_CARD_KINDS = Object.freeze([
  "album", "record", "day", "week", "quarter", "year", "bank", "area", "project",
  "notebook", "prose", "ref",
]);

const PROPERTY_CARD_SPECIES = Object.freeze({
  album: Object.freeze({ kind: "album", word: "Album", tile: "stack", icon: "library", band: "", temporal: false }),
  record: Object.freeze({ kind: "record", word: "Record", tile: "sheet", icon: "file-text", band: "", temporal: false, foldDefault: true }),
  day: Object.freeze({ kind: "day", word: "Day", tile: "leaf", icon: "calendar", band: "", temporal: true }),
  week: Object.freeze({ kind: "week", word: "Week", tile: "leaf", icon: "calendar-range", band: "WEEK", temporal: true }),
  quarter: Object.freeze({ kind: "quarter", word: "Quarter", tile: "leaf", icon: "calendar-range", band: "QTR", temporal: true }),
  year: Object.freeze({ kind: "year", word: "Year", tile: "leaf", icon: "calendar-range", band: "YEAR", temporal: true }),
  bank: Object.freeze({ kind: "bank", word: "Bank", tile: "plain", icon: "landmark", band: "", temporal: false }),
  area: Object.freeze({ kind: "area", word: "Area", tile: "field", icon: "layers", band: "", temporal: false, foldDefault: true }),
  project: Object.freeze({ kind: "project", word: "Project", tile: "pennant", icon: "target", band: "", temporal: false, foldDefault: true }),
  notebook: Object.freeze({ kind: "notebook", word: "Notebook", tile: "spine", icon: "notebook-tabs", band: "", temporal: false, foldDefault: true }),
  prose: Object.freeze({ kind: "prose", word: "Prose", tile: "folio", icon: "pilcrow", band: "", temporal: false }),
  ref: Object.freeze({ kind: "ref", word: "Ref", tile: "ribbon", icon: "bookmark", band: "", temporal: false, foldDefault: true }),
});

// Frozen descriptor { kind, word, tile, icon, band, temporal, foldDefault? }
// or null. The word is title case; CSS uppercases the kicker so screen readers
// still read a word. A day's band is its weekday, which the adapter supplies.
function propertyCardSpecies(kind) {
  if (typeof kind !== "string") return null;
  return Object.prototype.hasOwnProperty.call(PROPERTY_CARD_SPECIES, kind)
    ? PROPERTY_CARD_SPECIES[kind]
    : null;
}

// "<Word>: <title>" (Album: Restaurants), the bare word for an empty title
// or when the title folds equal to the species word (Bank, not Bank: Bank),
// or the title alone for an unknown kind.
function propertyCardAccessibleName(kind, title) {
  const text = String(title === null || title === undefined ? "" : title).replace(/\s+/g, " ").trim();
  const species = propertyCardSpecies(kind);
  if (!species) return text;
  if (!text) return species.word;
  try {
    if (text.toLowerCase() === species.word.toLowerCase()) return species.word;
  } catch (_) {}
  return `${species.word}: ${text}`;
}

// Stamp identity on a card root: data-card-kind, an accessible name that
// leads with the species word, and role=group unless the card already has a
// role. Unknown kinds and missing cards change nothing and return false.
function propertyCardApplyIdentity(card, spec = {}) {
  const species = propertyCardSpecies(spec?.kind);
  if (!card || !species || typeof card.setAttribute !== "function") return false;
  try {
    card.setAttribute(PROPERTY_CARD_KIND_ATTR, species.kind);
    card.setAttribute("aria-label", propertyCardAccessibleName(species.kind, spec?.title));
    const role = typeof card.getAttribute === "function" ? card.getAttribute("role") : null;
    if (!role) card.setAttribute("role", "group");
    return true;
  } catch (_) {
    return false;
  }
}
