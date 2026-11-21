// Property-card identity kit (bob-cli-o6 collection-cards): identity badge.
// Additive and backward compatible. Surfaces that name their species without
// owning the note title (the bank card's head row and card editor headers)
// show the species glyph tile and the
// species word. CSS uppercases the word like the kicker, so screen readers
// still read a word. The badge is never a heading and adds no role, so it
// never doubles a visible H1. The tile stays aria-hidden. Kit CSS gives the
// badge its own accent and ink fallbacks, so it also renders outside a
// .bob-property-card (modal headers). Returns null instead of throwing.
const PROPERTY_CARD_IDENTITY_CLASS = "bob-property-card-identity";
const PROPERTY_CARD_IDENTITY_WORD_CLASS = "bob-property-card-identity-word";

// span.bob-property-card-identity[data-card-kind] holding the glyph tile and
// span.bob-property-card-identity-word, or null for an unknown kind or a
// document without createElement/createTextNode.
// spec: { kind, emoji?, icon?, band?, value? }. The tile options are the
// ones propertyCardBuildGlyphTile takes: stack, sheet, and plain tiles show
// the emoji, else the given or species icon.
function propertyCardBuildIdentityBadge(doc, spec = {}) {
  try {
    if (!propertyCardKitDocOk(doc)) return null;
    const options = spec && typeof spec === "object" ? spec : {};
    const species = propertyCardSpecies(options.kind);
    if (!species) return null;
    const badge = propertyCardKitEl(doc, "span", PROPERTY_CARD_IDENTITY_CLASS);
    badge.setAttribute(PROPERTY_CARD_KIND_ATTR, species.kind);
    const tile = propertyCardBuildGlyphTile(doc, { ...options, kind: species.kind });
    if (tile) badge.appendChild(tile);
    badge.appendChild(propertyCardKitSpan(doc, PROPERTY_CARD_IDENTITY_WORD_CLASS, species.word));
    return badge;
  } catch (_) {
    return null;
  }
}
