import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const SHIELDCN_BASE = "https://shieldcn.dev";
const README_PATH = path.join(repoRoot, "README.md");

function parseJsonFromCliOutput(stdout) {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Could not find JSON object in shieldcn-cli output.");
  }
  return JSON.parse(stdout.slice(start, end + 1));
}

function coerceVersionMajor(versionRange) {
  // examples: ">=24.0.0 <25", "24", "^24.1.0"
  const m = String(versionRange).match(/(\d+)(?:\.\d+)?(?:\.\d+)?/);
  return m?.[1] ?? "";
}

function coerceVersionMinor(versionRange) {
  // examples: "^15.1.6" -> "15", "^5.7.2" -> "5.7"
  const m = String(versionRange).match(/(\d+)\.(\d+)/);
  if (m) return `${m[1]}.${m[2]}`;
  return coerceVersionMajor(versionRange);
}

function badgeStatic({ label, message, color, logo, variant = "branded" }) {
  const safeLabel = String(label).replace(/-/g, "_");
  const safeMessage = String(message).replace(/-/g, "_");
  const p = `/badge/${encodeURIComponent(safeLabel)}-${encodeURIComponent(
    safeMessage,
  )}-${encodeURIComponent(color)}.svg`;
  const qp = new URLSearchParams();
  if (logo) qp.set("logo", logo);
  if (variant) qp.set("variant", variant);
  return `${SHIELDCN_BASE}${p}?${qp.toString()}`;
}

function mdBadge({ alt, img, href }) {
  if (!href) return `![${alt}](${img})`;
  return `[![${alt}](${img})](${href})`;
}

async function readJson(relPath) {
  const full = path.join(repoRoot, relPath);
  return JSON.parse(await readFile(full, "utf8"));
}

async function getRepoMetaViaShieldcnCli() {
  // Prefer pnpm dlx so it works in this workspace without extra deps.
  const { stdout } =
    process.platform === "win32"
      ? await execFileAsync(
          "cmd.exe",
          ["/d", "/s", "/c", "pnpm -s dlx shieldcn-cli --json"],
          { cwd: repoRoot, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
        )
      : await execFileAsync(
          "pnpm",
          ["-s", "dlx", "shieldcn-cli", "--json"],
          { cwd: repoRoot, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
        );
  const json = parseJsonFromCliOutput(stdout);
  return {
    owner: json?.source?.owner,
    repo: json?.source?.repo,
    badges: Array.isArray(json?.badges) ? json.badges : [],
  };
}

async function generateBadgesMarkdown() {
  const rootPkg = await readJson("package.json");
  const webPkg = await readJson(path.join("apps", "web", "package.json"));

  const pnpmVersion = String(rootPkg.packageManager ?? "")
    .split("@")
    .slice(1)
    .join("@");
  const nodeMajor = coerceVersionMajor(rootPkg?.engines?.node);
  const tsMinor = coerceVersionMinor(webPkg?.devDependencies?.typescript);
  const nextMajor = coerceVersionMajor(webPkg?.dependencies?.next);

  const { owner, repo, badges } = await getRepoMetaViaShieldcnCli();
  const ci = badges.find((b) => b?.id === "github.ci");
  const license = badges.find((b) => b?.id === "github.license");

  const actionsUrl = owner && repo ? `https://github.com/${owner}/${repo}/actions/workflows/ci.yml` : "";
  const licenseUrl = "LICENSE";
  const docsUrl = owner && repo ? `https://${owner}.github.io/${repo}/` : "";

  const parts = [
    mdBadge({
      alt: "CI",
      img: ci?.url ? ci.url.replace("https://www.shieldcn.dev", SHIELDCN_BASE) : `${SHIELDCN_BASE}/github/ci/${owner}/${repo}.svg?variant=secondary`,
      href: actionsUrl,
    }),
    mdBadge({
      alt: "Docs",
      img: badgeStatic({
        label: "docs",
        message: "GitHub_Pages",
        color: "0ea5e9",
        logo: "readthedocs",
        variant: "secondary",
      }),
      href: docsUrl,
    }),
    mdBadge({
      alt: "License",
      img: license?.url ? license.url.replace("https://www.shieldcn.dev", SHIELDCN_BASE) : `${SHIELDCN_BASE}/github/license/${owner}/${repo}.svg?variant=ghost`,
      href: licenseUrl,
    }),
    mdBadge({
      alt: "pnpm",
      img: badgeStatic({
        label: "pnpm",
        message: pnpmVersion || "workspace",
        color: "F69220",
        logo: "pnpm",
      }),
      href: "https://pnpm.io/",
    }),
    mdBadge({
      alt: "Node",
      img: badgeStatic({
        label: "node",
        message: nodeMajor || "unknown",
        color: "339933",
        logo: "node.js",
      }),
      href: "https://nodejs.org/",
    }),
    mdBadge({
      alt: "TypeScript",
      img: badgeStatic({
        label: "TypeScript",
        message: tsMinor || "unknown",
        color: "3178C6",
        logo: "typescript",
      }),
      href: "https://www.typescriptlang.org/",
    }),
    mdBadge({
      alt: "Next.js",
      img: badgeStatic({
        label: "Next.js",
        message: nextMajor || "unknown",
        color: "000000",
        logo: "next.js",
        variant: "secondary",
      }),
      href: "https://nextjs.org/",
    }),
    mdBadge({
      alt: "Rust",
      img: badgeStatic({
        label: "Rust",
        message: "stable",
        color: "000000",
        logo: "rust",
        variant: "secondary",
      }),
      href: "https://www.rust-lang.org/",
    }),
    mdBadge({
      alt: "WASM",
      img: badgeStatic({
        label: "WebAssembly",
        message: "WASM",
        color: "654FF0",
        logo: "webassembly",
        variant: "secondary",
      }),
      href: "https://webassembly.org/",
    }),
  ].filter(Boolean);

  return `${parts.join("\n")}\n`;
}

function injectBetweenMarkers(readme, content) {
  const start = "<!-- shieldcn-start -->";
  const end = "<!-- shieldcn-end -->";

  if (readme.includes(start) && readme.includes(end)) {
    const before = readme.slice(0, readme.indexOf(start) + start.length);
    const after = readme.slice(readme.indexOf(end));
    return `${before}\n${content}${after}`;
  }

  // No markers: insert after first heading line.
  const lines = readme.split(/\r?\n/);
  const headingIdx = lines.findIndex((l) => l.startsWith("# "));
  if (headingIdx === -1) {
    return `${start}\n${content}${end}\n\n${readme}`;
  }

  const insertAt = headingIdx + 2;
  lines.splice(insertAt, 0, start, content.trimEnd(), end, "");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const write = args.has("--write") || args.has("--inject");

  const badges = await generateBadgesMarkdown();

  if (!write) {
    process.stdout.write(badges);
    return;
  }

  const readme = await readFile(README_PATH, "utf8");
  const next = injectBetweenMarkers(readme, badges);
  if (next !== readme) await writeFile(README_PATH, next, "utf8");
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

