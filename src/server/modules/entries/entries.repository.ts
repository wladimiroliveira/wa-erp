import { Prisma, StockMovementType } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { increaseStock, lockStockBalance, openLot, settleStockBalance } from "@/server/modules/stock/stock.repository";
import { DeficitSettlement } from "./entries.schemas";

export async function findProductBySku(sku: string) {
  const product = await prisma.product.findUnique({
    where: { sku },
    select: {
      sku: true,
      description: true,
      unit: true,
      isActive: true,
      packagings: { select: { id: true, content: true, isActive: true } },
    },
  });

  return (
    product && {
      ...product,
      packagings: product.packagings.map(({ content, ...packaging }) => ({
        ...packaging,
        content: content.toString(),
      })),
    }
  );
}

// Thrown inside the transaction, so nothing of the entry is written, and turned into an answer
// outside of it.
export class NegativeBalancePendingError extends Error {
  constructor(readonly deficit: Prisma.Decimal) {
    super("The product has a negative balance to settle.");
  }
}

const ZERO = new Prisma.Decimal(0);

// The lot, the movement and the balance change together or not at all. The balance is locked
// first: what the entry does depends on whether it is negative, and that must not change under it.
export function insertEntry(input: {
  productSku: string;
  quantity: string;
  unitCost: string;
  expiresAt: string | null;
  supplierId?: string;
  deficit?: DeficitSettlement;
  createdById: string;
  packagingId?: string;
  packageCount?: number;
}) {
  const { productSku, quantity, unitCost, createdById } = input;

  return prisma.$transaction(async (tx) => {
    const { owed, held, lastEntryCost } = await lockStockBalance(tx, productSku);

    if (owed.gt(0) && input.deficit === undefined) throw new NegativeBalancePendingError(owed);

    if (owed.gt(0) && input.deficit === DeficitSettlement.ZERO) {
      await settleStockBalance(tx, productSku, held);
      await tx.stockMovement.create({
        data: {
          productSku,
          createdById,
          type: StockMovementType.BALANCE_ADJUSTMENT,
          quantity: owed,
          unitCost: lastEntryCost ?? ZERO,
        },
      });
    }

    const [stock] = await increaseStock(tx, { productSku, quantity, unitCost });

    // Still owed at this point means the entry pays for it: the lot keeps only what is left.
    const left =
      input.deficit === DeficitSettlement.DISCOUNT ? Prisma.Decimal.max(ZERO, owed.neg().add(quantity)) : undefined;

    const lot = await openLot(tx, {
      productSku,
      quantity,
      left,
      unitCost,
      expiresAt: input.expiresAt,
      supplierId: input.supplierId,
      packagingId: input.packagingId,
      packageCount: input.packageCount,
    });

    const movement = await tx.stockMovement.create({
      data: { productSku, quantity, unitCost, createdById, lotId: lot.id, type: StockMovementType.ENTRY },
    });

    return { movement, lot, stock };
  });
}
