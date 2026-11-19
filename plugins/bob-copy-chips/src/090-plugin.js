class BobCopyChipsPlugin extends CopyChipsPluginBase {
  async onload() {
    try {
      this.copyChipsBuildApi();
    } catch (error) {
      try {
        this.copyChipsBuildApi();
      } catch (apiError) {
        this.api = copyChipFreeze({
          copyChips: copyChipFreeze({
            version: 1,
            parse: () => null,
            scanLine: () => copyChipFreeze([]),
            serialize: () => copyChipFreeze({ ok: false, reason: "unavailable" }),
            parseFenceInfo: () => null,
            fencePayload: () => "",
          }),
        });
      }
      if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn("Bob Copy Chips could not initialize its API", error);
      }
    }
  }

  copyChipsBuildApi() {
    const copyChips = copyChipFreeze({
      version: 1,
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
    });
    this.api = copyChipFreeze({ copyChips });
  }
}
