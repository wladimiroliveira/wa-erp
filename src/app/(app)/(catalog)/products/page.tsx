import { readProductFilters } from "@/features/products/product-filters";
import { ProductsListPage } from "@/features/products/ProductsListPage";
import { toSearchParams, type SearchParamsInput } from "@/lib/search-params";
import { listProducts } from "@/server/modules/products/products.repository";

// The address holds the filters in effect, so the server reads the list the link asks for. The
// whole catalog comes along for the recipe a manufactured product is asked for once registered.
export default async function Page({ searchParams }: { searchParams: SearchParamsInput }) {
  const filters = readProductFilters(await toSearchParams(searchParams));
  const [products, catalog] = await Promise.all([listProducts(filters), listProducts()]);

  return <ProductsListPage products={products} catalog={catalog} />;
}
