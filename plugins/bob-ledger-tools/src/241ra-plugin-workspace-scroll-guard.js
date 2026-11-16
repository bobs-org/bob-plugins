const BOB_WORKSPACE_SCROLL_GUARD_SELECTOR = [
  ".horizontal-main-container", ".workspace", ".workspace-split", ".workspace-tabs",
  ".workspace-tab-container", ".workspace-leaf", ".workspace-leaf-content",
].join(",");

class BobLedgerToolsWorkspaceScrollGuardMixin {
  setupWorkspaceScrollGuard() {
    this.workspaceScrollGuardDocs = new WeakSet();
    this.workspaceScrollGuardLastWarning = new WeakMap();
    this.workspaceScrollGuardBindDocument(typeof document !== "undefined" ? document : null);
    const workspace = this.app?.workspace;
    if (workspace?.on && this.registerEvent) {
      this.registerEvent(workspace.on("window-open", (win) => {
        this.workspaceScrollGuardBindDocument(win?.document || win?.doc || null);
      }));
    }
  }

  workspaceScrollGuardBindDocument(doc) {
    if (!doc || this.workspaceScrollGuardDocs?.has(doc) || !this.registerDomEvent) return;
    this.workspaceScrollGuardDocs.add(doc);
    this.registerDomEvent(doc, "scroll", (event) => {
      const target = event?.target;
      if (!target?.matches?.(BOB_WORKSPACE_SCROLL_GUARD_SELECTOR)) return;
      const top = Number(target.scrollTop) || 0;
      const left = Number(target.scrollLeft) || 0;
      if (top === 0 && left === 0) return;

      const active = doc.activeElement;
      const activeDetail = active ? {
        tag: String(active.tagName || active.nodeName || "").toLowerCase(),
        classes: String(active.className || "").slice(0, 120),
        text: String(active.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
      } : null;
      const targetClass = String(target.className || "").trim() || "(no class)";
      target.scrollTop = 0;
      target.scrollLeft = 0;

      const now = Date.now();
      const previous = this.workspaceScrollGuardLastWarning.get(doc);
      if (previous !== undefined && now - previous < 5000) return;
      this.workspaceScrollGuardLastWarning.set(doc, now);
      let hoverOpen = false;
      try { hoverOpen = Boolean(doc.querySelector?.(".hover-popover, .popover")); } catch (_error) {}
      let activePath = "";
      try {
        const leaf = this.app?.workspace?.activeLeaf;
        activePath = leaf?.view?.file?.path || this.app?.workspace?.getActiveFile?.()?.path || "";
      } catch (_error) {}
      try {
        console.warn("[bob-ledger-tools] reset unexpected workspace scroll", {
          container: targetClass, scrollTop: top, scrollLeft: left, activePath,
          activeElement: activeDetail, hoverPopoverOpen: hoverOpen,
        });
      } catch (_error) { /* Console reporting is best-effort. */ }
    }, { capture: true });
  }
}
