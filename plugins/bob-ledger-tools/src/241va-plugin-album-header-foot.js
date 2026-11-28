// Album header shared-foot adapter (bob-cli-pf adapters): truthful
// where-marks, nested schema opener, source cache, and the kit append
// after schema/header content including identity-only returns.
class BobLedgerToolsAlbumHeaderFootMixin {
  albumHeaderFootBind() {
    if (!(this.albumHeaderSourceCache instanceof Map)) this.albumHeaderSourceCache = new Map();
    if (!(this.albumHeaderSourceFlights instanceof Map)) this.albumHeaderSourceFlights = new Map();
    if (!(this.albumHeaderFootTracked instanceof Set)) this.albumHeaderFootTracked = new Set();
    propertyCardFootAdapterBind(this, {
      pendingKey: "albumHeaderFootPendingScroll",
      untoggleKey: "albumHeaderFootUntoggle",
      unresolverKey: "albumHeaderFootUnresolver",
      refresh: () => this.scheduleAlbumHeaderRefresh(),
      livePath: (view) => this.albumHeaderLivePath(view) || "",
    });
    try {
      const cache = this.app?.metadataCache;
      if (cache && typeof cache.on === "function" && typeof this.registerEvent === "function" && !this.albumHeaderFootMetaBound) {
        this.albumHeaderFootMetaBound = true;
        this.registerEvent(cache.on("changed", (file) => {
          const path = albumHeaderPath(file?.path);
          if (!path) return;
          this.albumHeaderSourceCache?.delete?.(path);
          this.albumHeaderSourceFlights?.delete?.(path);
          this.scheduleAlbumHeaderRefresh();
        }));
      }
    } catch (_) {}
  }

  albumHeaderFootUnbind() {
    propertyCardFootAdapterUnbind(this, {
      pendingKey: "albumHeaderFootPendingScroll",
      untoggleKey: "albumHeaderFootUntoggle",
      unresolverKey: "albumHeaderFootUnresolver",
      tracked: this.albumHeaderFootTracked,
      cache: this.albumHeaderSourceCache,
      flights: this.albumHeaderSourceFlights,
    });
  }

  albumHeaderRememberSource(path, text) {
    if (!(this.albumHeaderSourceCache instanceof Map)) this.albumHeaderSourceCache = new Map();
    return propertyCardFootAdapterRememberSource(this.albumHeaderSourceCache, path, text);
  }

  albumHeaderEnsureSource(path) {
    if (!(this.albumHeaderSourceCache instanceof Map)) this.albumHeaderSourceCache = new Map();
    if (!(this.albumHeaderSourceFlights instanceof Map)) this.albumHeaderSourceFlights = new Map();
    return propertyCardFootAdapterEnsureSource(this, path, {
      cache: this.albumHeaderSourceCache,
      flights: this.albumHeaderSourceFlights,
      active: () => this.albumHeaderActive !== false,
      refresh: () => this.scheduleAlbumHeaderRefresh(),
    });
  }

  albumHeaderFootWhere(card) {
    const identity = card?.identity || {};
    const body = card?.body || null;
    const where = { type: "tile", created: "foot" };
    if (Array.isArray(identity.owners) && identity.owners.length) where.parent = "kicker";
    if (identity.emoji) where.emoji = "tile";
    if (card?.subtitle) where.summary = "subtitle";
    if (body) where.record = "schema";
    const legacy = {};
    for (const key of Array.isArray(body?.legacy) ? body.legacy : []) {
      if (key) legacy[key] = "legacy";
    }
    const nested = {};
    if (body && this.albumHeaderDesktop?.() !== false) nested.record = "schema";
    return { where, nested, legacy };
  }

  albumHeaderFootSpec(path, card) {
    const filePath = albumHeaderPath(path);
    const marks = this.albumHeaderFootWhere(card);
    return propertyCardFootAdapterSpec({
      path: filePath,
      kind: "album",
      sourceText: this.albumHeaderSourceCache?.get?.(filePath),
      frontmatter: propertyCardFootAdapterFrontmatter(this, filePath),
      ...marks,
    });
  }

  albumHeaderFootExtra(path, card) {
    let spec = null;
    try { spec = this.albumHeaderFootSpec(path, card); } catch (_) { spec = null; }
    if (!spec) {
      spec = {
        path: albumHeaderPath(path),
        inventory: propertyCardFootAdapterPendingInventory(),
        stamp: null,
      };
    }
    return propertyCardFootAdapterExtra(path, spec, "album");
  }

  albumHeaderFootHandlers(path) {
    return propertyCardFootAdapterHandlers(this, path, {
      species: "album",
      pendingScroll: this.albumHeaderFootPendingScroll,
      refresh: () => this.scheduleAlbumHeaderRefresh(),
      hoverSource: "bob-album-header",
      jumpYaml: (key, line) => { void this.albumHeaderJumpYaml(path, line); },
      jumpRecovery: () => { void this.albumHeaderJumpYaml(path, 1); },
      openPath: (target, event) => { void this.albumHeaderOpenPath(target, path, event); },
      openNested: this.albumHeaderDesktop?.() === false ? null : (key) => {
        if (key === "record") {
          void (typeof this.openAlbumSchemaEntry === "function"
            ? this.openAlbumSchemaEntry({ filePath: path })
            : this.openAlbumSchemaCard?.(null, path));
        }
      },
    });
  }

  albumHeaderTrackFoot(container, path, header) {
    return propertyCardFootAdapterTrack(container, path, header, this.albumHeaderFootTracked, "album");
  }

  albumHeaderAppendFoot(header, card, options, doc) {
    const path = albumHeaderPath(options?.sourcePath || card?.identity?.path || card?.path);
    const spec = options?.footSpec || this.albumHeaderFootSpec(path, card);
    return propertyCardFootAdapterAppend(
      header, path, doc,
      spec && options?.keyLive === true ? { ...spec, keyLive: true } : spec,
      this.albumHeaderFootHandlers(path), this.albumHeaderFootPendingScroll,
      {
        plugin: this,
        species: "album",
        view: options?.view || null,
        readingScope: options?.readingScope || null,
        component: options?.component || this,
        source: options?.sourceText,
        frontmatter: options?.frontmatter || propertyCardFootAdapterFrontmatter(this, path),
        repaint: () => this.scheduleAlbumHeaderRefresh?.(),
      },
    );
  }
}
