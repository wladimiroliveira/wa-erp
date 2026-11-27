import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import {
  createOutflowBodySchema,
  listOutflowsQuerySchema,
  outflowPageSchema,
  outflowSchema,
} from "@/server/modules/stock-outflows/stock-outflows.schemas";
import { listOutflows, recordOutflow } from "@/server/modules/stock-outflows/stock-outflows.service";

export const GET = apiHandler(
  {
    auth: Permission.SALES_READ,
    tags: ["stock-outflows"],
    summary: "Lista as vendas e doações de um período, das mais recentes para as mais antigas",
    query: listOutflowsQuerySchema,
    response: { 200: outflowPageSchema },
  },
  async (request, reply) => reply.send(await listOutflows(request.query)),
);

export const POST = apiHandler(
  {
    auth: Permission.SALES_CREATE,
    tags: ["stock-outflows"],
    summary: "Registra uma venda ou doação e baixa do estoque",
    body: createOutflowBodySchema,
    response: { 201: outflowSchema, 404: messageSchema, 409: messageSchema },
  },
  async (request, reply) => {
    const result = await recordOutflow(request.body, request.currentUser!.id);

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.code(201).send(result.data);
  },
);
