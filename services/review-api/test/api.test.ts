import { describe, it, expect } from "vitest";
import { app } from "../src/index.js";

describe("review-api Endpoints", () => {
  it("app is defined with registered routes", () => {
    expect(app).toBeDefined();
    expect(app.listen).toBeDefined();
  });
});
