import { notFound } from "next/navigation";
import { ProductionDetailPage } from "@/features/productions/ProductionDetailPage";
import { productionIdParamsSchema } from "@/server/modules/productions/productions.schemas";
import { getProduction } from "@/server/modules/productions/productions.service";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const parsed = productionIdParamsSchema.safeParse(await params);

  // An address that is not an id, and an id nobody holds, are the same answer: there is no such production.
  if (!parsed.success) notFound();

  const result = await getProduction(parsed.data.id);

  if (!result.ok) notFound();

  return <ProductionDetailPage production={result.data} />;
}
