import process from "node:process";

function detectInstallClient() {
  const ua = String(process.env.npm_config_user_agent ?? "").toLowerCase();
  if (!ua) return "unknown";
  if (ua.includes("pnpm/")) return "pnpm";
  if (ua.includes("npm/")) return "npm";
  if (ua.includes("yarn/")) return "yarn";
  return "other";
}

const installClient = detectInstallClient();
if (installClient === "pnpm") {
  process.exit(0);
}

console.warn(`[preinstall] Detected '${installClient}' as install client.`);
console.warn("[preinstall] This monorepo uses pnpm workspaces. Please run `pnpm install` from the repo root.");
console.warn("[preinstall] Continuing install to avoid trapping you in a broken state.");
process.exit(0);
