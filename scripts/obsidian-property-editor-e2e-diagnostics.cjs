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
  // Xvfb without a window manager leaves BrowserWindow.focus() as a no-op, so
  // reasserting native focus never retires that blank window. Close it, then
  // keep focusing the vault window until Chromium's activeWindow matches.
  await client.call("Page.bringToFront");
  try {
    await client.call("Input.dispatchMouseEvent", {
      type: "mousePressed", x: 360, y: 24, button: "left", clickCount: 1,
    });
    await client.call("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: 360, y: 24, button: "left", clickCount: 1,
    });
  } catch (_) {}
  return waitFor(client, `(() => {
    const closed = [];
    try {
      const remote = require("electron").remote;
      const current = remote.getCurrentWindow();
      try { current.show(); } catch (_) {}
      try { current.focus(); } catch (_) {}
      try { current.webContents.focus(); } catch (_) {}
      const windows = remote.BrowserWindow && remote.BrowserWindow.getAllWindows
        ? remote.BrowserWindow.getAllWindows() : [];
      for (const win of windows) {
        if (win === current) continue;
        let url = "";
        try { url = String(win.webContents.getURL()); } catch (_) {}
        if (url === "about:blank") {
          try { win.destroy(); closed.push(url); } catch (_) {}
        }
      }
    } catch (_) {}
    try { window.focus(); } catch (_) {}
    if (typeof activeWindow !== "undefined" && activeWindow !== window) {
      const url = typeof activeDocument !== "undefined" ? String(activeDocument && activeDocument.URL || "") : "";
      if (url === "about:blank") {
        try { activeWindow.close(); closed.push(url); } catch (_) {}
      }
    }
    return {
      focused: document.hasFocus(),
      active: typeof activeWindow !== "undefined" && activeWindow === window,
      documentUrl: document.URL,
      activeDocumentUrl: typeof activeDocument === "undefined" ? null : (activeDocument && activeDocument.URL || null),
      closed,
    };
  })()`, (state) => state?.focused && state?.active, "Obsidian application window focus");
}

module.exports = {
  focusApplicationWindow,
  editorDiagnosticSource: () => `(${editorDiagnostics.toString()})()`,
  installEditorDiagnosticSource: () => `(${installEditorDiagnostics.toString()})()`,
};
