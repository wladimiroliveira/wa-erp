import { StockMovementsPage } from "@/features/stock-movements/StockMovementsPage";
import { can, requireUser } from "@/server/auth/current-user";
import { listProducts } from "@/server/modules/products/products.repository";
import { listStockMovementsQuerySchema } from "@/server/modules/stock/stock.schemas";
import { stockMovementsPage } from "@/server/modules/stock/stock.service";
import type { SearchParamsInput } from "@/lib/search-params";

/** The query the address asks for; an address that makes no sense opens the plain history. */
function queryOf(params: Record<string, string | string[] | undefined>) {
  const parsed = listStockMovementsQuerySchema.safeParse({ productSku: params.productSku });

  return parsed.success ? parsed.data : listStockMovementsQuerySchema.parse({});
}

export default async function Page({ searchParams }: { searchParams: SearchParamsInput }) {
  const user = await requireUser();
  const query = queryOf(await searchParams);
  // The filter is a convenience on top of the history: without the catalog the history still
  // opens, just unfiltered.
  const [page, products] = await Promise.all([
    stockMovementsPage(query),
    can(user, "CATALOG_READ") ? listProducts() : Promise.resolve([]),
  ]);

  return <StockMovementsPage page={page} products={products} productSku={query.productSku} />;
}
