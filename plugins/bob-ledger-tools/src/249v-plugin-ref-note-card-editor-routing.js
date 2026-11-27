// Ref Card editor routing (bob-cli-qp ref-editor): `=` opens the shared
// Property Editor on bob's REFERENCE contract when the note carries
// `props_ref_contract_v1`, else qm.1 focus-or-add on `title`. Owned rows
// route reading state, residence, and file name to their owners.
const REF_NOTE_CARD_EDITOR_KIND = "ref";

function refNoteCardEditorRoute(capabilities) {
  try {
    const list = Array.isArray(capabilities) ? capabilities : [];
    if (list.includes("props_ref_contract_v1")) return "settings";
    return "title-fallback";
  } catch (_) {
    return "title-fallback";
  }
}

// The `=` capability gate reads only the per-bob-path cache: confirmed
// opens the settings mode, while unknown, absent, and unconfirmed all fall
// back to title focus-or-add. Painting never probes; the lifecycle catalog
// and show probes in 298v settle the slot.
function refNoteCardEditorCapabilityConfirmed(plugin) {
  try {
    if (plugin && typeof plugin.propertyCapabilityRefContractConfirmed === "function") {
      return plugin.propertyCapabilityRefContractConfirmed() === true;
    }
  } catch (_) {}
  return false;
}

// The single `=` open path for ref notes (wired from the 249s kind
// registration): settings mode on the REFERENCE contract when the
// capability is present, qm.1 focus-or-add on `title` when it is absent or
// pending. Never throws; the open itself is async and unobserved.
function refNoteCardEditorOpen(plugin, path) {
  const target = typeof refNoteCardPath === "function" ? refNoteCardPath(path) : "";
  if (!target) return false;
  let open = null;
  try {
    open = plugin && typeof plugin.openPropertyEditor === "function" ? plugin.openPropertyEditor : null;
  } catch (_) {
    open = null;
  }
  if (!open) return false;
  try {
    if (refNoteCardEditorCapabilityConfirmed(plugin)) {
      // noteKind is the contract's wire name ("reference"), not the card
      // registry kind, so the badge and header are right before the report
      // arrives to confirm it.
      void open.call(plugin, { filePath: target, noteKind: "reference", focusSettings: true });
    } else {
      void open.call(plugin, { filePath: target, key: "title" });
    }
  } catch (_) {
    return false;
  }
  return true;
}

// Parse a managed-embed target (`![[path#fragment|alias]]`) into an
// openLinkText link. Anything else reads as no target.
function refNoteCardEmbedTarget(target) {
  try {
    const match = /^\s*!\[\[([^\]|#]+)(#[^\]|]*)?(?:\|[^\]]*)?\]\]\s*$/.exec(String(target || ""));
    if (!match || !match[1] || !match[1].trim()) return "";
    return `${match[1].trim()}${match[2] || ""}`;
  } catch (_) {
    return "";
  }
}

// Dispatch an owned-elsewhere row to its owner. Reading and residence open
// the reading task; the file name routes to `bob ref rename`. Never throws.
async function refNoteCardEditorFollowRoute(modal, entry) {
  try {
    const row = entry && entry.row;
    const route = row && row.settingRoute;
    if (route === "reading_task") return await refNoteCardEditorOpenReadingTask(modal, entry);
    if (route === "ref_rename") return await refNoteCardEditorOpenRename(modal, entry);
    return { ok: false, message: "That row is owned elsewhere." };
  } catch (error) {
    return { ok: false, message: String((error && error.message) || error || "That row could not be opened.") };
  }
}

// Enter on Reading or Lives under opens the reading task (the note's managed
// embed target). With no target the note is a legacy reference: say so and
// stay in the editor.
async function refNoteCardEditorOpenReadingTask(modal, entry) {
  const row = entry && entry.row;
  const link = refNoteCardEmbedTarget(row && row.settingTarget);
  let workspace = null;
  try {
    const plugin = modal && modal.propertyPlugin;
    const app = (plugin && plugin.app) || (modal && modal.app);
    workspace = app && app.workspace;
  } catch (_) {
    workspace = null;
  }
  if (!link) {
    try {
      if (typeof Notice !== "undefined") new Notice("This is a legacy reference without a reading task.");
    } catch (_) {}
    return { ok: false, message: "This is a legacy reference without a reading task." };
  }
  if (!workspace || typeof workspace.openLinkText !== "function") {
    return { ok: false, message: "The reading task could not be opened." };
  }
  try {
    await workspace.openLinkText(link, (modal && modal.filePath) || "", false);
  } catch (_) {
    return { ok: false, message: "The reading task could not be opened." };
  }
  try {
    if (modal && typeof modal.close === "function") modal.close();
  } catch (_) {}
  return { ok: true };
}

// The exact rename command the File name row copies or opens.
function refNoteCardRenameCommand(stem) {
  const name = String(stem || "").trim();
  return `bob ref rename ${name} <NEW>`;
}

// The Command Mode plugin api namespace when it is loaded, else null.
function refNoteCardCommandModeApi(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const mode = plugins && plugins["bob-command-mode"];
    const api = mode && mode.api && mode.api.commandMode;
    return api && typeof api === "object" ? api : null;
  } catch (_) {
    return null;
  }
}

// Copy helper for the rename command. Uses the async clipboard only;
// returns false when it is unavailable so the caller can say so.
async function refNoteCardCopyText(text) {
  const value = String(text || "");
  if (!value) return false;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard
      && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (_) {}
  return false;
}

// Enter on File name opens Command Mode when it is loaded so the user can
// paste the rename, and always copies `bob ref rename <stem> <NEW>`.
// (api.commandMode exposes no prefill opener, so the command travels on the
// clipboard either way.) The editor stays open behind the sheet.
async function refNoteCardEditorOpenRename(modal, entry) {
  void entry;
  let app = null;
  try {
    const plugin = modal && modal.propertyPlugin;
    app = (plugin && plugin.app) || (modal && modal.app);
  } catch (_) {
    app = null;
  }
  let stem = "";
  try {
    stem = typeof refNoteCardStem === "function"
      ? refNoteCardStem((modal && modal.filePath) || "")
      : String((modal && modal.filePath) || "").split("/").pop().replace(/\.md$/i, "");
  } catch (_) {
    stem = "";
  }
  const text = refNoteCardRenameCommand(stem);
  const commandMode = refNoteCardCommandModeApi(app);
  let opened = false;
  if (commandMode) {
    try {
      if (app && app.commands && typeof app.commands.executeCommandById === "function") {
        await app.commands.executeCommandById("bob-command-mode:open");
        opened = true;
      }
    } catch (_) {
      opened = false;
    }
  }
  let copied = false;
  try {
    copied = await refNoteCardCopyText(text);
  } catch (_) {
    copied = false;
  }
  if (!copied) {
    return { ok: false, message: `The rename command could not be copied: ${text}` };
  }
  try {
    if (typeof Notice !== "undefined") {
      new Notice(opened
        ? "Rename command copied — paste it into Command Mode to rename this reference."
        : "Command Mode is unavailable — the rename command was copied; paste it to rename.");
    }
  } catch (_) {}
  return { ok: true, opened, copied };
}
