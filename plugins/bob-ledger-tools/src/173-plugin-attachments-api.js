const ATTACHMENTS_API_VERSION = 1;
const ATTACHMENTS_API_VIA = "zoom";

function attachmentsDecode(stdout, stderr, operation) {
  const label = operation === "import" ? "bob attachments import" : "bob attachments origin";
  let body;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (_error) {
    return {
      ok: false,
      code: "unsupported",
      message: "Update bob to manage attachment origins.",
      detail: statsFirstLine(stderr),
    };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      code: "bad-shape",
      message: `${label} returned an unexpected JSON shape.`,
      detail: statsFirstLine(stderr),
    };
  }
  if (body.ok === false) {
    return {
      ok: false,
      code: typeof body.code === "string" && body.code ? body.code : "bob-error",
      message: typeof body.message === "string" && body.message
        ? body.message
        : `${label} reported an error.`,
      detail: statsFirstLine(stderr),
    };
  }
  if (body.schema_version !== ATTACHMENTS_API_VERSION) {
    return {
      ok: false,
      code: "bad-version",
      message: `${label} returned an unsupported schema version.`,
      detail: statsFirstLine(stderr),
    };
  }
  if (
    operation === "origin" &&
    !(body.origin === null || (body.origin && typeof body.origin === "object" && !Array.isArray(body.origin)))
  ) {
    return {
      ok: false,
      code: "bad-shape",
      message: `${label} returned an unexpected origin.`,
      detail: statsFirstLine(stderr),
    };
  }
  if (operation === "import" && !Array.isArray(body.attachments)) {
    return {
      ok: false,
      code: "bad-shape",
      message: `${label} returned an unexpected attachment list.`,
      detail: statsFirstLine(stderr),
    };
  }
  return { ok: true, report: body };
}

function attachmentsDecodeOrigin(stdout, stderr) {
  return attachmentsDecode(stdout, stderr, "origin");
}

function attachmentsDecodeImport(stdout, stderr) {
  return attachmentsDecode(stdout, stderr, "import");
}

class BobLedgerToolsAttachmentsMixin {
  attachmentsApi() {
    if (!this.attachmentsApiValue) {
      this.attachmentsApiValue = Object.freeze({
        version: ATTACHMENTS_API_VERSION,
        origin: (vaultPath) => this.apiAttachmentsOrigin(vaultPath),
        import: (path, options) => this.apiAttachmentsImport(path, options),
      });
    }
    return this.attachmentsApiValue;
  }

  attachmentsIsDesktop() {
    try {
      return typeof Platform !== "undefined" && Platform && Platform.isDesktopApp === true;
    } catch (_error) {
      return false;
    }
  }

  attachmentsSpawn(args, operation) {
    if (!this.attachmentsIsDesktop()) {
      return Promise.resolve({
        ok: false,
        code: "desktop_only",
        message: "Attachment actions need the desktop app.",
      });
    }
    const decode = operation === "import" ? attachmentsDecodeImport : attachmentsDecodeOrigin;
    return bobSpawnJson(args, decode, {
      commandLabel: `bob attachments ${operation}`,
      resolveBobPath: () =>
        typeof this.apiStatsBobPath === "function"
          ? this.apiStatsBobPath()
          : { path: "bob", source: "path" },
      getVaultPath: () => this.statsVaultBasePath(),
      timeout: BOB_SPAWN_TIMEOUT_MS,
      maxBuffer: BOB_SPAWN_MAX_BUFFER,
      firstLine: statsFirstLine,
      execFile: typeof this.attachmentsExecFile === "function"
        ? this.attachmentsExecFile
        : undefined,
    }).then((result) => {
      if (result && result.ok === true && result.report && typeof result.report === "object") {
        return { ...result.report, ok: true };
      }
      return result;
    });
  }

  async apiAttachmentsOrigin(vaultPath) {
    const path = String(vaultPath || "").trim();
    if (!path) return { ok: false, code: "missing", message: "Name a vault image path." };
    try {
      return await this.attachmentsSpawn(
        ["attachments", "origin", path, "-f", "json"],
        "origin",
      );
    } catch (_error) {
      return { ok: false, code: "failed", message: "bob attachments origin failed." };
    }
  }

  async apiAttachmentsImport(path, options = {}) {
    const source = String(path || "").trim();
    if (!source) return { ok: false, code: "missing", message: "Name a path to import." };
    const opts = options && typeof options === "object" ? options : {};
    const via = String(opts.via || ATTACHMENTS_API_VIA);
    try {
      return await this.attachmentsSpawn(
        ["attachments", "import", "--via", via, "-f", "json", "--", source],
        "import",
      );
    } catch (_error) {
      return { ok: false, code: "failed", message: "bob attachments import failed." };
    }
  }
}
