import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import { createLossBodySchema, lossSchema } from "@/server/modules/losses/losses.schemas";
import { recordLoss } from "@/server/modules/losses/losses.service";

export const POST = apiHandler(
  {
    auth: Permission.LOSSES_CREATE,
    tags: ["losses"],
    summary: "Registra a avaria de parte de um lote e baixa do estoque",
    body: createLossBodySchema,
    response: { 201: lossSchema, 404: messageSchema, 409: messageSchema },
  },
  async (request, reply) => {
    const result = await recordLoss(request.body, request.currentUser!.id);

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.code(201).send(result.data);
  },
);
