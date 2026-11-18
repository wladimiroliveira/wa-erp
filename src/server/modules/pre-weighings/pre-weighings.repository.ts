import { Prisma } from "@prisma/client";
import { pageArgs } from "@/server/lib/pagination";
import { prisma } from "@/server/lib/prisma";

const productSelect = { sku: true, description: true, unit: true } satisfies Prisma.ProductSelect;

const preWeighingSelect = {
  id: true,
  quantity: true,
  createdAt: true,
  product: { select: productSelect },
  production: { select: { id: true } },
  parent: { select: { id: true, product: { select: productSelect } } },
  children: {
    select: { id: true, quantity: true, product: { select: productSelect } },
    orderBy: { id: "asc" },
  },
  items: {
    select: { plannedQuantity: true, weighedQuantity: true, product: { select: productSelect } },
    orderBy: { product: { description: "asc" } },
  },
} satisfies Prisma.PreWeighingSelect;

export type PreWeighingRecord = Prisma.PreWeighingGetPayload<{ select: typeof preWeighingSelect }>;

export function findProductWithRecipe(sku: string) {
  return prisma.product.findUnique({
    where: { sku },
    select: {
      ...productSelect,
      isActive: true,
      recipe: {
        select: {
          yieldQuantity: true,
          ingredients: {
            select: {
              quantity: true,
              product: {
                select: {
                  ...productSelect,
                  isActive: true,
                  isStorableOnceOpened: true,
                  kind: true,
                  stock: { select: { averageCost: true, quantity: true } },
                },
              },
            },
            orderBy: { product: { description: "asc" } },
          },
        },
      },
    },
  });
}

// A pre-weighing to record and the ones recorded under it. A weighed quantity of null is a line that
// is taken from stock rather than weighed.
export type PlannedStage = {
  productSku: string;
  quantity: string;
  items: { productSku: string; plannedQuantity: Prisma.Decimal; weighedQuantity: string | null }[];
  stages: PlannedStage[];
};

const stageData = (
  { items, stages, ...stage }: PlannedStage,
  createdById: string,
): Prisma.PreWeighingUncheckedCreateWithoutParentInput => ({
  ...stage,
  createdById,
  items: { create: items },
  children: { create: stages.map((child) => stageData(child, createdById)) },
});

// The whole tree goes in one nested write, which the database applies as one transaction.
export function insertPreWeighingTree(tree: PlannedStage, input: { createdById: string; parentId: string | null }) {
  return prisma.preWeighing.create({
    data: { ...stageData(tree, input.createdById), parentId: input.parentId },
    select: preWeighingSelect,
  });
}

// What a complement needs to know of the pre-weighing it goes under.
export function findComplementParent(id: string) {
  return prisma.preWeighing.findUnique({
    where: { id },
    select: {
      product: { select: { recipe: { select: { ingredients: { select: { productSku: true } } } } } },
      production: { select: { production: { select: { status: true } } } },
    },
  });
}

// The pre-weighings above this one, nearest first.
export async function findAncestorIds(id: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE ancestors AS (
      SELECT p.parent_id AS id, 1 AS depth
      FROM pre_weighings p
      WHERE p.id = ${id}::uuid AND p.parent_id IS NOT NULL
      UNION ALL
      SELECT p.parent_id, a.depth + 1
      FROM pre_weighings p
      JOIN ancestors a ON p.id = a.id
      WHERE p.parent_id IS NOT NULL
    )
    SELECT id::text AS id FROM ancestors ORDER BY depth`;

  return rows.map((row) => row.id);
}

// Deletes a pre-weighing and every one recorded under it, unless one of them guides a production.
// The rows are held first, so no production can start from one of them while they are checked.
export function deletePreWeighingTree(id: string): Promise<"deleted" | "missing" | "guided"> {
  return prisma.$transaction(async (tx) => {
    const tree = await tx.$queryRaw<{ id: string; depth: number }[]>`
      WITH RECURSIVE tree AS (
        SELECT p.id, 0 AS depth FROM pre_weighings p WHERE p.id = ${id}::uuid
        UNION ALL
        SELECT p.id, t.depth + 1 FROM pre_weighings p JOIN tree t ON p.parent_id = t.id
      )
      SELECT id::text AS id, depth FROM tree ORDER BY depth DESC`;

    if (tree.length === 0) return "missing";

    const ids = tree.map((row) => row.id);

    await tx.$queryRaw`SELECT id FROM pre_weighings WHERE id = ANY(${ids}::uuid[]) FOR UPDATE`;

    if ((await tx.productionItem.count({ where: { preWeighingId: { in: ids } } })) > 0) return "guided";

    await tx.preWeighingItem.deleteMany({ where: { preWeighingId: { in: ids } } });

    // The deepest first: a pre-weighing cannot go while one under it is still there.
    for (const row of tree) await tx.preWeighing.delete({ where: { id: row.id } });

    return "deleted";
  });
}

export function findPreWeighingById(id: string) {
  return prisma.preWeighing.findUnique({ where: { id }, select: preWeighingSelect });
}

export function listPreWeighings(query: { available?: boolean; limit: number; cursor?: string }) {
  const { available, ...page } = query;
  const where: Prisma.PreWeighingWhereInput =
    available === undefined ? {} : { production: available ? null : { isNot: null } };

  return prisma.preWeighing.findMany({ where, select: preWeighingSelect, ...pageArgs(page) });
}
