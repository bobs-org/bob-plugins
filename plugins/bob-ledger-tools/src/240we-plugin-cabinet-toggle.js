// One semantic router for Properties, delegated folds, and content cabinets.
// It acts only on a cabinet mounted in the supplied view and never throws.
function propertyCardCabinetToggle(view, kind) {
  try {
    if (propertyCardCabinetsGateLive?.() !== true || typeof kind !== "string") return false;
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
    const rawProblems = extra.element?.getAttribute?.("data-cabinet-problems")
      || extra.element?.parentElement?.getAttribute?.("data-cabinet-problems") || "";
    const problems = typeof rawProblems === "string" ? rawProblems : "";
    const previous = propertyCardCabinetIsOpen(collected.path, kind, { problems });
    const next = !previous;
    if (previous && next === false) {
      propertyCardCabinetFocusHeadOnClose?.(extra.element, extra.element?.closest?.("[data-cabinet-kind]")?.querySelector?.(".bob-cabinet-drawer"));
    }
    propertyCardCabinetSetOpen(collected.path, kind, next, { problems });
    if (propertyCardCabinetRequestRepaint(view, collected.path, kind)) return true;
    propertyCardCabinetSetOpen(collected.path, kind, previous, { problems });
    return false;
  } catch (_) {
    return false;
  }
}
