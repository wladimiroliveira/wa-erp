import { z } from "zod";
import { PreWeighingPage, type PreWeighingComplement } from "@/features/pre-weighings/PreWeighingPage";
import type { SearchParamsInput } from "@/lib/search-params";
import { listProducts } from "@/server/modules/products/products.repository";
import { getPreWeighing } from "@/server/modules/pre-weighings/pre-weighings.service";
import { positiveDecimalSchema } from "@/shared/decimal";

// A production weighing names its production and exactly one of the item to weigh anew or the parent to complement.
const complementParamsSchema = z
  .object({
    productionId: z.uuid().optional(),
    itemId: z.uuid().optional(),
    parentId: z.uuid().optional(),
    productSku: z.uuid(),
    quantity: positiveDecimalSchema,
  })
  .refine(({ productionId, itemId, parentId }) =>
    productionId === undefined
      ? itemId === undefined && parentId !== undefined
      : (itemId === undefined) !== (parentId === undefined),
  );

// `?parentId=&productSku=&quantity=` records a complement of that pre-weighing. An address that does not
// read as one, or names a pre-weighing that does not exist, opens the screen as a new pre-weighing.
async function complementOf(searchParams: SearchParamsInput): Promise<PreWeighingComplement | undefined> {
  const params = await searchParams;
  const parsed = complementParamsSchema.safeParse({
    productionId: params.productionId,
    itemId: params.itemId,
    parentId: params.parentId,
    productSku: params.productSku,
    quantity: params.quantity,
  });

  if (!parsed.success) return undefined;

  // With an item there is no parent to read: the new weighing is guided by the item itself.
  if (parsed.data.parentId === undefined) return parsed.data;

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
