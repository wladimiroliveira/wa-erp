import { z } from "zod";
import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import { roleIdParamsSchema, roleSchema, updateRoleBodySchema } from "@/server/modules/roles/roles.schemas";
import { editRole, removeRole } from "@/server/modules/roles/roles.service";

export const PATCH = apiHandler(
  {
    auth: Permission.ACCESS_UPDATE,
    tags: ["roles"],
    summary: "Edita o nome e o pacote de permissões",
    params: roleIdParamsSchema,
    body: updateRoleBodySchema,
    response: { 200: roleSchema, 404: messageSchema, 409: messageSchema },
  },
  async (request, reply) => {
    const result = await editRole(request.params.id, request.body);

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.send(result.data);
  },
);

export const DELETE = apiHandler(
  {
    auth: Permission.ACCESS_UPDATE,
    tags: ["roles"],
    summary: "Remove o papel; seus usuários ficam sem herança",
    params: roleIdParamsSchema,
    response: { 204: z.void(), 404: messageSchema },
  },
  async (request, reply) => {
    const result = await removeRole(request.params.id);

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.code(204).send();
  },
);
