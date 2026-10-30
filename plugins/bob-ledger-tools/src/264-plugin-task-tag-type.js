// --- Task tag type identity: catalog, cache, inherited toggle --------------
// `BobLedgerToolsTaskTagTypeMixin`, installed after the task-tag-marks
// mixin. Resolves explicit and inherited `#TYPE` identity from the
// cached theme catalog and `effectiveTypeFor` cascade. Never spawns
// bob per row. Stale cache yields a generic glyph (null identity).
class BobLedgerToolsTaskTagTypeMixin {
  taskTagClearIdentityCache() {
    try {
      if (this.taskTagIdentityCache && typeof this.taskTagIdentityCache.clear === "function") {
        this.taskTagIdentityCache.clear();
      }
    } catch (error) {
      this.taskTagIdentityCache = null;
    }
  }

  taskTagWireIdentityRefresh() {
    try {
      if (this.taskTagIdentityRefreshWired) {
        return true;
      }
      this.taskTagIdentityRefreshWired = true;
      try {
        if (typeof this.onThemesChange === "function") {
          this.onThemesChange(() => {
            this.taskTagClearIdentityCache();
            try {
              this.refreshTaskTagMarkEditors();
            } catch (error) {
              // Editor refresh is best-effort.
            }
            try {
              if (this.taskTagMarksEnabled) {
                this.annotateTaskTagMarksInDocument();
              }
            } catch (error) {
              // Document re-annotation is best-effort.
            }
            try {
              this.refreshLedgerTypeMarkEditors();
            } catch (error) {
              // Ledger marks are best-effort.
            }
          });
        }
      } catch (error) {
        // Theme catalog refresh is best-effort.
      }
      const metadataCache = this.app && this.app.metadataCache;
      if (
        metadataCache &&
        typeof metadataCache.on === "function" &&
        typeof this.registerEvent === "function"
      ) {
        try {
          this.registerEvent(
            metadataCache.on("changed", () => {
              this.taskTagClearIdentityCache();
              try {
                this.refreshTaskTagMarkEditors();
              } catch (error) {
                // Editor refresh is best-effort.
              }
              try {
                this.refreshLedgerTypeMarkEditors();
              } catch (error) {
                // Ledger marks are best-effort.
              }
            }),
          );
        } catch (error) {
          // Metadata refresh is best-effort.
        }
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  taskTagSuggestForLine(lineText, filePath) {
    try {
      if (typeof pomodoroThemeSuggestWithDiagnostics !== "function") {
        return null;
      }
      const caps = loadPlanCaps().caps;
      const dailyPath =
        typeof this.pomodoroThemeTodayPath === "function"
          ? this.pomodoroThemeTodayPath()
          : null;
      let catalog = null;
      try {
        if (typeof this.pomodoroThemeSuggestCatalog === "function") {
          catalog = this.pomodoroThemeSuggestCatalog(
            dailyPath,
            filePath,
            null,
          );
        }
      } catch (error) {
        catalog = null;
      }
      const result = pomodoroThemeSuggestWithDiagnostics({
        path: typeof filePath === "string" ? filePath : "",
        line: String(lineText || ""),
        dailyPath,
        metadataCache: this.app && this.app.metadataCache,
        vault: this.app && this.app.vault,
        catalog,
        config: {
          readingTheme:
            caps && Object.prototype.hasOwnProperty.call(caps, "readingTheme")
              ? caps.readingTheme
              : "READ",
          defaultType:
            caps && Object.prototype.hasOwnProperty.call(caps, "defaultType")
              ? caps.defaultType
              : null,
        },
        themeRef:
          typeof this.pomodoroThemeRef === "function"
            ? (key, name, known) => this.pomodoroThemeRef(key, name, known)
            : undefined,
      });
      return result && result.suggestion ? result.suggestion : null;
    } catch (error) {
      return null;
    }
  }

  taskTagIdentityForLine(lineText, filePath) {
    try {
      const cacheKey = String(filePath || "") + "\0" + String(lineText || "");
      if (
        this.taskTagIdentityCache &&
        typeof this.taskTagIdentityCache.get === "function" &&
        this.taskTagIdentityCache.has(cacheKey)
      ) {
        return this.taskTagIdentityCache.get(cacheKey);
      }
      const field =
        typeof taskTagTypeFieldOf === "function"
          ? taskTagTypeFieldOf(lineText)
          : null;
      let identity = null;
      if (field && field.fieldState === "repair") {
        identity = taskTagIdentityFromField(field, null, {});
      } else if (field && field.fieldState === "set") {
        let hueInfo = null;
        try {
          if (typeof this.pomodoroThemeHueFor === "function") {
            hueInfo = this.pomodoroThemeHueFor(field.key, field.type);
          }
        } catch (error) {
          hueInfo = null;
        }
        let suggestion = null;
        try {
          suggestion = this.taskTagSuggestForLine(lineText, filePath);
        } catch (error) {
          suggestion = null;
        }
        const inherited =
          suggestion && suggestion.inherited && typeof suggestion.inherited === "object"
            ? suggestion.inherited
            : suggestion && suggestion.source !== "task"
              ? suggestion
              : null;
        identity = taskTagIdentityFromField(field, hueInfo, {
          suggest: inherited,
        });
      } else {
        const suggestion = this.taskTagSuggestForLine(lineText, filePath);
        const theme =
          suggestion && suggestion.theme && typeof suggestion.theme === "object"
            ? suggestion.theme
            : null;
        const name = theme && typeof theme.name === "string" ? theme.name : null;
        const key = theme && typeof theme.key === "string" ? theme.key : null;
        if (name) {
          let hueInfo = null;
          try {
            if (typeof this.pomodoroThemeHueFor === "function") {
              hueInfo = this.pomodoroThemeHueFor(key, name);
            }
          } catch (error) {
            hueInfo = null;
          }
          identity = taskTagIdentityFromInherited(name, key, hueInfo, {
            reason: suggestion,
            from:
              suggestion &&
              suggestion.from &&
              typeof suggestion.from.stem === "string"
                ? suggestion.from.stem
                : null,
          });
        }
      }
      try {
        if (
          this.taskTagIdentityCache &&
          typeof this.taskTagIdentityCache.set === "function"
        ) {
          this.taskTagIdentityCache.set(cacheKey, identity);
        }
      } catch (error) {
        // Cache writes are best-effort.
      }
      return identity;
    } catch (error) {
      return null;
    }
  }

  taskTagSyntheticLineFromAnchor(anchor) {
    try {
      let current = anchor;
      let li = null;
      let guard = 0;
      while (current && guard < 100) {
        guard += 1;
        let tag = "";
        try {
          tag = String(current.tagName || current.nodeName || "").toUpperCase();
        } catch (error) {
          tag = "";
        }
        if (tag === "LI") {
          li = current;
          break;
        }
        current = current.parentNode || null;
      }
      if (!li) {
        return "";
      }
      let typeValue = "";
      try {
        const nodes =
          typeof li.querySelectorAll === "function"
            ? li.querySelectorAll("[data-dv-norm-key], [data-dv-key]")
            : [];
        const list = typeof nodes.length === "number" ? nodes : [];
        for (const node of list) {
          try {
            const key = String(
              (typeof node.getAttribute === "function" &&
                (node.getAttribute("data-dv-norm-key") ||
                  node.getAttribute("data-dv-key"))) ||
                "",
            ).toLowerCase();
            if (key !== "type" && key !== "theme") {
              continue;
            }
            const parent = node.parentNode || node;
            const valueNode =
              parent && typeof parent.querySelector === "function"
                ? parent.querySelector(".inline-field-value")
                : null;
            const raw =
              valueNode && typeof valueNode.textContent === "string"
                ? valueNode.textContent
                : typeof node.textContent === "string"
                  ? node.textContent
                  : "";
            if (raw && raw.trim()) {
              typeValue = raw.trim();
              break;
            }
          } catch (error) {
            continue;
          }
        }
      } catch (error) {
        typeValue = "";
      }
      if (typeValue) {
        return "- [ ] #task [type:: " + typeValue + "]";
      }
      const text =
        typeof li.textContent === "string" ? li.textContent : "";
      return text ? "- [ ] " + text : "";
    } catch (error) {
      return "";
    }
  }

  taskTagIdentityForRenderedAnchor(anchor, ctx) {
    try {
      let lineText = "";
      const path =
        ctx && typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      try {
        const host =
          anchor && typeof anchor.closest === "function"
            ? anchor.closest("li") || anchor
            : anchor;
        const info =
          ctx && typeof ctx.getSectionInfo === "function"
            ? ctx.getSectionInfo(host)
            : null;
        if (info && typeof info.text === "string" && info.text) {
          lineText = info.text;
        }
      } catch (error) {
        lineText = "";
      }
      if (!lineText) {
        lineText = this.taskTagSyntheticLineFromAnchor(anchor);
      }
      return this.taskTagIdentityForLine(lineText, path);
    } catch (error) {
      return null;
    }
  }

  toggleInheritedTaskTypes() {
    try {
      this.inheritedTaskTypesEnabled = !this.inheritedTaskTypesEnabled;
      const enabled = this.inheritedTaskTypesEnabled === true;
      this.taskTagClearIdentityCache();
      try {
        if (this.taskTagMarksEnabled) {
          this.annotateTaskTagMarksInDocument();
        }
      } catch (error) {
        // Document re-annotation is best-effort.
      }
      try {
        this.refreshTaskTagMarkEditors();
      } catch (error) {
        // Editor refresh is best-effort.
      }
      try {
        new Notice(
          enabled ? "Inherited task types on" : "Inherited task types off",
        );
      } catch (error) {
        // Notice is best-effort.
      }
      return enabled;
    } catch (error) {
      return this.inheritedTaskTypesEnabled;
    }
  }
}
