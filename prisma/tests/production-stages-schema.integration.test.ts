import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { resetDatabase, testPrisma } from "@/server/testing/database";

const MIGRATION = fileURLToPath(
  new URL("../migrations/20261122000000_add_production_stages/migration.sql", import.meta.url),
);

// The statement that gives the items of a finished production what the production recorded. It ran
// once, when the migration was applied to an empty test schema; running it again is what tests it.
function backfillStatement(): string {
  const sql = readFileSync(MIGRATION, "utf8");
  const statement = /\n(UPDATE production_items[\s\S]*?;)/.exec(sql);

  expect(statement).not.toBeNull();

  return statement![1]!;
}

// Thrown to roll back what the backfill test wrote, the column it put back included.
class RolledBack extends Error {}

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
    data: {
      createdById: user.id,
      items: { create: { productSku: product.sku, expectedQuantity: "10" } },
    },
    include: { items: true },
  });
  const reason = await testPrisma.lossReason.create({ data: { name: "Burnt" } });

  return { product, user, item: production.items[0]!, reason };
}

describe("production_items", () => {
  it("starts pending, with no finish date and no leftovers choice", async () => {
    const { item } = await createItem();

    expect(item.status).toBe("PENDING");
    expect(item.finishedAt).toBeNull();
    expect(item.hasLeftoversInCost).toBeNull();
  });
});

describe("production_item_damages", () => {
  it("lets a pre-weighing be damaged at most once", async () => {
    const { product, user, item, reason } = await createItem();
    const preWeighing = await testPrisma.preWeighing.create({
      data: { productSku: product.sku, createdById: user.id, quantity: "10" },
    });
    const data = {
      productionItemId: item.id,
      preWeighingId: preWeighing.id,
      reasonId: reason.id,
      createdById: user.id,
    };

    await testPrisma.productionItemDamage.create({ data });

    await expect(testPrisma.productionItemDamage.create({ data })).rejects.toMatchObject({ code: "P2002" });
  });

  it("is read back from the losses it made", async () => {
    const { product, user, item, reason } = await createItem();
    const damage = await testPrisma.productionItemDamage.create({
      data: { productionItemId: item.id, reasonId: reason.id, createdById: user.id },
    });
    const lot = await testPrisma.stockLot.create({
      data: { productSku: product.sku, initialQuantity: "5", quantity: "5", unitCost: "2" },
    });
    const movement = await testPrisma.stockMovement.create({
      data: {
        productSku: product.sku,
        lotId: lot.id,
        type: "LOSS",
        quantity: "1",
        unitCost: "2",
        createdById: user.id,
      },
    });
    const loss = await testPrisma.stockLoss.create({
      data: { lotId: lot.id, reasonId: reason.id, movementId: movement.id, createdById: user.id, damageId: damage.id },
    });

    expect(loss.damageId).toBe(damage.id);
  });
});

describe("production stages backfill", () => {
  // The column the migration dropped is put back inside a transaction that is always rolled back, so
  // the statement runs on the shape it was written for and the schema is left as the migration left it.
  async function backfill(productions: { status: "IN_PROGRESS" | "FINISHED"; hasLeftoversInCost: boolean | null }[]) {
    const [product, user] = await Promise.all([
      testPrisma.product.create({ data: { description: "Bread", kind: "MANUFACTURED", unit: "KILOGRAM" } }),
      testPrisma.user.create({ data: { name: "Someone", username: "someone", passwordHash: "x" } }),
    ]);
    const finishedAt = new Date("2026-11-20T15:30:00.000Z");
    let items: {
      productionId: string;
      status: string;
      finishedAt: Date | null;
      hasLeftoversInCost: boolean | null;
    }[] = [];
    const ids: string[] = [];

    await testPrisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`ALTER TABLE productions ADD COLUMN has_leftovers_in_cost BOOLEAN`);

        for (const { status, hasLeftoversInCost } of productions) {
          const production = await tx.production.create({
            data: {
              status,
              finishedAt: status === "FINISHED" ? finishedAt : null,
              createdById: user.id,
              items: {
                create: [
                  { productSku: product.sku, expectedQuantity: "10" },
                  { productSku: product.sku, expectedQuantity: "5" },
                ],
              },
            },
          });
          await tx.$executeRaw`UPDATE productions SET has_leftovers_in_cost = ${hasLeftoversInCost} WHERE id = ${production.id}::uuid`;
          ids.push(production.id);
        }

        await tx.$executeRawUnsafe(backfillStatement());

        items = await tx.productionItem.findMany({
          where: { productionId: { in: ids } },
          select: { productionId: true, status: true, finishedAt: true, hasLeftoversInCost: true },
        });

        throw new RolledBack();
      })
      .catch((error: unknown) => {
        if (!(error instanceof RolledBack)) throw error;
      });

    return { ids, items, finishedAt };
  }

  it("marks every item of a finished production finished, at its finish, with its leftovers choice", async () => {
    const { ids, items, finishedAt } = await backfill([
      { status: "FINISHED", hasLeftoversInCost: true },
      { status: "FINISHED", hasLeftoversInCost: false },
    ]);

    expect(items).toHaveLength(4);
    expect(items.filter(({ productionId }) => productionId === ids[0])).toEqual([
      { productionId: ids[0], status: "FINISHED", finishedAt, hasLeftoversInCost: true },
      { productionId: ids[0], status: "FINISHED", finishedAt, hasLeftoversInCost: true },
    ]);
    expect(items.filter(({ productionId }) => productionId === ids[1])).toEqual([
      { productionId: ids[1], status: "FINISHED", finishedAt, hasLeftoversInCost: false },
      { productionId: ids[1], status: "FINISHED", finishedAt, hasLeftoversInCost: false },
    ]);
  });

  it("leaves the items of a production in progress pending", async () => {
    const { items } = await backfill([{ status: "IN_PROGRESS", hasLeftoversInCost: null }]);

    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item).toMatchObject({ status: "PENDING", finishedAt: null, hasLeftoversInCost: null });
    }
  });

  it("leaves the schema as the migration left it", async () => {
    await backfill([{ status: "FINISHED", hasLeftoversInCost: true }]);

    const columns = await testPrisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'productions' AND column_name = 'has_leftovers_in_cost'`;

    expect(columns).toEqual([]);
    expect(await testPrisma.production.count()).toBe(0);
  });
});
