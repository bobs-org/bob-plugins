// Bank host helpers that connect the mounted setup card to the shared
// frontmatter ownership coordinator. Kept separate from the host lifecycle
// fragment so each reviewed source fragment stays within the size limit.

function bankSetupClockLabel(timestamp) {
  try {
    if (!Number.isFinite(timestamp)) return null;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return null;
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const suffix = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    if (hours === 0) hours = 12;
    return `${hours}:${minutes} ${suffix}`;
  } catch (_) {
    return null;
  }
}

Object.assign(BobLedgerToolsBankSetupMixin.prototype, {
  bankSetupOwnMountedFrontmatter(scope, view, path, mount, sourceText, currentPath) {
    if (typeof propertyCardFrontmatterOwnMounted !== "function") return null;
    const key = bankSetupHubPath(path);
    const sourceFor = () => {
      if (view?.state?.doc && typeof view.state.doc.toString === "function") return view.state.doc.toString();
      return this.bankSetupSourceCache?.get?.(key);
    };
    const current = () => {
      const text = sourceFor();
      const card = text && this.bankSetupCardFor(key, text);
      return Boolean(card && card.model);
    };
    return propertyCardFrontmatterOwnMounted(this, {
      scope, view: view?.dom === scope ? view : null, path: key, kind: "bank", mount,
      sourceText, getSource: sourceFor, currentPath, isCurrent: current,
      active: () => this.bankSetupActive === true,
    });
  },

  bankSetupOwnMountedFrontmatterDeferred(scope, view, path, mount, sourceText, currentPath) {
    if (typeof propertyCardFrontmatterOwnMountedDeferred !== "function") return null;
    const key = bankSetupHubPath(path);
    const sourceFor = () => view?.state?.doc?.toString?.() || this.bankSetupSourceCache?.get?.(key);
    const current = () => {
      const text = sourceFor();
      const card = text && this.bankSetupCardFor(key, text);
      return Boolean(card && card.model);
    };
    // Title-slot adoption mounts after the CodeMirror update. Acquire only
    // after that mount is attached, including when eligibility has returned.
    return propertyCardFrontmatterOwnMountedDeferred(this, {
      scope, view: view?.dom === scope ? view : null, path: key, kind: "bank", mount,
      sourceText, getSource: sourceFor, currentPath, isCurrent: current,
      active: () => this.bankSetupActive === true,
      afterAttach: true,
    });
  },

  bankSetupReleaseFrontmatter(scope, path = "") {
    try {
      return propertyCardFrontmatterReleaseMounted?.(scope, {
        plugin: this, kind: "bank", path,
      }) || false;
    } catch (_) { return false; }
  },
});
