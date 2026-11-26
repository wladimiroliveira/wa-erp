import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import { concludeItem } from "@/server/modules/productions/production-batches.service";
import {
  concludeItemBodySchema,
  finishConflictSchema,
  productionItemParamsSchema,
  productionSchema,
} from "@/server/modules/productions/productions.schemas";

export const POST = apiHandler(
  {
    auth: Permission.PRODUCTION_CREATE,
    tags: ["productions"],
    summary:
      "Conclui um item: baixa os insumos do que foi feito agora, descarta as sobras de embalagens abertas e dá entrada nas levas, um lote por validade; a produção finaliza com o último item pendente",
    params: productionItemParamsSchema,
    body: concludeItemBodySchema,
    response: { 200: productionSchema, 404: messageSchema, 409: finishConflictSchema },
  },
  async (request, reply) => {
    const result = await concludeItem({
      productionId: request.params.id,
      itemId: request.params.itemId,
      ...request.body,
      createdById: request.currentUser!.id,
    });

    if (!result.ok) return reply.code(result.status).send({ ...result.details, message: result.message });

    return reply.send(result.data);
  },
);
