import { PreWeighingsListPage } from "@/features/pre-weighings/PreWeighingsListPage";
import { listPreWeighingsQuerySchema } from "@/server/modules/pre-weighings/pre-weighings.schemas";
import { listPreWeighingsPage } from "@/server/modules/pre-weighings/pre-weighings.service";
import type { SearchParamsInput } from "@/lib/search-params";

// The first page, newest first, as the API's list answers it. A query the schema refuses, such as
// a cursor that is not an id, is read as no query at all rather than refused with an error page.
export default async function Page({ searchParams }: { searchParams: SearchParamsInput }) {
  const parsed = listPreWeighingsQuerySchema.safeParse(await searchParams);
  const page = await listPreWeighingsPage(parsed.success ? parsed.data : listPreWeighingsQuerySchema.parse({}));

  return <PreWeighingsListPage page={page} />;
}
