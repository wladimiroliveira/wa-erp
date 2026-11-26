import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import { recordBatch } from "@/server/modules/productions/production-batches.service";
import {
  batchBodySchema,
  finishConflictSchema,
  productionItemParamsSchema,
  productionSchema,
} from "@/server/modules/productions/productions.schemas";

export const POST = apiHandler(
  {
    auth: Permission.PRODUCTION_CREATE,
    tags: ["productions"],
    summary: "Registra uma leva do item: o que foi feito agora ou o que já estava pronto",
    params: productionItemParamsSchema,
    body: batchBodySchema,
    response: { 201: productionSchema, 404: messageSchema, 409: finishConflictSchema },
  },
  async (request, reply) => {
    const result = await recordBatch({
      productionId: request.params.id,
      itemId: request.params.itemId,
      ...request.body,
      createdById: request.currentUser!.id,
    });

    if (!result.ok) return reply.code(result.status).send({ ...result.details, message: result.message });

    return reply.code(201).send(result.data);
  },
);
