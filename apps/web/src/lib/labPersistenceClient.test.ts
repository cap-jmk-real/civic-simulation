import { describe, expect, it } from "vitest";
import { optionalFullRunJsonUnderCap } from "./labPersistenceClient";

describe("labPersistenceClient", () => {
  it("skips full-run serialization for obviously large runs", () => {
    const fakeLargeRun = {
      manifest: {
        config: {
          agentCounts: {
            bigco: 400,
            academic: 400,
            smb: 300,
            solo: 300,
          },
        },
      },
      history: new Array(200).fill(null),
    } as unknown as Parameters<typeof optionalFullRunJsonUnderCap>[0];

    expect(optionalFullRunJsonUnderCap(fakeLargeRun)).toBeNull();
  });
});
