// Missing record links in album folders belong to bob albums sync, not
// Templater's generic note creation path.
Object.assign(BobNavigationHotkeysNotesMoveMixin.prototype, {
  isAlbumFolderCreationTarget(creation) {
    const folderPath = normalizeVaultRelativePath(creation && creation.folderPath || "")
      .replace(/^\/+|\/+$/g, "");
    if (!folderPath || folderPath.includes("/")) {
      return false;
    }

    const albumFile = this.app.vault.getAbstractFileByPath(`${folderPath}.md`);
    if (!this.isMarkdownFile(albumFile)) {
      return false;
    }
    try {
      const frontmatter = this.app.metadataCache.getFileCache(albumFile)?.frontmatter;
      return Boolean(frontmatter && isAlbumType(frontmatter.type));
    } catch (error) {
      return false;
    }
  },

  requestAlbumSyncForMissingRecord() {
    try {
      const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
      const ledger = plugins && plugins["bob-ledger-tools"];
      if (ledger && typeof ledger.albumScheduleSync === "function") {
        ledger.albumScheduleSync("missing-record-link");
      } else if (ledger && typeof ledger.apiAlbumSync === "function") {
        void ledger.apiAlbumSync({ automatic: true });
      }
    } catch (error) {
      // A failed optional sync request must not make link navigation unsafe.
    }
  },
});
