import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveMarkup } from "@/features/pricing/actions";

const ACTOR_ID = "018f0000-0000-7000-8000-000000000001";

const PRODUCT_SKU = "018f0000-0000-7000-8000-000000000090";

const signedIn = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/server/auth/current-user", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/current-user")>()),
  requireUser: async () => ({ id: ACTOR_ID, permissions: signedIn.permissions }),
}));

const service = vi.hoisted(() => ({ setMarkup: vi.fn(), listPricing: vi.fn() }));

vi.mock("@/server/modules/pricing/pricing.service", () => service);

beforeEach(() => {
  vi.clearAllMocks();
  signedIn.permissions = [];
});

describe("saveMarkup", () => {
  it("answers 403 without PRICING_UPDATE, before touching the service", async () => {
    signedIn.permissions = ["PRICING_READ"];

    expect(await saveMarkup({ productSku: PRODUCT_SKU, markupPercent: "35" })).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(service.setMarkup).not.toHaveBeenCalled();
  });

  it("answers 400 for a markup the schema refuses", async () => {
    signedIn.permissions = ["PRICING_UPDATE"];

    expect(await saveMarkup({ productSku: PRODUCT_SKU, markupPercent: "1000.01" })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(service.setMarkup).not.toHaveBeenCalled();
  });

  it("hands sku and markup to the service with the user id and revalidates /pricing", async () => {
    signedIn.permissions = ["PRICING_UPDATE"];
    service.setMarkup.mockResolvedValue({ ok: true, data: { markupPercent: "35.00" } });

    expect(await saveMarkup({ productSku: PRODUCT_SKU, markupPercent: "35" })).toEqual({
      ok: true,
      data: { markupPercent: "35.00" },
    });
    expect(service.setMarkup).toHaveBeenCalledWith(ACTOR_ID, { productSku: PRODUCT_SKU, markupPercent: "35" });
    expect(revalidatePath).toHaveBeenCalledWith("/pricing");
  });

  it("does not revalidate when the service refuses", async () => {
    signedIn.permissions = ["PRICING_UPDATE"];
    service.setMarkup.mockResolvedValue({
      ok: false,
      status: 409,
      message: "Only a manufactured product has a markup.",
    });

    expect(await saveMarkup({ productSku: PRODUCT_SKU, markupPercent: "35" })).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
