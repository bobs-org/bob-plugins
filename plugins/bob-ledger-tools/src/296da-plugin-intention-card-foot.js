// Day/week/quarter/year card shared-foot adapter (bob-cli-pf adapters).
// Identity-only temporal cards still get the foot; missing created stays
// quiet. Reuses the existing confirmed-source cache.
class BobLedgerToolsIntentionCardFootMixin {
  intentionCardFootBind() {
    if (!(this.intentionCardFootTracked instanceof Set)) this.intentionCardFootTracked = new Set();
    propertyCardFootAdapterBind(this, {
      pendingKey: "intentionCardFootPendingScroll",
      untoggleKey: "intentionCardFootUntoggle",
      unresolverKey: "intentionCardFootUnresolver",
      refresh: () => this.intentionCardHost?.().scheduleRefresh?.(),
      livePath: (view) => this.intentionCardLivePath(view) || "",
    });
  }

  intentionCardFootUnbind() {
    propertyCardFootAdapterUnbind(this, {
      pendingKey: "intentionCardFootPendingScroll",
      untoggleKey: "intentionCardFootUntoggle",
      unresolverKey: "intentionCardFootUnresolver",
      tracked: this.intentionCardFootTracked,
    });
  }

  intentionCardFootSource(path) {
    const key = intentionCardFilePath(path);
    return this.intentionCardSourceCache?.get?.(key)
      || this.intentionCardUnconfirmedSource?.get?.(key)
      || this.intentionCardSourceHold?.get?.(key)
      || null;
  }

  intentionCardFootWhere(model) {
    const where = { type: "tile", created: "foot" };
    if (Array.isArray(model?.identity?.kicker) && model.identity.kicker.length) where.parent = "kicker";
    if (Array.isArray(model?.intentions) && model.intentions.length) where.intentions = "intentions";
    if (model?.summary) where.summary = "summary";
    if (model?.reflection) where.reflection = "reflection";
    if (model?.summaryState === "agent") where.summary_drafted = "agent";
    return where;
  }

  intentionCardFootNoteDate(model) {
    const subject = model?.subject;
    if (!subject) return "";
    return subject.kind === "day" ? subject.id : subject.start || "";
  }

  intentionCardFootSpec(path, model) {
    const key = intentionCardFilePath(path);
    const current = this.intentionCardFootSource(key);
    const baseFm = current?.frontmatter || propertyCardFootAdapterFrontmatter(this, key);
    const merged = typeof this.intentionCardOverlayFrontmatterFor === "function"
      ? this.intentionCardOverlayFrontmatterFor(key, baseFm)
      : { frontmatter: baseFm };
    return propertyCardFootAdapterSpec({
      path: key,
      kind: model?.kind || "day",
      temporal: true,
      noteDate: this.intentionCardFootNoteDate(model),
      sourceText: current?.source,
      frontmatter: merged.frontmatter || baseFm,
      where: this.intentionCardFootWhere(model),
    });
  }

  intentionCardFootExtra(path, model) {
    let spec = null;
    try { spec = this.intentionCardFootSpec(path, model); } catch (_) { spec = null; }
    if (!spec) {
      spec = {
        path: intentionCardFilePath(path),
        inventory: propertyCardFootAdapterPendingInventory(),
        stamp: null,
      };
    }
    return propertyCardFootAdapterExtra(path, spec);
  }

  intentionCardFootSignature(model, extra) {
    return JSON.stringify([model?.signature || "", extra?.footDigest || "", extra?.footOpen === true]);
  }

  intentionCardFootHandlers(path, model) {
    const key = intentionCardFilePath(path);
    const species = (model && (model.kind || model.species)) || "";
    return propertyCardFootAdapterHandlers(this, key, {
      species,
      pendingScroll: this.intentionCardFootPendingScroll,
      refresh: () => this.intentionCardHost?.().scheduleRefresh?.(),
      hoverSource: "bob-intention-card",
      jumpYaml: (name, line) => { void this.intentionCardJumpSource?.(key, line); },
      jumpRecovery: () => { void this.intentionCardJumpSource?.(key, 1); },
      openPath: (target, event) => { void this.intentionCardOpenLink?.(target, key, event); },
    });
  }

  intentionCardTrackFoot(container, path, card, model) {
    const species = (model && (model.kind || model.species)) || "";
    return propertyCardFootAdapterTrack(container, path, card, this.intentionCardFootTracked, species || undefined);
  }

  intentionCardAppendFoot(card, model, doc) {
    const path = intentionCardFilePath(model?.path);
    const spec = model?.footSpec || this.intentionCardFootSpec(path, model);
    const species = (model && (model.kind || model.species)) || spec?.species || spec?.kind || "";
    return propertyCardFootAdapterAppend(
      card, path, doc, spec, this.intentionCardFootHandlers(path, model), this.intentionCardFootPendingScroll,
      { species: species || undefined },
    );
  }
}
