class BobLedgerToolsFreshnessMarkModelMixin {
  setupFreshnessMarks() {
    try {
      if (typeof this.freshnessMarksEnabled !== "boolean") {
        this.freshnessMarksEnabled = true;
      }
      try {
        if (
          typeof document !== "undefined" &&
          document &&
          document.body &&
          document.body.classList &&
          typeof document.body.classList.add === "function"
        ) {
          if (this.freshnessMarksEnabled) {
            document.body.classList.add("bob-fresh-marks");
          } else {
            document.body.classList.remove("bob-fresh-marks");
          }
        }
      } catch (error) {
        // Body class is best-effort.
      }
      try {
        if (typeof this.addCommand === "function") {
          this.addCommand({
            id: "toggle-freshness-marks",
            name: "Toggle task freshness marks",
            callback: () => this.toggleFreshnessMarks(),
          });
        }
      } catch (error) {
        // The toggle is best-effort.
      }
      try {
        const extension = this.createFreshnessMarkExtension();
        if (
          extension &&
          typeof this.registerEditorExtension === "function"
        ) {
          this.registerEditorExtension(extension);
        }
      } catch (error) {
        // Live Preview marks are best-effort.
      }
      try {
        if (typeof this.registerMarkdownPostProcessor === "function") {
          this.registerMarkdownPostProcessor(
            (el, ctx) => this.renderFreshnessMarksIn(el, ctx),
            50,
          );
        }
      } catch (error) {
        // Rendered-view marks are best-effort.
      }
    } catch (error) {
      // Marks setup never throws.
    }
  }

  freshnessMarksAvailable() {
    try {
      return Boolean(
        ViewPlugin &&
          Decoration &&
          WidgetType &&
          StateEffect &&
          RangeSetBuilder &&
          editorInfoField &&
          editorLivePreviewField &&
          FreshnessMarkWidget &&
          freshnessMarksRefresh,
      );
    } catch (error) {
      return false;
    }
  }

  createFreshnessMarkExtension() {
    try {
      if (!this.freshnessMarksAvailable()) {
        return null;
      }
      if (
        !ViewPlugin ||
        typeof ViewPlugin.fromClass !== "function" ||
        typeof Prec.highest !== "function"
      ) {
        return null;
      }
      const plugin = this;
      const MarkPluginClass = class {
        constructor(view) {
          try {
            this.decorations = plugin.buildFreshnessMarkDecorations(view);
          } catch (error) {
            try {
              this.decorations = Decoration.none;
            } catch (inner) {
              this.decorations = null;
            }
          }
        }

        update(u) {
          try {
            if (plugin.freshnessMarkShouldRebuild(u)) {
              this.decorations =
                plugin.buildFreshnessMarkDecorations(u.view);
            }
          } catch (error) {
            // Keep previous decorations on failure.
          }
        }
      };
      return Prec.highest(
        ViewPlugin.fromClass(MarkPluginClass, {
          decorations: (value) => value.decorations,
        }),
      );
    } catch (error) {
      return null;
    }
  }

  rebuildFreshnessMarkSnapshot() {
    try {
      const memo = this.freshnessEnsureMemo();
      this.freshnessMarkSnapshot = {
        dateText: memo.dateText,
        config: memo.config,
        memo,
        index: null,
      };
    } catch (error) {
      // The snapshot rebuilds on next access.
    }
  }

  freshnessMarkEnsureSnapshot() {
    try {
      const current = this.freshnessMarkSnapshot;
      if (
        current &&
        current.memo &&
        typeof current.dateText === "string" &&
        current.config
      ) {
        return current;
      }
      const memo = this.freshnessEnsureMemo();
      this.freshnessMarkSnapshot = {
        dateText: memo.dateText,
        config: memo.config,
        memo,
        index: null,
      };
      return this.freshnessMarkSnapshot;
    } catch (error) {
      return null;
    }
  }

  freshnessMarkSnapshotIndex(snapshot) {
    try {
      if (!snapshot || !snapshot.memo) {
        return null;
      }
      if (
        snapshot.index &&
        snapshot.index.byLine instanceof Map &&
        snapshot.index.byPath instanceof Map
      ) {
        return snapshot.index;
      }
      const byLine = new Map();
      const byPath = new Map();
      const rows = (snapshot.memo && snapshot.memo.rows) || [];
      for (const row of rows) {
        try {
          if (!row || typeof row !== "object") {
            continue;
          }
          const path = String(row.path || "");
          const lineNumber = row.lineNumber;
          if (!Number.isInteger(lineNumber)) {
            continue;
          }
          const key = path + "\u0000" + String(lineNumber);
          if (!byLine.has(key)) {
            byLine.set(key, row);
          }
          let list = byPath.get(path);
          if (!list) {
            list = [];
            byPath.set(path, list);
          }
          list.push(row);
        } catch (error) {
          continue;
        }
      }
      snapshot.index = { byLine, byPath };
      return snapshot.index;
    } catch (error) {
      return null;
    }
  }

  freshnessMarkUnresolvedInterval(snapshot, path, source, status) {
    try {
      const taskDays =
        source &&
        source.refresh !== null &&
        source.refresh !== undefined
          ? source.refresh
          : null;
      let noteDays = null;
      try {
        const raw = this.noteFreshnessRawFor(path);
        const parsed = freshnessParseNoteRefresh(raw);
        noteDays =
          parsed && parsed.days !== null && parsed.days !== undefined
            ? parsed.days
            : null;
      } catch (error) {
        noteDays = null;
      }
      const config =
        snapshot && snapshot.config
          ? snapshot.config
          : { interval: 7 };
      const symbol =
        typeof status === "string" && status !== ""
          ? String(status)[0]
          : null;
      const lane =
        symbol === "/" ? "pending" : symbol === "*" ? "next" : null;
      return freshnessIntervalFor(taskDays, noteDays, config, lane);
    } catch (error) {
      return { days: 7, source: "default" };
    }
  }

  freshnessMarkModelForLine(args) {
    try {
      const input = args && typeof args === "object" ? args : null;
      if (!input || !input.source) {
        return null;
      }
      const source = input.source;
      const text = typeof input.text === "string" ? input.text : "";
      const path = typeof input.path === "string" ? input.path : "";
      const lineNumber = input.lineNumber;
      const snapshot = this.freshnessMarkEnsureSnapshot();
      if (!snapshot) {
        return freshnessMarkModel({
          source,
          today: freshnessTodayFallback(),
          interval: { days: 7, source: "default" },
          status: freshnessTaskStatus(text),
          resolution: null,
        });
      }
      const dateText = snapshot.dateText;
      const config = snapshot.config;
      const status = freshnessTaskStatus(text);
      try {
        const index = this.freshnessMarkSnapshotIndex(snapshot);
        if (index && Number.isInteger(lineNumber)) {
          const row = index.byLine.get(path + "\u0000" + String(lineNumber));
          if (row && row.rawLine === text) {
            const resolution = freshnessMarkResolution(row, dateText, config, {
              cardCapable: freshnessDecayCardCapable(this.app),
            });
            if (resolution) {
              const model = freshnessMarkModel({
                source,
                today: dateText,
                interval: this.freshnessMarkUnresolvedInterval(
                  snapshot,
                  path,
                  source,
                  status,
                ),
                status,
                resolution,
              });
              if (model) {
                return model;
              }
            }
          }
        }
      } catch (error) {
        // Fall through to consensus.
      }
      try {
        const index = this.freshnessMarkSnapshotIndex(snapshot);
        const candidates =
          index && index.byPath ? index.byPath.get(path) || [] : [];
        const models = [];
        let hasCandidates = false;
        for (const row of candidates) {
          try {
            if (!row || typeof row !== "object") {
              continue;
            }
            const candidateSource = freshnessMarkSource(
              row.rawLine || "",
              dateText,
            );
            if (!candidateSource || candidateSource.text !== source.text) {
              continue;
            }
            hasCandidates = true;
            const resolution = freshnessMarkResolution(row, dateText, config, {
              cardCapable: freshnessDecayCardCapable(this.app),
            });
            const model = freshnessMarkModel({
              source,
              today: dateText,
              interval: this.freshnessMarkUnresolvedInterval(
                snapshot,
                path,
                source,
                status,
              ),
              status,
              resolution,
            });
            models.push(model);
          } catch (error) {
            continue;
          }
        }
        if (hasCandidates) {
          const consensus = freshnessMarkConsensus(models);
          if (consensus) {
            return consensus;
          }
        }
      } catch (error) {
        // Fall through to unresolved.
      }
      return freshnessMarkModel({
        source,
        today: dateText,
        interval: this.freshnessMarkUnresolvedInterval(
          snapshot,
          path,
          source,
          status,
        ),
        status,
        resolution: null,
      });
    } catch (error) {
      try {
        const input = args && typeof args === "object" ? args : null;
        if (!input || !input.source) {
          return null;
        }
        return freshnessMarkModel({
          source: input.source,
          today: freshnessTodayFallback(),
          interval: { days: 7, source: "default" },
          status: null,
          resolution: null,
        });
      } catch (inner) {
        return null;
      }
    }
  }

  freshnessMarkModelForText(args) {
    try {
      const input = args && typeof args === "object" ? args : null;
      if (!input || !input.source) {
        return null;
      }
      const source = input.source;
      const path =
        typeof input.path === "string"
          ? input.path
          : input.path === null || input.path === undefined
            ? ""
            : String(input.path);
      const snapshot = this.freshnessMarkEnsureSnapshot();
      if (!snapshot) {
        return freshnessMarkModel({
          source,
          today: freshnessTodayFallback(),
          interval: { days: 7, source: "default" },
          status: null,
          resolution: null,
        });
      }
      const dateText = snapshot.dateText;
      const config = snapshot.config;
      try {
        const index = this.freshnessMarkSnapshotIndex(snapshot);
        const candidates =
          index && index.byPath ? index.byPath.get(path) || [] : [];
        const models = [];
        let hasCandidates = false;
        for (const row of candidates) {
          try {
            if (!row || typeof row !== "object") {
              continue;
            }
            const candidateSource = freshnessMarkSource(
              row.rawLine || "",
              dateText,
            );
            if (!candidateSource || candidateSource.text !== source.text) {
              continue;
            }
            hasCandidates = true;
            const resolution = freshnessMarkResolution(row, dateText, config, {
              cardCapable: freshnessDecayCardCapable(this.app),
            });
            const status =
              resolution &&
              resolution.status !== undefined &&
              resolution.status !== null
                ? resolution.status
                : null;
            const model = freshnessMarkModel({
              source,
              today: dateText,
              interval: this.freshnessMarkUnresolvedInterval(
                snapshot,
                path,
                source,
                status,
              ),
              status,
              resolution,
            });
            models.push(model);
          } catch (error) {
            continue;
          }
        }
        if (hasCandidates) {
          const consensus = freshnessMarkConsensus(models);
          if (consensus) {
            return consensus;
          }
        }
      } catch (error) {
        // Fall through to unresolved.
      }
      return freshnessMarkModel({
        source,
        today: dateText,
        interval: this.freshnessMarkUnresolvedInterval(
          snapshot,
          path,
          source,
          null,
        ),
        status: null,
        resolution: null,
      });
    } catch (error) {
      try {
        const input = args && typeof args === "object" ? args : null;
        if (!input || !input.source) {
          return null;
        }
        return freshnessMarkModel({
          source: input.source,
          today: freshnessTodayFallback(),
          interval: { days: 7, source: "default" },
          status: null,
          resolution: null,
        });
      } catch (inner) {
        return null;
      }
    }
  }

}
