import { RolesListPage } from "@/features/roles/RolesListPage";
import { listRoles } from "@/server/modules/roles/roles.repository";

export default async function Page() {
  const roles = (await listRoles()).map(({ id, name, permissions }) => ({ id, name, permissions }));

  return <RolesListPage roles={roles} />;
}
