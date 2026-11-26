// Keep the Bank Area's editor surface while preserving the Rust props wire kind.
function homeCardIsDesktopPlatform(platform) {
  try {
    const host = platform === undefined ? Platform : platform;
    return Boolean(host && host.isDesktopApp === true);
  } catch (_) {
    return false;
  }
}

function homeCardPropertyEditorNoteKind(path, frontmatter) {
  try {
    const eligible = homeCardEligible(path, frontmatter);
    if (!eligible) return "";
    if (eligible.kind === "area" && typeof bankSetupIsHubPath === "function"
      && bankSetupIsHubPath(path) === true) return "bank";
    return eligible.kind;
  } catch (_) {
    return "";
  }
}
