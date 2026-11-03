import { notFound } from "next/navigation";
import { PreWeighingDetailPage } from "@/features/pre-weighings/PreWeighingDetailPage";
import { preWeighingIdParamsSchema } from "@/server/modules/pre-weighings/pre-weighings.schemas";
import { getPreWeighing } from "@/server/modules/pre-weighings/pre-weighings.service";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const parsed = preWeighingIdParamsSchema.safeParse(await params);

  // An address that is not an id, and an id nobody holds, are the same answer: there is no such pre-weighing.
  if (!parsed.success) notFound();

  const result = await getPreWeighing(parsed.data.id);

  if (!result.ok) notFound();

  return <PreWeighingDetailPage preWeighing={result.data} />;
}
