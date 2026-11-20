class BobCopyChipsPlugin extends CopyChipsPluginBase {
  async onload() {
    try {
      const app = this.app;
      if (
        app &&
        app.workspace &&
        typeof app.workspace.onLayoutReady === "function"
      ) {
        app.workspace.onLayoutReady(async () => {
          try {
            const plugins = app.plugins && app.plugins.plugins;
            if (
              !plugins ||
              !plugins["bob-copy-chips"] ||
              typeof app.plugins.disablePlugin !== "function"
            ) {
              return;
            }
            await app.plugins.disablePlugin("bob-copy-chips");
            if (typeof console !== "undefined" && typeof console.info === "function") {
              console.info("Bob Chips disabled the legacy bob-copy-chips plugin");
            }
          } catch (error) {
            if (typeof console !== "undefined" && typeof console.warn === "function") {
              console.warn("Bob Chips could not disable the legacy bob-copy-chips plugin", error);
            }
          }
        });
      }
    } catch (error) {
      // The transition guard must never interfere with copy chips.
    }
    try {
      if (!(this.copyChipEditorViews instanceof Set)) {
        this.copyChipEditorViews = new Set();
      }
    } catch (error) {
      // View tracking is best-effort.
    }
    try {
      this.copyChipsBuildApi();
    } catch (error) {
      try {
        this.copyChipsBuildApi();
      } catch (apiError) {
        this.api = copyChipFreeze({
          copyChips: copyChipFreeze({
            version: 2,
            parse: () => null,
            scanLine: () => copyChipFreeze([]),
            serialize: () => copyChipFreeze({ ok: false, reason: "unavailable" }),
            parseFenceInfo: () => null,
            fencePayload: () => "",
            fencePayloadFromSource: () => "",
            chipAt: () => copyChipFreeze({ state: "none", count: 0 }),
            copy: async () => copyChipFreeze({ ok: false, reason: "unavailable" }),
            copyChip: async () => copyChipFreeze({ ok: false, reason: "unavailable" }),
            flash: () => false,
          }),
        });
      }
      if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn("Bob Chips could not initialize its API", error);
      }
    }
    try {
      const liveExtension =
        typeof copyChipCreateLiveExtension === "function"
          ? copyChipCreateLiveExtension(this)
          : null;
      if (liveExtension && typeof this.registerEditorExtension === "function") {
        this.registerEditorExtension(liveExtension);
      }
    } catch (error) {
      // Live Preview is best-effort and never breaks startup.
    }
    try {
      const flashField =
        typeof copyChipCreateSourceFlashField === "function"
          ? copyChipCreateSourceFlashField()
          : null;
      if (flashField && typeof this.registerEditorExtension === "function") {
        this.registerEditorExtension(flashField);
      }
    } catch (error) {
      // Source flashes are best-effort.
    }
    try {
      if (typeof copyChipSetupReading === "function") {
        copyChipSetupReading(this);
      }
    } catch (error) {
      // Reading view is best-effort.
    }
    try {
      if (typeof copyChipSetupFence === "function") {
        copyChipSetupFence(this);
      }
    } catch (error) {
      // Fence cards are best-effort and never break startup.
    }
    try {
      if (typeof copyChipRegisterCursorCommand === "function") {
        copyChipRegisterCursorCommand(this);
      }
    } catch (error) {
      // Command registration is best-effort.
    }
    try {
      if (typeof copyChipRegisterAuthorCommand === "function") {
        copyChipRegisterAuthorCommand(this);
      }
    } catch (error) {
      // Author command registration is best-effort.
    }
    try {
      if (typeof this.register === "function") {
        this.register(() => {
          try {
            if (this.copyChipEditorViews instanceof Set) {
              this.copyChipEditorViews.clear();
            }
          } catch (error) {
            // View cleanup is best-effort.
          }
          this.copyChipReadingSetupDone = false;
          this.copyChipFenceSetupDone = false;
          this.copyChipCursorCommandRegistered = false;
          this.copyChipAuthorCommandRegistered = false;
          try {
            if (this.copyChipAuthorModal && typeof this.copyChipAuthorModal.copyChipCancel === "function") {
              this.copyChipAuthorModal.copyChipCancel();
            }
          } catch (error) {
            // Author modal cleanup is best-effort.
          }
          this.copyChipAuthorModal = null;
        });
      }
    } catch (error) {
      // Unload cleanup is best-effort.
    }
  }

  onunload() {
    try {
      if (this.copyChipEditorViews instanceof Set) {
        this.copyChipEditorViews.clear();
      }
    } catch (error) {
      // Unload cleanup is best-effort.
    }
    this.copyChipReadingSetupDone = false;
    this.copyChipFenceSetupDone = false;
    this.copyChipCursorCommandRegistered = false;
    this.copyChipAuthorCommandRegistered = false;
    try {
      if (this.copyChipAuthorModal && typeof this.copyChipAuthorModal.copyChipCancel === "function") {
        this.copyChipAuthorModal.copyChipCancel();
      }
    } catch (error) {
      // Author modal cleanup is best-effort.
    }
    this.copyChipAuthorModal = null;
  }

  copyChipsBuildApi() {
    const copyChips = copyChipFreeze({
      version: 2,
      parse(content) {
        try {
          return copyChipParseContent(content);
        } catch (error) {
          return null;
        }
      },
      scanLine(line, options) {
        try {
          return copyChipScanLine(line, options);
        } catch (error) {
          return copyChipFreeze([]);
        }
      },
      serialize(input, options) {
        try {
          return copyChipSerialize(input, options);
        } catch (error) {
          return copyChipFreeze({ ok: false, reason: "serialize failed" });
        }
      },
      parseFenceInfo(info) {
        try {
          return copyChipParseFenceInfo(info);
        } catch (error) {
          return null;
        }
      },
      fencePayload(bodyLines) {
        try {
          return copyChipFencePayload(bodyLines);
        } catch (error) {
          return "";
        }
      },
      fencePayloadFromSource(source) {
        try {
          if (typeof copyChipFencePayloadFromSource === "function") {
            return copyChipFencePayloadFromSource(source);
          }
          return typeof source === "string" ? source : "";
        } catch (error) {
          return "";
        }
      },
      chipAt(request) {
        try {
          if (typeof copyChipAt === "function") return copyChipAt(request);
          return copyChipFreeze({ state: "none", count: 0 });
        } catch (error) {
          return copyChipFreeze({ state: "none", count: 0 });
        }
      },
      async copy(text) {
        try {
          if (typeof copyChipCopyText === "function") return await copyChipCopyText(text);
          return copyChipFreeze({ ok: false, reason: "unavailable" });
        } catch (error) {
          return copyChipFreeze({ ok: false, reason: "copy failed" });
        }
      },
      async copyChip(chip, options) {
        try {
          if (typeof copyChipCopyChip === "function") return await copyChipCopyChip(chip, options);
          return copyChipFreeze({ ok: false, reason: "unavailable" });
        } catch (error) {
          return copyChipFreeze({ ok: false, reason: "copy failed" });
        }
      },
      flash(chip, options) {
        try {
          if (typeof copyChipFlashChip === "function") return copyChipFlashChip(chip, options);
          return false;
        } catch (error) {
          return false;
        }
      },
    });
    this.api = copyChipFreeze({ copyChips });
  }
}
