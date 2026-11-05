import { UsersListPage } from "@/features/users/UsersListPage";
import { listRoles } from "@/server/modules/roles/roles.repository";
import { listUsers } from "@/server/modules/users/users.service";

export default async function Page() {
  const [users, roles] = await Promise.all([listUsers(), listRoles()]);

  return <UsersListPage users={users} roles={roles.map(({ id, name, permissions }) => ({ id, name, permissions }))} />;
}
