import { z } from "zod";
import { Permission } from "@prisma/client";
import { apiHandler } from "@/server/http/handler";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import { listProducts } from "@/server/modules/products/products.repository";
import {
  createProductBodySchema,
  listProductsQuerySchema,
  productSchema,
} from "@/server/modules/products/products.schemas";
import { createProduct } from "@/server/modules/products/products.service";

export const GET = apiHandler(
  {
    auth: Permission.CATALOG_READ,
    tags: ["products"],
    summary: "Lista os produtos com suas embalagens, filtrados por busca (descrição ou GTIN), tipo, unidade e situação",
    query: listProductsQuerySchema,
    response: { 200: z.array(productSchema) },
  },
  async (request, reply) => reply.send(await listProducts(request.query)),
);

export const POST = apiHandler(
  {
    auth: Permission.CATALOG_CREATE,
    tags: ["products"],
    summary: "Cadastra um produto com as embalagens em que é comprado",
    body: createProductBodySchema,
    response: { 201: productSchema, 400: messageSchema, 409: messageSchema },
  },
  async (request, reply) => {
    const result = await createProduct(request.body);

    if (!result.ok) return reply.code(result.status).send({ message: result.message });

    return reply.code(201).send(result.data);
  },
);
