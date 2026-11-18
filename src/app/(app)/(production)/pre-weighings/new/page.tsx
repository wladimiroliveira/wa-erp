import { z } from "zod";
import { PreWeighingPage, type PreWeighingComplement } from "@/features/pre-weighings/PreWeighingPage";
import type { SearchParamsInput } from "@/lib/search-params";
import { listProducts } from "@/server/modules/products/products.repository";
import { getPreWeighing } from "@/server/modules/pre-weighings/pre-weighings.service";
import { positiveDecimalSchema } from "@/shared/decimal";

const complementParamsSchema = z.object({
  parentId: z.uuid(),
  productSku: z.uuid(),
  quantity: positiveDecimalSchema,
});

// `?parentId=&productSku=&quantity=` records a complement of that pre-weighing. An address that does not
// read as one, or names a pre-weighing that does not exist, opens the screen as a new pre-weighing.
async function complementOf(searchParams: SearchParamsInput): Promise<PreWeighingComplement | undefined> {
  const params = await searchParams;
  const parsed = complementParamsSchema.safeParse({
    parentId: params.parentId,
    productSku: params.productSku,
    quantity: params.quantity,
  });

  if (!parsed.success) return undefined;

  const parent = await getPreWeighing(parsed.data.parentId);

  if (!parent.ok) return undefined;

  return { ...parsed.data, parentDescription: parent.data.product.description };
}

// Only a manufactured product has a recipe, and an inactive one is refused by the server.
export default async function Page({ searchParams }: { searchParams: SearchParamsInput }) {
  const [products, complement] = await Promise.all([
    listProducts({ kind: ["MANUFACTURED"], status: "ACTIVE" }),
    complementOf(searchParams),
  ]);

  return <PreWeighingPage products={products} complement={complement} />;
}
