import { Prisma } from "@prisma/client";
import { pageArgs } from "@/server/lib/pagination";
import { prisma } from "@/server/lib/prisma";
import { STALE_AFTER_MS, type PreWeighingStatus } from "./pre-weighing-status";

const productSelect = { sku: true, description: true, unit: true } satisfies Prisma.ProductSelect;

// The item that took a pre-weighing as an extra weighing, when it did.
const extraItemSelect = { select: { productionItem: { select: { status: true } } } } as const;

const preWeighingSelect = {
  id: true,
  quantity: true,
  createdAt: true,
  product: { select: productSelect },
  production: { select: { status: true } },
  productionWeighing: extraItemSelect,
  damage: { select: { id: true } },
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

// The whole tree goes in one nested write, which the database applies as one transaction; a client
// of a transaction makes it part of that one.
export function insertPreWeighingTree(
  tree: PlannedStage,
  input: { createdById: string; parentId: string | null },
  client: Prisma.TransactionClient = prisma,
) {
  return client.preWeighing.create({
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
      production: { select: { status: true } },
      productionWeighing: extraItemSelect,
      damage: { select: { id: true } },
    },
  });
}

// Deletes a pre-weighing and every one recorded under it, unless one of them is not pending: guided
// by a production item, taken as an extra weighing or named by a damage.
// The rows are held first, so no production can start from one of them while they are checked.
export function deletePreWeighingTree(id: string): Promise<"deleted" | "missing" | "not-pending"> {
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

    if ((await tx.productionItem.count({ where: { preWeighingId: { in: ids } } })) > 0) return "not-pending";
    if ((await tx.productionItemWeighing.count({ where: { preWeighingId: { in: ids } } })) > 0) return "not-pending";
    if ((await tx.productionItemDamage.count({ where: { preWeighingId: { in: ids } } })) > 0) return "not-pending";

    await tx.preWeighingItem.deleteMany({ where: { preWeighingId: { in: ids } } });

    // The deepest first: a pre-weighing cannot go while one under it is still there.
    for (const row of tree) await tx.preWeighing.delete({ where: { id: row.id } });

    return "deleted";
  });
}

export function findPreWeighingById(id: string) {
  return prisma.preWeighing.findUnique({ where: { id }, select: preWeighingSelect });
}

// Where a pre-weighing sits in its tree: null for a root, undefined when there is no such pre-weighing.
export async function findPreWeighingParentId(id: string, client: Prisma.TransactionClient = prisma) {
  const found = await client.preWeighing.findUnique({ where: { id }, select: { parentId: true } });

  return found?.parentId;
}

// Guided by an item, or taken as an extra weighing of one: either reads the same.
const ofItem = (status: "FINISHED" | "PENDING"): Prisma.PreWeighingWhereInput => ({
  damage: null,
  OR: [{ production: { status } }, { productionWeighing: { productionItem: { status } } }],
});

const whereOfStatus: Record<PreWeighingStatus, Prisma.PreWeighingWhereInput> = {
  DAMAGED: { damage: { isNot: null } },
  PRODUCED: ofItem("FINISHED"),
  IN_PRODUCTION: ofItem("PENDING"),
  PENDING: { damage: null, production: null, productionWeighing: null },
};

const staleWhere = (now: Date): Prisma.PreWeighingWhereInput => ({
  ...whereOfStatus.PENDING,
  createdAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) },
});

export function listPreWeighings(
  query: { status?: PreWeighingStatus; staleOnly?: boolean; limit: number; cursor?: string },
  now = new Date(),
) {
  const { status, staleOnly, ...page } = query;
  const filters: Prisma.PreWeighingWhereInput[] = [];

  if (status !== undefined) filters.push(whereOfStatus[status]);
  if (staleOnly) filters.push(staleWhere(now));

  return prisma.preWeighing.findMany({ where: { AND: filters }, select: preWeighingSelect, ...pageArgs(page) });
}

export function countStalePreWeighings(now = new Date()) {
  return prisma.preWeighing.count({ where: staleWhere(now) });
}

// The pre-weighing and every one recorded under it, the root first and then each branch depth-first.
export async function findPreWeighingTree(
  rootId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<PreWeighingRecord[]> {
  const rows = await client.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE tree AS (
      SELECT p.id, ARRAY[p.id] AS path FROM pre_weighings p WHERE p.id = ${rootId}::uuid
      UNION ALL
      SELECT p.id, t.path || p.id FROM pre_weighings p JOIN tree t ON p.parent_id = t.id
    )
    SELECT id::text AS id FROM tree ORDER BY path`;
  const records = await client.preWeighing.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
    select: preWeighingSelect,
  });
  const byId = new Map(records.map((record) => [record.id, record]));

  return rows.map((row) => byId.get(row.id)!);
}

// What a guided production can start from: a pending pre-weighing whose parent is not pending, if
// there is one.
const startRootWhere: Prisma.PreWeighingWhereInput = {
  ...whereOfStatus.PENDING,
  OR: [{ parentId: null }, { parent: { NOT: whereOfStatus.PENDING } }],
};

export async function isPendingStartRoot(id: string, client: Prisma.TransactionClient = prisma) {
  return (await client.preWeighing.count({ where: { id, ...startRootWhere } })) > 0;
}

// The pending pre-weighings a production can start from, the newest first.
export function listPendingStartRoots() {
  return prisma.preWeighing.findMany({
    where: startRootWhere,
    select: preWeighingSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

// The pending ones recorded directly under any of these.
export function listPendingChildren(parentIds: string[], client: Prisma.TransactionClient = prisma) {
  return client.preWeighing.findMany({
    where: { ...whereOfStatus.PENDING, parentId: { in: parentIds } },
    select: preWeighingSelect,
    orderBy: { id: "asc" },
  });
}
