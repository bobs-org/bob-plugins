// Notebook creation through bob (`bob notebooks create`; plan
// 202611/bob_notebooks.md, phase plugins-notebook-gestures). The Create
// notebook here command in bob-navigation-hotkeys resolves through
// `api.notebooks.create`, the way the Links-stage merge resolves through
// `api.taskMerge`: one desktop-only spawn that decodes bob's schema-1 JSON
// envelope. Elsewhere every call resolves `desktop_only` and writes nothing.
const NOTEBOOKS_API_VERSION = 1;
const NOTEBOOKS_MOBILE_MESSAGE = "Creating a notebook needs the desktop app";

function notebooksCreateDecodeReport(stdout, stderr) {
  const label = "bob notebooks create";
  let body;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (_error) {
    return {
      ok: false,
      code: "unsupported",
      message: "Update bob to create notebooks.",
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
  if (body.schema_version !== NOTEBOOKS_API_VERSION) {
    return {
      ok: false,
      code: "bad-version",
      message: `${label} returned an unsupported schema version.`,
      detail: statsFirstLine(stderr),
    };
  }
  if (body.ok === false) {
    const error =
      body.error && typeof body.error === "object" && !Array.isArray(body.error)
        ? body.error
        : {};
    return {
      ok: false,
      code: typeof error.code === "string" && error.code ? error.code : "bob-error",
      message:
        typeof error.message === "string" && error.message
          ? error.message
          : `${label} reported an error.`,
      // The teaching hint rides in `detail`: the shared spawn keeps only
      // `code`, `message`, and `detail` from a failed decode.
      detail:
        typeof error.hint === "string" && error.hint
          ? error.hint
          : statsFirstLine(stderr),
    };
  }
  const notebook = body.notebook;
  if (
    !notebook ||
    typeof notebook !== "object" ||
    Array.isArray(notebook) ||
    typeof notebook.path !== "string" ||
    !notebook.path
  ) {
    return {
      ok: false,
      code: "bad-shape",
      message: `${label} returned a report without a notebook.`,
      detail: statsFirstLine(stderr),
    };
  }
  return { ok: true, report: body };
}

// The argv for one real create. Positionals follow `--` and the free text
// rides `--summary=` / `--title=` so a value that starts with `-` is never
// read as an option. Returns null when a required piece is blank.
function notebooksCreateArgs(request) {
  const input = request && typeof request === "object" ? request : {};
  const parent = String(input.parent === undefined ? "" : input.parent).trim();
  const id = String(input.id === undefined ? "" : input.id).trim();
  const summary = String(input.summary === undefined ? "" : input.summary).trim();
  const title = String(input.title === undefined ? "" : input.title).trim();
  if (!parent || !id || !summary) {
    return null;
  }
  const args = ["notebooks", "create", `--summary=${summary}`];
  if (title) {
    args.push(`--title=${title}`);
  }
  args.push("-f", "json", "--", parent, id);
  return args;
}

class BobLedgerToolsNotebooksMixin {
  notebooksApi() {
    if (!this.notebooksApiValue) {
      const plugin = this;
      this.notebooksApiValue = Object.freeze({
        version: NOTEBOOKS_API_VERSION,
        create: (request) => plugin.apiNotebooksCreate(request),
      });
    }
    return this.notebooksApiValue;
  }

  notebooksIsDesktop() {
    try {
      return typeof Platform !== "undefined" && Platform && Platform.isDesktopApp === true;
    } catch (_error) {
      return false;
    }
  }

  notebooksSpawn(args) {
    if (!this.notebooksIsDesktop()) {
      return Promise.resolve({
        ok: false,
        code: "desktop_only",
        message: NOTEBOOKS_MOBILE_MESSAGE,
      });
    }
    return bobSpawnJson(args, notebooksCreateDecodeReport, {
      commandLabel: "bob notebooks create",
      resolveBobPath: () =>
        typeof this.apiStatsBobPath === "function"
          ? this.apiStatsBobPath()
          : { path: "bob", source: "path" },
      getVaultPath: () => this.statsVaultBasePath(),
      timeout: BOB_SPAWN_TIMEOUT_MS,
      maxBuffer: BOB_SPAWN_MAX_BUFFER,
      firstLine: statsFirstLine,
    });
  }

  // `create({ parent, id, summary, title? })` resolves `{ ok: true, report }`
  // (`report.notebook` has `path`, `stem`, `title`, `summary`, `parent`;
  // `report.warnings` lists soft findings) or `{ ok: false, code, message,
  // detail }`. A bob refusal keeps its `notebook_*` code. Never throws.
  async apiNotebooksCreate(request) {
    try {
      const args = notebooksCreateArgs(request);
      if (!args) {
        return {
          ok: false,
          code: "missing",
          message: "Creating a notebook needs a parent, an ID, and a summary.",
        };
      }
      return await this.notebooksSpawn(args);
    } catch (_error) {
      return { ok: false, code: "failed", message: "bob notebooks create failed." };
    }
  }
}
