import type { Prisma } from "@prisma/client";

type Supplier = { id: string; name: string };

type PackagingLot = {
  id: string;
  createdAt: Date;
  packageCount: number | null;
  packagePrice: Prisma.Decimal | null;
  supplier: Supplier | null;
};

type Packaging = { id: string; content: Prisma.Decimal; isActive: boolean; lots: PackagingLot[] };

/**
 * What each packaging of a product was bought at: its entries newest first, the newest as its last
 * price. A packaging no longer used and never received says nothing and is left out.
 */
export function packagingCostsOf(packagings: Packaging[]) {
  return [...packagings]
    .sort((a, b) => a.content.comparedTo(b.content))
    .map(({ id, content, isActive, lots }) => {
      const history = lots
        .flatMap(({ id: lotId, createdAt, supplier, packageCount, packagePrice }) =>
          packageCount === null || packagePrice === null
            ? []
            : [{ lotId, createdAt, supplier, count: packageCount, price: packagePrice.toString() }],
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(({ createdAt, ...entry }) => ({ ...entry, createdAt: createdAt.toISOString() }));
      const [last] = history;

      return {
        id,
        content: content.toString(),
        isActive,
        lastEntry:
          last === undefined ? null : { price: last.price, createdAt: last.createdAt, supplier: last.supplier },
        history,
      };
    })
    .filter(({ isActive, history }) => isActive || history.length > 0);
}
