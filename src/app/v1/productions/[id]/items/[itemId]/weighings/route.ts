import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import { weighItem } from "@/server/modules/productions/production-batches.service";
import {
  finishConflictSchema,
  itemWeighingBodySchema,
  productionItemParamsSchema,
  productionSchema,
} from "@/server/modules/productions/productions.schemas";

export const POST = apiHandler(
  {
    auth: Permission.PRODUCTION_CREATE,
    tags: ["productions"],
    summary: "Registra uma pesagem do item: guia o item que aguarda pesagem, ou soma mais uma leva aos insumos dele",
    params: productionItemParamsSchema,
    body: itemWeighingBodySchema,
    response: { 200: productionSchema, 404: messageSchema, 409: finishConflictSchema },
  },
  async (request, reply) => {
    const result = await weighItem({
      productionId: request.params.id,
      itemId: request.params.itemId,
      ...request.body,
      createdById: request.currentUser!.id,
    });

    if (!result.ok) return reply.code(result.status).send({ ...result.details, message: result.message });

    return reply.send(result.data);
  },
);
