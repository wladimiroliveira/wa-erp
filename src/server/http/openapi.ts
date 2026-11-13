import { z } from "zod";
import { PUBLIC } from "@/server/modules/auth/auth.access";
import type { CollectedRoute } from "@/server/routes";

type JsonSchema = Record<string, unknown>;

// Named schemas (`.meta({ id })`) come out of zod nested in `definitions`; OpenAPI wants them in
// `components.schemas`, shared by every route that uses them.
type Components = Record<string, JsonSchema>;

const rewriteRefs = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(rewriteRefs);
  if (node === null || typeof node !== "object") return node;

  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      key === "$ref" && typeof value === "string"
        ? value.replace(/^#\/(?:definitions|\$defs)\//, "#/components/schemas/")
        : rewriteRefs(value),
    ]),
  );
};

const toSchema = (schema: z.ZodType, io: "input" | "output", components: Components): JsonSchema => {
  const { $schema: _dropped, ...generated } = z.toJSONSchema(schema, {
    target: "openapi-3.0",
    io,
    unrepresentable: "any",
  });
  const { definitions, $defs, ...rest } = generated as JsonSchema;
  const named = { ...(definitions as Components | undefined), ...($defs as Components | undefined) };

  for (const [name, definition] of Object.entries(named)) {
    const hoisted = rewriteRefs(definition) as JsonSchema;

    if (components[name] !== undefined && JSON.stringify(components[name]) !== JSON.stringify(hoisted)) {
      throw new Error(`Two different schemas share the id "${name}".`);
    }

    components[name] = hoisted;
  }

  return rewriteRefs(rest) as JsonSchema;
};

/** One `in: path` or `in: query` parameter per property of an object schema. */
function parametersOf(schema: z.ZodType | undefined, location: "path" | "query", components: Components): JsonSchema[] {
  if (schema === undefined) return [];

  const object = toSchema(schema, "input", components);
  const properties = (object.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((object.required ?? []) as string[]);

  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: location,
    required: location === "path" || required.has(name),
    schema: property,
  }));
}

function responsesOf(route: CollectedRoute, components: Components): Record<string, JsonSchema> {
  return Object.fromEntries(
    Object.entries(route.spec.response).map(([status, schema]) => {
      const body = toSchema(schema!, "output", components);
      // A `void` response has no body, as a 204 does.
      const hasBody = Object.keys(body).length > 0 && body.not === undefined;

      return [
        status,
        hasBody
          ? { description: "Default Response", content: { "application/json": { schema: body } } }
          : { description: "Default Response" },
      ];
    }),
  );
}

/**
 * The OpenAPI document of the collected routes. It is what the mobile client generates its code
 * from, so each route's path, schemas and status codes come from the same declarations the
 * handlers enforce.
 */
export function buildOpenApiDocument(routes: CollectedRoute[]): JsonSchema {
  const paths: Record<string, Record<string, JsonSchema>> = {};
  const schemas: Components = {};

  for (const route of routes) {
    const { spec } = route;
    const operation: JsonSchema = {
      tags: spec.tags,
      summary: spec.summary,
      ...(spec.auth === PUBLIC ? {} : { security: [{ BearerAuth: [] }] }),
    };
    const parameters = [...parametersOf(spec.params, "path", schemas), ...parametersOf(spec.query, "query", schemas)];

    if (parameters.length > 0) operation.parameters = parameters;
    if (spec.body !== undefined) {
      operation.requestBody = {
        required: true,
        content: { "application/json": { schema: toSchema(spec.body, "input", schemas) } },
      };
    }
    operation.responses = responsesOf(route, schemas);

    paths[route.path] = { ...paths[route.path], [route.method.toLowerCase()]: operation };
  }

  return {
    openapi: "3.0.3",
    info: { title: "wa-erp", description: "API do wa-system", version: "0.0.0" },
    components: {
      securitySchemes: { BearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      ...(Object.keys(schemas).length > 0 ? { schemas } : {}),
    },
    paths,
  };
}
