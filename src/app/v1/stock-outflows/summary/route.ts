import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { outflowPeriodQuerySchema, outflowSummarySchema } from "@/server/modules/stock-outflows/stock-outflows.schemas";
import { summariseOutflows } from "@/server/modules/stock-outflows/stock-outflows.service";

export const GET = apiHandler(
  {
    auth: Permission.SALES_READ,
    tags: ["stock-outflows"],
    summary: "Resume o que as vendas e doações de um período renderam e custaram",
    query: outflowPeriodQuerySchema,
    response: { 200: outflowSummarySchema },
  },
  async (request, reply) => reply.send(await summariseOutflows(request.query)),
);
