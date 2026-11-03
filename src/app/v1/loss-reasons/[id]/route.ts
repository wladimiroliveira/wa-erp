import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import {
  lossReasonIdParamsSchema,
  lossReasonSchema,
  updateLossReasonBodySchema,
} from "@/server/modules/losses/losses.schemas";
import { editLossReason } from "@/server/modules/losses/losses.service";

export const PATCH = apiHandler(
  {
    auth: Permission.LOSSES_UPDATE,
    tags: ["losses"],
    summary: "Edita, inativa ou reativa uma modalidade de avaria",
    params: lossReasonIdParamsSchema,
    body: updateLossReasonBodySchema,
    response: { 200: lossReasonSchema, 404: messageSchema, 409: messageSchema },
  },
  async (request, reply) => {
    const result = await editLossReason(request.params.id, request.body);

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.send(result.data);
  },
);
