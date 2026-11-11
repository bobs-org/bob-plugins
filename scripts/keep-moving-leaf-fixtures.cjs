// LP identities mirror docs/task-dependencies.md §12.17 and the Rust vectors.
function leafFixtures() {
  const project = (parent, extra = {}) => ({ type: "[[project]]", ...(parent ? { parent: `[[${parent}]]` } : {}), ...extra });
  const fm = {
    "dev.md": { type: "[[area]]" },
    "sase.md": project("dev"), "sase_goals.md": project("sase"),
    "sase_blog.md": project("sase", { root: " TRUE " }), "sase_pre_blog.md": project("sase_blog"),
    "gtd_daily.md": { type: "[[area]]", parent: "[[dev]]" }, "p.md": project("gtd_daily"),
    "o.md": project(), "missing.md": project("gone"), "ambiguous.md": project("dup"),
    "x/dup.md": project("dev"), "y/dup.md": project("dev"),
    "wrapper.md": { type: "other", parent: "[[sase]]" }, "k.md": project("wrapper"),
    "m.md": project("sase"), "m_child.md": project("m"),
    "a.md": project("b"), "b.md": project("a"),
    "job.md": { type: "[[area]]" }, "job_2026.md": project("job"),
    "job_email_recruiters.md": project("job_2026"),
    "rooted.md": project("sase", { root: true }), "split.md": project("dev"), "prose.md": project("dev"),
  };
  const texts = Object.fromEntries(Object.entries(fm).map(([path, meta]) => [path,
    ["---", ...Object.entries(meta).map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
      "status: wip", "---", "- [ ] #task Root ^prj", "- [ ] #task Work ^work"].join("\n"),
  ]));
  for (const [path, marker] of [["sase.md", "[[sase_goals]]"], ["sase_blog.md", "[[sase_pre_blog]]"],
    ["m.md", "[[m_child]]"], ["split.md", "~~[[x]]~~ ✅ • ~~[[y]]~~ ❌"]]) {
    texts[path] = texts[path].replace("Root ^prj", `Root ^prj\n\t- 🧩 **Sub-projects:** ${marker}`);
  }
  texts["sase_goals.md"] += "\n- [ ] #task Override [root:: sase_blog] ^override";
  texts["prose.md"] += "\nSee 🧩 **Sub-projects:** [[ghost]].\n```\n- 🧩 **Sub-projects:** [[fenced]]\n```\n- [ ] #task Other ^other\n\t- 🧩 **Sub-projects:** [[otherchild]]";
  const vectors = [
    ["LP1", "sase_goals.md", true], ["LP2", "sase.md", false], ["LP3", "sase_blog.md", false],
    ["LP4", "sase_pre_blog.md", true], ["LP5", "p.md", false], ["LP6", "o.md", false],
    ["LP7 missing", "missing.md", false], ["LP7 ambiguous", "ambiguous.md", false],
    ["LP8", "k.md", true], ["LP9", "m.md", true], ["LP10", "sase_goals.md", true],
    ["LP11", "dev.md", false], ["LP12", "a.md", true], ["LP12 reverse", "b.md", true],
    ["LP13", "job_email_recruiters.md", true], ["LP14", "rooted.md", false],
    ["LP15", "split.md", false], ["LP16", "sase_goals.md", true], ["LP17", "prose.md", false],
  ];
  return vectors.map(([id, path, expected]) => {
    // Include an excluded collision while resolution chooses the root-level note.
    const paths = [...Object.keys(fm), ...(id === "LP16" ? ["_generated/tag_pages/topic/sase.md"] : [])];
    const resolve = (target) => {
      const clean = String(target).replace(/\.md$/i, "");
      const found = paths.find((p) => p.replace(/\.md$/i, "") === clean ||
        (!clean.includes("/") && p.split("/").pop().replace(/\.md$/i, "") === clean));
      return found ? { path: found } : null;
    };
    const ctx = {
      frontmatterFor: (p) => fm[p] || null,
      noteTextFor: (p) => texts[p] || "",
      markdownPaths: () => paths,
      resolveLinkpath: resolve,
    };
    const app = {
      vault: { getMarkdownFiles: () => paths.map((p) => ({ path: p })) },
      metadataCache: {
        getCache: (p) => fm[p] ? { frontmatter: fm[p] } : null,
        getFirstLinkpathDest: resolve,
      },
    };
    return { id, path, expected, text: texts[path], ctx, app };
  });
}
module.exports = { leafFixtures };
