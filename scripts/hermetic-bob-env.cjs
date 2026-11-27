// Hermetic process env for plugin unit and perf tests. Mirrors bob-cli's
// `tests/cli/support.rs::bob_command()`: a test that does not name a
// fixture vault must never fall back to ~/bob. Overwrites these variables
// on load so an agent shell that exported BOB_DIR=~/bob cannot leak through.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SENTINEL_VAULT = "/definitely/missing/bob-plugins-test-vault";
const STATE_HOME = fs.mkdtempSync(
  path.join(os.tmpdir(), "bob-plugins-test-state-"),
);
const LOCK_FILE = path.join(STATE_HOME, "bob_sync.lock");

process.env.BOB_DIR = SENTINEL_VAULT;
process.env.XDG_STATE_HOME = STATE_HOME;
process.env.BOB_VAULT_SYNC_LOCK_FILE = LOCK_FILE;
process.env.BOB_VAULT_SYNC_NOTIFY = "0";

module.exports = {
  SENTINEL_VAULT,
  STATE_HOME,
  LOCK_FILE,
};
