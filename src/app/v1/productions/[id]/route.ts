import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import { productionIdParamsSchema, productionSchema } from "@/server/modules/productions/productions.schemas";
import { getProduction } from "@/server/modules/productions/productions.service";

export const GET = apiHandler(
  {
    auth: Permission.PRODUCTION_READ,
    tags: ["productions"],
    summary: "Consulta uma produção e o que ela usa de cada insumo",
    params: productionIdParamsSchema,
    response: { 200: productionSchema, 404: messageSchema },
  },
  async (request, reply) => {
    const result = await getProduction(request.params.id);

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.send(result.data);
  },
);
