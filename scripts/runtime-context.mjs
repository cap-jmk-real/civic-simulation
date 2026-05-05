import process from "node:process";

function detectInstallClient() {
  const ua = String(process.env.npm_config_user_agent ?? "").toLowerCase();
  if (!ua) return "unknown";
  if (ua.includes("pnpm/")) return "pnpm";
  if (ua.includes("npm/")) return "npm";
  if (ua.includes("yarn/")) return "yarn";
  return "other";
}

const scope = process.argv[2] ? String(process.argv[2]) : "root";
const nodeVersion = process.version;
const nodeMajor = Number(process.versions.node.split(".")[0]);
const abi = process.versions.modules;
const execPath = process.execPath;
const installClient = detectInstallClient();
const ua = String(process.env.npm_config_user_agent ?? "<missing>");
const npmExecPath = String(process.env.npm_execpath ?? "<missing>");
const initCwd = String(process.env.INIT_CWD ?? "<missing>");
const cwd = process.cwd();

console.log(
  `[runtime:${scope}] Node ${nodeVersion} (major ${nodeMajor}, ABI ${abi}) via ${execPath}`,
);
console.log(`[runtime:${scope}] package manager=${installClient}; userAgent=${ua}`);
console.log(`[runtime:${scope}] npm_execpath=${npmExecPath}`);
console.log(`[runtime:${scope}] cwd=${cwd}; INIT_CWD=${initCwd}`);
