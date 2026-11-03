import { SuppliersListPage } from "@/features/suppliers/SuppliersListPage";
import { listSuppliers } from "@/server/modules/suppliers/suppliers.repository";

export default async function Page() {
  return <SuppliersListPage suppliers={await listSuppliers()} />;
}
