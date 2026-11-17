class VideoZoomModal extends ImageZoomModal {
  constructor(app, options = {}) {
    super(app, options);
    this.videoZoomReady = false;
    this.videoZoomFailed = false;
    this.videoZoomHasAudio = false;
    this.videoZoomAudioOnly = false;
    this.videoZoomZoomDisabled = false;
    this.videoZoomHint = "";
    this.videoZoomHasPlayed = false;
    this.videoZoomPlayToken = 0;
    this.videoZoomRafId = null;
    this.videoZoomFrameCallbackId = null;
    this.videoZoomPlaceholderEl = null;
    this.videoZoomFailureEl = null;
  }

  decorateImageZoomChrome() {
    addImageZoomClass(this.containerEl, "bob-video-zoom-container");
    addImageZoomClass(this.modalEl, "bob-video-zoom-modal");
    addImageZoomClass(this.contentEl, "bob-video-zoom");
  }

  createImageZoomMediaEl() {
    this.imgEl = this.viewportEl.createEl("video", {
      cls: "bob-image-zoom-img bob-video-zoom-video",
      attr: {
        preload: "auto",
        playsinline: "",
        disablepictureinpicture: "",
        disableremoteplayback: "",
      },
    });
    this.mediaEl = this.imgEl;
    try {
      this.imgEl.playsInline = true;
      this.imgEl.disablePictureInPicture = true;
      this.imgEl.controls = false;
    } catch (_error) {
      // Boolean properties are optional in the Node harness.
    }
    this.videoZoomPlaceholderEl = this.viewportEl.createDiv({
      cls: "bob-video-zoom-placeholder",
    });
    this.videoZoomPlaceholderEl.setText("♪ Audio only");
    this.videoZoomPlaceholderEl.classList.toggle("is-visible", false);
  }

  bindImageZoomMediaEvents(signalOpts) {
    listenImageZoom(
      this.imgEl,
      "loadedmetadata",
      () => this.handleVideoZoomMetadata(),
      signalOpts,
    );
    listenImageZoom(
      this.imgEl,
      "loadeddata",
      () => this.handleVideoZoomLoadedData(),
      signalOpts,
    );
    listenImageZoom(this.imgEl, "error", () => this.handleImageZoomError(), signalOpts);
    listenImageZoom(this.imgEl, "play", () => this.handleVideoZoomPlayEvent(), signalOpts);
    listenImageZoom(this.imgEl, "pause", () => this.handleVideoZoomPauseEvent(), signalOpts);
    listenImageZoom(
      this.imgEl,
      "timeupdate",
      () => this.updateVideoZoomReadout(),
      signalOpts,
    );
  }

  startImageZoomMediaLoad() {
    if (!this.imgEl) {
      return;
    }
    this.imgEl.setAttribute("src", this.imageSrc);
    try {
      this.imgEl.src = this.imageSrc;
    } catch (_error) {
      // Property assignment is optional in the Node harness.
    }
  }

  mapImageZoomKey(event) {
    return videoZoomKeyAction(event);
  }

  handleImageZoomMappedKey(mapped, event) {
    if (mapped.action === "togglePlay") {
      this.preventVideoZoomDefault(event);
      this.toggleVideoZoomPlayback();
      return true;
    }
    if (mapped.action === "seek") {
      this.preventVideoZoomDefault(event);
      this.seekVideoZoom(mapped.delta);
      return true;
    }
    if (mapped.action === "openExternal") {
      this.openVideoZoomExternal();
      return true;
    }
    if (this.handleVideoZoomTransportMappedKey(mapped, event)) {
      return true;
    }
    if (this.videoZoomFailed || this.videoZoomZoomDisabled) {
      if (
        mapped.action === "zoomIn" ||
        mapped.action === "zoomOut" ||
        mapped.action === "fit" ||
        mapped.action === "actual" ||
        mapped.action === "pan"
      ) {
        return true;
      }
    }
    return false;
  }

  preventVideoZoomDefault(event) {
    try {
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
    } catch (_error) {
      // Some harness events are not cancelable.
    }
  }

  addImageZoomPrimaryFooterChips(addChip) {
    if (this.videoZoomFailed) {
      addChip("o", "open in default app");
      addChip("y", "copy path");
      addChip("Esc", "close");
      return;
    }
    const chips = videoZoomFooterChipPlan({
      hasAudio: this.videoZoomHasAudio === true,
      compact: this.videoZoomFooterCompact === true,
    });
    for (const [key, label] of chips) {
      addChip(key, label);
    }
  }

  collectImageZoomTrailingFooterChips(addChip) {
    if (this.videoZoomFailed) {
      return;
    }
    addChip("o", "open");
  }

  renderImageZoomFooter() {
    if (this.videoZoomFailed) {
      const footer = this.imageZoomFooterEl;
      if (!footer) {
        return;
      }
      footer.empty();
      const addChip = (key, label) => {
        const item = footer.createSpan({ cls: "bob-image-zoom-chip" });
        item.createEl("kbd", { text: key });
        item.createSpan({ cls: "bob-image-zoom-chip-label", text: label });
      };
      this.addImageZoomPrimaryFooterChips(addChip);
      this.ensureVideoZoomScrubber();
      return;
    }
    super.renderImageZoomFooter();
    this.ensureVideoZoomScrubber();
  }

  imageZoomReadoutText() {
    if (this.videoZoomFailed) {
      return "";
    }
    if (!this.videoZoomReady) {
      return "Loading…";
    }
    return videoZoomReadout(this.videoZoomReadoutState());
  }

  videoZoomReadoutState() {
    const video = this.imgEl;
    const dpr = getImageZoomDevicePixelRatio(this.getImageZoomWindow());
    const zoomPercent = this.fitMode
      ? ""
      : `${Math.round((this.state.scale || 1) * dpr * 100)}%`;
    return {
      playing: Boolean(video && video.paused === false),
      currentTime: video ? Number(video.currentTime) : 0,
      duration: video ? Number(video.duration) : 0,
      zoomPercent,
      speed: Number(this.videoZoomSpeed) || VIDEO_ZOOM_DEFAULT_SPEED,
      muted: Boolean(this.videoZoomHasAudio && video && video.muted === true),
      hint: this.videoZoomHasPlayed ? "" : this.videoZoomHint,
    };
  }

  updateVideoZoomReadout() {
    if (this.imageZoomClosed) {
      return;
    }
    if (this.readoutEl && typeof this.readoutEl.setText === "function") {
      this.readoutEl.setText(this.imageZoomReadoutText());
    }
    this.updateVideoZoomScrubber();
  }

  prefersVideoZoomReducedMotion() {
    const win = this.getImageZoomWindow();
    try {
      const media = win && typeof win.matchMedia === "function"
        ? win.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
      return Boolean(media && media.matches);
    } catch (_error) {
      return false;
    }
  }

  handleVideoZoomMetadata() {
    if (this.imageZoomClosed || !this.imgEl) {
      return;
    }
    const width = Number(this.imgEl.videoWidth);
    const height = Number(this.imgEl.videoHeight);
    this.viewportSize = measureImageZoomViewport(
      this.viewportEl,
      this.getImageZoomWindow(),
    );
    if (!(width > 0) || !(height > 0)) {
      this.videoZoomAudioOnly = true;
      this.videoZoomZoomDisabled = true;
      this.natural = Object.freeze({ width: 1, height: 1 });
      if (this.videoZoomPlaceholderEl && this.videoZoomPlaceholderEl.classList) {
        this.videoZoomPlaceholderEl.classList.toggle("is-visible", true);
      }
      this.fitMode = true;
      this.refitImageZoom();
      return;
    }
    this.videoZoomAudioOnly = false;
    this.videoZoomZoomDisabled = false;
    this.natural = Object.freeze({ width, height });
    this.fitMode = true;
    this.refitImageZoom();
  }

  handleVideoZoomLoadedData() {
    if (this.imageZoomClosed || !this.imgEl) {
      return;
    }
    this.videoZoomReady = true;
    const audioBytes = this.imgEl.webkitAudioDecodedByteCount;
    this.videoZoomHasAudio = !(
      typeof audioBytes === "number" && Number.isFinite(audioBytes) && audioBytes === 0
    );
    const policy = videoZoomStartPolicy({
      audioBytes,
      reducedMotion: this.prefersVideoZoomReducedMotion(),
    });
    try {
      this.imgEl.loop = policy.loop === true;
    } catch (_error) {
      // loop is optional in the harness.
    }
    this.videoZoomHint = policy.hint || "";
    this.videoZoomHasPlayed = false;
    this.updateVideoZoomReadout();
    this.renderImageZoomFooter();
    this.maybeCompactVideoZoomFooter();
    if (policy.autoplay) {
      this.playVideoZoom();
    } else {
      this.showVideoZoomRestingFlash();
    }
  }

  handleImageZoomError() {
    if (this.imageZoomClosed) {
      return;
    }
    const code = this.imgEl && this.imgEl.error ? this.imgEl.error.code : undefined;
    this.showVideoZoomFailure(code);
  }

  handleImageZoomMediaClick(_event) {
    this.toggleVideoZoomPlayback();
  }

  handleImageZoomWheel(event) {
    if (this.videoZoomFailed || this.videoZoomZoomDisabled) {
      return;
    }
    super.handleImageZoomWheel(event);
  }

  handleImageZoomDblClick(event) {
    if (this.videoZoomFailed || this.videoZoomZoomDisabled) {
      return;
    }
    super.handleImageZoomDblClick(event);
  }

  handleImageZoomPointerDown(event) {
    if (this.videoZoomFailed || this.videoZoomZoomDisabled) {
      return;
    }
    super.handleImageZoomPointerDown(event);
  }

  isImageZoomPannable() {
    if (this.videoZoomFailed || this.videoZoomZoomDisabled) {
      return false;
    }
    return super.isImageZoomPannable();
  }

  zoomImageZoom(factor, point) {
    if (this.videoZoomFailed || this.videoZoomZoomDisabled) {
      return;
    }
    super.zoomImageZoom(factor, point);
  }

  actualImageZoom(point) {
    if (this.videoZoomFailed || this.videoZoomZoomDisabled) {
      return;
    }
    super.actualImageZoom(point);
  }

  panImageZoom(dir, large) {
    if (this.videoZoomFailed || this.videoZoomZoomDisabled) {
      return;
    }
    super.panImageZoom(dir, large);
  }

  renderImageZoom() {
    if (this.videoZoomAudioOnly && this.imgEl && this.imgEl.style) {
      this.imgEl.style.visibility = "hidden";
    }
    super.renderImageZoom();
    this.updateVideoZoomReadout();
  }

  toggleVideoZoomPlayback() {
    if (this.imageZoomClosed || this.videoZoomFailed || !this.imgEl) {
      return;
    }
    if (this.imgEl.paused === false) {
      this.pauseVideoZoom();
      this.showVideoZoomFlash(VIDEO_ZOOM_PAUSE_GLYPH);
      return;
    }
    this.playVideoZoom();
    this.showVideoZoomFlash(VIDEO_ZOOM_PLAY_GLYPH);
  }

  pauseVideoZoom() {
    this.videoZoomPlayToken += 1;
    try {
      if (this.imgEl && typeof this.imgEl.pause === "function") {
        this.imgEl.pause();
      }
    } catch (_error) {
      // Pause is best effort.
    }
    this.cancelVideoZoomRaf();
    this.cancelVideoZoomFrameCallbacks();
    this.updateVideoZoomReadout();
  }

  playVideoZoom() {
    if (this.imageZoomClosed || this.videoZoomFailed || !this.imgEl) {
      return;
    }
    this.videoZoomPlayToken += 1;
    const token = this.videoZoomPlayToken;
    let result;
    try {
      result = typeof this.imgEl.play === "function" ? this.imgEl.play() : null;
    } catch (error) {
      this.handleVideoZoomPlayError(error);
      return;
    }
    if (result && typeof result.then === "function") {
      Promise.resolve(result).then(
        () => {
          if (this.imageZoomClosed || token !== this.videoZoomPlayToken) {
            return;
          }
          if (this.imgEl && this.imgEl.paused) {
            return;
          }
          this.videoZoomHasPlayed = true;
          this.videoZoomHint = "";
          this.clearVideoZoomRestingFlash();
          this.startVideoZoomRaf();
          this.updateVideoZoomReadout();
        },
        (error) => {
          if (this.imageZoomClosed || token !== this.videoZoomPlayToken) {
            return;
          }
          this.handleVideoZoomPlayError(error);
        },
      );
    }
  }

  handleVideoZoomPlayError(error) {
    const name = error && error.name;
    if (name === "NotSupportedError") {
      this.showVideoZoomFailure(4);
      return;
    }
    try {
      if (this.imgEl && typeof this.imgEl.pause === "function") {
        this.imgEl.pause();
      }
    } catch (_error) {
      // Stay in the paused visual state.
    }
    this.cancelVideoZoomRaf();
    this.updateVideoZoomReadout();
  }

  handleVideoZoomPlayEvent() {
    if (this.imageZoomClosed || this.videoZoomFailed) {
      return;
    }
    this.videoZoomHasPlayed = true;
    this.videoZoomHint = "";
    this.clearVideoZoomRestingFlash();
    this.startVideoZoomRaf();
    this.updateVideoZoomReadout();
  }

  handleVideoZoomPauseEvent() {
    if (this.imageZoomClosed) {
      return;
    }
    this.cancelVideoZoomRaf();
    this.updateVideoZoomReadout();
  }

  startVideoZoomRaf() {
    this.cancelVideoZoomRaf();
    this.startVideoZoomFrameSampling();
    const win = this.getImageZoomWindow();
    const raf = win && win.requestAnimationFrame;
    if (typeof raf !== "function") {
      this.updateVideoZoomReadout();
      return;
    }
    const tick = () => {
      if (this.imageZoomClosed || !this.imgEl || this.imgEl.paused !== false) {
        this.videoZoomRafId = null;
        return;
      }
      this.updateVideoZoomReadout();
      this.videoZoomRafId = raf.call(win, tick);
    };
    this.videoZoomRafId = raf.call(win, tick);
  }

  cancelVideoZoomRaf() {
    if (this.videoZoomRafId == null) {
      return;
    }
    const win = this.getImageZoomWindow();
    try {
      if (win && typeof win.cancelAnimationFrame === "function") {
        win.cancelAnimationFrame(this.videoZoomRafId);
      }
    } catch (_error) {
      // Best effort.
    }
    this.videoZoomRafId = null;
  }

  cancelVideoZoomFrameCallbacks() {
    const win = this.getImageZoomWindow();
    const video = this.imgEl;
    try {
      if (
        this.videoZoomFrameCallbackId != null &&
        video &&
        typeof video.cancelVideoFrameCallback === "function"
      ) {
        video.cancelVideoFrameCallback(this.videoZoomFrameCallbackId);
      } else if (
        this.videoZoomFrameCallbackId != null &&
        win &&
        typeof win.cancelVideoFrameCallback === "function"
      ) {
        win.cancelVideoFrameCallback(this.videoZoomFrameCallbackId);
      }
    } catch (_error) {
      // Best effort.
    }
    this.videoZoomFrameCallbackId = null;
  }

  seekVideoZoom(delta) {
    if (this.imageZoomClosed || this.videoZoomFailed || !this.imgEl) {
      return;
    }
    const next = clampVideoZoomSeek(
      this.imgEl.currentTime,
      delta,
      this.imgEl.duration,
    );
    try {
      this.imgEl.currentTime = next;
    } catch (_error) {
      // Seeking is best effort in the harness.
    }
    this.updateVideoZoomReadout();
  }

  openVideoZoomExternal() {
    if (this.imageZoomClosed) {
      return;
    }
    this.pauseVideoZoom();
    const context = this.imageZoomContext || {};
    const vaultPath = String(context.vaultPath || "");
    const opener = this.app && this.app.openWithDefaultApp;
    if (!vaultPath || typeof opener !== "function") {
      this.showImageZoomToast("! Can't open outside Obsidian here", { error: true });
      return;
    }
    try {
      opener.call(this.app, vaultPath);
      if (this.imageZoomClosed) {
        return;
      }
      this.showImageZoomToast("✓ Opened in default app");
    } catch (_error) {
      if (this.imageZoomClosed) {
        return;
      }
      this.showImageZoomToast("! Can't open outside Obsidian here", { error: true });
    }
  }

  showVideoZoomFailure(code) {
    if (this.imageZoomClosed) {
      return;
    }
    this.videoZoomFailed = true;
    this.videoZoomPlayToken += 1;
    this.cancelVideoZoomRaf();
    try {
      if (this.imgEl && typeof this.imgEl.pause === "function") {
        this.imgEl.pause();
      }
    } catch (_error) {
      // Best effort.
    }
    const copy = videoZoomFailureCopy(code, this.imageTitle);
    this.renderVideoZoomFailureCard(copy);
    this.updateVideoZoomReadout();
    this.renderImageZoomFooter();
    this.hideVideoZoomTransportOnFailure();
  }

  renderVideoZoomFailureCard(copy) {
    if (!this.viewportEl) {
      return;
    }
    if (this.videoZoomFailureEl && typeof this.videoZoomFailureEl.empty === "function") {
      this.videoZoomFailureEl.empty();
    } else {
      this.videoZoomFailureEl = this.viewportEl.createDiv({
        cls: "bob-video-zoom-failure",
      });
    }
    this.videoZoomFailureEl.createDiv({
      cls: "bob-video-zoom-failure-title",
      text: copy.title,
    });
    this.videoZoomFailureEl.createDiv({
      cls: "bob-video-zoom-failure-reason",
      text: copy.reason,
    });
    this.videoZoomFailureEl.classList.toggle("is-visible", true);
    if (this.imgEl && this.imgEl.style) {
      this.imgEl.style.visibility = "hidden";
    }
    if (this.videoZoomPlaceholderEl && this.videoZoomPlaceholderEl.classList) {
      this.videoZoomPlaceholderEl.classList.toggle("is-visible", false);
    }
  }

  releaseImageZoomMedia() {
    this.videoZoomPlayToken += 1;
    this.cancelVideoZoomRaf();
    this.cancelVideoZoomFrameCallbacks();
    this.releaseVideoZoomTransport();
    const video = this.imgEl;
    if (!video) {
      return;
    }
    try {
      if (typeof video.pause === "function") {
        video.pause();
      }
    } catch (_error) {
      // Best effort.
    }
    try {
      if (typeof video.removeAttribute === "function") {
        video.removeAttribute("src");
      }
    } catch (_error) {
      // Best effort.
    }
    try {
      video.src = "";
    } catch (_error) {
      // Best effort.
    }
    try {
      if (typeof video.load === "function") {
        video.load();
      }
    } catch (_error) {
      // Releasing the decoder is best effort.
    }
  }
}
