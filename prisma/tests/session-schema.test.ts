import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findSchemaConventionViolations } from "@/server/prisma/schema-convention";

const SCHEMA = readFileSync(fileURLToPath(new URL("../schema.prisma", import.meta.url)), "utf8");

describe("session schema", () => {
  it("declares the web sessions table apart from the refresh tokens of the API", () => {
    expect(SCHEMA).toMatch(/model Session \{[\s\S]*?@@map\("sessions"\)/);
  });

  it("stores only the hash of the token, never the token", () => {
    expect(SCHEMA).toMatch(/model Session \{[\s\S]*?tokenHash\s+String\s+@unique @map\("token_hash"\)/);
    expect(SCHEMA).not.toMatch(/model Session \{[\s\S]*?\n\s+token\s+String/);
  });

  it("indexes sessions by user, because revoking in bulk is routine", () => {
    expect(SCHEMA).toMatch(/@@index\(\[userId\], map: "idx_sessions_user_id"\)/);
  });

  it("violates no rule of the table convention", () => {
    expect(findSchemaConventionViolations(SCHEMA)).toEqual([]);
  });
});
