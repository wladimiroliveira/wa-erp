import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import { productionIdParamsSchema, productionSchema } from "@/server/modules/productions/productions.schemas";
import { cancelProduction } from "@/server/modules/productions/production-batches.service";

export const POST = apiHandler(
  {
    auth: Permission.PRODUCTION_CREATE,
    tags: ["productions"],
    summary:
      "Cancela uma produção em andamento: conclui os itens que já têm levas com o que foi feito e libera as pré-pesagens dos outros",
    params: productionIdParamsSchema,
    response: { 200: productionSchema, 404: messageSchema, 409: messageSchema },
  },
  async (request, reply) => {
    const result = await cancelProduction({ id: request.params.id, createdById: request.currentUser!.id });

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.send(result.data);
  },
);
