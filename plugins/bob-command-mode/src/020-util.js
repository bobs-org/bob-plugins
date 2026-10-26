// Bob Command Mode: small pure utilities (quoting, ANSI, durations, ids).

// Strip ANSI escape sequences: CSI ... <letter> plus OSC hyperlinks and charset
// sequences. Rendered text nodes and spans only; never innerHTML downstream.
function cmStripAnsi(text) {
  return String(text || "")
    .replace(/\u001b\]8;;.*?\u001b\\/g, "")
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b[()][0-9A-B]/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function cmSplitLines(text) {
  return String(text || "").split(/\r?\n/);
}

// Last non-empty line after ANSI stripping, or "" when there is none.
function cmLastMeaningfulLine(text) {
  const lines = cmSplitLines(cmStripAnsi(text));
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (line) return line;
  }
  return "";
}

// First non-empty line after ANSI stripping, or "" when there is none.
function cmFirstMeaningfulLine(text) {
  for (const line of cmSplitLines(cmStripAnsi(text))) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

// First stderr line starting with `error:` (case-insensitive), ANSI-stripped.
function cmFirstErrorLine(text) {
  for (const line of cmSplitLines(cmStripAnsi(text))) {
    const trimmed = line.trim();
    if (/^error:/i.test(trimmed)) return trimmed;
  }
  return "";
}

// Quote one argv word for display and copy. Mirrors POSIX single-quote rules:
// wrap in quotes when the word is empty or holds anything outside [A-Za-z0-9_./-=+:,].
function cmQuoteArg(word) {
  const value = String(word ?? "");
  if (value && /^[A-Za-z0-9_./=+:,\-]+$/.test(value)) return value;
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function cmFormatArgv(argv) {
  return (Array.isArray(argv) ? argv : []).map(cmQuoteArg).join(" ");
}

// Short human duration: "0:42" under a minute, "1.2 s" under ten, "N s" / "N min".
function cmFormatDuration(durationMs) {
  const ms = Math.max(0, Number(durationMs) || 0);
  if (ms < 1000) return "0:" + String(Math.floor(ms / 1000)).padStart(2, "0");
  const seconds = ms / 1000;
  if (seconds < 60) {
    return seconds < 10
      ? seconds.toFixed(1).replace(/\.0$/, "") + " s"
      : Math.round(seconds) + " s";
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return minutes + ":" + String(rest).padStart(2, "0");
}

// Long clock used by the status chip: "0:42", "1:05".
function cmFormatClock(durationMs) {
  const totalSeconds = Math.max(0, Math.floor((Number(durationMs) || 0) / 1000));
  return Math.floor(totalSeconds / 60) + ":" + String(totalSeconds % 60).padStart(2, "0");
}

function cmPad2(value) {
  return String(value).padStart(2, "0");
}

// Run id: YYYYMMDD-HHMMSS-<4 lowercase alphanumerics, no lookalikes>.
function cmRunId(nowMs, random) {
  const date = new Date(typeof nowMs === "number" ? nowMs : Date.now());
  const stamp = date.getFullYear() + cmPad2(date.getMonth() + 1) + cmPad2(date.getDate()) +
    "-" + cmPad2(date.getHours()) + cmPad2(date.getMinutes()) + cmPad2(date.getSeconds());
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const pick = typeof random === "function" ? random : Math.random;
  let suffix = "";
  for (let index = 0; index < 4; index += 1) {
    suffix += alphabet[Math.floor(pick() * alphabet.length) % alphabet.length];
  }
  return stamp + "-" + suffix;
}

function cmIsoNow(nowMs) {
  return new Date(typeof nowMs === "number" ? nowMs : Date.now()).toISOString();
}

function cmExpandHome(rawPath, home) {
  const value = typeof rawPath === "string" ? rawPath.trim() : "";
  if (!value) return "";
  if (value === "~") return home || value;
  if (value.startsWith("~/")) return home ? home + value.slice(1) : value;
  return value;
}

function cmHomeDir(options = {}) {
  try {
    const osModule = options.osModule || (typeof cmOs === "function" ? cmOs() : null);
    const home = osModule && typeof osModule.homedir === "function" ? osModule.homedir() : "";
    if (typeof home === "string" && home.trim()) return home.replace(/\/$/, "") || "/";
  } catch (error) {
    // Fall through to the environment.
  }
  try {
    const env = options.env || (typeof process !== "undefined" ? process.env : {});
    const home = env && typeof env.HOME === "string" ? env.HOME : "";
    return home ? home.replace(/\/$/, "") : "";
  } catch (error) {
    return "";
  }
}

function cmStateRoot(env, osModule) {
  const fromEnv = env && typeof env.XDG_STATE_HOME === "string" ? env.XDG_STATE_HOME.trim() : "";
  if (fromEnv) return fromEnv;
  const home = cmHomeDir({ env, osModule });
  return home ? home + "/.local/state" : "";
}
