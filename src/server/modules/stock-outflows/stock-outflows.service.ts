import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { localToday } from "@/server/lib/dates";
import { fail, succeed, type Result } from "@/server/lib/result";
import { findCurrentPrice } from "@/server/modules/pricing/pricing.repository";
import { onHandQuantity, onHandUnitCost, takeCoveredFromLots } from "@/server/modules/stock/stock.repository";
import {
  findOutflowsOfPeriod,
  findProductForOutflow,
  insertOutflow,
  listOutflows as readOutflows,
} from "./stock-outflows.repository";
import { toPage } from "@/server/lib/pagination";
import type {
  CreateOutflowBody,
  ListOutflowsQuery,
  Outflow,
  OutflowPage,
  OutflowPeriodQuery,
  OutflowQuote,
  OutflowSummary,
} from "./stock-outflows.schemas";
import { outflowValues } from "./stock-outflows.values";

const FAILURES = {
  missing: { status: 404, message: "Product not found." },
  inactive: { status: 409, message: "Product is inactive." },
  "not-sellable": { status: 409, message: "Only a manufactured product can be sold." },
  insufficient: { status: 409, message: "Not enough stock." },
  "no-price": { status: 409, message: "The product has no price." },
} as const;

type Failure = keyof typeof FAILURES;

// Thrown inside the transaction so that what was already taken from the lots is undone.
class Refused extends Error {
  constructor(readonly failure: Failure) {
    super(failure);
  }
}

type OutflowRow = {
  id: string;
  kind: "SALE" | "DONATION";
  product: { sku: string; description: string; unit: Outflow["product"]["unit"] };
  quantity: Prisma.Decimal;
  listPrice: Prisma.Decimal | null;
  unitPrice: Prisma.Decimal | null;
  note: string | null;
  createdAt: Date;
  createdBy: { id: string; name: string };
  movements: { quantity: Prisma.Decimal; unitCost: Prisma.Decimal | null }[];
};

// The one shape an outflow has, whether it was just recorded or is being listed.
function toOutflow(row: OutflowRow): Outflow {
  const takes = row.movements.map((m) => ({ quantity: m.quantity, unitCost: m.unitCost ?? new Prisma.Decimal(0) }));

  return {
    id: row.id,
    kind: row.kind,
    product: row.product,
    quantity: row.quantity.toString(),
    listPrice: row.listPrice?.toFixed(2) ?? null,
    unitPrice: row.unitPrice?.toFixed(2) ?? null,
    ...outflowValues({ kind: row.kind, quantity: row.quantity, unitPrice: row.unitPrice, takes }),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}

/** Takes a sale or donation out of the lots that cover it and records it, or says why it could not. */
export async function recordOutflow(body: CreateOutflowBody, createdById: string): Promise<Result<Outflow, 404 | 409>> {
  const quantity = new Prisma.Decimal(body.quantity);
  const unitPrice = body.kind === "SALE" ? new Prisma.Decimal(body.unitPrice) : null;

  try {
    const recorded = await prisma.$transaction(async (tx) => {
      const product = await findProductForOutflow(tx, body.productSku);

      if (product === null) throw new Refused("missing");
      if (!product.isActive) throw new Refused("inactive");
      if (body.kind === "SALE" && product.kind === "GOODS") throw new Refused("not-sellable");

      const taken = await takeCoveredFromLots(tx, { productSku: body.productSku, quantity, today: localToday() });

      if ("failure" in taken) throw new Refused(taken.failure);

      // Read once the take holds the balance, so the price cannot change under a sale in flight.
      let listPrice: Prisma.Decimal | null = null;

      if (body.kind === "SALE") {
        const current = await findCurrentPrice(tx, body.productSku);

        if (current === null) throw new Refused("no-price");

        listPrice = current.price;
      }

      const outflow = await insertOutflow(tx, {
        kind: body.kind,
        productSku: body.productSku,
        quantity,
        listPrice,
        unitPrice,
        note: body.note ?? null,
        createdById,
        takes: taken.takes,
      });

      return { outflow, product, listPrice, takes: taken.takes };
    });

    const { outflow, product, listPrice, takes } = recorded;

    return succeed(
      toOutflow({
        id: outflow.id,
        kind: body.kind,
        product: { sku: product.sku, description: product.description, unit: product.unit },
        quantity,
        listPrice,
        unitPrice,
        note: body.note ?? null,
        createdAt: outflow.createdAt,
        createdBy: outflow.createdBy,
        movements: takes,
      }),
    );
  } catch (error) {
    if (error instanceof Refused) {
      const { status, message } = FAILURES[error.failure];

      return fail(status, message);
    }

    throw error;
  }
}

/** The outflows of a period, newest first. */
export async function listOutflows(query: ListOutflowsQuery): Promise<OutflowPage> {
  const page = toPage(await readOutflows(query), query);

  return { items: page.items.map(toOutflow), nextCursor: page.nextCursor };
}

/** What the sales of a period brought in and cost, and what the donations cost. */
export async function summariseOutflows(query: OutflowPeriodQuery): Promise<OutflowSummary> {
  const outflows = (await findOutflowsOfPeriod(query)).map(toOutflow);
  const sales = outflows.filter((outflow) => outflow.kind === "SALE");
  const donations = outflows.filter((outflow) => outflow.kind === "DONATION");
  const sum = (values: (string | null)[]) =>
    values.reduce((total, value) => total.plus(value ?? 0), new Prisma.Decimal(0));

  const revenue = sum(sales.map((sale) => sale.revenue));
  const saleCost = sum(sales.map((sale) => sale.cost));
  const profit = sum(sales.map((sale) => sale.profit));
  const donated = sum(donations.map((donation) => donation.cost));

  return {
    revenue: revenue.toFixed(2),
    saleCost: saleCost.toFixed(2),
    profit: profit.toFixed(2),
    donated: donated.toFixed(2),
    result: profit.minus(donated).toFixed(2),
    saleCount: sales.length,
    donationCount: donations.length,
  };
}

/** What a sale or donation of a product would start from: its list price, what its lots cost and how much they hold. */
export async function outflowQuote(productSku: string): Promise<OutflowQuote> {
  const today = localToday();
  const [price, onHandCost, available] = await Promise.all([
    findCurrentPrice(prisma, productSku),
    onHandUnitCost(prisma, { productSku, today }),
    onHandQuantity(prisma, { productSku, today }),
  ]);

  return {
    listPrice: price?.price.toFixed(2) ?? null,
    onHandCost: onHandCost?.toString() ?? null,
    available: available.toString(),
  };
}
