// Settle a note after a dependency gesture promoted one of its tasks. The
// preparation and mirror writers must land first because they guard the
// exact, unsettled preimage.
function navPromotedNoteOpenEditor(plugin, path) {
  const workspace = plugin && plugin.app && plugin.app.workspace;
  if (!workspace || typeof workspace.getLeavesOfType !== "function") return null;
  for (const leaf of workspace.getLeavesOfType("markdown") || []) {
    const view = leaf && leaf.view;
    if (
      view &&
      view.file &&
      normalizeVaultRelativePath(view.file.path) === path &&
      view.editor &&
      typeof view.editor.getValue === "function"
    ) {
      return view.editor;
    }
  }
  return null;
}

function navPromotedDependencyTaskNotePaths(plan, parentPath, mirrorTouch) {
  if (mirrorTouch) return [];
  return [...new Set(
    (plan && Array.isArray(plan.preparations) ? plan.preparations : [])
      .filter(
        (preparation) =>
          normalizeVaultRelativePath(preparation.path || "") !== parentPath &&
          getObsidianTaskCheckboxStatus(preparation.from) !==
            getObsidianTaskCheckboxStatus(preparation.text),
      )
      .map((preparation) => normalizeVaultRelativePath(preparation.path || ""))
      .filter(Boolean),
  )];
}

async function navSettlePromotedTaskNotes(plugin, paths, today) {
  const uniquePaths = new Set(
    (Array.isArray(paths) ? paths : [])
      .map((path) => normalizeVaultRelativePath(path || ""))
      .filter(Boolean),
  );
  for (const path of uniquePaths) {
    try {
      const editor = navPromotedNoteOpenEditor(plugin, path);
      const vault = plugin && plugin.app && plugin.app.vault;
      let file = null;
      let live = null;
      if (editor) {
        live = String(editor.getValue() || "");
      } else {
        file =
          vault && typeof vault.getAbstractFileByPath === "function"
            ? vault.getAbstractFileByPath(path)
            : null;
        if (!file || !vault) continue;
        if (typeof vault.cachedRead === "function") {
          live = String((await vault.cachedRead(file)) || "");
        } else if (typeof vault.read === "function") {
          live = String((await vault.read(file)) || "");
        } else {
          continue;
        }
      }
      const prepared = navPrepareSettledFilePostimage(plugin, path, live, { today });
      if (!prepared || typeof prepared.contents !== "string" || prepared.contents === live) {
        continue;
      }
      if (editor) {
        navApplySettledEditorPostimage(
          plugin,
          editor,
          path,
          live,
          live,
          { annotation: BLOCKS_MACHINE_WRITE_ANNOTATION, today },
        );
      } else {
        await navApplySettledVaultPostimage(
          plugin,
          vault,
          file,
          path,
          live,
          live,
          { today },
        );
      }
    } catch (_error) {
      // Best-effort recovery; the dependency write stands and reconcile heals a miss.
    }
  }
}

function navTaskCheckboxStatusChanged(before, after) {
  const beforeTasks = String(before || "")
    .split(/\r?\n/)
    .filter((line) => isObsidianTaskLine(line));
  const afterTasks = String(after || "")
    .split(/\r?\n/)
    .filter((line) => isObsidianTaskLine(line));
  return (
    beforeTasks.length === afterTasks.length &&
    beforeTasks.some(
      (line, index) =>
        getObsidianTaskCheckboxStatus(line) !==
        getObsidianTaskCheckboxStatus(afterTasks[index]),
    )
  );
}
