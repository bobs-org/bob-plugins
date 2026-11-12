// Additive nav `api.walkMode` v1: the persisted bracket-walk family plus a
// workspace doorbell. `current()` returns the persisted family ("s", "w",
// "n", or null for unset) via `readBracketRepeatType()`; invalid stored
// values normalize to null and it never throws. `select(type)` behaves
// exactly like a selector letter click: it refuses anything but s/w/n with
// `{ok: false, reason: "invalid-type"}`, otherwise records via
// `rememberBracketRepeatType` (refreshing the indicator, never walking) and
// never throws. Ledger feature-detects `api.walkMode?.version >= 1`.
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
    version: 1,
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
  });
}
