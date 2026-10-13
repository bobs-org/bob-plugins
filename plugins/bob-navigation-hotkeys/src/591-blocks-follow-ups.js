// Cross-note BLOCKS courtesy writes. Each note is planned once from its
// preimage and committed after the Depends-On transaction; an open editor
// receives its own undo entry, while vault.process protects a closed note.
class BobNavigationHotkeysBlocksFollowUpsMixin {
  async applyBlocksFollowUps(followUps) {
    const entries = Array.isArray(followUps) ? followUps : [];
    if (entries.length === 0) return Object.freeze({ ok: true, failed: Object.freeze([]) });
    const vault = this.app && this.app.vault;
    const workspace = this.app && this.app.workspace;
    const resolver = this.dependencyLinkpathResolver();
    const vaultFiles = this.readDependencyVaultFileList() || [];
    const dateEntry = entries.find((entry) => entry && entry.today);
    const today = dateEntry ? dateEntry.today : new Date();
    const dailyPaths = scheduledRecoveryDailyPaths(vaultFiles.map((path) => ({ path })), today);
    const grouped = new Map();
    for (const entry of entries) {
      const path = normalizeVaultRelativePath(entry && entry.path);
      if (!path || /^done\//i.test(path) || path === (dailyPaths && dailyPaths.previous)) continue;
      if (!grouped.has(path)) grouped.set(path, { path, preimage: entry.preimage, owners: new Map() });
      const note = grouped.get(path);
      if (note.preimage !== entry.preimage) note.preimage = null;
      const id = normalizeBulletPropertyValue(entry.ownerBlockId);
      if (!id) continue;
      if (!note.owners.has(id)) note.owners.set(id, { add: [], remove: [] });
      const owner = note.owners.get(id);
      owner.add.push(...(Array.isArray(entry.add) ? entry.add : []));
      owner.remove.push(...(Array.isArray(entry.remove) ? entry.remove : []));
    }

    const failed = new Set();
    for (const note of grouped.values()) {
      if (typeof note.preimage !== "string") {
        failed.add(note.path);
        continue;
      }
      let editor = null;
      if (workspace && typeof workspace.getLeavesOfType === "function") {
        for (const leaf of workspace.getLeavesOfType("markdown") || []) {
          const view = leaf && leaf.view;
          if (view && view.file && normalizeVaultRelativePath(view.file.path) === note.path && view.editor && typeof view.editor.getValue === "function") {
            editor = view.editor;
            break;
          }
        }
      }
      let current = null;
      if (editor) {
        current = String(editor.getValue() || "");
      } else {
        try {
          const file = vault && typeof vault.getAbstractFileByPath === "function"
            ? vault.getAbstractFileByPath(note.path)
            : null;
          if (file && vault && typeof vault.cachedRead === "function") current = String(await vault.cachedRead(file));
          else if (file && vault && typeof vault.read === "function") current = String(await vault.read(file));
        } catch (_error) {
          current = null;
        }
      }
      if (current === null || current !== note.preimage) {
        failed.add(note.path);
        continue;
      }

      let nextContent = note.preimage;
      let noteFailed = false;
      for (const [ownerBlockId, delta] of note.owners) {
        const lines = nextContent.split(/\r?\n/);
        const ownerLine = findTaskLineByTrailingBlockId(lines, ownerBlockId);
        if (ownerLine === null || !OPEN_OBSIDIAN_TASK_STATUSES.has(getObsidianTaskCheckboxStatus(lines[ownerLine]))) continue;
        const children = findBlocksChildren(lines, ownerLine);
        const parsed = children.map((index) => parseBlocksLine(lines[index], { isDirectChildOfTask: true }));
        if (parsed.some((item) => item.verdict === "malformed")) {
          noteFailed = true;
          continue;
        }
        const existing = children.flatMap((index) =>
          blocksExistingRows(note.path, lines[index], resolver, vaultFiles),
        );
        const add = [];
        for (const link of delta.add) {
          const parsedLink = extractDependencyLineLinks(String(link || ""))[0];
          if (!parsedLink) continue;
          const targetPath = dependencyPathForLinkNote(parsedLink.note, note.path, resolver);
          const identity = blocksIdentity(targetPath, parsedLink.blockId);
          if (!identity) continue;
          const canonical = canonicalDependencyLink({ path: targetPath, blockId: parsedLink.blockId }, note.path, vaultFiles).text;
          add.push({ identity, link: canonical });
        }
        const desired = blocksDesiredAfterDelta(
          existing,
          (entry) => entry.identity || null,
          add,
          [...new Set(delta.remove)],
        );
        const planned = planBlocksLineEdit(nextContent, ownerLine, desired);
        if (!planned.ok) {
          noteFailed = true;
          continue;
        }
        nextContent = planned.nextContent;
      }

      if (nextContent !== note.preimage) {
        if (editor) {
          if (String(editor.getValue() || "") !== note.preimage || !applyEditorContentTransaction(editor, note.preimage, nextContent, null, BLOCKS_MACHINE_WRITE_ANNOTATION)) {
            failed.add(note.path);
            continue;
          }
        } else {
          const file = vault && typeof vault.getAbstractFileByPath === "function"
            ? vault.getAbstractFileByPath(note.path)
            : null;
          if (!file || !vault || typeof vault.process !== "function") {
            failed.add(note.path);
            continue;
          }
          let applied = false;
          try {
            await vault.process(file, (data) => {
              if (String(data || "") !== note.preimage) return data;
              applied = true;
              return nextContent;
            });
          } catch (_error) {
            applied = false;
          }
          if (!applied) {
            failed.add(note.path);
            continue;
          }
        }
      }
      if (noteFailed) failed.add(note.path);
    }
    return Object.freeze({ ok: failed.size === 0, failed: Object.freeze([...failed]) });
  }

  // Remaining direct-planner paths commit their own transaction, then call
  // this once so every cross-note BLOCKS follow-up shares one notice suffix.
  async finishBlocksFollowUps(followUps, notice) {
    let failed = [];
    try {
      const result = await this.applyBlocksFollowUps(followUps || []);
      failed = (result && result.failed) || [];
    } catch (_error) {
      failed = (Array.isArray(followUps) ? followUps : [])
        .map((entry) => entry && entry.path)
        .filter(Boolean);
    }
    if (notice) new Notice(withBlocksFollowUpNotice(notice, failed));
    return Object.freeze({ failed: Object.freeze(failed) });
  }
}
