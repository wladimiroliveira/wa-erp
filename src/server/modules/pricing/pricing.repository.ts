import { Prisma, ProductKind } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";

const productSelect = { sku: true, description: true, unit: true } satisfies Prisma.ProductSelect;

const HISTORY_LIMIT = 20;

const pricingSourceSelect = {
  ...productSelect,
  markup: { select: { markupPercent: true } },
  prices: {
    select: { price: true, averageCost: true, markupPercent: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: HISTORY_LIMIT,
  },
} satisfies Prisma.ProductSelect;

export type PricingSource = Prisma.ProductGetPayload<{ select: typeof pricingSourceSelect }>;

/** Every active manufactured product with its markup and its latest prices, newest first. */
export function findPricingSources(): Promise<PricingSource[]> {
  return prisma.product.findMany({
    where: { kind: ProductKind.MANUFACTURED, isActive: true },
    select: pricingSourceSelect,
    orderBy: { description: "asc" },
  });
}

export async function findProductKind(sku: string): Promise<ProductKind | null> {
  const product = await prisma.product.findUnique({ where: { sku }, select: { kind: true } });

  return product?.kind ?? null;
}

export function upsertMarkup(input: { productSku: string; markupPercent: string; updatedById: string }) {
  const { productSku, markupPercent, updatedById } = input;

  return prisma.productMarkup.upsert({
    where: { productSku },
    create: { productSku, markupPercent, updatedById },
    update: { markupPercent, updatedById },
    select: { markupPercent: true },
  });
}

type Client = Prisma.TransactionClient | typeof prisma;

/** What a price is made from besides the cost: the product's kind and its markup, if it has one. */
export async function findPricingInputs(
  client: Client,
  sku: string,
): Promise<{ kind: ProductKind; markupPercent: Prisma.Decimal | null } | null> {
  const product = await client.product.findUnique({
    where: { sku },
    select: { kind: true, markup: { select: { markupPercent: true } } },
  });

  return product && { kind: product.kind, markupPercent: product.markup?.markupPercent ?? null };
}

export async function insertPrice(
  client: Client,
  data: { productSku: string; averageCost: string; markupPercent: string; price: string },
): Promise<void> {
  await client.productPrice.create({ data });
}

/** The latest price written for the product, or null while it has none. */
export function findCurrentPrice(client: Client, sku: string) {
  return client.productPrice.findFirst({
    where: { productSku: sku },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { price: true, averageCost: true, markupPercent: true, createdAt: true },
  });
}
