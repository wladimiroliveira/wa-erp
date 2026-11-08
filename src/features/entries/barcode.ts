import type { Packaging, Product } from "@/lib/api";

/** The active product and active packaging a read GTIN is printed on, or null when none is. */
export function findByGtin(products: Product[], gtin: string): { product: Product; packaging: Packaging } | null {
  const read = gtin.trim();

  for (const product of products) {
    if (!product.isActive) continue;

    const packaging = product.packagings.find((candidate) => candidate.isActive && candidate.gtin === read);

    if (packaging !== undefined) return { product, packaging };
  }

  return null;
}
