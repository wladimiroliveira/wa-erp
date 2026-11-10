import { MeasurementUnit, Prisma } from "@prisma/client";
import { localToday, toOptionalDateString } from "@/server/lib/dates";
import { toPage } from "@/server/lib/pagination";
import { fail, succeed } from "@/server/lib/result";
import { lotPackagingOf } from "./stock.lot-packaging";
import { packagingCostsOf } from "./stock.packaging-costs";
import { lotCountOf, lotStatusOf, lotValueOf, nextExpiryOf, statusOf, valueOf } from "./stock.position";
import { findProductWithStock, listProductsWithStock, listStockMovements } from "./stock.repository";
import type { ListStockMovementsQuery } from "./stock.schemas";

type Product = { sku: string; description: string; unit: MeasurementUnit };
type Stock = {
  quantity: Prisma.Decimal;
  lastEntryCost: Prisma.Decimal | null;
  averageCost: Prisma.Decimal | null;
  minimumQuantity: Prisma.Decimal | null;
};
type Lot = { quantity: Prisma.Decimal; unitCost: Prisma.Decimal; expiresAt: Date | null };

const NO_STOCK = { quantity: new Prisma.Decimal(0), lastEntryCost: null, averageCost: null, minimumQuantity: null };

// The one place that reads a product, its balance and its lots as a position, so the list and the
// detail of a product can never tell two different stories about it.
function toPosition(product: Product, stock: Stock | null, lots: Lot[], today: string) {
  const balance = stock ?? NO_STOCK;

  return {
    product,
    quantity: balance.quantity.toString(),
    minimumQuantity: balance.minimumQuantity?.toString() ?? null,
    lastEntryCost: balance.lastEntryCost?.toString() ?? null,
    averageCost: balance.averageCost?.toString() ?? null,
    value: valueOf(lots).toFixed(2),
    lotCount: lotCountOf(lots),
    nextExpiresAt: nextExpiryOf(lots),
    status: statusOf(balance, lots, today),
  };
}

/** One page of movements, the newest first, with amounts and dates as the API writes them. */
export async function stockMovementsPage(query: ListStockMovementsQuery) {
  const { items, nextCursor } = toPage(await listStockMovements(query), query);

  return {
    items: items.map(({ lot, ...movement }) => ({
      ...movement,
      lot: lot === null ? null : { ...lot, expiresAt: toOptionalDateString(lot.expiresAt) },
      quantity: movement.quantity.toString(),
      unitCost: movement.unitCost.toString(),
      createdAt: movement.createdAt.toISOString(),
    })),
    nextCursor,
  };
}

/** The position of every product and what the whole stock is worth. */
export async function stockPosition() {
  const today = localToday();
  const positions = (await listProductsWithStock()).map(({ stock, lots, ...product }) => ({
    position: toPosition(product, stock, lots, today),
    value: valueOf(lots),
  }));

  return {
    items: positions.map(({ position }) => position),
    totalValue: Prisma.Decimal.sum(0, ...positions.map(({ value }) => value)).toFixed(2),
  };
}

/** The position of one product and the lots that make it up. */
export async function productStockPosition(sku: string, options: { depleted: boolean }) {
  const found = await findProductWithStock(sku, options);

  if (found === null) return fail(404, "Product not found.");

  const today = localToday();
  const { stock, lots, packagings, ...product } = found;

  return succeed({
    ...toPosition(product, stock, lots, today),
    lots: lots.map((lot) => ({
      id: lot.id,
      expiresAt: toOptionalDateString(lot.expiresAt),
      supplier: lot.supplier,
      initialQuantity: lot.initialQuantity.toString(),
      quantity: lot.quantity.toString(),
      unitCost: lot.unitCost.toString(),
      value: lotValueOf(lot).toFixed(2),
      createdAt: lot.createdAt.toISOString(),
      status: lotStatusOf(lot, today),
      packaging: lotPackagingOf(lot),
    })),
    packagings: packagingCostsOf(packagings),
  });
}
