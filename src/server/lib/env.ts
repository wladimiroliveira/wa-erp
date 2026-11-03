import { z } from "zod";
import { loadDotenv } from "./dotenv";

// Next loads the .env files itself before any server code runs; this covers the other entry
// points, the tests and the scripts, so whoever reaches this module reads an environment that is
// already complete, whatever the import order.
loadDotenv();

const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${details}`);
  }

  return result.data;
}

let cached: Env | null = null;

export function loadEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
