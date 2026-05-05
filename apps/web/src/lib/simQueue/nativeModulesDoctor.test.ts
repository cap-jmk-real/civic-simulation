import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  classifyBetterSqlite3Error,
  detectNodeModuleVersionMismatch,
  expectedAbiForNodeMajor,
  isNodeMajorSupported,
  parseSupportedNodeMajors,
  probeBetterSqlite3Load,
} from "../../../../../scripts/native-modules-doctor.js";

describe("native module doctor helpers", () => {
  it("parses bounded engine majors", () => {
    expect(parseSupportedNodeMajors(">=24.0.0 <25")).toEqual({ minMajor: 24, maxMajor: 24 });
  });

  it("accepts supported node majors", () => {
    const result = isNodeMajorSupported(24, ">=24.0.0 <25");
    expect(result.ok).toBe(true);
  });

  it("rejects unsupported node majors with actionable reason", () => {
    const result = isNodeMajorSupported(22, ">=24.0.0 <25");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("unsupported");
    expect(result.reason).toContain("24-24");
  });

  it("maps expected ABI for known Node majors", () => {
    expect(expectedAbiForNodeMajor(22)).toBe(127);
    expect(expectedAbiForNodeMajor(24)).toBe(137);
  });

  it("detects NODE_MODULE_VERSION mismatch from load error", () => {
    const mismatch = detectNodeModuleVersionMismatch(
      "The module was compiled against NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 137.",
    );
    expect(mismatch).toEqual({
      builtAbi: 127,
      runtimeAbi: 137,
    });
  });

  it("classifies missing better-sqlite3 module errors", () => {
    const classified = classifyBetterSqlite3Error({
      code: "MODULE_NOT_FOUND",
      message: "Cannot find module 'better-sqlite3'",
    });
    expect(classified.kind).toBe("missing-module");
  });

  it("classifies ABI mismatch module errors", () => {
    const classified = classifyBetterSqlite3Error(
      new Error(
        "The module was compiled against NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 137.",
      ),
    );
    expect(classified.kind).toBe("abi-mismatch");
    expect(classified.abiMismatch).toEqual({ builtAbi: 127, runtimeAbi: 137 });
  });

  it("probes from package-json based directory and marks missing dependency", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "native-doctor-"));
    try {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "tmp-probe" }));
      const missingError = Object.assign(new Error("Cannot find module 'better-sqlite3'"), {
        code: "MODULE_NOT_FOUND",
      });
      const moduleLoader = vi.fn(() => {
        throw missingError;
      });

      const result = probeBetterSqlite3Load(tempDir, { moduleLoader });
      expect(result.ok).toBe(false);
      expect(result.failureType).toBe("missing-module");
      expect(moduleLoader).toHaveBeenCalledWith("better-sqlite3");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
