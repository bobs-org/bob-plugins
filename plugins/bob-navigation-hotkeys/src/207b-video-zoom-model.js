const VIDEO_ZOOM_EXTENSIONS = Object.freeze(
  new Set(["mp4", "mov", "webm", "mkv"]),
);
const VIDEO_ZOOM_PLAY_GLYPH = "\u25B6\uFE0E";
const VIDEO_ZOOM_PAUSE_GLYPH = "\u23F8\uFE0E";
const VIDEO_ZOOM_SPACE_HINT = "· Space to play";

function videoZoomKeyAction(event) {
  if (!event) {
    return Object.freeze({ action: "ignore" });
  }
  if (event.isComposing === true || event.keyCode === 229) {
    return Object.freeze({ action: "ignore" });
  }
  const key = String(event.key || "");
  const ctrl = event.ctrlKey === true;
  const meta = event.metaKey === true;
  const alt = event.altKey === true;
  const shift = event.shiftKey === true;
  if ((key === " " || key === "Spacebar") && !ctrl && !meta && !alt && !shift) {
    return Object.freeze({ action: "togglePlay" });
  }
  if (key === "ArrowLeft" && !ctrl && !meta && !alt) {
    return Object.freeze({ action: "seek", delta: shift ? -10 : -1 });
  }
  if (key === "ArrowRight" && !ctrl && !meta && !alt) {
    return Object.freeze({ action: "seek", delta: shift ? 10 : 1 });
  }
  if (key.toLowerCase() === "o" && !ctrl && !meta && !alt && !shift && !event.repeat) {
    return Object.freeze({ action: "openExternal" });
  }
  return imageZoomKeyAction(event);
}

function formatVideoZoomTime(seconds, duration) {
  const time = Number(seconds);
  const length = Number(duration);
  const safe = Number.isFinite(time) && time > 0 ? time : 0;
  const useHours = Number.isFinite(length) && length >= 3600;
  if (useHours) {
    const total = Math.max(0, Math.round(safe));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  const tenthsTotal = Math.max(0, Math.round(safe * 10));
  const whole = Math.floor(tenthsTotal / 10);
  const tenths = tenthsTotal % 10;
  const minutes = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}.${tenths}`;
}

function clampVideoZoomSeek(current, delta, duration) {
  const now = Number(current);
  const step = Number(delta);
  const length = Number(duration);
  const start = Number.isFinite(now) ? now : 0;
  const bump = Number.isFinite(step) ? step : 0;
  const max = Number.isFinite(length) && length > 0 ? length : 0;
  return clampNumber(start + bump, 0, max);
}

function videoZoomStartPolicy(options = {}) {
  const reducedMotion = Boolean(options && options.reducedMotion);
  const audioBytes = options ? options.audioBytes : undefined;
  const silent = typeof audioBytes === "number" && Number.isFinite(audioBytes) && audioBytes === 0;
  if (reducedMotion || !silent) {
    return Object.freeze({
      autoplay: false,
      loop: false,
      hint: VIDEO_ZOOM_SPACE_HINT,
    });
  }
  return Object.freeze({ autoplay: true, loop: true, hint: "" });
}

function videoZoomReadout(state) {
  const current = state && typeof state === "object" ? state : {};
  const playing = current.playing === true;
  const glyph = playing ? VIDEO_ZOOM_PLAY_GLYPH : VIDEO_ZOOM_PAUSE_GLYPH;
  const duration = current.duration;
  const currentText = formatVideoZoomTime(current.currentTime, duration);
  const durationText = formatVideoZoomTime(duration, duration);
  const extras = [];
  if (current.zoomPercent) {
    extras.push(String(current.zoomPercent));
  }
  if (current.muted === true) {
    extras.push("muted");
  }
  if (current.hint) {
    extras.push(String(current.hint).replace(/^\s*·\s*/, ""));
  }
  const extra = extras.length ? ` · ${extras.join(" · ")}` : "";
  return `${glyph} ${currentText} / ${durationText}${extra}`;
}

function videoZoomFailureCopy(code, title) {
  const name = String(title || "this file");
  const numeric = Number(code);
  let reason = "Playback failed.";
  if (numeric === 4) {
    reason = "Obsidian's player can't decode this file — the codec may be unsupported, or the file may be damaged.";
  } else if (numeric === 3) {
    reason = "Decoding stopped partway — the file may be damaged.";
  } else if (numeric === 2) {
    reason = "Obsidian couldn't read the file.";
  }
  return Object.freeze({
    title: `Can't play ${name} here`,
    reason,
  });
}
