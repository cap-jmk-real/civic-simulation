import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ENGINE_MAJOR_PATTERN = />=\s*(\d+)(?:\.\d+\.\d+)?\s*<\s*(\d+)(?:\.\d+\.\d+)?/;
const NODE_MAJOR_TO_ABI = {
  20: 115,
  21: 120,
  22: 127,
  23: 131,
  24: 137,
};

export function expectedAbiForNodeMajor(nodeMajor) {
  return NODE_MAJOR_TO_ABI[nodeMajor] ?? null;
}

export function detectNodeModuleVersionMismatch(message) {
  const raw = String(message ?? "");
  const match = raw.match(
    /compiled against NODE_MODULE_VERSION\s+(\d+)[\s\S]*?requires NODE_MODULE_VERSION\s+(\d+)/i,
  );
  if (!match) return null;
  return {
    builtAbi: Number(match[1]),
    runtimeAbi: Number(match[2]),
  };
}

export function classifyBetterSqlite3Error(error) {
  const errorCode =
    error && typeof error === "object" && "code" in error ? String(error.code ?? "") : "";
  const errorMessage = error instanceof Error ? error.message : String(error ?? "");
  const abiMismatch = detectNodeModuleVersionMismatch(errorMessage);
  if (abiMismatch) {
    return {
      kind: "abi-mismatch",
      errorMessage,
      abiMismatch,
    };
  }
  const missingByCode = errorCode === "MODULE_NOT_FOUND";
  const missingByMessage = /cannot find module ['"]better-sqlite3['"]/i.test(errorMessage);
  if (missingByCode || missingByMessage) {
    return {
      kind: "missing-module",
      errorMessage,
      abiMismatch: null,
    };
  }
  return {
    kind: "other",
    errorMessage,
    abiMismatch: null,
  };
}

export function detectWindowsNodeGypFailure(logText) {
  const raw = String(logText ?? "");
  if (!raw.trim()) return null;
  const lowered = raw.toLowerCase();
  const hasNodeGyp = lowered.includes("node-gyp") || lowered.includes("gyp err");
  const hasPythonFailure =
    /could not find any python installation/i.test(raw) ||
    /find python/i.test(raw) ||
    /python is not set from command line or npm configuration/i.test(raw);
  const hasVsFailure =
    /could not find any visual studio installation/i.test(raw) ||
    /msbuild\.exe/i.test(raw) ||
    /desktop development with c\+\+/i.test(raw);
  const hasFileLock =
    /\bEPERM\b/i.test(raw) ||
    /\bEBUSY\b/i.test(raw) ||
    /operation not permitted, unlink/i.test(raw);
  const abiMismatch = detectNodeModuleVersionMismatch(raw);
  const looksLikeCompileFailure = hasNodeGyp || hasPythonFailure || hasVsFailure;
  if (!looksLikeCompileFailure && !hasFileLock && !abiMismatch) return null;
  return {
    hasNodeGyp,
    hasPythonFailure,
    hasVsFailure,
    hasFileLock,
    abiMismatch,
  };
}

export function parseSupportedNodeMajors(engineRange) {
  const raw = String(engineRange ?? "").trim();
  const match = raw.match(ENGINE_MAJOR_PATTERN);
  if (!match) return null;
  const minMajor = Number(match[1]);
  const upperExclusiveMajor = Number(match[2]);
  if (!Number.isInteger(minMajor) || !Number.isInteger(upperExclusiveMajor)) return null;
  if (upperExclusiveMajor <= minMajor) return null;
  return { minMajor, maxMajor: upperExclusiveMajor - 1 };
}

export function isNodeMajorSupported(currentMajor, engineRange) {
  const parsed = parseSupportedNodeMajors(engineRange);
  if (!parsed) {
    return {
      ok: true,
      reason: "Unable to parse engines.node range; skipping strict major check.",
    };
  }
  if (currentMajor < parsed.minMajor || currentMajor > parsed.maxMajor) {
    return {
      ok: false,
      reason: `Node ${currentMajor} is unsupported. Expected major ${parsed.minMajor}-${parsed.maxMajor} (${engineRange}).`,
    };
  }
  return {
    ok: true,
    reason: `Node ${currentMajor} is within supported range ${engineRange}.`,
  };
}

export function readRootNodeEngine(repoRoot) {
  const packageJsonPath = path.join(repoRoot, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  return packageJson?.engines?.node ?? null;
}

export function probeBetterSqlite3Load(fromDir, options = {}) {
  const packageJsonPath = path.resolve(fromDir, "package.json");
  const customLoader = options?.moduleLoader;
  if (typeof customLoader === "function") {
    try {
      const mod = customLoader("better-sqlite3");
      if (!mod) {
        return {
          ok: false,
          errorMessage: "better-sqlite3 resolved to an empty export.",
          abiMismatch: null,
        };
      }
      return {
        ok: true,
        errorMessage: null,
        abiMismatch: null,
        failureType: null,
      };
    } catch (error) {
      const classified = classifyBetterSqlite3Error(error);
      return {
        ok: false,
        errorMessage: classified.errorMessage,
        abiMismatch: classified.abiMismatch,
        failureType: classified.kind,
      };
    }
  }

  let requireFromDir;
  let loadModule;
  try {
    requireFromDir = createRequire(packageJsonPath);
    loadModule = (specifier) => requireFromDir(specifier);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      errorMessage: `Failed to create module resolver from ${packageJsonPath}: ${errorMessage}`,
      abiMismatch: null,
    };
  }
  try {
    const mod = loadModule("better-sqlite3");
    if (!mod) {
      return {
        ok: false,
        errorMessage: "better-sqlite3 resolved to an empty export.",
        abiMismatch: null,
      };
    }
    return {
      ok: true,
      errorMessage: null,
      abiMismatch: null,
      failureType: null,
    };
  } catch (error) {
    const classified = classifyBetterSqlite3Error(error);
    return {
      ok: false,
      errorMessage: classified.errorMessage,
      abiMismatch: classified.abiMismatch,
      failureType: classified.kind,
    };
  }
}
