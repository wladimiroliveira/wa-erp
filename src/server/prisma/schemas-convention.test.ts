import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MODULES_DIR = fileURLToPath(new URL("../modules", import.meta.url));

// What a schema file may pull in at runtime. Anything else would reach the browser bundle the
// moment a client component imports the schema for its types or its validation.
const ALLOWED = [/^zod$/, /^@\/shared\//, /^@\/server\/lib\/pagination$/, /\.schemas$/];

const RUNTIME_IMPORT = /^import\s+(?!type\s)[^;]*?from\s+"([^"]+)"/gm;

function schemaFiles(): string[] {
  return readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      readdirSync(join(MODULES_DIR, entry.name))
        .filter((file) => file.endsWith(".schemas.ts"))
        .map((file) => join(entry.name, file)),
    );
}

describe("module schemas", () => {
  it.each(schemaFiles())("%s imports at runtime only zod, shared code and other schemas", (file) => {
    const source = readFileSync(join(MODULES_DIR, file), "utf8");
    const offending = [...source.matchAll(RUNTIME_IMPORT)]
      .map((match) => match[1]!)
      .filter((specifier) => !ALLOWED.some((rule) => rule.test(specifier)));

    expect(offending).toEqual([]);
  });
});
