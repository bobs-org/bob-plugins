// Record sheet shared-foot adapter (bob-cli-pf drawer-record): per-note
// foot spec, mount tracking, and the kit append below the walk rail.
// Methods merge onto the plugin through 310-install-methods.js; this file
// owns every name starting with recordSheetFoot.
class BobLedgerToolsRecordSheetFootMixin {
  // Shared-foot spec for one record mount: where-marks declare the
  // card-to-YAML mapping (parent→kicker, type→tile, title→title when the
  // sheet covers it, schema fields and ghosts→field, created→foot). An
  // absent ghost is not a fabricated stored property; the drawer inventories
  // actual top-level source keys.
  recordSheetFootSpec(path, card) {
    const filePath = recordSheetPath(path);
    const body = card && card.body ? card.body : null;
    const frontmatter = this.recordSheetFrontmatter(filePath) || {};
    const cache = this.recordSheetCache(filePath);
    const sourceText = this.recordSheetSourceCache?.get?.(filePath);
    const where = { parent: "kicker", type: "tile", created: "foot" };
    if (body && body.coverage && body.coverage.title === "sheet") where.title = "title";
    for (const row of [...(body?.rows || []), ...(body?.ghosts || [])]) {
      if (row && row.key) where[row.key] = "field";
    }
    const legacy = {};
    for (const key of Array.isArray(body?.legacyKeys) ? body.legacyKeys : []) {
      if (key) legacy[key] = "legacy";
    }
    let inventory = null;
    try {
      inventory = typeof propertyCardInventory === "function"
        ? propertyCardInventory({
          path: filePath,
          sourcePath: filePath,
          cachePath: cache ? filePath : "",
          sourceText,
          frontmatter,
          parseYaml: typeof parseYaml === "function" ? parseYaml : null,
          where,
          nested: {},
          legacy,
        })
        : null;
    } catch (_) {
      inventory = null;
    }
    if (!inventory) {
      inventory = {
        state: "pending", reason: "kit-unavailable", rows: [],
        groups: [], count: 0, issues: [], recovery: null,
      };
    }
    const createdRow = Array.isArray(inventory.rows)
      ? inventory.rows.find((row) => row && row.key === "created")
      : null;
    let stamp = null;
    try {
      stamp = typeof propertyCardFormatCreatedStamp === "function"
        ? propertyCardFormatCreatedStamp({
          kind: "record",
          value: frontmatter.created,
          present: Object.prototype.hasOwnProperty.call(frontmatter, "created"),
          sourceScalar: createdRow ? createdRow.sourceScalar : "",
        })
        : null;
    } catch (_) {
      stamp = null;
    }
    return { path: filePath, inventory, stamp };
  }

  // One foot computation per paint: signature, mount, and drawer share it.
  recordSheetFootExtra(path, card) {
    let spec = null;
    try {
      spec = this.recordSheetFootSpec(path, card);
    } catch (_) {
      spec = null;
    }
    if (!spec) {
      spec = {
        path: recordSheetPath(path),
        inventory: {
          state: "pending", reason: "kit-unavailable", rows: [],
          groups: [], count: 0, issues: [], recovery: null,
        },
        stamp: null,
      };
    }
    let open = false;
    try {
      open = typeof propertyCardFootIsOpen === "function" && propertyCardFootIsOpen(path);
    } catch (_) {}
    return { footOpen: open, footDigest: this.recordSheetFootDigest(spec), footSpec: spec };
  }

  recordSheetFootDigest(spec) {
    try {
      const rows = Array.isArray(spec?.inventory?.rows) ? spec.inventory.rows : [];
      const hook = typeof propertyCardFootEditorHook === "function" && propertyCardFootEditorHook ? 1 : 0;
      return JSON.stringify({
        state: spec?.inventory?.state || "",
        stamp: spec?.stamp?.text || "",
        hook,
        rows: rows.map((row) => [
          row.key,
          row.occurrence,
          row.line,
          row.valueState,
          typeof propertyCardFootRowText === "function" ? propertyCardFootRowText(row) : String(row.value),
        ]),
      });
    } catch (_) {
      return "";
    }
  }

  recordSheetFootHandlers(path) {
    return {
      onToggle: (notePath, next) => {
        let decided = next;
        try {
          if (typeof propertyCardFootToggle === "function") {
            propertyCardFootToggle(notePath);
            decided = propertyCardFootIsOpen(notePath);
          }
        } catch (_) {}
        if (decided === true) {
          if (!(this.recordSheetFootPendingScroll instanceof Set)) this.recordSheetFootPendingScroll = new Set();
          this.recordSheetFootPendingScroll.add(recordSheetPath(notePath));
        }
        this.scheduleRecordSheetRefresh();
        return decided;
      },
      jumpYaml: (key, line) => { void this.recordSheetJumpYaml(path, key, line); },
      jumpRecovery: () => { void this.recordSheetOpenSource(path, 1); },
      openPath: (target, event) => { void this.recordSheetOpenPath(target, path, event); },
      hoverLink: (event, targetEl, linktext) => this.recordSheetHoverLink(event, targetEl, linktext, path),
      searchTag: (tag) => { this.recordSheetSearchTag(tag); },
      openNested: null,
      onOpenEditor: typeof propertyCardFootEditorHook === "function" && propertyCardFootEditorHook
        ? (key) => propertyCardFootOpenEditor(path, key)
        : null,
      onAddProperty: typeof propertyCardFootEditorHook === "function" && propertyCardFootEditorHook
        ? () => propertyCardFootOpenEditor(path, undefined, "add")
        : null,
      onEditAll: typeof propertyCardFootEditorHook === "function" && propertyCardFootEditorHook
        ? () => propertyCardFootOpenEditor(path, undefined, "browse")
        : null,
    };
  }

  recordSheetSearchTag(tag) {
    return propertyCardFootOpenTagSearch(this.app, tag);
  }

  // Track the mounted foot node for propertyCardToggleProperties: release
  // the path's previous (possibly detached) mounts under the container,
  // then register the live node. Null sheet only releases.
  recordSheetTrackFoot(container, path, sheet) {
    const key = recordSheetPath(path);
    try {
      if (typeof propertyCardFootReleaseScope === "function") {
        propertyCardFootReleaseScope(container || null, key);
      }
    } catch (_) {}
    if (!sheet || !key) return null;
    let foot = null;
    try {
      foot = typeof sheet.querySelector === "function"
        ? sheet.querySelector(`.${PROPERTY_CARD_FOOT_CLASS}`)
        : null;
    } catch (_) {
      foot = null;
    }
    if (!foot) return null;
    try {
      if (typeof propertyCardFootRegisterMount === "function") {
        const drawer = typeof foot.querySelector === "function"
          ? foot.querySelector(`.${PROPERTY_CARD_FOOT_DRAWER_CLASS}`)
          : null;
        const drawerId = drawer?.getAttribute?.("id") || "";
        const disclosureId = drawerId.endsWith("-drawer") ? drawerId.slice(0, -"-drawer".length) : "";
        return propertyCardFootRegisterMount(foot, key, disclosureId || undefined);
      }
    } catch (_) {}
    return null;
  }

  // Append the shared foot below the walk rail in every return: Reading and
  // Live Preview, identity-only, broken-schema, and collapsed. Consumes one
  // pending API-toggle scroll per expand; disclosure clicks scroll
  // synchronously in the foot DOM before the repaint.
  recordSheetAppendFoot(sheet, model, options, doc, footSpec) {
    try {
      const path = recordSheetPath(options?.sourcePath || model?.identity?.path || model?.path);
      if (!sheet || !path || typeof propertyCardFootBuildEl !== "function") return null;
      const spec = footSpec || this.recordSheetFootSpec(path, model && model.identity ? model : null);
      const open = typeof propertyCardFootIsOpen === "function" && propertyCardFootIsOpen(path);
      let disclosureId = "";
      try {
        disclosureId = typeof propertyCardFootNextDisclosureId === "function"
          ? propertyCardFootNextDisclosureId()
          : "";
      } catch (_) {
        disclosureId = "";
      }
      const built = propertyCardFootBuildEl(doc || recordSheetDomDoc(sheet), {
        path,
        disclosureId,
        open,
        inventory: spec.inventory,
        stamp: spec.stamp,
        keyLive: options?.keyLive === true,
        handlers: this.recordSheetFootHandlers(path),
      });
      if (!built || !built.element) return null;
      if (doc && built.element.ownerDocument !== doc) {
        try { doc.adoptNode?.(built.element); } catch (_) {}
      }
      sheet.appendChild(built.element);
      if (open && this.recordSheetFootPendingScroll instanceof Set && this.recordSheetFootPendingScroll.has(path)) {
        this.recordSheetFootPendingScroll.delete(path);
        try {
          if (typeof propertyCardFootReveal === "function") propertyCardFootReveal(built.element);
        } catch (_) {}
      }
      return built;
    } catch (_) {
      return null;
    }
  }
}
