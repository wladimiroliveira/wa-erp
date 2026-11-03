import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { stockPositionSchema } from "@/server/modules/stock/stock.schemas";
import { stockPosition } from "@/server/modules/stock/stock.service";

export const GET = apiHandler(
  {
    auth: Permission.REPORTS_READ,
    tags: ["stock"],
    summary: "Posição de estoque de cada produto e o valor total em estoque",
    response: { 200: stockPositionSchema },
  },
  async (_request, reply) => reply.send(await stockPosition()),
);
