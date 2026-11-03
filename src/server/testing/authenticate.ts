import type { Permission } from "@prisma/client";
import * as signin from "@/app/v1/sessions/signin/route";
import { hashPassword } from "@/server/modules/auth/auth.password";
import { testPrisma } from "./database";
import { inject } from "./inject";

export const TEST_PASSWORD = "correct horse battery";

// Creates a user holding exactly the permissions the test needs and signs in as that user. Tests
// that need a permission say so; nothing is granted by accident.
export async function authenticateAs(
  permissions: Permission[],
  username = "tester",
): Promise<{ userId: string; headers: { authorization: string } }> {
  const user = await testPrisma.user.create({
    data: {
      name: "Test Person",
      username,
      passwordHash: await hashPassword(TEST_PASSWORD),
      extraPermissions: permissions,
    },
  });

  const response = await inject(signin, {
    method: "POST",
    url: "/v1/sessions/signin",
    payload: { username, password: TEST_PASSWORD },
  });

  return { userId: user.id, headers: { authorization: `Bearer ${response.json().accessToken}` } };
}
