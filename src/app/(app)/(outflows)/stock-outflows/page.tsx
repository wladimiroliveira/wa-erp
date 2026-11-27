import { StockOutflowsPage } from "@/features/stock-outflows/StockOutflowsPage";
import { listProducts } from "@/server/modules/products/products.repository";
import { outflowPeriodQuerySchema } from "@/server/modules/stock-outflows/stock-outflows.schemas";
import { listOutflows, summariseOutflows } from "@/server/modules/stock-outflows/stock-outflows.service";
import { OUTFLOW_PAGE_SIZE } from "@/shared/outflows";
import type { SearchParamsInput } from "@/lib/search-params";

const pad = (value: number) => String(value).padStart(2, "0");

/** The first and last day of the current local month, the period an address without one asks for. */
function currentMonth(): { from: string; to: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();

  return { from: `${year}-${month}-01`, to: `${year}-${month}-${pad(lastDay)}` };
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The period the address asks for; one that makes no sense opens the current month. */
function periodOf(params: Record<string, string | string[] | undefined>) {
  const parsed = outflowPeriodQuerySchema.safeParse({
    from: first(params.from),
    to: first(params.to),
    productSku: first(params.productSku),
  });

  return parsed.success ? parsed.data : { ...currentMonth(), productSku: undefined };
}

export default async function Page({ searchParams }: { searchParams: SearchParamsInput }) {
  const query = periodOf(await searchParams);
  const [page, summary, products] = await Promise.all([
    listOutflows({ ...query, limit: OUTFLOW_PAGE_SIZE }),
    summariseOutflows(query),
    listProducts({ status: "ACTIVE" }),
  ]);

  return (
    <StockOutflowsPage
      page={page}
      summary={summary}
      products={products}
      from={query.from}
      to={query.to}
      productSku={query.productSku}
    />
  );
}
