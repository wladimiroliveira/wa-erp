import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import {
  productParamsSchema,
  productSchema,
  updateProductBodySchema,
} from "@/server/modules/products/products.schemas";
import { editProduct } from "@/server/modules/products/products.service";

export const PATCH = apiHandler(
  {
    auth: Permission.CATALOG_UPDATE,
    tags: ["products"],
    summary: "Edita a descrição, o GTIN e o estoque mínimo de um produto, ou o inativa e reativa",
    params: productParamsSchema,
    body: updateProductBodySchema,
    response: { 200: productSchema, 404: messageSchema, 409: messageSchema },
  },
  async (request, reply) => {
    const result = await editProduct(request.params.sku, request.body);

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.send(result.data);
  },
);
