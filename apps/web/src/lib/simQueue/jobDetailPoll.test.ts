import { describe, expect, it } from "vitest";
import { shouldPollSimJobDetail } from "./jobDetailPoll";

describe("shouldPollSimJobDetail", () => {
  it("is true while status unknown, queued, or running", () => {
    expect(shouldPollSimJobDetail(undefined)).toBe(true);
    expect(shouldPollSimJobDetail("queued")).toBe(true);
    expect(shouldPollSimJobDetail("running")).toBe(true);
  });

  it("is false when terminal", () => {
    expect(shouldPollSimJobDetail("done")).toBe(false);
    expect(shouldPollSimJobDetail("failed")).toBe(false);
    expect(shouldPollSimJobDetail("cancelled")).toBe(false);
  });
});
