import { z } from "zod";
import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import { createUserBodySchema, userSchema } from "@/server/modules/users/users.schemas";
import { createUser, listUsers } from "@/server/modules/users/users.service";

export const GET = apiHandler(
  {
    auth: Permission.ACCESS_READ,
    tags: ["users"],
    summary: "Lista os usuários",
    response: { 200: z.array(userSchema) },
  },
  async (_request, reply) => reply.send(await listUsers()),
);

export const POST = apiHandler(
  {
    auth: Permission.ACCESS_CREATE,
    tags: ["users"],
    summary: "Cria um usuário",
    body: createUserBodySchema,
    response: { 201: userSchema, 404: messageSchema, 409: messageSchema },
  },
  async (request, reply) => {
    const result = await createUser(request.body);

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.code(201).send(result.data);
  },
);
