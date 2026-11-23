import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import {
  finishConflictSchema,
  finishProductionBodySchema,
  productionIdParamsSchema,
  productionSchema,
} from "@/server/modules/productions/productions.schemas";
import { finishProduction } from "@/server/modules/productions/productions.service";

export const POST = apiHandler(
  {
    auth: Permission.PRODUCTION_CREATE,
    tags: ["productions"],
    summary:
      "Finaliza itens da produção: baixa os insumos, descarta as sobras de embalagens abertas e dá entrada no que foi produzido; a produção finaliza com o último item pendente",
    params: productionIdParamsSchema,
    body: finishProductionBodySchema,
    response: { 200: productionSchema, 404: messageSchema, 409: finishConflictSchema },
  },
  async (request, reply) => {
    const result = await finishProduction({
      id: request.params.id,
      createdById: request.currentUser!.id,
      items: request.body.items,
      hasLeftoversInCost: request.body.hasLeftoversInCost,
    });

    if (!result.ok) return reply.code(result.status).send({ ...result.details, message: result.message });

    return reply.send(result.data);
  },
);
