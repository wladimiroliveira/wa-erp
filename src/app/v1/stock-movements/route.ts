import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { listStockMovementsQuerySchema, stockMovementPageSchema } from "@/server/modules/stock/stock.schemas";
import { stockMovementsPage } from "@/server/modules/stock/stock.service";

export const GET = apiHandler(
  {
    auth: Permission.ENTRIES_READ,
    tags: ["stock"],
    summary: "Lista as movimentações de estoque, das mais recentes para as mais antigas",
    query: listStockMovementsQuerySchema,
    response: { 200: stockMovementPageSchema },
  },
  async (request, reply) => reply.send(await stockMovementsPage(request.query)),
);
