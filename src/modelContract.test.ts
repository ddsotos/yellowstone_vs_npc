import { describe, expect, it } from "vitest";
import metadata from "../public/models/registry.json";
import { MODEL_ID, verifyModelContract } from "./modelContract";

describe("static public model contract", () => {
  it("contains only the fixed public gated model", () => {
    expect(metadata.models).toHaveLength(1);
    expect(metadata.models[0].id).toBe(MODEL_ID);
    expect(() => verifyModelContract()).not.toThrow();
  });
});
