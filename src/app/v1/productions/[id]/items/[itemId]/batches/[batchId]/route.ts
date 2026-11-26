import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import { removeBatch } from "@/server/modules/productions/production-batches.service";
import { productionBatchParamsSchema, productionSchema } from "@/server/modules/productions/productions.schemas";

export const DELETE = apiHandler(
  {
    auth: Permission.PRODUCTION_CREATE,
    tags: ["productions"],
    summary: "Remove uma leva de um item pendente",
    params: productionBatchParamsSchema,
    response: { 200: productionSchema, 404: messageSchema, 409: messageSchema },
  },
  async (request, reply) => {
    const result = await removeBatch({
      productionId: request.params.id,
      itemId: request.params.itemId,
      batchId: request.params.batchId,
    });

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.send(result.data);
  },
);
