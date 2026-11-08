import { describe, expect, it } from "vitest";
import { costOf } from "@/features/pricing/pricing-format";

describe("costOf", () => {
  it("drops the zeros past the cent", () => expect(costOf("1.500000")).toBe("R$ 1,50"));
  it("keeps the places that carry value", () => expect(costOf("0.012345")).toBe("R$ 0,012345"));
  it("keeps the cents of a whole amount", () => expect(costOf("3.000000")).toBe("R$ 3,00"));
  it("shows a dash for no cost", () => expect(costOf(null)).toBe("—"));
});
