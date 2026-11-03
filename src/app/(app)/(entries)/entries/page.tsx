import { EntryPage } from "@/features/entries/EntryPage";
import { listProducts } from "@/server/modules/products/products.repository";
import { listSuppliers } from "@/server/modules/suppliers/suppliers.repository";

// An inactive product is refused by the server, so it is never offered.
export default async function Page() {
  const [products, suppliers] = await Promise.all([listProducts({ status: "ACTIVE" }), listSuppliers()]);

  return <EntryPage products={products} suppliers={suppliers} />;
}
