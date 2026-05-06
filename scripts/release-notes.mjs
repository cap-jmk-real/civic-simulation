import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

function die(message) {
  console.error(message);
  process.exit(1);
}

function readChangelog(repoRoot) {
  const p = path.join(repoRoot, "CHANGELOG.md");
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf8");
}

function extractSection(changelog, tag) {
  const lines = changelog.split("\n");
  const header = `## ${tag} - `;
  const start = lines.findIndex((l) => l.startsWith(header));
  if (start === -1) return null;
  const next = lines.findIndex((l, idx) => idx > start && l.startsWith("## v"));
  const end = next === -1 ? lines.length : next;
  return lines.slice(start, end).join("\n").trim() + "\n";
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const tag = process.argv[2] ? String(process.argv[2]) : "";
  if (!tag || !/^v\d+\.\d+\.\d+$/u.test(tag)) {
    die("Usage: node scripts/release-notes.mjs vX.Y.Z");
  }
  const changelog = readChangelog(repoRoot);
  if (!changelog) {
    console.log(`## ${tag}\n\n- No changelog available.\n`);
    return;
  }
  const section = extractSection(changelog, tag);
  if (!section) {
    console.log(`## ${tag}\n\n- No changelog section found.\n`);
    return;
  }
  console.log(section);
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}

