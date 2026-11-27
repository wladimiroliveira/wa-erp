import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import {
  damageProductionItemBodySchema,
  finishConflictSchema,
  productionItemParamsSchema,
  productionSchema,
} from "@/server/modules/productions/productions.schemas";
import { damageProductionItem } from "@/server/modules/productions/productions.service";

export const POST = apiHandler(
  {
    auth: Permission.PRODUCTION_CREATE,
    tags: ["productions"],
    summary: "Registra a perda de um item que deu errado: os insumos saem do estoque como perda",
    params: productionItemParamsSchema,
    body: damageProductionItemBodySchema,
    response: { 200: productionSchema, 404: messageSchema, 409: finishConflictSchema },
  },
  async (request, reply) => {
    const result = await damageProductionItem({
      productionId: request.params.id,
      itemId: request.params.itemId,
      reasonId: request.body.reasonId,
      note: request.body.note,
      createdById: request.currentUser!.id,
    });

    if (!result.ok) return reply.code(result.status).send({ ...result.details, message: result.message });

    return reply.send(result.data);
  },
);
