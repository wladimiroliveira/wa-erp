import { z } from "zod";
import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import { listRoles } from "@/server/modules/roles/roles.repository";
import { createRoleBodySchema, roleSchema } from "@/server/modules/roles/roles.schemas";
import { createRole } from "@/server/modules/roles/roles.service";

export const GET = apiHandler(
  {
    auth: Permission.ACCESS_READ,
    tags: ["roles"],
    summary: "Lista os papéis",
    response: { 200: z.array(roleSchema) },
  },
  async (_request, reply) => reply.send(await listRoles()),
);

export const POST = apiHandler(
  {
    auth: Permission.ACCESS_CREATE,
    tags: ["roles"],
    summary: "Cria um papel",
    body: createRoleBodySchema,
    response: { 201: roleSchema, 409: messageSchema },
  },
  async (request, reply) => {
    const result = await createRole(request.body);

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.code(201).send(result.data);
  },
);
