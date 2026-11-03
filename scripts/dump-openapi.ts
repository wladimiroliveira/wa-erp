import { writeFileSync } from "node:fs";
import { buildOpenApiDocument } from "../src/server/http/openapi.ts";
import { collectRoutes } from "../src/server/routes.ts";

// Serializing the document from the route files, rather than fetching it from a running server, is
// what lets the clients regenerate their types with nothing but a checkout: no port, no database.
const document = buildOpenApiDocument(await collectRoutes());

writeFileSync(new URL("../openapi.json", import.meta.url), `${JSON.stringify(document, null, 2)}\n`);

console.log("openapi.json written");
