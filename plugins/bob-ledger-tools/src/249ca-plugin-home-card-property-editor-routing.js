function homeCardIsDesktopPlatform(platform) {
  try {
    const host = platform === undefined ? Platform : platform;
    return Boolean(host && host.isDesktopApp === true);
  } catch (_) {
    return false;
  }
}
