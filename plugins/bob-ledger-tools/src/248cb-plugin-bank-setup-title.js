// Bank title ownership (bob-cli-q6 bank-title): the bank card's identity
// model, title block, and title-slot adoption. The card owns the note top in
// desktop Live Preview and Reading through the adopter glue (240k); embeds,
// popovers, canvas, print, mobile, and failed mounts keep today's body
// placement with the kit's demoted heading. No Markdown or frontmatter is
// rewritten. The BANK badge is retired: the tile and kicker carry identity.
const bankSetupNodeSignatures = new WeakMap();

// First body H1, cleaned (emoji included), from live source bytes. Probes the
// kit range with an accept-all recognizer so the scan stays frontmatter-aware
// without duplicating its rules. "" when the note has no H1.
function bankSetupFirstHeading(sourceText) {
  try {
    const range = propertyCardTitleSourceRange(String(sourceText || ""), {
      key: "bank:probe",
      requireHeading: true,
      heading: () => true,
      follower: () => false,
    });
    return range && typeof range.title === "string" ? range.title : "";
  } catch (_) {
    return "";
  }
}

// Local identity for the bank card's title block: path, title, tile emoji,
// raw heading, summary, and the parent chain from the metadata cache alone,
// so the title paints at once without waiting for a bob report. The title
// comes from the first body H1 with its leading emoji split into the tile
// ("# 🏦 Bank" -> tile 🏦, title Bank); fallbacks are tile 🏦 and the
// humanized stem. Null unless the path is the bank hub.
function bankSetupIdentityModel(path, options = {}) {
  try {
    const hub = bankSetupHubPath(path);
    if (!bankSetupIsHubPath(hub)) return null;
    const metadataCache = options.metadataCache || null;
    const vault = options.vault || null;
    const stem = hub.split("/").pop().replace(/\.md$/i, "");
    // The real H1 (live bytes, else the cached headings) drives the split
    // and the recognizer. Aliases and the stem only top up the title; they
    // never pose as a heading.
    let realHeading = "";
    if (typeof options.sourceText === "string" && options.sourceText) {
      realHeading = bankSetupFirstHeading(options.sourceText);
    }
    let frontmatter = null;
    try {
      const file = typeof notebookResolveLinkFile === "function"
        ? notebookResolveLinkFile(hub, hub, metadataCache, vault)
        : null;
      const cache = file && metadataCache?.getFileCache?.(file);
      frontmatter = cache?.frontmatter && typeof cache.frontmatter === "object" ? cache.frontmatter : null;
      if (!realHeading) {
        const headings = cache && Array.isArray(cache.headings) ? cache.headings : [];
        const h1 = headings.find((row) => row && row.level === 1 && row.heading);
        if (h1) realHeading = String(h1.heading || "").trim();
      }
    } catch (_) {
      frontmatter = null;
    }
    let raw = realHeading;
    if (!raw && typeof notebookHeaderNoteTitle === "function") {
      try {
        raw = String(notebookHeaderNoteTitle(hub, metadataCache, vault) || "").trim();
      } catch (_) {
        raw = "";
      }
    }
    const split = typeof propertyCardSplitLeadingEmoji === "function"
      ? propertyCardSplitLeadingEmoji(raw)
      : { emoji: "", rest: String(raw || "").trim() };
    const emoji = split.emoji || "🏦";
    let title = split.rest;
    // A bare stem (no H1 anywhere, or an H1 that just repeats it) reads as a
    // title: "bank" -> "Bank", like the album stem fallback.
    try {
      if (!title || title.toLowerCase() === stem.toLowerCase()) {
        title = typeof albumHeaderHumanize === "function"
          ? albumHeaderHumanize(title || stem) || stem
          : (title || stem);
      }
    } catch (_) {
      if (!title) title = stem;
    }
    const summary = frontmatter && typeof frontmatter.summary === "string"
      ? frontmatter.summary.trim()
      : "";
    let owners = [];
    let ancestryBroken = false;
    try {
      const parent = typeof pomodoroHomeParentTarget === "function"
        ? pomodoroHomeParentTarget(frontmatter ? frontmatter.parent : null)
        : (typeof albumNormalizeParent === "function" ? albumNormalizeParent(frontmatter ? frontmatter.parent : null) : "");
      const ancestry = typeof albumHeaderOwnerChain === "function"
        ? albumHeaderOwnerChain({ path: hub, parent: parent || "" }, { metadataCache, vault, sourcePath: hub })
        : { crumbs: [] };
      owners = (ancestry.crumbs || []).map((crumb) => ({
        path: crumb.path,
        title: crumb.title || crumb.stem,
        stem: crumb.stem,
        kind: crumb.kind,
      }));
      ancestryBroken = Boolean(ancestry.broken || ancestry.cyclic || ancestry.truncated);
    } catch (_) {
      owners = [];
      ancestryBroken = false;
    }
    return {
      kind: "bank",
      path: hub,
      stem,
      title,
      emoji,
      heading: realHeading || (title ? `${emoji} ${title}`.trim() : ""),
      summary,
      owners,
      ancestryBroken,
      ancestryMessage: ancestryBroken
        ? "Some owner ancestry could not be resolved; only confirmed notes are linked."
        : "",
    };
  } catch (_) {
    return null;
  }
}

// Stable digest of the identity half of a card repaint, so title, tile,
// kicker, and subtitle changes repaint even when the report model is stale.
function bankSetupIdentityDigest(identity) {
  try {
    return JSON.stringify([
      identity && identity.title,
      identity && identity.emoji,
      identity && identity.heading,
      identity && identity.summary,
      (identity && Array.isArray(identity.owners) ? identity.owners : [])
        .map((owner) => [owner.path, owner.title]),
      Boolean(identity && identity.ancestryBroken),
    ]);
  } catch (_) {
    return "identity";
  }
}

class BobLedgerToolsBankSetupTitleMixin {
  bankSetupSettledCache() {
    try {
      return typeof propertyCardSettledMetadataCache === "function"
        ? propertyCardSettledMetadataCache(this.app)
        : this.app?.metadataCache;
    } catch (_) {
      return this.app?.metadataCache;
    }
  }

  bankSetupTitleIdentity(sourcePath, sourceText) {
    try {
      return bankSetupIdentityModel(sourcePath, {
        sourceText,
        metadataCache: this.bankSetupSettledCache(),
        vault: this.app?.vault,
      });
    } catch (_) {
      return null;
    }
  }

  // The real hue walk (cash's walk), like album, so the card follows the
  // parent area. Null falls back to the bank.md color and "magenta" literal.
  bankSetupTitleHue(sourcePath) {
    try {
      if (typeof notebookHostHueName === "function") {
        return notebookHostHueName(sourcePath, this.bankSetupSettledCache(), this.app?.vault);
      }
    } catch (_) {}
    return null;
  }

  // { identity, model }: identity is required and always supplies the title;
  // model is the report-backed Setup model, or null while the report is
  // pending, failed, or has no entry.
  bankSetupCardFor(sourcePath, sourceText) {
    try {
      const identity = this.bankSetupTitleIdentity(sourcePath, sourceText);
      if (!identity) return null;
      let model = null;
      try {
        model = this.bankSetupModelFor(sourcePath);
      } catch (_) {
        model = null;
      }
      return { identity, model };
    } catch (_) {
      return null;
    }
  }

  bankSetupTitleRecognizer(identity) {
    try {
      return propertyCardBankTitleRecognizer(identity && identity.heading);
    } catch (_) {
      return propertyCardBankTitleRecognizer("");
    }
  }

  async bankSetupKickerOpen(target, sourcePath, event) {
    const path = bankSetupHubPath(target);
    if (!path) return { ok: false };
    let pane = false;
    try {
      pane = typeof albumHeaderLinkPane === "function"
        ? albumHeaderLinkPane(event)
        : Boolean(event?.ctrlKey || event?.metaKey);
    } catch (_) {
      pane = Boolean(event?.ctrlKey || event?.metaKey);
    }
    try {
      const workspace = this.app?.workspace;
      if (workspace && typeof workspace.openLinkText === "function") {
        await workspace.openLinkText(path.replace(/\.md$/i, ""), sourcePath || "", pane);
        return { ok: true };
      }
    } catch (_) {}
    try { new Notice("Could not open the bank owner."); } catch (_) {}
    return { ok: false };
  }

  bankSetupReleaseAdoptionOnScope(view) {
    try {
      const livePath = this.bankSetupLivePath(view);
      const sourcePath = livePath || this.bankSetupSourcePath(view);
      if (view?.dom) this.bankSetupReleaseAdoption(view.dom, sourcePath || "");
    } catch (_) {}
  }

  // Patch a slot-mounted Live Preview card outside the CodeMirror update.
  bankSetupPatchLive(view, adopted, fresh, signature) {
    const target = adopted.node;
    try {
      if (typeof queueMicrotask === "function") {
        queueMicrotask(() => {
          try {
            const entry = typeof propertyCardAdoptedEntry === "function" ? propertyCardAdoptedEntry(view?.dom) : null;
            if (!entry || entry.node !== target || entry.generation !== adopted.generation) return;
            const doc = notebookDomDoc(target) || (typeof document !== "undefined" ? document : null);
            const active = doc?.activeElement;
            const focusKey = active && target?.contains?.(active)
              ? active.getAttribute?.("data-bank-setup-focus") : "";
            propertyCardAdoptPatch(target, fresh);
            bankSetupNodeSignatures.set(target, signature);
            propertyCardSyncTitleHeading(target, entry.owned);
            if (focusKey) {
              try {
                const next = target.querySelector?.(`[data-bank-setup-focus="${focusKey}"]`);
                next?.focus?.({ preventScroll: true });
              } catch (_) {}
            }
          } catch (_) {}
        });
      } else {
        propertyCardAdoptPatch(target, fresh);
        bankSetupNodeSignatures.set(target, signature);
      }
    } catch (_) {}
  }

  bankSetupReleaseAdoption(scope, sourcePath = "", options = {}) {
    try {
      return propertyCardAdoptRelease(scope, sourcePath || undefined, "bank", options) === true;
    } catch (_) {
      return false;
    }
  }

  // Body-placed card nodes for this path under root: never the slot node,
  // never another path's card, never a nested embed's card.
  bankSetupBodyNodes(root, sourcePath, exclude = null) {
    const path = bankSetupHubPath(sourcePath);
    return Array.from(root?.querySelectorAll?.(`.${BANK_SETUP_CLASS}`) || []).filter((node) => {
      if (node === exclude || !this.bankSetupNodeBelongs(node, root)) return false;
      if (node.classList?.contains?.(PROPERTY_CARD_TITLE_SLOT_CLASS)) return false;
      const ownedPath = bankSetupHubPath(node.getAttribute?.("data-bank-setup-source") || "");
      return !path || !ownedPath || ownedPath === path;
    });
  }

  // Stray mounts stranded in editor callout chunks (never the live widget,
  // never another path).
  bankSetupRemoveStrays(root, sourcePath) {
    try {
      for (const node of Array.from(root?.querySelectorAll?.(`.${BANK_SETUP_CLASS}`) || [])) {
        if (node.getAttribute?.("data-cm-widget") === "true") continue;
        if (!node.closest?.(".cm-widgetBuffer, .cm-content")) continue;
        if (bankSetupHubPath(node.getAttribute?.("data-bank-setup-source")) !== bankSetupHubPath(sourcePath)) continue;
        node.remove?.();
      }
    } catch (_) {}
  }

  // Mount the card node in the title slot (or report fallback). Reading
  // mounts synchronously; Live Preview defers around the CodeMirror update.
  // onLost reschedules so a lost slot recovers through the next refresh.
  bankSetupAdoptTitle(scope, header, sourcePath, identity, extra = {}) {
    try {
      if (propertyCardHomeBankAreaCurrent?.(scope, bankSetupHubPath(sourcePath))) {
        // A current Area mount owns the pane's title arbitration. The bank
        // card remains in the body and keeps its setup/editor controls.
        this.bankSetupReleaseAdoption(scope, sourcePath, { preserveFallback: true });
        this.bankSetupReleaseFrontmatter?.(scope, sourcePath);
        return { mode: "fallback", release: () => {} };
      }
      return propertyCardAdoptTitle(scope, header, {
        path: bankSetupHubPath(sourcePath),
        kind: "bank",
        view: extra.view || null,
        currentPath: extra.currentPath || null,
        recognizer: this.bankSetupTitleRecognizer(identity),
        onLost: () => this.scheduleBankSetupRefresh(),
        onMount: extra.onMount || null,
      });
    } catch (_) {
      return { mode: "fallback", release: () => {} };
    }
  }

  // Patch a mounted card in place. The caller adopts right after, and the
  // adopter promotes or demotes the kit heading to match ownership.
  bankSetupPatchAdopted(header, fresh) {
    try {
      return propertyCardAdoptPatch(header, fresh) || header;
    } catch (_) {
      return header;
    }
  }
}
