import { PreWeighingsListPage } from "@/features/pre-weighings/PreWeighingsListPage";
import { readPreWeighingFilter } from "@/features/pre-weighings/status-filter";
import { listPreWeighingsQuerySchema } from "@/server/modules/pre-weighings/pre-weighings.schemas";
import { countStale, listPreWeighingsPage } from "@/server/modules/pre-weighings/pre-weighings.service";
import type { SearchParamsInput } from "@/lib/search-params";

// The first page, newest first, as the API's list answers it. A query the schema refuses, such as
// a cursor that is not an id, is read as no query at all rather than refused with an error page.
export default async function Page({ searchParams }: { searchParams: SearchParamsInput }) {
  const raw = await searchParams;
  const parsed = listPreWeighingsQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : listPreWeighingsQuerySchema.parse({});
  const [page, staleCount] = await Promise.all([listPreWeighingsPage(query), countStale()]);

  // Keyed by the filters, so the pages loaded under one do not linger under the next.
  const filter = readPreWeighingFilter(query.status);
  const staleOnly = query.staleOnly === "true";

  return (
    <PreWeighingsListPage
      key={`${filter}-${staleOnly}`}
      page={page}
      filter={filter}
      staleOnly={staleOnly}
      staleCount={staleCount}
    />
  );
}
