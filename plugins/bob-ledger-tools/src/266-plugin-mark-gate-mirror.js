// --- Mark gate popout mirror: body-class gates in every window ---------
// `BobLedgerToolsMarkGateMixin`, installed in `310-install-methods.js`
// before the date-marks mixin. Owned by the epic plan
// `plan:202610/backlog_batch11_ref_repair_taskcard_popout_gkeep_again.md`
// phase `popout-mark-gates` (bob-cli-9q).
//
// The progress-mark, unblocked-glyph, and Tasks date-mark gates in
// `styles.css` key visibility on `body:not(.bob-...)` classes. The
// setup/toggle methods used to add those classes only to the main
// window's `document.body`, so every gate matched (and hid the marks)
// in Obsidian popout windows, which own a separate `<body>`. This
// mixin mirrors each gate class onto every known document body: the
// main document, each markdown leaf's container document (popout
// leaves render into the popout document, mirroring
// `todayMarksReadingDocuments` in `276-plugin-today-marks-reading.js`),
// and every popout document seen on `workspace` `window-open` (so a
// toggle also reaches popouts with no markdown leaf yet). Callers
// re-apply on setup and on every toggle, and mirror each new popout
// on `window-open`. Every method is synchronous and never throws.
class BobLedgerToolsMarkGateMixin {
  markGateLeafContainer(leaf) {
    try {
      return (
        (leaf && leaf.containerEl) ||
        (leaf && leaf.view && leaf.view.containerEl) ||
        null
      );
    } catch (error) {
      return null;
    }
  }

  markGateSeenDocs() {
    try {
      if (!(this.markGatePopoutDocs instanceof Set)) {
        try {
          this.markGatePopoutDocs = new Set();
        } catch (error) {
          this.markGatePopoutDocs = null;
        }
      }
      return this.markGatePopoutDocs;
    } catch (error) {
      return null;
    }
  }

  markGateDocuments() {
    const docs = [];
    let seen = null;
    try {
      seen = new Set();
    } catch (error) {
      seen = null;
    }
    const add = (doc) => {
      try {
        if (!doc) {
          return;
        }
        if (seen) {
          if (seen.has(doc)) {
            return;
          }
          seen.add(doc);
        } else if (docs.indexOf(doc) !== -1) {
          return;
        }
        docs.push(doc);
      } catch (error) {
        // Document collection is best-effort.
      }
    };
    try {
      if (typeof document !== "undefined") {
        add(document);
      }
    } catch (error) {
      // The main document is optional on test hosts.
    }
    try {
      const tracked = this.markGateSeenDocs();
      if (tracked && typeof tracked.forEach === "function") {
        tracked.forEach((doc) => add(doc));
      }
    } catch (error) {
      // Tracked popouts are best-effort.
    }
    try {
      const workspace = this.app && this.app.workspace;
      const leaves =
        workspace && typeof workspace.getLeavesOfType === "function"
          ? workspace.getLeavesOfType("markdown") || []
          : [];
      for (const leaf of leaves) {
        try {
          const container = this.markGateLeafContainer(leaf);
          if (container && container.ownerDocument) {
            add(container.ownerDocument);
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Popout documents are best-effort.
    }
    return docs;
  }

  applyMarkGateClass(className, enabled) {
    try {
      if (!className) {
        return;
      }
      const on = Boolean(enabled);
      for (const doc of this.markGateDocuments()) {
        try {
          const body = doc && doc.body;
          const list = body && body.classList;
          if (!list) {
            continue;
          }
          if (on) {
            if (typeof list.add === "function") {
              list.add(className);
            }
          } else if (typeof list.remove === "function") {
            list.remove(className);
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Body classes are best-effort.
    }
  }

  markGatePopoutDocument(win, openedWindow) {
    try {
      const candidates = [
        openedWindow && openedWindow.document,
        win && win.document,
        win && win.doc,
      ];
      for (const doc of candidates) {
        if (doc) {
          return doc;
        }
      }
    } catch (error) {
      // Popout resolution is best-effort.
    }
    return null;
  }

  applyMarkGateClassToPopout(className, enabled, win, openedWindow) {
    try {
      if (!className) {
        return;
      }
      const doc = this.markGatePopoutDocument(win, openedWindow);
      if (!doc) {
        return;
      }
      try {
        const tracked = this.markGateSeenDocs();
        if (tracked && typeof tracked.add === "function") {
          tracked.add(doc);
        }
      } catch (error) {
        // Tracking is best-effort.
      }
      const body = doc.body;
      const list = body && body.classList;
      if (!list) {
        return;
      }
      if (enabled) {
        if (typeof list.add === "function") {
          list.add(className);
        }
      } else if (typeof list.remove === "function") {
        list.remove(className);
      }
    } catch (error) {
      // Popout mirroring is best-effort.
    }
  }

  registerMarkGatePopoutSync(className, isEnabled) {
    try {
      if (!className || typeof isEnabled !== "function") {
        return;
      }
      const workspace = this.app && this.app.workspace;
      if (
        !workspace ||
        typeof workspace.on !== "function" ||
        typeof this.registerEvent !== "function"
      ) {
        return;
      }
      const plugin = this;
      this.registerEvent(
        workspace.on("window-open", (win, openedWindow) => {
          try {
            plugin.applyMarkGateClassToPopout(
              className,
              isEnabled(),
              win,
              openedWindow,
            );
          } catch (error) {
            // New popouts start unmirrored; the next toggle syncs them.
          }
        }),
      );
    } catch (error) {
      // Popout mirroring is best-effort.
    }
  }
}
