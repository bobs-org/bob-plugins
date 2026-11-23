// Property Editor proseField consumer (S16): Text and List values share
// navigation's [[ and (( completion. The editor's Escape/q/Ctrl+[ ladder
// owns back-out; subjects are omitted because this stage does not edit tasks.
function propertyEditorProseFieldApi(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const nav = plugins ? plugins["bob-navigation-hotkeys"] : null;
    const prose = nav && nav.api && nav.api.proseField;
    if (!prose || Number(prose.version) < 1 || typeof prose.attach !== "function") return null;
    return prose;
  } catch (_) {
    return null;
  }
}

Object.assign(PropertyEditorModal.prototype, {
  propertyEditorProseStageNodes(stage = this.stage) {
    try {
      if (!stage || !["text", "list"].includes(stage.kind)) return null;
      const panel = this.contentEl?.querySelector?.("[data-property-stage]");
      const input = panel?.querySelector?.("[data-property-stage-input]");
      const band = panel?.querySelector?.("[data-property-stage-band]");
      if (!input || !band || Number(input.getAttribute?.("data-property-stage-id")) !== stage.id) return null;
      return { input, band };
    } catch (_) {
      return null;
    }
  }
,
  propertyEditorSyncProseField() {
    if (this.closed) {
      this.propertyEditorDetachProseField();
      return;
    }
    const stage = this.stage;
    const nodes = this.propertyEditorProseStageNodes(stage);
    if (!nodes) {
      this.propertyEditorDetachProseField();
      return;
    }
    const binding = this.propertyEditorProseBinding;
    if (binding && binding.stageId === stage.id && binding.kind === stage.kind) {
      if (binding.inputEl !== nodes.input || binding.bandHost !== nodes.band) {
        try { binding.handle.rebind?.({ inputEl: nodes.input, bandHost: nodes.band }); } catch (_) {}
        binding.inputEl = nodes.input;
        binding.bandHost = nodes.band;
      }
      return;
    }
    this.propertyEditorDetachProseField();
    const api = propertyEditorProseFieldApi(this.propertyPlugin?.app || this.app);
    if (!api) return;
    let handle = null;
    try {
      handle = api.attach({
        inputEl: nodes.input,
        bandHost: nodes.band,
        sourcePath: () => this.filePath || null,
        links: true,
        tasks: true,
        mode: "inline",
        density: "roomy",
        ownKeys: false,
        arrowKeys: true,
      });
    } catch (_) {
      handle = null;
    }
    if (!handle || typeof handle.handleKeydown !== "function") return;
    this.propertyEditorProseBinding = {
      handle,
      stageId: stage.id,
      kind: stage.kind,
      inputEl: nodes.input,
      bandHost: nodes.band,
    };
  }
,
  propertyEditorDetachProseField() {
    const binding = this.propertyEditorProseBinding;
    this.propertyEditorProseBinding = null;
    try { binding?.handle?.detach?.(); } catch (_) {}
  }
,
  propertyEditorProseOffer(event) {
    const binding = this.propertyEditorProseBinding;
    if (!binding || !binding.handle || !event || event.target !== binding.inputEl) return false;
    let wasOpen = false;
    try { wasOpen = binding.handle.isLinkOpen?.() === true; } catch (_) {}
    let consumed = false;
    try { consumed = binding.handle.handleKeydown(event) === true; } catch (_) {}
    if (!consumed && wasOpen && event.key === "Enter") consumed = true;
    if (!consumed) return false;
    try { event.preventDefault?.(); } catch (_) {}
    try { event.stopPropagation?.(); } catch (_) {}
    this.propertyEditorStageInputChanged(binding.inputEl);
    return true;
  }
,
  propertyEditorProseBackOut(event) {
    const binding = this.propertyEditorProseBinding;
    if (!binding?.handle) return false;
    let consumed = false;
    try { consumed = binding.handle.backOut?.(event) === true; } catch (_) {}
    return consumed;
  }
,
});
