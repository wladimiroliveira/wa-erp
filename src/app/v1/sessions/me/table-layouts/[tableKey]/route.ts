import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { AUTHENTICATED } from "@/server/modules/auth/auth.access";
import { deleteTableLayout, saveTableLayout } from "@/server/modules/table-layouts/table-layouts.repository";
import {
  tableKeyParamsSchema,
  tableLayoutBodySchema,
  tableLayoutSchema,
} from "@/server/modules/table-layouts/table-layouts.schemas";

export const PUT = apiHandler(
  {
    auth: AUTHENTICATED,
    tags: ["table-layouts"],
    summary: "Grava a ordem e a largura das colunas de uma tabela",
    params: tableKeyParamsSchema,
    body: tableLayoutBodySchema,
    response: { 200: tableLayoutSchema },
  },
  async (request, reply) =>
    reply.send(await saveTableLayout(request.currentUser!.id, request.params.tableKey, request.body)),
);

export const DELETE = apiHandler(
  {
    auth: AUTHENTICATED,
    tags: ["table-layouts"],
    summary: "Devolve uma tabela à disposição original das colunas",
    params: tableKeyParamsSchema,
    response: { 204: z.void() },
  },
  async (request, reply) => {
    await deleteTableLayout(request.currentUser!.id, request.params.tableKey);

    return reply.code(204).send();
  },
);
