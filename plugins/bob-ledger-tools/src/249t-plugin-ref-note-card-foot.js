// Shared Ref Card foot adapter: created/captured stamp and the Properties
// drawer. Reference sync and identity roles follow the ref-props table in
// plan:202611/ref_cards.md and fold into Managed; loose citation fields stay
// editable through the ordinary Property Editor.
const REF_NOTE_CARD_FOOT_KIND = "ref";

function refNoteCardFootModel(frontmatter) {
  try {
    const fm = frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter) ? frontmatter : {};
    const hasCreated = Object.prototype.hasOwnProperty.call(fm, "created") && fm.created !== null && fm.created !== undefined;
    const hasCaptured = Object.prototype.hasOwnProperty.call(fm, "captured") && fm.captured !== null && fm.captured !== undefined;
    return Object.freeze({
      created: hasCreated ? fm.created : null,
      captured: hasCaptured ? fm.captured : null,
      stampValue: hasCreated ? fm.created : hasCaptured ? fm.captured : null,
      stampLabel: hasCreated ? "created" : hasCaptured ? "captured" : "",
    });
  } catch (_) {
    return Object.freeze({ created: null, captured: null, stampValue: null, stampLabel: "" });
  }
}

class BobLedgerToolsRefNoteCardFootMixin {
  refNoteCardFootBind() {
    if (!(this.refNoteCardSourceCache instanceof Map)) this.refNoteCardSourceCache = new Map();
    if (!(this.refNoteCardSourceFlights instanceof Map)) this.refNoteCardSourceFlights = new Map();
    if (!(this.refNoteCardFootTracked instanceof Set)) this.refNoteCardFootTracked = new Set();
    if (!(this.refNoteCardFootPendingScroll instanceof Set)) this.refNoteCardFootPendingScroll = new Set();
    propertyCardFootAdapterBind(this, {
      pendingKey: "refNoteCardFootPendingScroll",
      untoggleKey: "refNoteCardFootUntoggle",
      unresolverKey: "refNoteCardFootUnresolver",
      refresh: () => this.scheduleRefNoteCardRefresh?.(),
      livePath: (view) => this.refNoteCardLivePath?.(view) || "",
    });
    try {
      const cache = this.app?.metadataCache;
      if (cache && typeof cache.on === "function" && typeof this.registerEvent === "function" && !this.refNoteCardMetaBound) {
        this.refNoteCardMetaBound = true;
        this.registerEvent(cache.on("changed", (file) => {
          const path = refNoteCardPath(file?.path);
          if (!path) return;
          this.refNoteCardSourceCache?.delete?.(path);
          this.refNoteCardSourceFlights?.delete?.(path);
          this.scheduleRefNoteCardRefresh?.();
        }));
      }
    } catch (_) {}
    try {
      const vault = this.app?.vault;
      if (vault && typeof vault.on === "function" && typeof this.registerEvent === "function" && !this.refNoteCardVaultBound) {
        this.refNoteCardVaultBound = true;
        this.registerEvent(vault.on("rename", (file, oldPath) => {
          try { propertyCardFootRenamePath?.(oldPath, file?.path); } catch (_) {}
          const previous = refNoteCardPath(oldPath);
          const next = refNoteCardPath(file?.path);
          if (previous && previous !== next) {
            this.refNoteCardSourceCache?.delete?.(previous);
            this.refNoteCardSourceFlights?.delete?.(previous);
            this.refNoteCardCollapsed?.delete?.(previous);
          }
          this.scheduleRefNoteCardRefresh?.();
        }));
        this.registerEvent(vault.on("delete", (file) => {
          try { propertyCardFootReleasePath?.(file?.path); } catch (_) {}
          const path = refNoteCardPath(file?.path);
          this.refNoteCardSourceCache?.delete?.(path);
          this.refNoteCardSourceFlights?.delete?.(path);
          this.refNoteCardCollapsed?.delete?.(path);
          this.scheduleRefNoteCardRefresh?.();
        }));
      }
    } catch (_) {}
  }

  refNoteCardFootUnbind() {
    propertyCardFootAdapterUnbind(this, {
      pendingKey: "refNoteCardFootPendingScroll",
      untoggleKey: "refNoteCardFootUntoggle",
      unresolverKey: "refNoteCardFootUnresolver",
      tracked: this.refNoteCardFootTracked,
      cache: this.refNoteCardSourceCache,
      flights: this.refNoteCardSourceFlights,
    });
    this.refNoteCardMetaBound = false;
    this.refNoteCardVaultBound = false;
  }

  refNoteCardRememberSource(path, text) {
    if (!(this.refNoteCardSourceCache instanceof Map)) this.refNoteCardSourceCache = new Map();
    return propertyCardFootAdapterRememberSource(this.refNoteCardSourceCache, path, text);
  }

  refNoteCardEnsureSource(path) {
    if (!(this.refNoteCardSourceCache instanceof Map)) this.refNoteCardSourceCache = new Map();
    if (!(this.refNoteCardSourceFlights instanceof Map)) this.refNoteCardSourceFlights = new Map();
    return propertyCardFootAdapterEnsureSource(this, path, {
      cache: this.refNoteCardSourceCache,
      flights: this.refNoteCardSourceFlights,
      active: () => this.refNoteCardActive === true,
      refresh: () => this.scheduleRefNoteCardRefresh?.(),
    });
  }

  refNoteCardFootFrontmatter(path) {
    try { return propertyCardFootAdapterFrontmatter(this, refNoteCardPath(path)) || {}; } catch (_) { return {}; }
  }

  refNoteCardFootSpec(path, model) {
    const filePath = refNoteCardPath(path);
    const frontmatter = model?.frontmatter && typeof model.frontmatter === "object"
      ? model.frontmatter : this.refNoteCardFrontmatter(filePath);
    const foot = refNoteCardFootModel(frontmatter);
    const stampFrontmatter = foot.stampLabel === "captured"
      ? { ...frontmatter, created: foot.stampValue }
      : frontmatter;
    const where = {
      title: "title",
      summary: "dek",
      author: "byline",
      published: "byline",
      source_url: "byline",
      url: "byline",
      source_pdf: "access",
      audio: "access",
      created: "foot",
      captured: "foot",
    };
    const spec = propertyCardFootAdapterSpec({
      path: filePath,
      kind: REF_NOTE_CARD_FOOT_KIND,
      sourceText: this.refNoteCardSourceCache?.get?.(filePath),
      frontmatter: stampFrontmatter,
      where,
      managed: refNoteCardManagedMap(frontmatter),
    });
    if (foot.stampLabel === "captured" && spec?.stamp?.text) {
      spec.stamp = { ...spec.stamp, text: spec.stamp.text.replace(/^created\b/, "captured") };
    }
    return spec;
  }

  refNoteCardFootExtra(path, model) {
    const spec = this.refNoteCardFootSpec(path, model)
      || { path: refNoteCardPath(path), inventory: propertyCardFootAdapterPendingInventory(), stamp: null };
    return propertyCardFootAdapterExtra(path, spec, "ref");
  }

  refNoteCardFootHandlers(path) {
    const filePath = refNoteCardPath(path);
    return propertyCardFootAdapterHandlers(this, filePath, {
      species: "ref",
      pendingScroll: this.refNoteCardFootPendingScroll,
      refresh: () => this.scheduleRefNoteCardRefresh?.(),
      hoverSource: "bob-ref-card",
      jumpYaml: (key, line) => { void this.homeCardJumpYaml?.(filePath, key, line); },
      jumpRecovery: () => { void this.homeCardJumpYaml?.(filePath, "", 1); },
      openPath: (target, event) => { void this.homeCardOpenPath?.(target, filePath, event); },
    });
  }

  refNoteCardTrackFoot(container, path, card) {
    return propertyCardFootAdapterTrack(container, path, card, this.refNoteCardFootTracked, "ref");
  }

  refNoteCardAppendFoot(card, path, model, doc, footSpec, options = {}) {
    const key = refNoteCardPath(path);
    if (!card || !key) return null;
    const spec = footSpec || this.refNoteCardFootSpec(key, model);
    const built = propertyCardFootAdapterAppend(
      card,
      key,
      doc,
      options.keyLive === true ? { ...spec, keyLive: true } : spec,
      this.refNoteCardFootHandlers(key),
      this.refNoteCardFootPendingScroll,
      { species: "ref" },
    );
    if (!built?.element) return built;
    const lint = doc.createElement("span");
    lint.setAttribute("class", "bob-ref-card-lint-slot");
    lint.setAttribute("data-ref-lint", "true");
    lint.setAttribute("data-state", "waiting");
    lint.setAttribute("aria-live", "polite");
    lint.setAttribute("aria-hidden", "true");
    try { built.element.insertBefore(lint, built.drawer || null); } catch (_) { built.element.appendChild(lint); }
    return built;
  }
}
