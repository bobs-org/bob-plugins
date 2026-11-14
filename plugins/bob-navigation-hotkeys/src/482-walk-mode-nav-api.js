// Additive nav `api.walkMode` v4: the persisted bracket-walk family plus a
// workspace doorbell. `current()` returns the persisted family ("s", "w",
// "n", or null for unset) via `readBracketRepeatType()`; invalid stored
// values normalize to null and it never throws. `select(type)` behaves
// exactly like a selector letter click: it refuses anything but s/w/n/b with
// `{ok: false, reason: "invalid-type"}`, otherwise records via
// `rememberBracketRepeatType` (refreshing the indicator, never walking) and
// never throws. `links({path, content})` v2 previews the first prev/next
// body links with the exact matcher behind `[n`/`]n`; it is read-only and
// reports resolved or creation-eligible paths without opening or creating.
// v3 adds display-only review attention for the selector's `s` letter. v4
// keeps attention per family so the bank's waiting dot can coexist with it.
// Ledger feature-detects each member version.
// The doorbell fires from `rememberBracketRepeatType` only on an actual
// change and once at plugin setup after the stored value is first read. It
// carries no authoritative payload: receivers re-read `current()`. A missing
// workspace trigger or a throwing listener never breaks the walk.
const WALK_MODE_DOORBELL_EVENT = "bob-navigation-hotkeys:walk-mode";

function fireWalkModeDoorbell(plugin) {
  try {
    const workspace = plugin && plugin.app ? plugin.app.workspace : null;
    if (!workspace || typeof workspace.trigger !== "function") {
      return;
    }
    workspace.trigger(WALK_MODE_DOORBELL_EVENT);
  } catch (error) {
    // The doorbell never breaks the walk or a selection.
  }
}

function createWalkModeApi(plugin) {
  return Object.freeze({
    version: 4,
    current() {
      try {
        if (!plugin || typeof plugin.readBracketRepeatType !== "function") {
          return null;
        }
        return plugin.readBracketRepeatType();
      } catch (error) {
        return null;
      }
    },
    select(type) {
      try {
        let normalized = null;
        try {
          normalized =
            typeof normalizeBracketRepeatType === "function"
              ? normalizeBracketRepeatType(type)
              : null;
        } catch (error) {
          normalized = null;
        }
        if (normalized === null) {
          return Object.freeze({ ok: false, reason: "invalid-type" });
        }
        if (
          !plugin ||
          typeof plugin.rememberBracketRepeatType !== "function"
        ) {
          return Object.freeze({ ok: false, reason: "unavailable" });
        }
        plugin.rememberBracketRepeatType(normalized);
        return Object.freeze({ ok: true });
      } catch (error) {
        return Object.freeze({ ok: false, reason: "api-failed" });
      }
    },
    setAttention(type, value) {
      try {
        if (type !== "s" && type !== "b") {
          return Object.freeze({ ok: false, reason: "invalid-type" });
        }
        let attention = null;
        if (value !== null && value !== undefined) {
          if (!value || typeof value !== "object") {
            return Object.freeze({ ok: false, reason: "invalid-value" });
          }
          const tier = typeof value.tier === "string" ? value.tier.trim().toLowerCase() : "";
          const label = typeof value.label === "string" ? value.label.trim() : "";
          if (!tier || !label) {
            return Object.freeze({ ok: false, reason: "invalid-value" });
          }
          attention = Object.freeze({ tier, label });
        }
        if (!plugin) {
          return Object.freeze({ ok: false, reason: "unavailable" });
        }
        const current =
          plugin.bracketModeAttention &&
          typeof plugin.bracketModeAttention === "object"
            ? plugin.bracketModeAttention
            : {};
        const next = { ...current };
        if (attention === null) {
          delete next[type];
        } else {
          next[type] = attention;
        }
        plugin.bracketModeAttention = Object.freeze(next);
        try {
          if (typeof plugin.refreshBracketModeIndicator === "function") {
            plugin.refreshBracketModeIndicator();
          }
        } catch (_error) {
          // Attention is display-only and never blocks selection or walking.
        }
        return Object.freeze({ ok: true });
      } catch (_error) {
        return Object.freeze({ ok: false, reason: "api-failed" });
      }
    },
    links(input = {}) {
      try {
        const path =
          input && typeof input.path === "string" ? input.path.trim() : "";
        const content = input && typeof input.content === "string"
          ? input.content
          : null;
        if (!path || content === null) {
          return Object.freeze({ ok: false, reason: "invalid-input" });
        }
        if (
          !plugin ||
          !plugin.app ||
          !plugin.app.vault ||
          typeof plugin.app.vault.getAbstractFileByPath !== "function" ||
          typeof plugin.isMarkdownFile !== "function" ||
          typeof plugin.findFirstRenderedLink !== "function" ||
          typeof plugin.toLineLinkCandidate !== "function"
        ) {
          return Object.freeze({ ok: false, reason: "unavailable" });
        }
        const sourceFile = plugin.app.vault.getAbstractFileByPath(path);
        if (!plugin.isMarkdownFile(sourceFile)) {
          return Object.freeze({ ok: false, reason: "invalid-source" });
        }
        const resolve = (label) => {
          const link = plugin.findFirstRenderedLink(content, label);
          if (!link) {
            return null;
          }
          let candidate = null;
          try {
            candidate = plugin.toLineLinkCandidate(
              {
                target: link.target,
                renderedText: link.renderedText,
              },
              path,
              0,
            );
          } catch (error) {
            candidate = null;
          }
          return Object.freeze({
            text: String(link.renderedText || ""),
            target: String(link.target || ""),
            path:
              candidate && typeof candidate.path === "string"
                ? candidate.path
                : null,
            exists: Boolean(
              candidate &&
              candidate.actionKind === "open" &&
              candidate.resolvedFile,
            ),
          });
        };
        return Object.freeze({
          ok: true,
          prev: resolve("prev"),
          next: resolve("next"),
        });
      } catch (error) {
        return Object.freeze({ ok: false, reason: "api-failed" });
      }
    },
  });
}
