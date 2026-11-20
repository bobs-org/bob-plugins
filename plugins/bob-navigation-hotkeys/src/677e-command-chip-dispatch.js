// ⌘↵ command-chip step. bob-chips owns the target rule (its
// `api.commandChips.targetAt` / `runAtCursor`); this dispatcher only asks it
// first and stops when it handled the key. Without bob-chips, or with an
// older one, every call falls through to the Highlights → Gmail → new-tab
// chain unchanged. The capability flag `commandChipDispatch` (set in
// onload) tells bob-chips that this dispatcher really runs chips, so its
// keycap never advertises a key that would do something else.
const COMMAND_CHIPS_PLUGIN_ID = "bob-chips";

function commandChipDispatchInput(context) {
  return Object.freeze({
    editor: (context && context.editor) || null,
    file: (context && context.file) || null,
  });
}

class BobNavigationHotkeysCommandChipDispatchMixin {
  commandChipsApi() {
    try {
      const holder = this.app && this.app.plugins && this.app.plugins.plugins;
      const chips = holder && holder[COMMAND_CHIPS_PLUGIN_ID];
      const api = chips && chips.api && chips.api.commandChips;
      if (!api || !(Number(api.version) >= 1)) return null;
      return api;
    } catch (_error) {
      return null;
    }
  }

  // True when the command-chip rule claims the cursor (ready, ambiguous, or
  // blocked): the Highlights hint and rail yield so one ⌘↵ cue shows.
  commandChipClaimsCursor(context) {
    try {
      if (!context || !context.editor) return false;
      const api = this.commandChipsApi();
      if (!api || typeof api.targetAt !== "function") return false;
      const target = api.targetAt(commandChipDispatchInput(context));
      return Boolean(target && target.state && target.state !== "none");
    } catch (_error) {
      return false;
    }
  }

  // The dispatcher's first step. Resolves true when bob-chips handled the
  // key (it ran, opened, or refused a chip), so the chain must stop.
  async runCommandChipAtCursor(context) {
    try {
      if (!context || !context.editor) return false;
      const api = this.commandChipsApi();
      if (!api || typeof api.runAtCursor !== "function") return false;
      const result = await api.runAtCursor(commandChipDispatchInput(context));
      return Boolean(result && result.handled === true);
    } catch (_error) {
      return false;
    }
  }
}
