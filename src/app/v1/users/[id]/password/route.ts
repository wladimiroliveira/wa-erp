import { z } from "zod";
import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import { resetPasswordBodySchema, userIdParamsSchema } from "@/server/modules/users/users.schemas";
import { resetPassword } from "@/server/modules/users/users.service";

export const PATCH = apiHandler(
  {
    auth: Permission.ACCESS_UPDATE,
    tags: ["users"],
    summary: "Reseta a senha de outro usuário",
    params: userIdParamsSchema,
    body: resetPasswordBodySchema,
    response: { 204: z.void(), 404: messageSchema },
  },
  async (request, reply) => {
    const result = await resetPassword(request.params.id, request.body.newPassword);

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.code(204).send();
  },
);
