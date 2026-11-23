"use strict";

// These functions execute in the inspected Obsidian page. Keep them standalone
// so failures before the first assertion still explain the modal's lifecycle.
function editorDiagnostics() {
  const plugin = window.app?.plugins?.plugins?.["bob-ledger-tools"];
  const modal = plugin?.propertyEditorModal;
  const content = modal?.contentEl;
  const owner = content?.ownerDocument;
  const root = content?.getRootNode?.();
  return {
    pluginLoaded: Boolean(plugin),
    entrypointsActive: plugin?.propertyEditorEntrypointsActive ?? null,
    layoutReady: window.app?.workspace?.layoutReady ?? null,
    activePath: window.app?.workspace?.activeLeaf?.view?.file?.path || null,
    documentUrl: document.URL,
    documentFocused: document.hasFocus?.() ?? null,
    activeWindowMatches: typeof activeWindow === "undefined" ? null : activeWindow === window,
    activeDocumentUrl: typeof activeDocument === "undefined" ? null : activeDocument?.URL,
    documentEditors: document.querySelectorAll(".bob-property-editor").length,
    documentModals: document.querySelectorAll(".modal-container").length,
    modal: modal ? {
      filePath: modal.filePath,
      closed: modal.closed,
      pendingApply: modal.pendingApply,
      readSeq: modal.readSeq,
      status: modal.status,
      refusal: modal.refusal,
      reportPath: modal.report?.path || null,
      stageKind: modal.stage?.kind || null,
      connected: content?.isConnected ?? null,
      ownerDocumentMatches: owner === document,
      ownerDocumentUrl: owner?.URL || null,
      ownerDocumentEditors: owner?.querySelectorAll(".bob-property-editor").length ?? null,
      root: root?.nodeName || null,
      rootHost: root?.host?.tagName || null,
      contentHtml: content?.outerHTML?.slice(0, 16000) || null,
    } : null,
    lifecycle: window.__bobPropertyEditorLifecycle || [],
    lastOpen: window.__bobPropertyEditorLastOpen || null,
  };
}

function installEditorDiagnostics() {
  const plugin = window.app?.plugins?.plugins?.["bob-ledger-tools"];
  const proto = plugin?.constructor?.helpers?.PropertyEditorModal?.prototype;
  if (!proto) throw new Error("Property Editor modal helpers are not available");
  if (window.__bobPropertyEditorLifecycle) return;
  const events = window.__bobPropertyEditorLifecycle = [];
  const record = (event) => {
    events.push(event);
    if (events.length > 200) events.shift();
  };
  for (const name of ["open", "close", "onOpen", "onClose", "paintPropertyEditor"]) {
    const original = proto[name];
    if (typeof original !== "function") continue;
    proto[name] = function (...args) {
      const event = {
        method: name, path: this.filePath, closed: this.closed,
        connected: this.contentEl?.isConnected ?? null,
      };
      if (name !== "paintPropertyEditor") {
        event.stack = new Error().stack;
        record(event);
      }
      try { return original.apply(this, args); }
      catch (error) {
        event.error = String(error?.stack || error);
        if (name === "paintPropertyEditor") record(event);
        throw error;
      }
    };
  }
}

async function focusApplicationWindow(client, waitFor) {
  // A fresh Electron profile can leave Obsidian's activeWindow pointing to its
  // about:blank startup window. Native Modal.open() mounts into that document.
  // Focus the real page before exercising the API or sending keyboard input.
  await client.call("Page.bringToFront");
  await client.evaluate("window.focus()");
  return waitFor(client, `({
    focused: document.hasFocus(),
    active: typeof activeWindow !== "undefined" && activeWindow === window,
    documentUrl: document.URL,
  })`, (state) => state?.focused && state?.active, "Obsidian application window focus");
}

module.exports = {
  focusApplicationWindow,
  editorDiagnosticSource: () => `(${editorDiagnostics.toString()})()`,
  installEditorDiagnosticSource: () => `(${installEditorDiagnostics.toString()})()`,
};
