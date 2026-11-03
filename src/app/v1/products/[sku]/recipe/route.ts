import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import { recipeParamsSchema, recipeSchema, saveRecipeBodySchema } from "@/server/modules/recipes/recipes.schemas";
import { defineRecipe, readRecipe } from "@/server/modules/recipes/recipes.service";

export const GET = apiHandler(
  {
    auth: Permission.CATALOG_READ,
    tags: ["recipes"],
    summary: "Consulta a receita de um produto",
    params: recipeParamsSchema,
    response: { 200: recipeSchema, 404: messageSchema },
  },
  async (request, reply) => {
    const result = await readRecipe(request.params.sku);

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.send(result.data);
  },
);

export const PUT = apiHandler(
  {
    auth: Permission.CATALOG_UPDATE,
    tags: ["recipes"],
    summary: "Define ou substitui a receita de um produto fabricado",
    params: recipeParamsSchema,
    body: saveRecipeBodySchema,
    response: { 200: recipeSchema, 404: messageSchema, 409: messageSchema },
  },
  async (request, reply) => {
    const result = await defineRecipe(request.params.sku, request.body);

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.send(result.data);
  },
);
