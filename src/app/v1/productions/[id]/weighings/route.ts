import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import {
  productionIdParamsSchema,
  productionSchema,
  productionWeighingBodySchema,
} from "@/server/modules/productions/productions.schemas";
import { recordProductionWeighing } from "@/server/modules/productions/productions.service";

export const POST = apiHandler(
  {
    auth: Permission.PRODUCTION_CREATE,
    tags: ["productions"],
    summary:
      "Registra uma nova pesagem dentro da produção: a de um item que deu errado, ou o complemento de um item em falta; cada etapa pesada entra como item",
    params: productionIdParamsSchema,
    body: productionWeighingBodySchema,
    response: { 200: productionSchema, 404: messageSchema, 409: messageSchema },
  },
  async (request, reply) => {
    const { itemId, parentId, ...tree } = request.body;
    const result = await recordProductionWeighing({
      productionId: request.params.id,
      createdById: request.currentUser!.id,
      itemId,
      parentId,
      tree,
    });

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.send(result.data);
  },
);
