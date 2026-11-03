import { z } from "zod";
import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { recipeSummarySchema } from "@/server/modules/recipes/recipes.schemas";
import { listRecipes } from "@/server/modules/recipes/recipes.service";

export const GET = apiHandler(
  {
    auth: Permission.CATALOG_READ,
    tags: ["recipes"],
    summary: "Lista um resumo de cada receita",
    response: { 200: z.array(recipeSummarySchema) },
  },
  async (_request, reply) => reply.send(await listRecipes()),
);
