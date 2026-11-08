import { Prisma, ProductKind } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";

const productSelect = { sku: true, description: true, unit: true } satisfies Prisma.ProductSelect;

const pricingSourceSelect = {
  yieldQuantity: true,
  product: { select: { ...productSelect, markup: { select: { markupPercent: true } } } },
  ingredients: {
    select: {
      quantity: true,
      product: { select: { ...productSelect, stock: { select: { averageCost: true } } } },
    },
    orderBy: { product: { description: "asc" } },
  },
} satisfies Prisma.RecipeSelect;

export type PricingSource = Prisma.RecipeGetPayload<{ select: typeof pricingSourceSelect }>;

/** Every active manufactured product that has a recipe, with what its cost and price are made of. */
export function findPricingSources(): Promise<PricingSource[]> {
  return prisma.recipe.findMany({
    where: { product: { kind: ProductKind.MANUFACTURED, isActive: true } },
    select: pricingSourceSelect,
    orderBy: { product: { description: "asc" } },
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
