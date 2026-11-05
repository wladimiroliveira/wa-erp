import { describe, expect, it } from "vitest";
import { Permission } from "@prisma/client";
import { removesOwnAccess } from "@/server/modules/users/users.lockout";

const ME = "018f0000-0000-7000-8000-000000000001";
const SOMEONE_ELSE = "018f0000-0000-7000-8000-000000000002";

const managing = { isActive: true, rolePermissions: [], extraPermissions: [Permission.ACCESS_UPDATE] };

describe("removesOwnAccess", () => {
  it("lets an edit of one's own account through when access management survives it", () => {
    expect(removesOwnAccess(ME, ME, managing)).toBe(false);
  });

  it("refuses deactivating one's own account", () => {
    expect(removesOwnAccess(ME, ME, { ...managing, isActive: false })).toBe(true);
  });

  it("refuses dropping ACCESS_UPDATE from one's own extra permissions", () => {
    expect(removesOwnAccess(ME, ME, { ...managing, extraPermissions: [Permission.ACCESS_READ] })).toBe(true);
  });

  it("lets ACCESS_UPDATE go from the extras while the role still grants it", () => {
    expect(
      removesOwnAccess(ME, ME, { isActive: true, rolePermissions: [Permission.ACCESS_UPDATE], extraPermissions: [] }),
    ).toBe(false);
  });

  it("refuses a role swap that leaves one without ACCESS_UPDATE", () => {
    expect(
      removesOwnAccess(ME, ME, { isActive: true, rolePermissions: [Permission.SALES_READ], extraPermissions: [] }),
    ).toBe(true);
  });

  it("does not care what is done to somebody else", () => {
    expect(removesOwnAccess(ME, SOMEONE_ELSE, { isActive: false, rolePermissions: [], extraPermissions: [] })).toBe(
      false,
    );
  });
});
