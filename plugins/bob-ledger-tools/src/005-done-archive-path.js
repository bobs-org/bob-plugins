// One done/ path contract, mirroring bob-cli's `done_archive::is_archive_path`
// (bob-cli phase path-contract): a vault path is a done/ archive exactly when
// its first normal path segment equals `done`, case-sensitively. A root
// `done.md`, a nested `x/done/`, `Done/`, and `.done/` are not archives.
// Pinned by the shared vectors at
// plugins/bob-ledger-tools/scripts/fixtures/done_archive_paths/vectors.json,
// byte-identical to bob-cli's tests/fixtures/done_archive_paths/vectors.json.
function isDoneArchivePath(path) {
  const segments = String(path || "").replace(/\\/g, "/").split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      continue;
    }
    return segment === "done";
  }
  return false;
}
