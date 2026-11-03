import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import { updateUserBodySchema, userIdParamsSchema, userSchema } from "@/server/modules/users/users.schemas";
import { editUser, readUser } from "@/server/modules/users/users.service";

export const GET = apiHandler(
  {
    auth: Permission.ACCESS_READ,
    tags: ["users"],
    summary: "Cadastro e permissões efetivas",
    params: userIdParamsSchema,
    response: { 200: userSchema, 404: messageSchema },
  },
  async (request, reply) => {
    const result = await readUser(request.params.id);

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.send(result.data);
  },
);

export const PATCH = apiHandler(
  {
    auth: Permission.ACCESS_UPDATE,
    tags: ["users"],
    summary: "Edita papel, permissões avulsas, nome e situação",
    params: userIdParamsSchema,
    body: updateUserBodySchema,
    response: { 200: userSchema, 404: messageSchema },
  },
  async (request, reply) => {
    const result = await editUser(request.params.id, request.body);

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.send(result.data);
  },
);
