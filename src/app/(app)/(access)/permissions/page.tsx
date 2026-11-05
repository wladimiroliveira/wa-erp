import { PermissionsListPage } from "@/features/permissions/PermissionsListPage";
import { listRoles } from "@/server/modules/roles/roles.repository";

export default async function Page() {
  const roles = (await listRoles()).map(({ id, name, permissions }) => ({ id, name, permissions }));

  return <PermissionsListPage roles={roles} />;
}
