import { Prisma } from "@prisma/client";
import { pageArgs } from "@/server/lib/pagination";
import { prisma } from "@/server/lib/prisma";

const productSelect = { sku: true, description: true, unit: true } satisfies Prisma.ProductSelect;

const preWeighingSelect = {
  id: true,
  quantity: true,
  createdAt: true,
  product: { select: productSelect },
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

// The pre-weighings right under these ones, each with the status of the production whose item it
// guides: null when none does, which is also what a canceled production leaves behind.
export async function findChildrenProgress(preWeighingIds: string[], client: Prisma.TransactionClient = prisma) {
  if (preWeighingIds.length === 0) return [];

  const children = await client.preWeighing.findMany({
    where: { parentId: { in: preWeighingIds } },
    select: {
      id: true,
      parentId: true,
      product: { select: productSelect },
      production: { select: { production: { select: { status: true } } } },
    },
    orderBy: [{ product: { description: "asc" } }, { id: "asc" }],
  });

  return children.map(({ id, parentId, product, production }) => ({
    id,
    parentId: parentId!,
    product,
    status: production?.production.status ?? null,
  }));
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
