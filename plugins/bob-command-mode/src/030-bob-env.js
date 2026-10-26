// Bob Command Mode: bob resolution, vault base, and child environment.

const CM_BOB_CANDIDATES = [
  ".cargo/bin/bob",
  ".local/bin/bob",
  "/opt/homebrew/bin/bob",
  "/usr/local/bin/bob",
];

function cmBobCandidatePaths(home) {
  const base = typeof home === "string" ? home : "";
  return CM_BOB_CANDIDATES
    .map((entry) => (entry.startsWith("/") ? entry : base ? base + "/" + entry : ""))
    .filter(Boolean);
}

// Resolve bob. Order: explicit setting, bob-ledger-tools api, well-known
// candidates, then PATH. Returns {path, source, tried}: `tried` lists every
// candidate path checked so a missing bob can report them.
function cmResolveBobPath(configured, options = {}) {
  const tried = [];
  const home = options.home !== undefined ? options.home : cmHomeDir(options);
  const configPath = cmExpandHome(configured, home);
  if (configPath) return { path: configPath, source: "config", tried };
  if (typeof options.ledgerBobPath === "function") {
    try {
      const ledgerPath = options.ledgerBobPath();
      if (typeof ledgerPath === "string" && ledgerPath.trim()) {
        return { path: ledgerPath.trim(), source: "ledger-tools", tried };
      }
    } catch (error) {
      // Fall through to the candidate locations.
    }
  } else if (typeof options.ledgerBobPath === "string" && options.ledgerBobPath.trim()) {
    return { path: options.ledgerBobPath.trim(), source: "ledger-tools", tried };
  }
  let existsSync = options.existsSync;
  if (!existsSync) {
    try {
      existsSync = (candidate) => cmFs().existsSync(candidate);
    } catch (error) {
      existsSync = () => false;
    }
  }
  for (const candidate of cmBobCandidatePaths(home)) {
    tried.push(candidate);
    try {
      if (existsSync(candidate)) return { path: candidate, source: "candidate", tried };
    } catch (error) {
      // Try the next known install location.
    }
  }
  return { path: "bob", source: "path", tried };
}

// Vault base path for child cwd and BOB_DIR. A vault without a local folder
// refuses command mode ("Command mode needs a local vault").
function cmVaultBasePath(app) {
  try {
    const adapter = app && app.vault && app.vault.adapter;
    const basePath = adapter && typeof adapter.getBasePath === "function"
      ? adapter.getBasePath()
      : null;
    if (typeof basePath === "string" && basePath.trim()) return basePath;
  } catch (error) {
    // Fall through to the null refusal below.
  }
  return null;
}

// Assemble the child environment. Starts from the parent env, points BOB_DIR at
// the vault, prepends the Mac GUI tool paths, and honors the catalog-advertised
// features with NO_COLOR precedence. Never falls back to ~/bob for BOB_DIR.
function cmBuildChildEnv(options = {}) {
  const parent = options.env || {};
  const env = { ...parent };
  if (options.vaultBase) env.BOB_DIR = options.vaultBase;
  const features = new Set(Array.isArray(options.features) ? options.features : []);
  const noColorSet = typeof env.NO_COLOR === "string" && env.NO_COLOR.trim() !== "";
  if (features.has(CM_FEATURE_COLOR) && !noColorSet) {
    env.CLICOLOR_FORCE = "1";
  } else if (!features.has(CM_FEATURE_COLOR) && !noColorSet) {
    env.NO_COLOR = "1";
  }
  if (features.has(CM_FEATURE_PROGRESS)) env.BOB_PROGRESS = "1";
  if (features.has(CM_FEATURE_RECEIPT) && options.receiptPath) {
    env.BOB_RUN_RECEIPT = options.receiptPath;
  }
  const pathModule = options.pathModule || null;
  const delimiter = pathModule && typeof pathModule.delimiter === "string" ? pathModule.delimiter : ":";
  const home = options.home !== undefined ? options.home : "";
  const candidateDirs = cmBobCandidatePaths(home)
    .map((candidate) => {
      const slash = candidate.lastIndexOf("/");
      return slash > 0 ? candidate.slice(0, slash) : "";
    })
    .filter(Boolean);
  const currentPath = typeof env.PATH === "string" ? env.PATH : "";
  const present = new Set(currentPath.split(delimiter).filter(Boolean));
  const prepended = candidateDirs.filter((dir) => !present.has(dir));
  if (prepended.length > 0) {
    env.PATH = [...prepended, ...(currentPath ? [currentPath] : [])].join(delimiter);
  }
  const cols = Number(options.pagerWidthCols);
  env.COLUMNS = String(Number.isFinite(cols) && cols > 0 ? Math.floor(cols) : 100);
  delete env.BOB_NOW;
  delete env.BOB_DAY_FILE;
  for (const key of Object.keys(env)) {
    if (key.startsWith("BOB_COMPLETE_")) delete env[key];
  }
  return env;
}
