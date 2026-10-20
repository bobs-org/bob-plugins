const IMAGE_ZOOM_STEP = 1.2;
const IMAGE_ZOOM_PADDING = 32;
const IMAGE_ZOOM_MAX_FACTOR = 8;
const IMAGE_ZOOM_PAN_FRACTION = 0.15;
const IMAGE_ZOOM_DRAG_THRESHOLD_PX = 4;
const IMAGE_ZOOM_FOOTER_HINT =
  "Esc · q · Z close   + / − zoom   0 fit   1 actual   hjkl pan";

function defaultImageZoomDefer(callback) {
  if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
    return window.setTimeout(callback, 0);
  }
  callback();
}

function addImageZoomClass(el, name) {
  if (!el || !name) {
    return;
  }
  if (typeof el.addClass === "function") {
    el.addClass(name);
    return;
  }
  if (el.classList && typeof el.classList.add === "function") {
    el.classList.add(name);
  }
}

function listenImageZoom(target, type, handler, options) {
  if (!target || typeof target.addEventListener !== "function") {
    return;
  }
  try {
    target.addEventListener(type, handler, options);
  } catch (_error) {
    target.addEventListener(type, handler);
  }
}

function computeImageZoomFitScale(natural, viewport, padding) {
  const pad = Number.isFinite(Number(padding)) ? Number(padding) : IMAGE_ZOOM_PADDING;
  const natW = Number(natural && natural.width);
  const natH = Number(natural && natural.height);
  const viewW = Number(viewport && viewport.width);
  const viewH = Number(viewport && viewport.height);
  const boxW = viewW - 2 * pad;
  const boxH = viewH - 2 * pad;
  if (!(natW > 0) || !(natH > 0) || !(boxW > 0) || !(boxH > 0)) {
    return 1;
  }
  return Math.min(1, boxW / natW, boxH / natH);
}

function computeImageZoomBounds(fit, oneToOne) {
  const fitScale = Number(fit);
  const actual = Number(oneToOne);
  const safeFit = Number.isFinite(fitScale) ? fitScale : 1;
  const safeActual = Number.isFinite(actual) && actual > 0 ? actual : 1;
  return Object.freeze({
    fit: safeFit,
    oneToOne: safeActual,
    min: Math.min(safeFit, safeActual),
    max: IMAGE_ZOOM_MAX_FACTOR * Math.max(safeFit, safeActual, 1),
  });
}

function zoomImageZoomState(state, factor, point, ctx) {
  const current = state && typeof state === "object" ? state : {};
  const scale = Number(current.scale);
  const safeScale = scale > 0 && Number.isFinite(scale) ? scale : 1;
  const min = ctx && Number.isFinite(Number(ctx.min)) ? Number(ctx.min) : 0;
  const max = ctx && Number.isFinite(Number(ctx.max))
    ? Number(ctx.max)
    : Number.POSITIVE_INFINITY;
  const nextScale = clampNumber(safeScale * Number(factor), min, max);
  const px = point && Number.isFinite(Number(point.x)) ? Number(point.x) : 0;
  const py = point && Number.isFinite(Number(point.y)) ? Number(point.y) : 0;
  const ox = Number(current.x) || 0;
  const oy = Number(current.y) || 0;
  const ratio = nextScale / safeScale;
  return Object.freeze({
    scale: nextScale,
    x: px - (px - ox) * ratio,
    y: py - (py - oy) * ratio,
  });
}

function clampImageZoomAxis(offset, scaled, view) {
  if (!(scaled > view)) {
    return 0;
  }
  const limit = (scaled - view) / 2;
  return clampNumber(offset, -limit, limit);
}

function clampImageZoomPan(state, natural, viewport) {
  const current = state && typeof state === "object" ? state : {};
  const scale = Number(current.scale);
  const safeScale = scale > 0 && Number.isFinite(scale) ? scale : 1;
  const natW = Number(natural && natural.width) || 0;
  const natH = Number(natural && natural.height) || 0;
  const viewW = Number(viewport && viewport.width) || 0;
  const viewH = Number(viewport && viewport.height) || 0;
  return Object.freeze({
    scale: safeScale,
    x: clampImageZoomAxis(Number(current.x) || 0, natW * safeScale, viewW),
    y: clampImageZoomAxis(Number(current.y) || 0, natH * safeScale, viewH),
  });
}

function imageZoomKeyAction(event) {
  if (!event) {
    return Object.freeze({ action: "ignore" });
  }
  if (event.isComposing === true || event.keyCode === 229) {
    return Object.freeze({ action: "ignore" });
  }
  if (isTaskCardCloseKeydown(event)) {
    return Object.freeze({ action: "close" });
  }
  const key = String(event.key || "");
  const ctrl = event.ctrlKey === true;
  const meta = event.metaKey === true;
  const alt = event.altKey === true;
  const shift = event.shiftKey === true;
  if (key === "Z" && !ctrl && !meta && !alt) {
    return Object.freeze({ action: "close" });
  }
  if (ctrl || meta || alt) {
    return Object.freeze({ action: "ignore" });
  }
  if (key === "+" || key === "=") {
    return Object.freeze({ action: "zoomIn" });
  }
  if (key === "-" || key === "_") {
    return Object.freeze({ action: "zoomOut" });
  }
  if (key === "0") {
    return Object.freeze({ action: "fit" });
  }
  if (key === "1") {
    return Object.freeze({ action: "actual" });
  }
  const panDirs = Object.freeze({
    h: "left",
    arrowleft: "left",
    l: "right",
    arrowright: "right",
    k: "up",
    arrowup: "up",
    j: "down",
    arrowdown: "down",
  });
  const dir = panDirs[key.toLowerCase()];
  if (dir) {
    return Object.freeze({ action: "pan", dir, large: shift });
  }
  return Object.freeze({ action: "ignore" });
}

function imageZoomWheelFactor(event) {
  if (!event) {
    return 1;
  }
  let deltaY = Number(event.deltaY) || 0;
  if (event.deltaMode === 1) {
    deltaY *= 16;
  }
  const k = event.ctrlKey ? 0.01 : 0.0015;
  return Math.exp(-deltaY * k);
}

function measureImageZoomViewport(viewportEl, win) {
  const width = Number(viewportEl && viewportEl.clientWidth);
  const height = Number(viewportEl && viewportEl.clientHeight);
  if (width > 0 && height > 0) {
    return Object.freeze({ width, height });
  }
  const innerWidth = Number(win && win.innerWidth);
  const innerHeight = Number(win && win.innerHeight);
  if (innerWidth > 0 && innerHeight > 0) {
    return Object.freeze({ width: innerWidth, height: innerHeight });
  }
  return Object.freeze({ width: 0, height: 0 });
}

function getImageZoomDevicePixelRatio(win) {
  const dpr = Number(win && win.devicePixelRatio);
  return dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
}

function imageZoomPointFromEvent(event, el) {
  if (!el || typeof el.getBoundingClientRect !== "function") {
    return Object.freeze({ x: 0, y: 0 });
  }
  try {
    const rect = el.getBoundingClientRect();
    return Object.freeze({
      x: Number(event && event.clientX) - (rect.left + rect.width / 2),
      y: Number(event && event.clientY) - (rect.top + rect.height / 2),
    });
  } catch (_error) {
    return Object.freeze({ x: 0, y: 0 });
  }
}

function imageZoomEventHitsEl(event, el) {
  if (!el) {
    return false;
  }
  if (event && event.target === el) {
    return true;
  }
  if (typeof el.getBoundingClientRect !== "function") {
    return false;
  }
  try {
    const rect = el.getBoundingClientRect();
    const x = Number(event && event.clientX);
    const y = Number(event && event.clientY);
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  } catch (_error) {
    return false;
  }
}

class ImageZoomModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    const settings = options && typeof options === "object" ? options : {};
    this.imageSrc = String(settings.src || "");
    this.imageTitle = String(settings.title || "");
    this.onClosed = typeof settings.onClosed === "function" ? settings.onClosed : null;
    this.defer =
      typeof settings.defer === "function" ? settings.defer : defaultImageZoomDefer;
    this.imageZoomClosed = false;
    this.armed = false;
    this.fitMode = true;
    this.state = Object.freeze({ scale: 1, x: 0, y: 0 });
    this.natural = null;
    this.viewportSize = Object.freeze({ width: 0, height: 0 });
    this.fitScale = 1;
    this.oneToOne = 1;
    this.scopeHandler = null;
    this.abortController = null;
    this.viewportEl = null;
    this.imgEl = null;
    this.readoutEl = null;
    this.drag = null;
    this.suppressClick = false;
  }

  getImageZoomWindow() {
    try {
      const host = this.containerEl || this.modalEl;
      const doc = host && host.ownerDocument;
      if (doc && doc.defaultView) {
        return doc.defaultView;
      }
    } catch (_error) {
      // Fall through to the global window.
    }
    return typeof window !== "undefined" ? window : null;
  }

  imageZoomListenerOptions(extra) {
    const options = extra && typeof extra === "object" ? { ...extra } : {};
    if (this.abortController && this.abortController.signal) {
      options.signal = this.abortController.signal;
    }
    return options;
  }

  onOpen() {
    const { contentEl } = this;
    if (contentEl && typeof contentEl.empty === "function") {
      contentEl.empty();
    }
    addImageZoomClass(this.containerEl, "bob-image-zoom-container");
    addImageZoomClass(this.modalEl, "bob-image-zoom-modal");
    addImageZoomClass(contentEl, "bob-image-zoom");

    const header = contentEl.createDiv({ cls: "bob-image-zoom-header" });
    header.createDiv({ cls: "bob-image-zoom-title", text: this.imageTitle });
    this.readoutEl = header.createDiv({
      cls: "bob-image-zoom-readout",
      text: "Loading…",
    });

    this.viewportEl = contentEl.createDiv({
      cls: "bob-image-zoom-viewport",
      attr: { tabindex: "-1" },
    });
    this.imgEl = this.viewportEl.createEl("img", {
      cls: "bob-image-zoom-img",
      attr: { draggable: "false", alt: this.imageTitle },
    });
    contentEl.createDiv({
      cls: "bob-image-zoom-footer",
      text: IMAGE_ZOOM_FOOTER_HINT,
    });

    if (this.scope && typeof this.scope.register === "function") {
      this.scopeHandler = this.scope.register(null, null, (evt) => {
        this.handleImageZoomKey(evt);
        return false;
      });
    }

    this.abortController =
      typeof AbortController === "function"
        ? new AbortController()
        : { signal: { aborted: false }, abort() { this.signal.aborted = true; } };
    const signalOpts = this.imageZoomListenerOptions();
    listenImageZoom(this.imgEl, "load", () => this.handleImageZoomLoad(), signalOpts);
    listenImageZoom(this.imgEl, "error", () => this.handleImageZoomError(), signalOpts);
    listenImageZoom(
      this.viewportEl,
      "wheel",
      (event) => this.handleImageZoomWheel(event),
      this.imageZoomListenerOptions({ passive: false }),
    );
    listenImageZoom(
      this.viewportEl,
      "pointerdown",
      (event) => this.handleImageZoomPointerDown(event),
      signalOpts,
    );
    listenImageZoom(
      this.viewportEl,
      "pointermove",
      (event) => this.handleImageZoomPointerMove(event),
      signalOpts,
    );
    listenImageZoom(
      this.viewportEl,
      "pointerup",
      (event) => this.handleImageZoomPointerUp(event),
      signalOpts,
    );
    listenImageZoom(
      this.viewportEl,
      "pointercancel",
      (event) => this.handleImageZoomPointerUp(event),
      signalOpts,
    );
    listenImageZoom(
      this.viewportEl,
      "click",
      (event) => this.handleImageZoomClick(event),
      signalOpts,
    );
    listenImageZoom(
      this.viewportEl,
      "dblclick",
      (event) => this.handleImageZoomDblClick(event),
      signalOpts,
    );
    listenImageZoom(
      this.getImageZoomWindow(),
      "resize",
      () => this.handleImageZoomResize(),
      signalOpts,
    );

    if (this.imgEl) {
      this.imgEl.setAttribute("src", this.imageSrc);
    }

    // Ignore the opening Z until the next tick, then steal focus back from Vim.
    this.defer(() => {
      if (this.imageZoomClosed) {
        return;
      }
      this.armed = true;
      try {
        if (this.viewportEl && typeof this.viewportEl.focus === "function") {
          this.viewportEl.focus();
        }
      } catch (_error) {
        // Best effort: the catch-all scope still swallows keys.
      }
    });
  }

  handleImageZoomKey(event) {
    if (this.imageZoomClosed || !this.armed) {
      return;
    }
    const mapped = imageZoomKeyAction(event);
    if (mapped.action === "close") {
      if (event && event.repeat) {
        return;
      }
      this.close();
      return;
    }
    if (!this.natural || mapped.action === "ignore") {
      return;
    }
    if (mapped.action === "zoomIn" || mapped.action === "zoomOut") {
      this.zoomImageZoom(
        mapped.action === "zoomIn" ? IMAGE_ZOOM_STEP : 1 / IMAGE_ZOOM_STEP,
      );
      return;
    }
    if (mapped.action === "fit") {
      this.fitImageZoom();
      return;
    }
    if (mapped.action === "actual") {
      this.actualImageZoom();
      return;
    }
    if (mapped.action === "pan") {
      this.panImageZoom(mapped.dir, mapped.large);
    }
  }

  handleImageZoomLoad() {
    if (this.imageZoomClosed || !this.imgEl) {
      return;
    }
    let width = Number(this.imgEl.naturalWidth);
    let height = Number(this.imgEl.naturalHeight);
    this.viewportSize = measureImageZoomViewport(
      this.viewportEl,
      this.getImageZoomWindow(),
    );
    if (!(width > 0) || !(height > 0)) {
      width = Math.max(1, this.viewportSize.width - 2 * IMAGE_ZOOM_PADDING);
      height = Math.max(1, this.viewportSize.height - 2 * IMAGE_ZOOM_PADDING);
    }
    this.natural = Object.freeze({ width, height });
    this.fitMode = true;
    this.refitImageZoom();
  }

  handleImageZoomError() {
    if (this.imageZoomClosed) {
      return;
    }
    try {
      new Notice(`Could not load image: ${this.imageTitle}`);
    } catch (_error) {
      // Notices are best effort.
    }
    this.close();
  }

  handleImageZoomWheel(event) {
    if (this.imageZoomClosed || !this.natural) {
      return;
    }
    try {
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
    } catch (_error) {
      // Some harness events are not cancelable.
    }
    this.zoomImageZoom(
      imageZoomWheelFactor(event),
      imageZoomPointFromEvent(event, this.viewportEl),
    );
  }

  handleImageZoomPointerDown(event) {
    if (this.imageZoomClosed || !this.natural || !this.isImageZoomPannable()) {
      return;
    }
    this.drag = {
      pointerId: event && event.pointerId,
      lastX: Number(event && event.clientX) || 0,
      lastY: Number(event && event.clientY) || 0,
      startX: Number(event && event.clientX) || 0,
      startY: Number(event && event.clientY) || 0,
      dragging: false,
    };
    try {
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
    } catch (_error) {
      // Best effort.
    }
    try {
      if (this.viewportEl && typeof this.viewportEl.setPointerCapture === "function") {
        this.viewportEl.setPointerCapture(event.pointerId);
      }
    } catch (_error) {
      // Pointer capture is optional in the Node harness.
    }
  }

  handleImageZoomPointerMove(event) {
    if (!this.drag || (event && event.pointerId !== this.drag.pointerId)) {
      return;
    }
    const x = Number(event && event.clientX) || 0;
    const y = Number(event && event.clientY) || 0;
    const traveled = Math.hypot(x - this.drag.startX, y - this.drag.startY);
    if (!this.drag.dragging && traveled < IMAGE_ZOOM_DRAG_THRESHOLD_PX) {
      return;
    }
    const dx = x - this.drag.lastX;
    const dy = y - this.drag.lastY;
    this.drag.lastX = x;
    this.drag.lastY = y;
    this.drag.dragging = true;
    this.suppressClick = true;
    this.fitMode = false;
    addImageZoomClass(this.viewportEl, "is-dragging");
    this.state = clampImageZoomPan(
      { scale: this.state.scale, x: this.state.x + dx, y: this.state.y + dy },
      this.natural,
      this.viewportSize,
    );
    this.renderImageZoom();
  }

  handleImageZoomPointerUp(event) {
    if (!this.drag || (event && event.pointerId !== this.drag.pointerId)) {
      return;
    }
    if (this.drag.dragging) {
      this.suppressClick = true;
    }
    try {
      if (
        this.viewportEl &&
        typeof this.viewportEl.releasePointerCapture === "function"
      ) {
        this.viewportEl.releasePointerCapture(this.drag.pointerId);
      }
    } catch (_error) {
      // Optional.
    }
    this.drag = null;
    if (this.viewportEl && this.viewportEl.classList) {
      this.viewportEl.classList.remove("is-dragging");
    }
  }

  handleImageZoomClick(event) {
    if (this.imageZoomClosed) {
      return;
    }
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    if (imageZoomEventHitsEl(event, this.imgEl)) {
      return;
    }
    this.close();
  }

  handleImageZoomDblClick(event) {
    if (this.imageZoomClosed || !this.natural) {
      return;
    }
    const point = imageZoomPointFromEvent(event, this.viewportEl);
    if (this.fitMode) {
      this.actualImageZoom(point);
      return;
    }
    this.fitImageZoom();
  }

  handleImageZoomResize() {
    if (this.imageZoomClosed || !this.natural) {
      return;
    }
    this.refitImageZoom();
  }

  isImageZoomPannable() {
    if (!this.natural || !this.viewportSize) {
      return false;
    }
    return (
      this.natural.width * this.state.scale > this.viewportSize.width ||
      this.natural.height * this.state.scale > this.viewportSize.height
    );
  }

  zoomImageZoom(factor, point) {
    if (!this.natural) {
      return;
    }
    const bounds = computeImageZoomBounds(this.fitScale, this.oneToOne);
    this.fitMode = false;
    this.state = clampImageZoomPan(
      zoomImageZoomState(this.state, factor, point, bounds),
      this.natural,
      this.viewportSize,
    );
    this.renderImageZoom();
  }

  fitImageZoom() {
    this.fitMode = true;
    this.refitImageZoom();
  }

  actualImageZoom(point) {
    if (!this.natural) {
      return;
    }
    const bounds = computeImageZoomBounds(this.fitScale, this.oneToOne);
    const factor = this.state.scale > 0 ? this.oneToOne / this.state.scale : 1;
    this.fitMode = false;
    this.state = clampImageZoomPan(
      zoomImageZoomState(this.state, factor, point, bounds),
      this.natural,
      this.viewportSize,
    );
    this.renderImageZoom();
  }

  panImageZoom(dir, large) {
    if (!this.natural || !this.viewportSize) {
      return;
    }
    const axisSize = dir === "left" || dir === "right"
      ? this.viewportSize.width
      : this.viewportSize.height;
    const delta = (large ? 3 : 1) * IMAGE_ZOOM_PAN_FRACTION * axisSize;
    let { x, y } = this.state;
    if (dir === "left") {
      x += delta;
    } else if (dir === "right") {
      x -= delta;
    } else if (dir === "up") {
      y += delta;
    } else if (dir === "down") {
      y -= delta;
    }
    this.fitMode = false;
    this.state = clampImageZoomPan(
      { scale: this.state.scale, x, y },
      this.natural,
      this.viewportSize,
    );
    this.renderImageZoom();
  }

  refitImageZoom() {
    if (!this.natural) {
      return;
    }
    this.viewportSize = measureImageZoomViewport(
      this.viewportEl,
      this.getImageZoomWindow(),
    );
    this.oneToOne = 1 / getImageZoomDevicePixelRatio(this.getImageZoomWindow());
    this.fitScale = computeImageZoomFitScale(
      this.natural,
      this.viewportSize,
      IMAGE_ZOOM_PADDING,
    );
    if (this.fitMode) {
      this.state = Object.freeze({ scale: this.fitScale, x: 0, y: 0 });
    } else {
      const bounds = computeImageZoomBounds(this.fitScale, this.oneToOne);
      this.state = clampImageZoomPan(
        {
          scale: clampNumber(this.state.scale, bounds.min, bounds.max),
          x: this.state.x,
          y: this.state.y,
        },
        this.natural,
        this.viewportSize,
      );
    }
    this.renderImageZoom();
  }

  renderImageZoom() {
    if (this.readoutEl && typeof this.readoutEl.setText === "function") {
      if (!this.natural) {
        this.readoutEl.setText("Loading…");
      } else {
        const dpr = getImageZoomDevicePixelRatio(this.getImageZoomWindow());
        this.readoutEl.setText(`${Math.round(this.state.scale * dpr * 100)}%`);
      }
    }
    if (!this.imgEl || !this.natural) {
      return;
    }
    const width = this.natural.width * this.state.scale;
    const height = this.natural.height * this.state.scale;
    this.imgEl.style.width = `${width}px`;
    this.imgEl.style.height = `${height}px`;
    this.imgEl.style.left = "50%";
    this.imgEl.style.top = "50%";
    this.imgEl.style.transform =
      `translate(-50%, -50%) translate(${this.state.x}px, ${this.state.y}px)`;
    if (this.viewportEl && this.viewportEl.classList) {
      this.viewportEl.classList.toggle("is-pannable", this.isImageZoomPannable());
    }
  }

  onClose() {
    const alreadyClosed = this.imageZoomClosed;
    this.imageZoomClosed = true;
    this.armed = false;
    this.drag = null;
    try {
      if (this.abortController && typeof this.abortController.abort === "function") {
        this.abortController.abort();
      }
    } catch (_error) {
      // Best effort.
    }
    try {
      if (
        this.scopeHandler &&
        this.scope &&
        typeof this.scope.unregister === "function"
      ) {
        this.scope.unregister(this.scopeHandler);
      }
    } catch (_error) {
      // Best effort.
    }
    this.scopeHandler = null;
    try {
      if (this.imgEl && typeof this.imgEl.removeAttribute === "function") {
        this.imgEl.removeAttribute("src");
      }
    } catch (_error) {
      // Cancelling a pending load is best effort.
    }
    contentElCleanup(this.contentEl);
    if (alreadyClosed) {
      return;
    }
    const callback = this.onClosed;
    this.onClosed = null;
    if (typeof callback === "function") {
      try {
        callback();
      } catch (_error) {
        // onClosed is a restore hook; never throw out of close.
      }
    }
  }
}
