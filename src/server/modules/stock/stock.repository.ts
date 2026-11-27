import { Prisma } from "@prisma/client";
import { pageArgs } from "@/server/lib/pagination";
import { prisma } from "@/server/lib/prisma";
import { allocate, costOfShortfall, inOrderOfUse, owedOf } from "./stock.allocation";
import { expiryOf, LotStatus } from "./stock.position";
import { HISTORY_LIMIT } from "./stock.schemas";

const ZERO = new Prisma.Decimal(0);

type StockAfterIncrease = { quantity: Prisma.Decimal; lastEntryCost: Prisma.Decimal; averageCost: Prisma.Decimal };

// The balance is updated by a single statement, so the database computes the new average under the
// row lock: reading the stock first and writing it back would let two simultaneous movements
// overwrite each other.
export function increaseStock(
  client: Prisma.TransactionClient,
  input: { productSku: string; quantity: string; unitCost: string },
) {
  return client.$queryRaw<StockAfterIncrease[]>`
    INSERT INTO product_stocks AS stock (product_sku, quantity, last_entry_cost, average_cost, updated_at)
    VALUES (${input.productSku}::uuid, ${input.quantity}::numeric, ${input.unitCost}::numeric, ${input.unitCost}::numeric, now())
    ON CONFLICT (product_sku) DO UPDATE SET
      quantity = stock.quantity + EXCLUDED.quantity,
      last_entry_cost = EXCLUDED.last_entry_cost,
      -- A balance at or below zero has no cost left to weight, so the average restarts from the entry.
      average_cost = CASE
        WHEN stock.quantity <= 0 OR stock.average_cost IS NULL THEN EXCLUDED.last_entry_cost
        ELSE (stock.quantity * stock.average_cost + EXCLUDED.quantity * EXCLUDED.last_entry_cost)
          / (stock.quantity + EXCLUDED.quantity)
      END,
      updated_at = now()
    RETURNING quantity, last_entry_cost AS "lastEntryCost", average_cost AS "averageCost"
  `;
}

// The minimum is a setting of the product, kept beside its balance: setting it on a product that
// never moved opens the balance at zero, the same row its first movement would open.
export function setMinimumQuantity(
  client: Prisma.TransactionClient,
  input: { productSku: string; minimumQuantity: string | null },
) {
  return client.$executeRaw`
    INSERT INTO product_stocks AS stock (product_sku, quantity, minimum_quantity, updated_at)
    VALUES (${input.productSku}::uuid, 0, ${input.minimumQuantity}::numeric, now())
    ON CONFLICT (product_sku) DO UPDATE SET minimum_quantity = EXCLUDED.minimum_quantity, updated_at = now()
  `;
}

type HeldBalance = {
  productSku: string;
  quantity: Prisma.Decimal;
  lastEntryCost: Prisma.Decimal | null;
  averageCost: Prisma.Decimal | null;
};

// Holds the balances of several products until the transaction ends, always in the same order.
// Whatever moves more than one product holds them all here before moving any: taking them one by
// one, in an order of its own, would deadlock with another doing the same the other way round.
export async function holdStockBalances(client: Prisma.TransactionClient, productSkus: string[]) {
  const skus = [...new Set(productSkus.map((sku) => sku.toLowerCase()))].sort();

  if (skus.length === 0) return [];

  // A product that never moved has no row to hold, and two first movements at once would each read
  // the other's lot against a balance that is not there yet. Opening the row first gives them one.
  await client.$executeRaw`
    INSERT INTO product_stocks (product_sku, quantity, updated_at)
    VALUES ${Prisma.join(skus.map((sku) => Prisma.sql`(${sku}::uuid, 0, now())`))}
    ON CONFLICT (product_sku) DO NOTHING
  `;

  return client.$queryRaw<HeldBalance[]>`
    SELECT product_sku::text AS "productSku", quantity, last_entry_cost AS "lastEntryCost", average_cost AS "averageCost"
    FROM product_stocks
    WHERE product_sku IN (${Prisma.join(skus.map((sku) => Prisma.sql`${sku}::uuid`))})
    ORDER BY product_sku
    FOR UPDATE
  `;
}

// What is in stock of a product right now, read without holding it: for what is only shown.
export async function readStockBalance(productSku: string) {
  const row = await prisma.productStock.findUnique({ where: { productSku }, select: { quantity: true } });

  return row?.quantity ?? new Prisma.Decimal(0);
}

// Reads the balance of a product and holds it until the transaction ends, so whatever is decided
// from it is still true when it is written.
export async function lockStockBalance(client: Prisma.TransactionClient, productSku: string) {
  const [balance] = await holdStockBalances(client, [productSku]);
  const { _sum } = await client.stockLot.aggregate({ where: { productSku }, _sum: { quantity: true } });
  const held = _sum.quantity ?? ZERO;
  const quantity = balance?.quantity ?? ZERO;

  return { held, lastEntryCost: balance?.lastEntryCost ?? null, owed: owedOf({ held, quantity }) };
}

// Writes off what is owed: the balance becomes what the lots hold.
export function settleStockBalance(client: Prisma.TransactionClient, productSku: string, held: Prisma.Decimal) {
  return client.$executeRaw`
    UPDATE product_stocks SET quantity = ${held}::numeric, updated_at = now() WHERE product_sku = ${productSku}::uuid
  `;
}

// What came into the stock together becomes a lot. `left` is for the lot that comes in already
// partly spoken for; without it the whole quantity is there to take.
export function openLot(
  client: Prisma.TransactionClient,
  lot: {
    productSku: string;
    quantity: Prisma.Decimal | string;
    left?: Prisma.Decimal;
    unitCost: Prisma.Decimal | string;
    expiresAt: string | null;
    supplierId?: string;
    packagingId?: string;
    packageCount?: number;
    packagePrice?: string;
  },
) {
  return client.stockLot.create({
    data: {
      productSku: lot.productSku,
      supplierId: lot.supplierId,
      packagingId: lot.packagingId,
      packageCount: lot.packageCount,
      packagePrice: lot.packagePrice,
      expiresAt: lot.expiresAt === null ? null : new Date(lot.expiresAt),
      initialQuantity: lot.quantity,
      quantity: lot.left ?? lot.quantity,
      unitCost: lot.unitCost,
    },
    select: {
      id: true,
      expiresAt: true,
      quantity: true,
      supplier: { select: { id: true, name: true } },
      packageCount: true,
      packagePrice: true,
      packaging: { select: { id: true, brand: true, content: true } },
    },
  });
}

type UsableLot = {
  id: string;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  expiresAt: Date | null;
  createdAt: Date;
  /** What one packaging of the lot holds; null for a lot received loose. */
  packageContent: Prisma.Decimal | null;
};

// The lots a quantity may be taken from, in the order they are to be used. An expired lot is not
// among them: it leaves the stock as a loss, not as an input.
async function usableLots(
  client: Prisma.TransactionClient,
  { productSku, today, lock }: { productSku: string; today: string; lock: boolean },
) {
  const held = await client.$queryRaw<UsableLot[]>`
    SELECT id, quantity, unit_cost AS "unitCost", expires_at AS "expiresAt", created_at AS "createdAt",
      -- A scalar subquery, not a join, so that FOR UPDATE locks the lots alone.
      (SELECT content FROM product_packagings WHERE product_packagings.id = stock_lots.packaging_id) AS "packageContent"
    FROM stock_lots
    WHERE product_sku = ${productSku}::uuid
      AND quantity > 0
    ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}
  `;

  return inOrderOfUse(held.filter((lot) => expiryOf(lot.expiresAt, today) !== LotStatus.EXPIRED));
}

// Which lots a quantity would come from if it were taken now, and what they would not cover. It
// takes nothing: by the time the stock really moves, the lots may be others.
export async function suggestLots(input: { productSku: string; quantity: Prisma.Decimal; today: string }) {
  const lots = await usableLots(prisma, { productSku: input.productSku, today: input.today, lock: false });

  return allocate(lots, input.quantity);
}

type Take = {
  lotId: string | null;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  // What the lot held before the take, and what one of its packagings holds; null for what was owed.
  lotQuantity: Prisma.Decimal | null;
  packageContent: Prisma.Decimal | null;
};

// Takes a quantity out of the stock, lot by lot. What the lots do not cover is taken anyway and
// stays owed.
export async function takeFromLots(
  client: Prisma.TransactionClient,
  input: { productSku: string; quantity: Prisma.Decimal; today: string },
): Promise<Take[]> {
  const { productSku, quantity, today } = input;
  const balance = await lockStockBalance(client, productSku);

  const lots = await usableLots(client, { productSku, today, lock: true });
  const { takes, shortfall } = allocate(lots, quantity);

  await applyTakes(client, productSku, takes, quantity);

  const taken: Take[] = takes.map(({ lot, quantity: amount }) => ({
    lotId: lot.id,
    quantity: amount,
    unitCost: lot.unitCost,
    lotQuantity: lot.quantity,
    packageContent: lot.packageContent,
  }));

  if (shortfall.gt(0)) {
    const unitCost = costOfShortfall({
      lastLotTaken: taken.at(-1)?.unitCost ?? null,
      newestLot: await newestLotCost(client, productSku),
      lastEntry: balance.lastEntryCost,
    });

    taken.push({ lotId: null, quantity: shortfall, unitCost, lotQuantity: null, packageContent: null });
  }

  return taken;
}

type Allocated = { lot: UsableLot; quantity: Prisma.Decimal }[];

// The write both takes share: the lots reached lose what was taken from them, and the balance
// loses the whole quantity, owed part included.
async function applyTakes(
  client: Prisma.TransactionClient,
  productSku: string,
  takes: Allocated,
  quantity: Prisma.Decimal,
) {
  if (takes.length > 0) {
    // One statement for every lot reached, however many they are.
    await client.$executeRaw`
      UPDATE stock_lots AS lot
      SET quantity = lot.quantity - take.quantity, updated_at = now()
      FROM (VALUES ${Prisma.join(takes.map(({ lot, quantity: taken }) => Prisma.sql`(${lot.id}::uuid, ${taken}::numeric)`))})
        AS take (id, quantity)
      WHERE lot.id = take.id
    `;
  }

  await decreaseStock(client, { productSku, quantity: quantity.toString() });
}

// The lots that are on hand: with something left and not expired. It holds nothing, so it serves a
// screen as well as a transaction.
async function onHandLots(client: Prisma.TransactionClient | typeof prisma, productSku: string, today: string) {
  const lots = await client.stockLot.findMany({
    where: { productSku, quantity: { gt: 0 } },
    select: { quantity: true, unitCost: true, expiresAt: true },
  });

  return lots.filter((lot) => expiryOf(lot.expiresAt, today) !== LotStatus.EXPIRED);
}

// How much of a product is on hand to be sold or given away.
export async function onHandQuantity(
  client: Prisma.TransactionClient | typeof prisma,
  { productSku, today }: { productSku: string; today: string },
) {
  const lots = await onHandLots(client, productSku, today);

  return lots.reduce((sum, lot) => sum.add(lot.quantity), ZERO);
}

// What one unit of the lots on hand is worth: each lot's cost weighted by what is left of it.
// Expired lots are not on hand, and a lot of zero cost is a cost not known: it is left out, and
// null is answered when nothing else is on hand. What can be taken is still onHandQuantity's.
export async function onHandUnitCost(
  client: Prisma.TransactionClient | typeof prisma,
  { productSku, today }: { productSku: string; today: string },
) {
  const onHand = (await onHandLots(client, productSku, today)).filter((lot) => lot.unitCost.gt(0));
  const quantity = onHand.reduce((sum, lot) => sum.add(lot.quantity), ZERO);

  if (quantity.lte(0)) return null;

  const cost = onHand.reduce((sum, lot) => sum.add(lot.quantity.mul(lot.unitCost)), ZERO);

  return cost.div(quantity).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
}

// Takes a quantity out of the lots only if they cover all of it; otherwise nothing is touched.
// Unlike takeFromLots, nothing is left owed.
export async function takeCoveredFromLots(
  client: Prisma.TransactionClient,
  input: { productSku: string; quantity: Prisma.Decimal; today: string },
): Promise<
  { failure: "insufficient" } | { takes: { lotId: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal }[] }
> {
  const { productSku, quantity, today } = input;

  await lockStockBalance(client, productSku);

  const lots = await usableLots(client, { productSku, today, lock: true });
  const { takes, shortfall } = allocate(lots, quantity);

  if (shortfall.gt(0)) return { failure: "insufficient" };

  await applyTakes(client, productSku, takes, quantity);

  return {
    takes: takes.map(({ lot, quantity: amount }) => ({ lotId: lot.id, quantity: amount, unitCost: lot.unitCost })),
  };
}

// Takes a quantity out of one given lot, whatever its date: this is how what is expired or damaged
// leaves the stock. Unlike a lot taken from in turn, a lot named outright cannot go short, so more
// than it holds is refused.
type NamedLot = {
  id: string;
  productSku: string;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  expiresAt: Date | null;
};

type LotTake = { failure: "missing" | "insufficient" } | { lot: NamedLot & { left: Prisma.Decimal } };

export async function takeFromLot(
  client: Prisma.TransactionClient,
  { lotId, quantity }: { lotId: string; quantity: Prisma.Decimal },
): Promise<LotTake> {
  const owner = await client.stockLot.findUnique({ where: { id: lotId }, select: { productSku: true } });

  if (owner === null) return { failure: "missing" };

  // Whatever takes from the lots of a product holds its balance first and its lots after. Holding
  // them the other way round here would deadlock with a consumption of the same product.
  await lockStockBalance(client, owner.productSku);

  const [lot] = await client.$queryRaw<NamedLot[]>`
    SELECT id, product_sku AS "productSku", quantity, unit_cost AS "unitCost", expires_at AS "expiresAt"
    FROM stock_lots
    WHERE id = ${lotId}::uuid
    FOR UPDATE
  `;

  if (lot === undefined) return { failure: "missing" };
  if (quantity.gt(lot.quantity)) return { failure: "insufficient" };

  await client.stockLot.update({ where: { id: lotId }, data: { quantity: { decrement: quantity } } });
  await decreaseStock(client, { productSku: lot.productSku, quantity: quantity.toString() });

  return { lot: { ...lot, left: lot.quantity.sub(quantity) } };
}

// Takes a quantity out of a lot the transaction already holds, with its product's balance: what
// a consumption leaves of an opened packaging. Holding them again would only repeat the queries.
// The lot never goes below zero: more than it holds is refused.
export async function takeFromHeldLot(
  client: Prisma.TransactionClient,
  { lotId, productSku, quantity }: { lotId: string; productSku: string; quantity: Prisma.Decimal },
) {
  const updated = await client.$executeRaw`
    UPDATE stock_lots SET quantity = quantity - ${quantity}::numeric, updated_at = now()
    WHERE id = ${lotId}::uuid AND quantity >= ${quantity}::numeric
  `;

  if (updated !== 1) throw new Error(`Lot ${lotId} does not hold ${quantity.toString()}.`);

  await decreaseStock(client, { productSku, quantity: quantity.toString() });
}

async function newestLotCost(client: Prisma.TransactionClient, productSku: string) {
  const lot = await client.stockLot.findFirst({
    where: { productSku },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { unitCost: true },
  });

  return lot?.unitCost ?? null;
}

// Taking from the stock never fails for lack of balance: the balance goes negative and the next
// entry settles it. The average cost is what each unit taken is worth, and it stays as it was.
export function decreaseStock(client: Prisma.TransactionClient, input: { productSku: string; quantity: string }) {
  return client.$queryRaw<{ averageCost: Prisma.Decimal | null }[]>`
    INSERT INTO product_stocks AS stock (product_sku, quantity, updated_at)
    VALUES (${input.productSku}::uuid, -${input.quantity}::numeric, now())
    ON CONFLICT (product_sku) DO UPDATE SET
      quantity = stock.quantity + EXCLUDED.quantity,
      updated_at = now()
    RETURNING average_cost AS "averageCost"
  `;
}

export function listStockMovements(query: { productSku?: string; limit: number; cursor?: string }) {
  const { productSku, ...page } = query;

  return prisma.stockMovement.findMany({
    where: { productSku },
    select: {
      id: true,
      type: true,
      quantity: true,
      unitCost: true,
      createdAt: true,
      product: { select: { sku: true, description: true, unit: true } },
      lot: { select: { id: true, expiresAt: true, supplier: { select: { id: true, name: true } } } },
      createdBy: { select: { id: true, name: true } },
    },
    ...pageArgs(page),
  });
}

const STOCK_FIELDS = {
  select: { quantity: true, lastEntryCost: true, averageCost: true, minimumQuantity: true },
} as const;

const STILL_HELD = { quantity: { gt: 0 } } as const;

// Every product, moved or not: one that never had an entry has no stock row yet.
export function listProductsWithStock() {
  return prisma.product.findMany({
    select: {
      sku: true,
      description: true,
      unit: true,
      stock: STOCK_FIELDS,
      lots: { where: STILL_HELD, select: { quantity: true, unitCost: true, expiresAt: true } },
    },
    orderBy: { description: "asc" },
  });
}

// The lots come in the order they are to be used.
export async function findProductWithStock(sku: string, { depleted }: { depleted: boolean }) {
  const product = await prisma.product.findUnique({
    where: { sku },
    select: {
      sku: true,
      description: true,
      unit: true,
      stock: STOCK_FIELDS,
      lots: {
        where: depleted ? {} : STILL_HELD,
        select: {
          id: true,
          expiresAt: true,
          initialQuantity: true,
          quantity: true,
          unitCost: true,
          createdAt: true,
          supplier: { select: { id: true, name: true } },
          packageCount: true,
          packagePrice: true,
          packaging: { select: { id: true, brand: true, content: true } },
        },
      },
      // Every lot each packaging came in, depleted ones too: they are its price history.
      packagings: {
        select: {
          id: true,
          brand: true,
          content: true,
          isActive: true,
          lots: {
            orderBy: { createdAt: "desc" },
            take: HISTORY_LIMIT,
            select: {
              id: true,
              createdAt: true,
              packageCount: true,
              packagePrice: true,
              supplier: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  return product === null ? null : { ...product, lots: inOrderOfUse(product.lots) };
}
