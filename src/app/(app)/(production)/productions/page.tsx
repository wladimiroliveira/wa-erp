import { ProductionsListPage } from "@/features/productions/ProductionsListPage";
import { readStatusFilter, statusOfFilter } from "@/features/productions/status-filter";
import { listProductionsQuerySchema } from "@/server/modules/productions/productions.schemas";
import { listProductionsPage } from "@/server/modules/productions/productions.service";
import type { SearchParamsInput } from "@/lib/search-params";

// The status comes from the address, defaulting to what is still in progress. A cursor the schema
// refuses is read as none rather than answered with an error page.
export default async function Page({ searchParams }: { searchParams: SearchParamsInput }) {
  const params = await searchParams;
  const filter = readStatusFilter(params.status);
  const status = statusOfFilter(filter);
  const parsed = listProductionsQuerySchema.safeParse({ status, cursor: params.cursor });
  const page = await listProductionsPage(parsed.success ? parsed.data : listProductionsQuerySchema.parse({ status }));

  // Keyed by the filter, so the pages loaded under one status do not linger under the next.
  return <ProductionsListPage key={filter} page={page} filter={filter} />;
}
