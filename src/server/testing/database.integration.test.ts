import { afterAll, afterEach, describe, expect, it } from "vitest";
import { resetDatabase, testPrisma } from "@/server/testing/database";

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("test infrastructure", () => {
  it("reaches a migrated database", async () => {
    await testPrisma.role.create({ data: { name: "Temporary", permissions: [] } });

    expect(await testPrisma.role.count()).toBe(1);
  });

  it("starts each test from an empty database", async () => {
    expect(await testPrisma.role.count()).toBe(0);
  });
});
