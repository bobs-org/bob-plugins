class BobNavigationHotkeysBlocksApiMixin {
  async openLinkedBlocksStage(target) {
    return this.openLinkedDependencyStage(target, { rowId: "blocks" });
  }

  async openBlocksStageForRef(ref = {}) {
    try {
      const path = normalizeVaultRelativePath(ref.path || "");
      const hitLine = Math.floor(numericOrDefault(ref.line, Number.NaN));
      if (!path || !Number.isFinite(hitLine)) {
        return Object.freeze({ ok: false, reason: "invalid-ref" });
      }
      const view = this.getActiveMarkdownView();
      if (
        !view ||
        !view.editor ||
        !view.file ||
        normalizeVaultRelativePath(view.file.path) !== path
      ) {
        return Object.freeze({ ok: false, reason: "note-not-open" });
      }
      const content = String(view.editor.getValue() || "");
      const lines = content.split(/\r?\n/);
      if (hitLine < 0 || hitLine >= lines.length) {
        return Object.freeze({ ok: false, reason: "line-out-of-range" });
      }
      const owning = findOwningTaskLine(lines, hitLine);
      if (owning === null) {
        return Object.freeze({ ok: false, reason: "no-owning-task" });
      }
      setEditorCursorSafely(view.editor, owning, 0);
      const opened = this.openBulletPropertyPicker(view.editor, {
        reopenBlocksStage: true,
      });
      return opened
        ? Object.freeze({ ok: true })
        : Object.freeze({ ok: false, reason: "picker-not-opened" });
    } catch (_error) {
      return Object.freeze({ ok: false, reason: "open-failed" });
    }
  }

  async removeBlocksDependentByRef(ownerRef = {}, target = {}) {
    try {
      const path = normalizeVaultRelativePath(ownerRef.path || "");
      const hitLine = Math.floor(numericOrDefault(ownerRef.line, Number.NaN));
      const targetPath = normalizeVaultRelativePath(target.path || "");
      const targetBlockId = normalizeBulletPropertyValue(target.blockId || "");
      if (!path || !Number.isFinite(hitLine) || !targetPath || !targetBlockId) {
        return Object.freeze({ ok: false, reason: "invalid-ref" });
      }
      const view = this.getActiveMarkdownView();
      if (
        !view ||
        !view.editor ||
        !view.file ||
        normalizeVaultRelativePath(view.file.path) !== path
      ) {
        return Object.freeze({ ok: false, reason: "note-not-open" });
      }
      const ownerContent = String(view.editor.getValue() || "");
      const ownerLines = ownerContent.split(/\r?\n/);
      if (hitLine < 0 || hitLine >= ownerLines.length) {
        return Object.freeze({ ok: false, reason: "line-out-of-range" });
      }
      const ownerLine = findOwningTaskLine(ownerLines, hitLine);
      if (ownerLine === null) {
        return Object.freeze({ ok: false, reason: "no-owning-task" });
      }
      const ownerBlockId = getTrailingBlockId(ownerLines[ownerLine]);
      if (!ownerBlockId) {
        // No dependent can list an owner with no id.
        new Notice("🧱 That task is not a dependent");
        return Object.freeze({ ok: false, reason: "not-a-dependent" });
      }

      const dependentContent = await this.readDependencyNoteContent(
        targetPath,
        null,
        path,
      );
      if (dependentContent === null) {
        return Object.freeze({ ok: false, reason: "target-not-found" });
      }
      const dependentLines = dependentContent.split(/\r?\n/);
      const dependentLine = findTaskLineByTrailingBlockId(
        dependentLines,
        targetBlockId,
      );
      if (dependentLine === null) {
        new Notice("🧱 That task is not a dependent");
        return Object.freeze({ ok: false, reason: "not-a-dependent" });
      }
      const dependencyLine = collectDependencyNavigationBullets(
        dependentContent,
        dependentLine,
      );
      if (dependencyLine.reason) {
        return Object.freeze({ ok: false, reason: dependencyLine.reason });
      }
      const resolveLinkpath = this.dependencyLinkpathResolver();
      const linked = dependencyLine.targets.some((entry) => {
        const linkedPath = dependencyPathForLinkNote(
          entry.note,
          targetPath,
          resolveLinkpath,
        );
        return (
          normalizeVaultRelativePath(linkedPath) === path &&
          normalizeBulletPropertyValue(entry.blockId) ===
            normalizeBulletPropertyValue(ownerBlockId)
        );
      });
      if (!linked) {
        new Notice("🧱 That task is not a dependent");
        return Object.freeze({ ok: false, reason: "not-a-dependent" });
      }

      const expected = new Map([
        [path, ownerContent],
        [targetPath, dependentContent],
      ]);
      const outcome = await this.applyBlocksEdit({
        sources: [{ path, line: ownerLine, blockId: ownerBlockId }],
        add: [],
        remove: [{ path: targetPath, line: dependentLine, blockId: targetBlockId }],
        expected,
      });
      if (!outcome.ok) {
        new Notice(outcome.notice || `🧱 Could not remove dependent (${outcome.reason})`);
        return Object.freeze({ ok: false, reason: outcome.reason });
      }
      if (outcome.notice) {
        new Notice(outcome.notice);
      }
      return Object.freeze({ ok: true });
    } catch (_error) {
      return Object.freeze({ ok: false, reason: "remove-failed" });
    }
  }
}
