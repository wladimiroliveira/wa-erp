import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { AUTHENTICATED } from "@/server/modules/auth/auth.access";
import { listTableLayouts } from "@/server/modules/table-layouts/table-layouts.repository";
import { tableLayoutSchema } from "@/server/modules/table-layouts/table-layouts.schemas";

// Each user arranges only their own tables, so every route reads and writes under the user signed in.
export const GET = apiHandler(
  {
    auth: AUTHENTICATED,
    tags: ["table-layouts"],
    summary: "Lista a disposição das colunas que o usuário deu às tabelas",
    response: { 200: z.array(tableLayoutSchema) },
  },
  async (request, reply) => reply.send(await listTableLayouts(request.currentUser!.id)),
);
