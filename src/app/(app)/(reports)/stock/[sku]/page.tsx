import { notFound } from "next/navigation";
import { StockProductPage } from "@/features/stock/StockProductPage";
import { listLossReasons } from "@/server/modules/losses/losses.service";
import { productStockParamsSchema, productStockQuerySchema } from "@/server/modules/stock/stock.schemas";
import { productStockPosition } from "@/server/modules/stock/stock.service";
import type { SearchParamsInput } from "@/lib/search-params";

type Params = Promise<{ sku: string }>;
export default async function Page({ searchParams, params }: { params: Params; searchParams: SearchParamsInput }) {
  const sku = productStockParamsSchema.safeParse(await params);

  // A sku that is not even an id names no product, the same as one that no longer exists.
  if (!sku.success) notFound();

  const query = productStockQuerySchema.safeParse(await searchParams);
  const depleted = query.success && query.data.depleted === "true";
  const [stock, reasons] = await Promise.all([productStockPosition(sku.data.sku, { depleted }), listLossReasons()]);

  if (!stock.ok) notFound();

  return <StockProductPage stock={stock.data} reasons={reasons} depleted={depleted} />;
}
