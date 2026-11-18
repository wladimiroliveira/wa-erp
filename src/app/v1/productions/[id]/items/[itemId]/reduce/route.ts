import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import {
  productionItemParamsSchema,
  productionSchema,
  reduceProductionItemBodySchema,
} from "@/server/modules/productions/productions.schemas";
import { reduceProductionItem } from "@/server/modules/productions/productions.service";

export const POST = apiHandler(
  {
    auth: Permission.PRODUCTION_CREATE,
    tags: ["productions"],
    summary: "Reduz a quantidade esperada de um item e escala os insumos na mesma proporção",
    params: productionItemParamsSchema,
    body: reduceProductionItemBodySchema,
    response: { 200: productionSchema, 404: messageSchema, 409: messageSchema },
  },
  async (request, reply) => {
    const result = await reduceProductionItem({
      productionId: request.params.id,
      itemId: request.params.itemId,
      quantity: request.body.quantity,
    });

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.send(result.data);
  },
);
