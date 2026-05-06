import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

function die(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, cwd) {
  const proc = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  if ((proc.status ?? 1) !== 0) {
    process.exit(proc.status ?? 1);
  }
}

function runCapture(command, args, cwd) {
  const proc = spawnSync(command, args, {
    cwd,
    stdio: "pipe",
    shell: false,
    env: process.env,
    encoding: "utf8",
  });
  if ((proc.status ?? 1) !== 0) {
    const out = `${proc.stdout ?? ""}\n${proc.stderr ?? ""}`.trim();
    die(out || `Command failed: ${command} ${args.join(" ")}`);
  }
  return String(proc.stdout ?? "").trim();
}

function parseArgs(argv) {
  const args = {
    bump: null,
    commit: true,
    tag: true,
    changelog: true,
    dryRun: false,
  };

  const positionals = [];
  for (const raw of argv) {
    if (raw === "--no-commit") args.commit = false;
    else if (raw === "--no-tag") args.tag = false;
    else if (raw === "--no-changelog") args.changelog = false;
    else if (raw === "--dry-run") args.dryRun = true;
    else if (raw === "-h" || raw === "--help") args.bump = "help";
    else positionals.push(raw);
  }

  if (args.bump !== "help") {
    const bump = positionals[0] ? String(positionals[0]) : "";
    if (!bump) args.bump = "patch";
    else args.bump = bump;
  }

  return args;
}

function isSemver(text) {
  return /^\d+\.\d+\.\d+$/u.test(String(text));
}

function bumpSemver(current, bump) {
  if (!isSemver(current)) die(`[version] Root package.json version is not a simple semver: '${current}'`);
  const [maj, min, pat] = current.split(".").map((n) => Number(n));
  if (![maj, min, pat].every((n) => Number.isFinite(n) && n >= 0)) die(`[version] Invalid semver: '${current}'`);
  if (bump === "patch") return `${maj}.${min}.${pat + 1}`;
  if (bump === "minor") return `${maj}.${min + 1}.0`;
  if (bump === "major") return `${maj + 1}.0.0`;
  die(`[version] Unknown bump '${bump}'. Use patch|minor|major.`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(filePath, text, "utf8");
}

function ensureCleanGit(repoRoot) {
  const status = runCapture("git", ["status", "--porcelain"], repoRoot);
  if (status) die("[git] Working tree is not clean. Commit or stash before bumping.");
}

function findLastTag(repoRoot) {
  const last = runCapture("git", ["tag", "--list", "v*", "--sort=-version:refname"], repoRoot)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)[0];
  return last || null;
}

function collectCommits(repoRoot, range) {
  const format = "%h%x09%s";
  const out = runCapture("git", ["log", "--no-merges", `--pretty=format:${format}`, range], repoRoot);
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, subject] = line.split("\t");
      return { sha, subject: subject ?? "" };
    });
}

function buildChangelogSection(version, commits) {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push(`## v${version} - ${date}`);
  lines.push("");
  if (!commits.length) {
    lines.push("- No changes recorded.");
    lines.push("");
    return lines.join("\n");
  }
  for (const c of commits) {
    lines.push(`- ${c.subject} (${c.sha})`);
  }
  lines.push("");
  return lines.join("\n");
}

function upsertChangelog(repoRoot, nextVersion, lastTag) {
  const changelogPath = path.join(repoRoot, "CHANGELOG.md");
  const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
  const commits = collectCommits(repoRoot, range);
  const section = buildChangelogSection(nextVersion, commits);

  const header = [
    "# Changelog",
    "",
    "All notable changes to this repository will be documented in this file.",
    "",
  ].join("\n");

  const existing = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, "utf8") : "";
  const body = existing.trim() ? existing.trimEnd() + "\n\n" : header;
  const next = body.startsWith("# Changelog") ? body.replace(/^# Changelog\s*/u, "# Changelog\n\n") : `${header}\n`;

  const insertAfterHeader = next.startsWith("# Changelog\n\n") ? "# Changelog\n\n" : "# Changelog\n";
  const updated = next.replace(insertAfterHeader, `${insertAfterHeader}${section}`);
  fs.writeFileSync(changelogPath, updated, "utf8");
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const args = parseArgs(process.argv.slice(2));

  if (args.bump === "help") {
    console.log(`Usage:
  pnpm version:patch
  pnpm version:minor
  pnpm version:major

Or directly:
  node scripts/bump-version.mjs [patch|minor|major] [--no-commit] [--no-tag] [--no-changelog] [--dry-run]
`);
    process.exit(0);
  }

  ensureCleanGit(repoRoot);

  const rootPkgPath = path.join(repoRoot, "package.json");
  const rootPkg = readJson(rootPkgPath);
  const current = rootPkg.version;
  if (!current) die("[version] Root package.json missing 'version'.");

  const nextVersion = bumpSemver(String(current), String(args.bump));
  const nextTag = `v${nextVersion}`;

  const versionedPackageJsonPaths = [
    rootPkgPath,
    path.join(repoRoot, "apps", "web", "package.json"),
    path.join(repoRoot, "packages", "sim-core", "package.json"),
    path.join(repoRoot, "packages", "ip-sim-wasm", "package.json"),
  ].filter((p) => fs.existsSync(p));

  const originalVersions = new Map();
  for (const pkgPath of versionedPackageJsonPaths) {
    const json = readJson(pkgPath);
    if (!json.version) continue;
    originalVersions.set(pkgPath, String(json.version));
    json.version = nextVersion;
    if (!args.dryRun) writeJson(pkgPath, json);
  }

  const lastTag = findLastTag(repoRoot);
  if (args.changelog && !args.dryRun) {
    upsertChangelog(repoRoot, nextVersion, lastTag);
  }

  if (args.dryRun) {
    console.log(`[dry-run] Would bump to ${nextTag}:`);
    for (const [p, v] of originalVersions.entries()) {
      const rel = path.relative(repoRoot, p).replace(/\\/g, "/");
      console.log(`  - ${rel}: ${v} -> ${nextVersion}`);
    }
    if (args.changelog) {
      console.log(`  - CHANGELOG.md: add section for ${nextTag}`);
    }
    if (args.commit) {
      console.log(`  - commit: chore(release): ${nextTag}`);
    }
    if (args.tag) {
      console.log(`  - tag: ${nextTag}`);
    }
    process.exit(0);
  }

  if (args.commit) {
    run("git", ["add", "package.json", "apps/web/package.json", "packages/sim-core/package.json", "packages/ip-sim-wasm/package.json", "CHANGELOG.md"], repoRoot);
    run("git", ["commit", "-m", `chore(release): ${nextTag}`], repoRoot);
  }

  if (args.tag) {
    run("git", ["tag", "-a", nextTag, "-m", nextTag], repoRoot);
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}

