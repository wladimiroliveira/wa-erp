import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { takeFromHeldLot } from "./stock.repository";

vi.mock("@/server/lib/prisma", () => ({ prisma: {} }));

// A transaction that answers the guarded update with `updated` rows and records what else it is asked.
function heldTransaction(updated: number) {
  return {
    $executeRaw: vi.fn(async () => updated),
    $queryRaw: vi.fn(async () => [{ averageCost: null }]),
    stockLot: { findUnique: vi.fn(), aggregate: vi.fn(), update: vi.fn() },
    productStock: { upsert: vi.fn(), findUnique: vi.fn() },
  };
}

const take = { lotId: "lot-1", productSku: "sku-milk", quantity: new Prisma.Decimal("95") };

describe("takeFromHeldLot", () => {
  it("lowers a lot already held, and the balance, without holding them again", async () => {
    const tx = heldTransaction(1);

    await takeFromHeldLot(tx as unknown as Prisma.TransactionClient, take);

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.stockLot.findUnique).not.toHaveBeenCalled();
    expect(tx.stockLot.aggregate).not.toHaveBeenCalled();
  });

  it("refuses to take more than the lot holds", async () => {
    await expect(takeFromHeldLot(heldTransaction(0) as unknown as Prisma.TransactionClient, take)).rejects.toThrow(
      /lot-1/,
    );
  });
});
