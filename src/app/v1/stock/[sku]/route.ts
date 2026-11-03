import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import {
  productStockParamsSchema,
  productStockQuerySchema,
  productStockSchema,
} from "@/server/modules/stock/stock.schemas";
import { productStockPosition } from "@/server/modules/stock/stock.service";

export const GET = apiHandler(
  {
    auth: Permission.REPORTS_READ,
    tags: ["stock"],
    summary: "Posição de estoque de um produto e os lotes que a compõem",
    params: productStockParamsSchema,
    query: productStockQuerySchema,
    response: { 200: productStockSchema, 404: messageSchema },
  },
  async (request, reply) => {
    const result = await productStockPosition(request.params.sku, { depleted: request.query.depleted === "true" });

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.send(result.data);
  },
);
