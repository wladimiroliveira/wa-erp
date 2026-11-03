import { fail, succeed, type Result } from "@/server/lib/result";
import { findSupplierByName, insertSupplier } from "./suppliers.repository";

type Supplier = Awaited<ReturnType<typeof insertSupplier>>;

export async function createSupplier(input: { name: string }): Promise<Result<Supplier, 409>> {
  if ((await findSupplierByName(input.name)) !== null) {
    return fail(409, "A supplier with this name already exists.");
  }

  return succeed(await insertSupplier(input));
}
