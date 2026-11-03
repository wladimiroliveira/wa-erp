import { describe, expect, it } from "vitest";
import { labelFor, PERMISSION_GROUPS, PERMISSION_LABELS, PERMISSIONS } from "@/lib/permissions";

describe("permission vocabulary", () => {
  it("names every permission in Portuguese", () => {
    for (const permission of PERMISSIONS) {
      expect(PERMISSION_LABELS[permission]).toBeTruthy();
      expect(PERMISSION_LABELS[permission]).not.toBe(permission);
    }
  });

  it("puts every permission in exactly one group, so none is unreachable in a form", () => {
    const grouped = PERMISSION_GROUPS.flatMap((group) => group.permissions);

    expect([...grouped].sort()).toEqual([...PERMISSIONS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("answers with the label for a single permission", () => {
    expect(labelFor("ACCESS_READ")).toBe("Ver usuários e papéis");
  });
});
