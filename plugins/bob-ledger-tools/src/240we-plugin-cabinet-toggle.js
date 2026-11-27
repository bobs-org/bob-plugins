// One semantic router for Properties, delegated folds, and content cabinets.
// It acts only on a cabinet mounted in the supplied view and never throws.
function propertyCardCabinetToggle(view, kind) {
  try {
    if (typeof kind !== "string") return false;
    const collected = propertyCardCabinetsInView(view);
    if (!collected?.path) return false;
    if (kind === "properties") {
      if (!collected.properties || typeof propertyCardToggleProperties !== "function") return false;
      return propertyCardToggleProperties(view) === true;
    }
    const extra = collected.extras.find((row) => row.kind === kind);
    const spec = PROPERTY_CARD_CABINET_KINDS[kind];
    if (!extra || !spec) return false;
    if (spec.role === "config") {
      const foldKind = Object.keys(PROPERTY_CARD_CABINET_FOLD_KINDS)
        .find((candidate) => PROPERTY_CARD_CABINET_FOLD_KINDS[candidate] === kind);
      const registration = foldKind ? propertyCardFoldKinds.get(foldKind) : null;
      if (typeof registration?.toggle !== "function") return false;
      if (extra.open) propertyCardCabinetFocusHeadOnClose?.(extra.element, extra.element?.closest?.("[data-cabinet-kind]")?.querySelector?.(".bob-cabinet-drawer"));
      try {
        const result = registration.toggle(collected.path, view);
        return result !== false;
      } catch (_) {
        return false;
      }
    }
    if (spec.role !== "content" || !propertyCardCabinetProviderFor(kind)) return false;
    // Content providers own the full toggle lifecycle on their disclosure
    // button: state, lazy body mount, provider callbacks, and drawer motion.
    // Route keyboard picks through that same control so they cannot update
    // session state without actually repainting the mounted view.
    const control = extra.element;
    if (!control || typeof control.click !== "function") return false;
    const previous = control.getAttribute?.("aria-expanded") === "true";
    try { control.click(); } catch (_) { return false; }
    return control.getAttribute?.("aria-expanded") === String(!previous);
  } catch (_) {
    return false;
  }
}
