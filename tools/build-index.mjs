// Build the DSH plugin market index (format 1) for this repository.
//
// The index pins every plugin version to an exact commit, so an installation is
// reproducible. The plugin package is the repository root, so the install
// spec needs no subdirectory fragment: pnpm resolves the root package.json.
//
//   node tools/build-index.mjs [--commit <sha>] [--out market/index.json]
//
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_URL = "https://github.com/Onarous/DSH-GeminApi";

function git(...args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : argv[at + 1];
}

// The commit that holds the plugin sources.
//
// It is the last commit that touched the plugin package, not HEAD: the index
// lives in this repository too, so pinning HEAD would make every index-only
// commit invalidate the pin, and the release workflow would then fail on its
// own index rebuild.
const PLUGIN_PATHS = ["package.json", "lib", "locale", "icon.svg", "cordis.patch.yml"];
function lastPluginCommit() {
  try {
    return git("rev-list", "-1", "HEAD", "--", ...PLUGIN_PATHS);
  } catch {
    return git("rev-parse", "HEAD");
  }
}
const commit = arg("commit") ?? lastPluginCommit();
const out = resolve(repoRoot, arg("out", join("market", "index.json")));

const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const version = manifest.version;

// The publish time is the commit's own date, so rebuilding the index for the
// same sources produces the same document and a rebuild never differs from
// what is committed.
function commitTimestamp(sha) {
  try {
    return Number(git("show", "-s", "--format=%ct", sha));
  } catch {
    return Math.floor(Date.now() / 1000);
  }
}
const published = commitTimestamp(commit);

const index = {
  format: 1,
  title: { en: "Onarous DSH Plugins" },
  description: {
    en: "Plugin bundles published by Onarous for the DeepSeek Harness plugin market.",
  },
  metadata: {
    categories: {
      productivity: { title: { en: "Productivity" } },
      developer: { title: { en: "Developer Tools" } },
    },
    labels: {
      community: { title: { en: "Community" } },
    },
    sortKeys: {},
  },
  plugins: [
    {
      name: manifest.name,
      title: { en: "GeminApi Quotas" },
      description: {
        en: "Shows GeminApi account quotas and provides the parallel_task and dsh_subagent tools for DeepSeek Harness.",
      },
      author: "Onarous",
      homepage: REPO_URL,
      icon: `https://raw.githubusercontent.com/Onarous/DSH-GeminApi/main/icon.svg`,
      repository: { url: REPO_URL },
      metadata: {
        category: "productivity",
        keywords: ["geminapi", "quotas", "parallel-task", "subagent", "parallel"],
        labels: ["community"],
      },
      versions: [
        {
          version,
          publishTimestamp: published,
          source: {
            type: "git",
            url: REPO_URL,
            commit,
          },
          engines: { dsh: manifest.engines?.dsh ?? ">=0.2.0-rc.1" },
        },
      ],
    },
  ],
};

writeFileSync(out, `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(`wrote ${out}`);
console.log(`  plugin  ${manifest.name}@${version}`);
console.log(`  commit  ${commit}`);
console.log(`  engines dsh ${index.plugins[0].versions[0].engines.dsh}`);
console.log(`  spec    git+https://github.com/Onarous/DSH-GeminApi.git#${commit}`);
