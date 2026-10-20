const test = require("node:test");
const assert = require("node:assert/strict");
const {
  NavigationHotkeysPlugin,
  notices,
} = require("./navigation-hotkeys-harness.cjs");

function resetNotices() {
  notices.length = 0;
}

function makeResolver(files = {}, options = {}) {
  const fileMap = new Map();
  for (const [filePath, extra] of Object.entries(files)) {
    const segments = String(filePath).split("/");
    const basename = segments[segments.length - 1] || filePath;
    const dotIndex = basename.lastIndexOf(".");
    const extension = (
      (extra && extra.extension) ||
      (dotIndex === -1 ? "" : basename.slice(dotIndex + 1))
    ).toLowerCase();
    fileMap.set(filePath, {
      path: filePath,
      extension,
      name: basename,
      basename,
      ...(extra || {}),
    });
  }
  const seen = [];
  const resourceSeen = [];
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  plugin.app = {
    metadataCache: {
      getFirstLinkpathDest: (lookup, sourcePath) => {
        seen.push({ lookup: String(lookup), sourcePath: String(sourcePath) });
        const target = String(lookup || "");
        // Exact vault-relative match wins.
        if (fileMap.has(target)) {
          return fileMap.get(target);
        }
        if (fileMap.has(`${target}.md`)) {
          return fileMap.get(`${target}.md`);
        }
        // Relative lookups resolve against the source note directory.
        if (target.startsWith("./") || target.startsWith("../")) {
          const sourceDir = String(sourcePath || "").split("/").slice(0, -1);
          const parts = [...sourceDir];
          for (const segment of target.split("/")) {
            if (segment === "." || segment === "") {
              continue;
            }
            if (segment === "..") {
              parts.pop();
              continue;
            }
            parts.push(segment);
          }
          const resolved = parts.join("/");
          if (fileMap.has(resolved)) {
            return fileMap.get(resolved);
          }
        }
        // Basename fallback prefers the source note directory for duplicates.
        const base = target.split("/").pop().toLowerCase();
        const matches = [...fileMap.values()].filter(
          (file) => String(file.name || "").toLowerCase() === base,
        );
        if (matches.length === 0) {
          return null;
        }
        if (matches.length === 1) {
          return matches[0];
        }
        const sourceDir = String(sourcePath || "").split("/").slice(0, -1).join("/");
        const sameDir = matches.find(
          (file) =>
            String(file.path || "").split("/").slice(0, -1).join("/") === sourceDir,
        );
        return sameDir || matches[0];
      },
    },
    vault: {
      getResourcePath: (file) => {
        resourceSeen.push(file && file.path);
        return `resource://${file.path}`;
      },
      cachedRead() {
        throw new Error("resolver must not read notes");
      },
      read() {
        throw new Error("resolver must not read notes");
      },
      modify() {
        throw new Error("resolver must never write the vault");
      },
      create() {
        throw new Error("resolver must never write the vault");
      },
      process() {
        throw new Error("resolver must never write the vault");
      },
    },
  };
  if (options.appOverrides) {
    Object.assign(plugin.app, options.appOverrides);
  }
  return { plugin, seen, resourceSeen, fileMap };
}

function resolveOn(plugin, lineText, ch, sourcePath, inCodeFence = false) {
  resetNotices();
  return plugin.resolveImageZoomTargetOnLine({
    lineText,
    ch,
    sourcePath,
    inCodeFence,
  });
}

test("parser finds vault embed with size hint", () => {
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  const line = "- ![[img/20260901_085041.png|400]]";
  const refs = plugin.findImageZoomRefs(line);
  assert.equal(refs.length, 1);
  const ref = refs[0];
  assert.equal(ref.form, "wiki");
  assert.equal(ref.embed, true);
  assert.equal(ref.target, "img/20260901_085041.png");
  assert.equal(ref.external, false);
  assert.equal(line.slice(ref.start, ref.end), "![[img/20260901_085041.png|400]]");
  assert.equal(plugin.isImageZoomCandidate(ref), true);
});

test("parser finds plain image wikilink and blockquoted embed", () => {
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  const plain = plugin.findImageZoomRefs("See [[img/vim_veteran_redir.png]]");
  assert.equal(plain.length, 1);
  assert.equal(plain[0].form, "wiki");
  assert.equal(plain[0].embed, false);
  assert.equal(plain[0].target, "img/vim_veteran_redir.png");
  assert.equal(plain[0].external, false);

  const quoted = plugin.findImageZoomRefs("> ![[ref/a.assets/b.png|549]]");
  assert.equal(quoted.length, 1);
  assert.equal(quoted[0].embed, true);
  assert.equal(quoted[0].target, "ref/a.assets/b.png");
});

test("parser ignores callout bracket and finds the embed", () => {
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  const line = "> [!quote] Image ![[img/x.png]]";
  const refs = plugin.findImageZoomRefs(line);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].target, "img/x.png");
  assert.equal(line.slice(refs[0].start, refs[0].end), "![[img/x.png]]");
});

test("parser ignores image links inside single and double backticks", () => {
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  assert.deepEqual(plugin.findImageZoomRefs("`![[img/x.png]]`"), []);
  assert.deepEqual(plugin.findImageZoomRefs("``![[img/x.png]]``"), []);
  assert.deepEqual(plugin.findImageZoomRefs("`![](img/a.png)` and text"), []);
  // Code spans are CommonMark runs: an unmatched run is literal.
  const spans = plugin.findInlineCodeSpans("`unclosed and `![[img/x.png]]`");
  assert.ok(spans.length >= 1);
});

test("non-image wiki targets are recognized but not candidates", () => {
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  const note = plugin.findImageZoomRefs("See [[note]] and more");
  assert.equal(note.length, 1);
  assert.equal(note[0].target, "note");
  assert.equal(plugin.isImageZoomCandidate(note[0]), false);
  const pdf = plugin.findImageZoomRefs("See [[doc.pdf]] here");
  assert.equal(pdf.length, 1);
  assert.equal(pdf[0].target, "doc.pdf");
  assert.equal(plugin.isImageZoomCandidate(pdf[0]), false);
});

test("parser finds two image refs and lines with no refs", () => {
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  const line = "See [[img/a.png]] and ![[img/b.jpg|100]] end";
  const refs = plugin.findImageZoomRefs(line);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].target, "img/a.png");
  assert.equal(refs[1].target, "img/b.jpg");
  assert.ok(refs[0].end <= refs[1].start);
  assert.deepEqual(plugin.findImageZoomRefs("just prose, no links"), []);
  assert.deepEqual(plugin.findImageZoomRefs(""), []);
});

test("parser handles Markdown angle, title, and balanced parens", () => {
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  const angled = plugin.findImageZoomRefs("![alt](<img/Screen Shot.png>)");
  assert.equal(angled.length, 1);
  assert.equal(angled[0].form, "markdown");
  assert.equal(angled[0].embed, true);
  assert.equal(angled[0].target, "img/Screen Shot.png");
  assert.equal(plugin.isImageZoomCandidate(angled[0]), true);

  const titled = plugin.findImageZoomRefs('![](img/a%20b.png "t")');
  assert.equal(titled.length, 1);
  assert.equal(titled[0].target, "img/a b.png");

  const parens = plugin.findImageZoomRefs("[x](img/p(1).png)");
  assert.equal(parens.length, 1);
  assert.equal(parens[0].form, "markdown");
  assert.equal(parens[0].embed, false);
  assert.equal(parens[0].target, "img/p(1).png");
  assert.equal(plugin.isImageZoomCandidate(parens[0]), true);
});

test("picker uses containing, next, then previous rule", () => {
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  const line = "See [[img/a.png]] and ![[img/b.jpg]] end";
  const refs = plugin.findImageZoomRefs(line);
  const candidates = refs.filter((ref) => plugin.isImageZoomCandidate(ref));
  assert.equal(candidates.length, 2);
  const first = candidates[0];
  const second = candidates[1];
  // Before everything picks the first.
  assert.equal(plugin.pickImageZoomRef(candidates, 0), first);
  // At start, inside, and at end - 1 pick the containing ref.
  assert.equal(plugin.pickImageZoomRef(candidates, first.start), first);
  assert.equal(plugin.pickImageZoomRef(candidates, first.start + 2), first);
  assert.equal(plugin.pickImageZoomRef(candidates, first.end - 1), first);
  // Between refs picks the next one; after everything picks the last.
  const between = first.end;
  assert.equal(plugin.pickImageZoomRef(candidates, between), second);
  assert.equal(
    plugin.pickImageZoomRef(candidates, line.length),
    second,
  );
  // Single-ref line: before picks it, after picks it.
  const single = plugin.findImageZoomRefs("a ![[img/only.png]] b");
  const singleCandidates = single.filter((ref) =>
    plugin.isImageZoomCandidate(ref),
  );
  assert.equal(plugin.pickImageZoomRef(singleCandidates, 0), single[0]);
  assert.equal(
    plugin.pickImageZoomRef(singleCandidates, 100),
    single[0],
  );
  assert.equal(plugin.pickImageZoomRef([], 0), null);
});

test("resolution records sourcePath and resolves duplicate basenames", () => {
  const { plugin, seen } = makeResolver(
    {
      "A/img.png": {},
      "B/img.png": {},
      "A/note.md": {},
      "B/note.md": {},
    },
  );
  const fromA = resolveOn(plugin, "See [[img.png]]", 6, "A/note.md");
  assert.equal(fromA.kind, "image");
  assert.equal(fromA.path, "A/img.png");
  assert.equal(fromA.src, "resource://A/img.png");
  assert.equal(fromA.title, "img.png");
  const fromB = resolveOn(plugin, "See [[img.png]]", 6, "B/note.md");
  assert.equal(fromB.path, "B/img.png");
  assert.deepEqual(
    seen.map((entry) => entry.sourcePath),
    ["A/note.md", "B/note.md"],
  );
});

test("resolution handles relative, unicode, and space names", () => {
  const { plugin } = makeResolver({
    "notes/img/x.png": {},
    "img/café photo.png": {},
    "notes/note.md": {},
  });
  const relative = resolveOn(
    plugin,
    "See [[../img/x.png]]",
    7,
    "notes/sub/note.md",
  );
  // ../ from notes/sub lands in notes/img/x.png.
  assert.equal(relative.kind, "image");
  assert.equal(relative.path, "notes/img/x.png");

  const spaced = resolveOn(
    plugin,
    '![](img/caf%C3%A9%20photo.png "t")',
    2,
    "notes/note.md",
  );
  assert.equal(spaced.kind, "image");
  assert.equal(spaced.path, "img/café photo.png");
  assert.equal(spaced.src, "resource://img/café photo.png");
});

test("missing file, non-image cursor, and fenced lines show exact notices", () => {
  const { plugin, resourceSeen } = makeResolver({
    "notes/note.md": {},
    "notes/doc.pdf": {},
  });
  const missing = resolveOn(plugin, "See [[img/gone.png]]", 7, "notes/note.md");
  assert.deepEqual(missing, {
    kind: "notice",
    message: "Image not found: img/gone.png",
  });
  assert.deepEqual(resourceSeen, []);

  const line = "See [[doc.pdf]] here";
  const pdfRef = plugin.findImageZoomRefs(line)[0];
  const notImage = resolveOn(
    plugin,
    line,
    pdfRef.start + 2,
    "notes/note.md",
  );
  assert.deepEqual(notImage, {
    kind: "notice",
    message: "Not an image: doc.pdf",
  });

  const fenced = resolveOn(
    plugin,
    "![[img/x.png]]",
    2,
    "notes/note.md",
    true,
  );
  assert.deepEqual(fenced, {
    kind: "notice",
    message: "No image on this line",
  });

  const empty = resolveOn(plugin, "", 0, "notes/note.md");
  assert.deepEqual(empty, {
    kind: "notice",
    message: "No image on this line",
  });
});

test("vault resolution calls getResourcePath with the resolved file", () => {
  const { plugin, resourceSeen } = makeResolver({
    "img/a.png": {},
    "notes/note.md": {},
  });
  const result = resolveOn(plugin, "![[img/a.png]]", 2, "notes/note.md");
  assert.equal(result.kind, "image");
  assert.equal(result.source, "vault");
  assert.equal(result.path, "img/a.png");
  assert.equal(result.src, "resource://img/a.png");
  assert.deepEqual(resourceSeen, ["img/a.png"]);
});

test("http embed passes through and non-image urls are not candidates", () => {
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  const embed = plugin.findImageZoomRefs(
    "![](https://e.com/render?id=1)",
  )[0];
  assert.equal(embed.external, true);
  assert.equal(embed.target, "https://e.com/render?id=1");
  assert.equal(plugin.isImageZoomCandidate(embed), true);

  const page = plugin.findImageZoomRefs("[x](https://e.com/page)")[0];
  assert.equal(plugin.isImageZoomCandidate(page), false);

  const upper = plugin.findImageZoomRefs("[x](https://e.com/a.PNG?v=2)")[0];
  assert.equal(plugin.isImageZoomCandidate(upper), true);

  const file = plugin.findImageZoomRefs("[x](file:///tmp/a.png)")[0];
  assert.equal(plugin.isImageZoomCandidate(file), false);

  const { plugin: urlPlugin } = makeResolver({});
  const viaUrl = resolveOn(
    urlPlugin,
    "![](https://e.com/render?id=1)",
    2,
    "notes/note.md",
  );
  assert.equal(viaUrl.kind, "image");
  assert.equal(viaUrl.source, "url");
  assert.equal(viaUrl.src, "https://e.com/render?id=1");
  assert.equal(viaUrl.title, "render");
});
