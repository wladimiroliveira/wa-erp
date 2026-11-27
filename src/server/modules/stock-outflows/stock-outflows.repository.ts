import { Prisma, type StockOutflowKind } from "@prisma/client";
import { localDayRange } from "@/server/lib/dates";
import { pageArgs } from "@/server/lib/pagination";
import { prisma } from "@/server/lib/prisma";

const PRODUCT_FIELDS = { select: { sku: true, description: true, unit: true, kind: true, isActive: true } } as const;

export function findProductForOutflow(tx: Prisma.TransactionClient, sku: string) {
  return tx.product.findUnique({ where: { sku }, ...PRODUCT_FIELDS });
}

// One outflow and one movement per lot it was taken from.
export function insertOutflow(
  tx: Prisma.TransactionClient,
  input: {
    kind: StockOutflowKind;
    productSku: string;
    quantity: Prisma.Decimal;
    listPrice: Prisma.Decimal | null;
    unitPrice: Prisma.Decimal | null;
    note: string | null;
    createdById: string;
    takes: { lotId: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal }[];
  },
) {
  const { takes, ...data } = input;

  return tx.stockOutflow.create({
    data: {
      ...data,
      movements: {
        create: takes.map((take) => ({
          productSku: input.productSku,
          lotId: take.lotId,
          quantity: take.quantity,
          unitCost: take.unitCost,
          createdById: input.createdById,
          type: input.kind,
        })),
      },
    },
    select: {
      id: true,
      createdAt: true,
      createdBy: { select: { id: true, name: true } },
    },
  });
}

const OUTFLOW_FIELDS = {
  id: true,
  kind: true,
  quantity: true,
  listPrice: true,
  unitPrice: true,
  note: true,
  createdAt: true,
  product: { select: { sku: true, description: true, unit: true } },
  createdBy: { select: { id: true, name: true } },
  movements: { select: { quantity: true, unitCost: true } },
} as const;

const inPeriod = ({ from, to, productSku }: { from: string; to: string; productSku?: string }) => ({
  createdAt: localDayRange(from, to),
  productSku,
});

export function listOutflows(query: { from: string; to: string; productSku?: string; limit: number; cursor?: string }) {
  const { limit, cursor, ...period } = query;

  return prisma.stockOutflow.findMany({
    where: inPeriod(period),
    select: OUTFLOW_FIELDS,
    ...pageArgs({ limit, cursor }),
  });
}

export function findOutflowsOfPeriod(period: { from: string; to: string; productSku?: string }) {
  return prisma.stockOutflow.findMany({ where: inPeriod(period), select: OUTFLOW_FIELDS });
}
