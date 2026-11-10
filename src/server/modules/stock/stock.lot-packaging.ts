import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import type { lotPackagingSchema } from "./stock.schemas";

type PackagedLot = {
  packaging: { id: string; brand: string; content: Prisma.Decimal } | null;
  packageCount: number | null;
  packagePrice: Prisma.Decimal | null;
};

/** The packaging a lot came in, as every answer about the lot tells it; null for a lot received loose. */
export function lotPackagingOf(lot: PackagedLot): z.output<typeof lotPackagingSchema> {
  if (lot.packaging === null || lot.packageCount === null || lot.packagePrice === null) return null;

  return {
    id: lot.packaging.id,
    brand: lot.packaging.brand,
    content: lot.packaging.content.toString(),
    count: lot.packageCount,
    price: lot.packagePrice.toString(),
  };
}
