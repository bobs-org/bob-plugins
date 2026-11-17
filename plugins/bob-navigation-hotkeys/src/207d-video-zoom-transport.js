const VIDEO_ZOOM_SPEEDS = Object.freeze([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]);
const VIDEO_ZOOM_DEFAULT_SPEED = 1;
const VIDEO_ZOOM_FALLBACK_FRAME_DURATION = 1 / 30;
const VIDEO_ZOOM_MAX_FRAME_SAMPLES = 12;
const VIDEO_ZOOM_FLASH_MS = 350;

function videoZoomStepSpeed(current, direction) {
  const value = Number(current);
  const target = Number.isFinite(value) ? value : VIDEO_ZOOM_DEFAULT_SPEED;
  let best = VIDEO_ZOOM_SPEEDS.indexOf(VIDEO_ZOOM_DEFAULT_SPEED);
  let bestDist = Number.POSITIVE_INFINITY;
  for (let index = 0; index < VIDEO_ZOOM_SPEEDS.length; index += 1) {
    const dist = Math.abs(VIDEO_ZOOM_SPEEDS[index] - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = index;
    }
  }
  const next = clampNumber(
    best + (direction >= 0 ? 1 : -1),
    0,
    VIDEO_ZOOM_SPEEDS.length - 1,
  );
  return VIDEO_ZOOM_SPEEDS[next];
}

function videoZoomLearnFrameDuration(samples) {
  const times = (Array.isArray(samples) ? samples : [])
    .map(Number)
    .filter((value) => Number.isFinite(value));
  const deltas = [];
  for (let index = 1; index < times.length; index += 1) {
    const delta = times[index] - times[index - 1];
    if (delta > 0 && Number.isFinite(delta)) {
      deltas.push(delta);
    }
  }
  if (!deltas.length) {
    return VIDEO_ZOOM_FALLBACK_FRAME_DURATION;
  }
  deltas.sort((a, b) => a - b);
  const mid = Math.floor(deltas.length / 2);
  const median = deltas.length % 2 === 1
    ? deltas[mid]
    : (deltas[mid - 1] + deltas[mid]) / 2;
  if (!(median >= 1 / 240) || !(median <= 1)) {
    return VIDEO_ZOOM_FALLBACK_FRAME_DURATION;
  }
  return median;
}

function videoZoomFrameDurationOrFallback(frameDuration) {
  const fd = Number(frameDuration);
  if (Number.isFinite(fd) && fd > 0) {
    return fd;
  }
  return VIDEO_ZOOM_FALLBACK_FRAME_DURATION;
}

function videoZoomFrameStepTarget(currentTime, direction, frameDuration, duration) {
  const fd = videoZoomFrameDurationOrFallback(frameDuration);
  const now = Number(currentTime);
  const start = Number.isFinite(now) ? now : 0;
  const step = direction >= 0 ? 1 : -1;
  const target = (Math.floor(start / fd) + step + 0.5) * fd;
  const length = Number(duration);
  const max = Number.isFinite(length) && length > 0
    ? length
    : Number.POSITIVE_INFINITY;
  return clampNumber(target, 0, max);
}

function videoZoomJumpTarget(which, frameDuration, duration) {
  const fd = videoZoomFrameDurationOrFallback(frameDuration);
  const length = Number(duration);
  const max = Number.isFinite(length) && length > 0
    ? length
    : Number.POSITIVE_INFINITY;
  if (which === "end") {
    if (!Number.isFinite(max)) {
      return Number.POSITIVE_INFINITY;
    }
    return clampNumber(max - fd / 2, 0, max);
  }
  return clampNumber(fd / 2, 0, max);
}

function videoZoomEscapeAction(options) {
  const active = Boolean(options && options.fullscreenActive);
  return Object.freeze({ action: active ? "exitFullscreen" : "close" });
}

function videoZoomFooterChipPlan(options) {
  const settings = options && typeof options === "object" ? options : {};
  const compact = settings.compact === true;
  const hasAudio = settings.hasAudio === true;
  const chips = [
    ["Esc", "close"],
    ["Space", "play"],
    ["← →", "seek"],
    [", .", "frame"],
    ["[ ]", "speed"],
  ];
  if (hasAudio) {
    chips.push(["m", "mute"]);
  }
  if (!compact) {
    chips.push(["+ −", "zoom"], ["0", "fit"], ["1", "1:1"]);
  }
  return Object.freeze(chips.map((chip) => Object.freeze(chip.slice())));
}

VideoZoomModal.prototype.handleImageZoomKey = function handleVideoZoomKeyWithFullscreen(event) {
  if (this.imageZoomClosed || !this.armed) {
    return;
  }
  const key = event && event.key;
  if ((key === "Escape" || key === "Esc") && event && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (this.isVideoZoomFullscreen()) {
      this.preventVideoZoomDefault(event);
      this.exitVideoZoomFullscreen();
      return;
    }
  }
  return ImageZoomModal.prototype.handleImageZoomKey.call(this, event);
};

VideoZoomModal.prototype.handleImageZoomResize = function handleVideoZoomResizeForTransport(event) {
  ImageZoomModal.prototype.handleImageZoomResize.call(this, event);
  this.maybeCompactVideoZoomFooter();
};

VideoZoomModal.prototype.handleVideoZoomTransportMappedKey = function handleVideoZoomTransportMappedKey(mapped, event) {
  const action = mapped && mapped.action;
  if (action === "toggleFullscreen") {
    this.preventVideoZoomDefault(event);
    this.toggleVideoZoomFullscreen();
    return true;
  }
  if (
    action === "frameStep" ||
    action === "speedStep" ||
    action === "jumpStart" ||
    action === "jumpEnd" ||
    action === "toggleMute"
  ) {
    if (this.videoZoomFailed) {
      return true;
    }
    this.preventVideoZoomDefault(event);
    if (action === "frameStep") {
      this.stepVideoZoomFrame(mapped.delta);
    } else if (action === "speedStep") {
      this.stepVideoZoomSpeed(mapped.delta);
    } else if (action === "jumpStart") {
      this.jumpVideoZoomToStart();
    } else if (action === "jumpEnd") {
      this.jumpVideoZoomToEnd();
    } else {
      this.toggleVideoZoomMute();
    }
    return true;
  }
  return false;
};

VideoZoomModal.prototype.videoZoomFrameDuration = function videoZoomFrameDuration() {
  const learned = Number(this.videoZoomLearnedFrameDuration);
  if (Number.isFinite(learned) && learned > 0) {
    return learned;
  }
  return VIDEO_ZOOM_FALLBACK_FRAME_DURATION;
};

VideoZoomModal.prototype.stepVideoZoomFrame = function stepVideoZoomFrame(direction) {
  if (this.imageZoomClosed || this.videoZoomFailed || !this.imgEl) {
    return;
  }
  this.pauseVideoZoom();
  this.seekVideoZoomTo(
    videoZoomFrameStepTarget(
      this.imgEl.currentTime,
      direction,
      this.videoZoomFrameDuration(),
      this.imgEl.duration,
    ),
  );
};

VideoZoomModal.prototype.seekVideoZoomTo = function seekVideoZoomTo(time) {
  if (this.imageZoomClosed || this.videoZoomFailed || !this.imgEl) {
    return;
  }
  const duration = Number(this.imgEl.duration);
  const max = Number.isFinite(duration) && duration > 0
    ? duration
    : Number.POSITIVE_INFINITY;
  const next = clampNumber(Number(time), 0, max);
  if (!Number.isFinite(next)) {
    return;
  }
  try {
    this.imgEl.currentTime = next;
  } catch (_error) {
    // Seeking is best effort in the harness.
  }
  this.updateVideoZoomReadout();
};

VideoZoomModal.prototype.stepVideoZoomSpeed = function stepVideoZoomSpeed(direction) {
  if (this.imageZoomClosed || this.videoZoomFailed || !this.imgEl) {
    return;
  }
  const next = videoZoomStepSpeed(
    this.videoZoomSpeed == null ? VIDEO_ZOOM_DEFAULT_SPEED : this.videoZoomSpeed,
    direction,
  );
  this.videoZoomSpeed = next;
  try {
    this.imgEl.playbackRate = next;
  } catch (_error) {
    // playbackRate is a plain field in the harness.
  }
  this.updateVideoZoomReadout();
};

VideoZoomModal.prototype.jumpVideoZoomToStart = function jumpVideoZoomToStart() {
  if (this.imageZoomClosed || this.videoZoomFailed || !this.imgEl) {
    return;
  }
  this.seekVideoZoomTo(
    videoZoomJumpTarget("start", this.videoZoomFrameDuration(), this.imgEl.duration),
  );
};

VideoZoomModal.prototype.jumpVideoZoomToEnd = function jumpVideoZoomToEnd() {
  if (this.imageZoomClosed || this.videoZoomFailed || !this.imgEl) {
    return;
  }
  this.pauseVideoZoom();
  const target = videoZoomJumpTarget("end", this.videoZoomFrameDuration(), this.imgEl.duration);
  if (!Number.isFinite(target)) {
    return;
  }
  this.seekVideoZoomTo(target);
};

VideoZoomModal.prototype.toggleVideoZoomMute = function toggleVideoZoomMute() {
  if (this.imageZoomClosed || this.videoZoomFailed || !this.imgEl) {
    return;
  }
  try {
    this.imgEl.muted = !this.imgEl.muted;
  } catch (_error) {
    // muted is a plain field in the harness.
  }
  this.updateVideoZoomReadout();
};

VideoZoomModal.prototype.getVideoZoomDocument = function getVideoZoomDocument() {
  try {
    const win = this.getImageZoomWindow();
    if (win && win.document) {
      return win.document;
    }
  } catch (_error) {
    // Fall through to the global document.
  }
  try {
    if (typeof document !== "undefined") {
      return document;
    }
  } catch (_error) {
    // No document in the harness.
  }
  return null;
};

VideoZoomModal.prototype.isVideoZoomFullscreen = function isVideoZoomFullscreen() {
  try {
    const doc = this.getVideoZoomDocument();
    return Boolean(doc && doc.fullscreenElement);
  } catch (_error) {
    return false;
  }
};

VideoZoomModal.prototype.toggleVideoZoomFullscreen = function toggleVideoZoomFullscreen() {
  if (this.imageZoomClosed) {
    return;
  }
  if (this.isVideoZoomFullscreen()) {
    this.exitVideoZoomFullscreen();
    return;
  }
  try {
    const el = this.modalEl;
    if (el && typeof el.requestFullscreen === "function") {
      const result = el.requestFullscreen();
      if (result && typeof result.catch === "function") {
        result.catch(() => {});
      }
    }
  } catch (_error) {
    // Fullscreen is best effort.
  }
};

VideoZoomModal.prototype.exitVideoZoomFullscreen = function exitVideoZoomFullscreen() {
  try {
    const doc = this.getVideoZoomDocument();
    if (doc && doc.fullscreenElement && typeof doc.exitFullscreen === "function") {
      const result = doc.exitFullscreen();
      if (result && typeof result.catch === "function") {
        result.catch(() => {});
      }
    }
  } catch (_error) {
    // Fullscreen is best effort.
  }
};

VideoZoomModal.prototype.startVideoZoomFrameSampling = function startVideoZoomFrameSampling() {
  const video = this.imgEl;
  if (this.imageZoomClosed || !video) {
    return;
  }
  if (this.videoZoomFrameCallbackId != null) {
    return;
  }
  this.queueVideoZoomFrameSample();
};

VideoZoomModal.prototype.queueVideoZoomFrameSample = function queueVideoZoomFrameSample() {
  const video = this.imgEl;
  if (this.imageZoomClosed || !video) {
    return;
  }
  try {
    if (typeof video.requestVideoFrameCallback === "function") {
      this.videoZoomFrameCallbackId = video.requestVideoFrameCallback(
        (now, metadata) => this.handleVideoZoomFrameSample(now, metadata),
      );
    }
  } catch (_error) {
    this.videoZoomFrameCallbackId = null;
  }
};

VideoZoomModal.prototype.handleVideoZoomFrameSample = function handleVideoZoomFrameSample(_now, metadata) {
  this.videoZoomFrameCallbackId = null;
  if (this.imageZoomClosed || this.videoZoomFailed) {
    return;
  }
  const mediaTime = metadata ? Number(metadata.mediaTime) : Number.NaN;
  if (Number.isFinite(mediaTime) && mediaTime >= 0) {
    const samples = Array.isArray(this.videoZoomFrameSamples)
      ? this.videoZoomFrameSamples.slice()
      : [];
    samples.push(mediaTime);
    while (samples.length > VIDEO_ZOOM_MAX_FRAME_SAMPLES) {
      samples.shift();
    }
    this.videoZoomFrameSamples = samples;
    this.videoZoomLearnedFrameDuration = videoZoomLearnFrameDuration(samples);
  }
  const video = this.imgEl;
  const playing = Boolean(video && video.paused === false);
  const count = Array.isArray(this.videoZoomFrameSamples)
    ? this.videoZoomFrameSamples.length
    : 0;
  if (playing && count < VIDEO_ZOOM_MAX_FRAME_SAMPLES) {
    this.queueVideoZoomFrameSample();
  }
};

VideoZoomModal.prototype.ensureVideoZoomScrubber = function ensureVideoZoomScrubber() {
  const footer = this.imageZoomFooterEl;
  if (!footer || typeof footer.createDiv !== "function") {
    return;
  }
  const parentOf = (node) => {
    if (!node) {
      return null;
    }
    if (node.parentNode !== undefined) {
      return node.parentNode;
    }
    return node.parent || null;
  };
  let scrubber = this.videoZoomScrubberEl;
  if (!scrubber || parentOf(scrubber) !== footer) {
    scrubber = footer.createDiv({ cls: "bob-video-zoom-scrubber" });
    const buffered = scrubber.createDiv({ cls: "bob-video-zoom-scrubber-buffered" });
    const played = scrubber.createDiv({ cls: "bob-video-zoom-scrubber-played" });
    const bubble = scrubber.createDiv({ cls: "bob-video-zoom-scrubber-bubble" });
    try {
      bubble.setText("");
    } catch (_error) {
      // Text starts empty either way.
    }
    this.videoZoomScrubberEl = scrubber;
    this.videoZoomScrubberBufferedEl = buffered;
    this.videoZoomScrubberPlayedEl = played;
    this.videoZoomScrubberBubbleEl = bubble;
    this.videoZoomScrubSeeking = false;
    this.videoZoomScrubResume = false;
    const opts = this.imageZoomListenerOptions();
    listenImageZoom(scrubber, "pointerdown", (event) => this.handleVideoZoomScrubPointerDown(event), opts);
    listenImageZoom(scrubber, "pointermove", (event) => this.handleVideoZoomScrubPointerMove(event), opts);
    listenImageZoom(scrubber, "pointerup", (event) => this.handleVideoZoomScrubPointerUp(event), opts);
    listenImageZoom(scrubber, "pointercancel", (event) => this.handleVideoZoomScrubPointerUp(event), opts);
    listenImageZoom(scrubber, "pointerleave", () => this.handleVideoZoomScrubPointerLeave(), opts);
  }
  try {
    if (scrubber && parentOf(scrubber) === footer) {
      const first = footer.children && footer.children[0];
      if (first && first !== scrubber && typeof footer.insertBefore === "function") {
        footer.insertBefore(scrubber, first);
      }
    }
  } catch (_error) {
    // Order is best effort; the CSS keeps a trailing scrubber usable.
  }
  try {
    if (scrubber && scrubber.classList) {
      scrubber.classList.toggle("is-hidden", this.videoZoomFailed === true);
    }
  } catch (_error) {
    // Visibility is best effort.
  }
};

VideoZoomModal.prototype.updateVideoZoomScrubber = function updateVideoZoomScrubber() {
  const scrubber = this.videoZoomScrubberEl;
  const video = this.imgEl;
  if (!scrubber || !video) {
    return;
  }
  const duration = Number(video.duration);
  const current = Number(video.currentTime);
  const played = this.videoZoomScrubberPlayedEl;
  if (played && played.style) {
    const fraction = Number.isFinite(duration) && duration > 0 && Number.isFinite(current)
      ? clampNumber(current / duration, 0, 1)
      : 0;
    try {
      played.style.width = `${fraction * 100}%`;
    } catch (_error) {
      // Style is best effort in the harness.
    }
  }
  const bufferedEl = this.videoZoomScrubberBufferedEl;
  if (bufferedEl && bufferedEl.style) {
    let end = 0;
    try {
      const ranges = video.buffered;
      if (ranges && typeof ranges.length === "number" && ranges.length > 0 && typeof ranges.end === "function") {
        end = Number(ranges.end(ranges.length - 1));
      }
    } catch (_error) {
      end = 0;
    }
    const fraction = Number.isFinite(duration) && duration > 0 && Number.isFinite(end)
      ? clampNumber(end / duration, 0, 1)
      : 0;
    try {
      bufferedEl.style.width = `${fraction * 100}%`;
    } catch (_error) {
      // Style is best effort in the harness.
    }
  }
};

VideoZoomModal.prototype.videoZoomScrubFraction = function videoZoomScrubFraction(event) {
  const el = this.videoZoomScrubberEl;
  if (!el || typeof el.getBoundingClientRect !== "function") {
    return null;
  }
  let rect = null;
  try {
    rect = el.getBoundingClientRect();
  } catch (_error) {
    return null;
  }
  const width = rect ? Number(rect.width) : 0;
  if (!(width > 0)) {
    return null;
  }
  const x = event ? Number(event.clientX) : Number.NaN;
  if (!Number.isFinite(x)) {
    return null;
  }
  return clampNumber((x - Number(rect.left)) / width, 0, 1);
};

VideoZoomModal.prototype.stopVideoZoomScrubEvent = function stopVideoZoomScrubEvent(event) {
  try {
    if (event && typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }
  } catch (_error) {
    // Harness events carry no propagation.
  }
  try {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
  } catch (_error) {
    // Some harness events are not cancelable.
  }
};

VideoZoomModal.prototype.seekVideoZoomFraction = function seekVideoZoomFraction(fraction) {
  const video = this.imgEl;
  if (!video) {
    return;
  }
  const duration = Number(video.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    return;
  }
  this.seekVideoZoomTo(fraction * duration);
};

VideoZoomModal.prototype.showVideoZoomScrubBubble = function showVideoZoomScrubBubble(fraction) {
  const bubble = this.videoZoomScrubberBubbleEl;
  const video = this.imgEl;
  if (!bubble || !video) {
    return;
  }
  const duration = Number(video.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    return;
  }
  try {
    bubble.setText(formatVideoZoomTime(fraction * duration, duration));
    bubble.style.left = `${clampNumber(fraction, 0.04, 0.96) * 100}%`;
    bubble.classList.toggle("is-visible", true);
  } catch (_error) {
    // The bubble is best effort.
  }
};

VideoZoomModal.prototype.hideVideoZoomScrubBubble = function hideVideoZoomScrubBubble() {
  const bubble = this.videoZoomScrubberBubbleEl;
  if (!bubble || !bubble.classList) {
    return;
  }
  try {
    bubble.classList.toggle("is-visible", false);
  } catch (_error) {
    // The bubble is best effort.
  }
};

VideoZoomModal.prototype.setVideoZoomScrubSeeking = function setVideoZoomScrubSeeking(on) {
  const scrubber = this.videoZoomScrubberEl;
  if (!scrubber || !scrubber.classList) {
    return;
  }
  try {
    scrubber.classList.toggle("is-seeking", on === true);
  } catch (_error) {
    // The seeking style is best effort.
  }
};

VideoZoomModal.prototype.handleVideoZoomScrubPointerDown = function handleVideoZoomScrubPointerDown(event) {
  if (this.imageZoomClosed || this.videoZoomFailed || !this.imgEl) {
    return;
  }
  this.stopVideoZoomScrubEvent(event);
  const fraction = this.videoZoomScrubFraction(event);
  if (fraction == null) {
    return;
  }
  this.videoZoomScrubSeeking = true;
  this.videoZoomScrubResume = this.imgEl.paused === false;
  this.pauseVideoZoom();
  this.seekVideoZoomFraction(fraction);
  this.showVideoZoomScrubBubble(fraction);
  this.setVideoZoomScrubSeeking(true);
};

VideoZoomModal.prototype.handleVideoZoomScrubPointerMove = function handleVideoZoomScrubPointerMove(event) {
  if (this.imageZoomClosed || !this.videoZoomScrubberEl) {
    return;
  }
  const fraction = this.videoZoomScrubFraction(event);
  if (fraction == null) {
    return;
  }
  if (this.videoZoomScrubSeeking) {
    if (this.videoZoomFailed || !this.imgEl) {
      return;
    }
    this.stopVideoZoomScrubEvent(event);
    this.seekVideoZoomFraction(fraction);
  }
  this.showVideoZoomScrubBubble(fraction);
};

VideoZoomModal.prototype.handleVideoZoomScrubPointerUp = function handleVideoZoomScrubPointerUp(event) {
  if (!this.videoZoomScrubSeeking) {
    return;
  }
  this.stopVideoZoomScrubEvent(event);
  this.videoZoomScrubSeeking = false;
  this.setVideoZoomScrubSeeking(false);
  this.hideVideoZoomScrubBubble();
  if (this.imageZoomClosed) {
    return;
  }
  if (this.videoZoomScrubResume && !this.videoZoomFailed && this.imgEl) {
    this.videoZoomScrubResume = false;
    this.playVideoZoom();
  }
  try {
    if (this.viewportEl && typeof this.viewportEl.focus === "function") {
      this.viewportEl.focus();
    }
  } catch (_error) {
    // Focus is best effort.
  }
};

VideoZoomModal.prototype.handleVideoZoomScrubPointerLeave = function handleVideoZoomScrubPointerLeave() {
  if (this.videoZoomScrubSeeking) {
    return;
  }
  this.hideVideoZoomScrubBubble();
};

VideoZoomModal.prototype.ensureVideoZoomFlash = function ensureVideoZoomFlash() {
  const viewport = this.viewportEl;
  if (!viewport || typeof viewport.createDiv !== "function") {
    return null;
  }
  const current = this.videoZoomFlashEl;
  if (current && (current.parent === viewport || current.parentNode === viewport)) {
    return current;
  }
  const flash = viewport.createDiv({ cls: "bob-video-zoom-flash" });
  this.videoZoomFlashEl = flash;
  return flash;
};

VideoZoomModal.prototype.showVideoZoomFlash = function showVideoZoomFlash(glyph) {
  if (this.imageZoomClosed) {
    return;
  }
  try {
    if (this.prefersVideoZoomReducedMotion()) {
      return;
    }
  } catch (_error) {
    return;
  }
  const flash = this.ensureVideoZoomFlash();
  if (!flash) {
    return;
  }
  try {
    if (typeof this.imageZoomClearTimeout === "function" && this.videoZoomFlashTimer != null) {
      this.imageZoomClearTimeout(this.videoZoomFlashTimer);
    }
  } catch (_error) {
    // Timer cleanup is best effort.
  }
  this.videoZoomFlashTimer = null;
  try {
    flash.setText(glyph);
    flash.classList.toggle("is-resting", false);
    flash.classList.remove("is-visible");
    if (typeof flash.offsetWidth === "number") {
      void flash.offsetWidth;
    }
    flash.classList.add("is-visible");
  } catch (_error) {
    return;
  }
  try {
    if (typeof this.imageZoomSetTimeout === "function") {
      this.videoZoomFlashTimer = this.imageZoomSetTimeout(() => {
        this.videoZoomFlashTimer = null;
        if (this.imageZoomClosed) {
          return;
        }
        try {
          flash.classList.toggle("is-visible", false);
        } catch (_inner) {
          // The flash hides itself best effort.
        }
      }, VIDEO_ZOOM_FLASH_MS);
    }
  } catch (_error) {
    // The fade is best effort.
  }
};

VideoZoomModal.prototype.showVideoZoomRestingFlash = function showVideoZoomRestingFlash() {
  if (this.imageZoomClosed || this.videoZoomHasPlayed) {
    return;
  }
  try {
    if (this.prefersVideoZoomReducedMotion()) {
      return;
    }
  } catch (_error) {
    return;
  }
  if (this.imgEl && this.imgEl.paused === false) {
    return;
  }
  const flash = this.ensureVideoZoomFlash();
  if (!flash) {
    return;
  }
  try {
    flash.setText(VIDEO_ZOOM_PAUSE_GLYPH);
    flash.classList.toggle("is-visible", true);
    flash.classList.toggle("is-resting", true);
  } catch (_error) {
    // The resting flash is best effort.
  }
};

VideoZoomModal.prototype.clearVideoZoomRestingFlash = function clearVideoZoomRestingFlash() {
  const flash = this.videoZoomFlashEl;
  if (!flash || !flash.classList) {
    return;
  }
  try {
    if (typeof flash.classList.contains === "function" && !flash.classList.contains("is-resting")) {
      return;
    }
    flash.classList.toggle("is-resting", false);
    flash.classList.toggle("is-visible", false);
  } catch (_error) {
    // The resting flash is best effort.
  }
};

VideoZoomModal.prototype.maybeCompactVideoZoomFooter = function maybeCompactVideoZoomFooter() {
  if (this.imageZoomClosed || this.videoZoomFailed || this.videoZoomFooterCompact) {
    return;
  }
  const footer = this.imageZoomFooterEl;
  if (!footer) {
    return;
  }
  let scroll = 0;
  let client = 0;
  try {
    scroll = Number(footer.scrollHeight);
    client = Number(footer.clientHeight);
  } catch (_error) {
    return;
  }
  if (!(scroll > 0) || !(client > 0)) {
    return;
  }
  if (scroll <= client + 1) {
    return;
  }
  this.videoZoomFooterCompact = true;
  try {
    this.renderImageZoomFooter();
  } catch (_error) {
    // The full chip row stays when the compact render fails.
  }
};

VideoZoomModal.prototype.hideVideoZoomTransportOnFailure = function hideVideoZoomTransportOnFailure() {
  try {
    this.ensureVideoZoomScrubber();
  } catch (_error) {
    // The scrubber hides best effort.
  }
  const flash = this.videoZoomFlashEl;
  if (flash && flash.classList) {
    try {
      flash.classList.toggle("is-visible", false);
      flash.classList.toggle("is-resting", false);
    } catch (_error) {
      // The flash hides best effort.
    }
  }
};

VideoZoomModal.prototype.releaseVideoZoomTransport = function releaseVideoZoomTransport() {
  try {
    if (typeof this.imageZoomClearTimeout === "function" && this.videoZoomFlashTimer != null) {
      this.imageZoomClearTimeout(this.videoZoomFlashTimer);
    }
  } catch (_error) {
    // Timer cleanup is best effort.
  }
  this.videoZoomFlashTimer = null;
  this.videoZoomFlashEl = null;
  this.videoZoomScrubberEl = null;
  this.videoZoomScrubberPlayedEl = null;
  this.videoZoomScrubberBufferedEl = null;
  this.videoZoomScrubberBubbleEl = null;
  this.videoZoomScrubSeeking = false;
  this.videoZoomScrubResume = false;
  this.videoZoomFrameCallbackId = null;
  this.videoZoomFrameSamples = [];
  this.videoZoomLearnedFrameDuration = VIDEO_ZOOM_FALLBACK_FRAME_DURATION;
  this.videoZoomSpeed = VIDEO_ZOOM_DEFAULT_SPEED;
  try {
    this.exitVideoZoomFullscreen();
  } catch (_error) {
    // Fullscreen exits best effort.
  }
};
