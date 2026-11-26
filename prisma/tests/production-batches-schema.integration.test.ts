import { afterAll, afterEach, describe, expect, it } from "vitest";
import { resetDatabase, testPrisma } from "@/server/testing/database";

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

async function createItem() {
  const [product, user] = await Promise.all([
    testPrisma.product.create({ data: { description: "Bread", kind: "MANUFACTURED", unit: "KILOGRAM" } }),
    testPrisma.user.create({ data: { name: "Someone", username: "someone", passwordHash: "x" } }),
  ]);
  const production = await testPrisma.production.create({
    data: { createdById: user.id, items: { create: { productSku: product.sku, expectedQuantity: "10" } } },
    include: { items: true },
  });

  return { product, user, item: production.items[0]! };
}

describe("production_item_batches", () => {
  it("round-trips a batch with its quantity, expiry and source", async () => {
    const { user, item } = await createItem();

    const batch = await testPrisma.productionItemBatch.create({
      data: {
        productionItemId: item.id,
        quantity: "4.5",
        expiresAt: new Date("2027-01-31T00:00:00.000Z"),
        source: "EXISTING",
        createdById: user.id,
      },
    });

    expect(batch.quantity.toString()).toBe("4.5");
    expect(batch.expiresAt?.toISOString()).toBe("2027-01-31T00:00:00.000Z");
    expect(batch.source).toBe("EXISTING");
    expect(await testPrisma.productionItemBatch.count({ where: { productionItemId: item.id } })).toBe(1);
  });

  it("accepts a batch that never expires", async () => {
    const { user, item } = await createItem();

    const batch = await testPrisma.productionItemBatch.create({
      data: { productionItemId: item.id, quantity: "1", source: "PRODUCED", createdById: user.id },
    });

    expect(batch.expiresAt).toBeNull();
  });

  it("restricts deleting an item that has a batch", async () => {
    const { user, item } = await createItem();
    await testPrisma.productionItemBatch.create({
      data: { productionItemId: item.id, quantity: "1", source: "PRODUCED", createdById: user.id },
    });

    await expect(testPrisma.productionItem.delete({ where: { id: item.id } })).rejects.toThrow();
  });
});

describe("production_item_weighings", () => {
  it("links a pre-weighing to an item as an extra weighing", async () => {
    const { product, user, item } = await createItem();
    const preWeighing = await testPrisma.preWeighing.create({
      data: { productSku: product.sku, quantity: "5", createdById: user.id },
    });

    await testPrisma.productionItemWeighing.create({
      data: { productionItemId: item.id, preWeighingId: preWeighing.id },
    });

    const found = await testPrisma.productionItem.findUniqueOrThrow({
      where: { id: item.id },
      include: { extraWeighings: true },
    });

    expect(found.extraWeighings.map((weighing) => weighing.preWeighingId)).toEqual([preWeighing.id]);
  });

  it("refuses the same pre-weighing linked twice", async () => {
    const { product, user, item } = await createItem();
    const other = await testPrisma.production.create({
      data: { createdById: user.id, items: { create: { productSku: product.sku, expectedQuantity: "1" } } },
      include: { items: true },
    });
    const preWeighing = await testPrisma.preWeighing.create({
      data: { productSku: product.sku, quantity: "5", createdById: user.id },
    });
    await testPrisma.productionItemWeighing.create({
      data: { productionItemId: item.id, preWeighingId: preWeighing.id },
    });

    await expect(
      testPrisma.productionItemWeighing.create({
        data: { productionItemId: other.items[0]!.id, preWeighingId: preWeighing.id },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
