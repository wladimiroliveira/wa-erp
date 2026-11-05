import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUser, resetUserPassword, updateUser } from "@/features/users/actions";
import { aUser } from "@/tests/samples";

const USER_ID = "018f0000-0000-7000-8000-000000000002";

const ACTOR_ID = "018f0000-0000-7000-8000-000000000001";

const signedIn = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/server/auth/current-user", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/current-user")>()),
  requireUser: async () => ({ id: ACTOR_ID, permissions: signedIn.permissions }),
}));

const service = vi.hoisted(() => ({
  createUser: vi.fn(),
  editUser: vi.fn(),
  resetPassword: vi.fn(),
}));

vi.mock("@/server/modules/users/users.service", () => service);

beforeEach(() => {
  vi.clearAllMocks();
  signedIn.permissions = [];
});

describe("createUser", () => {
  const body = { name: "Maria Souza", username: "maria", password: "12345678", roleId: null, extraPermissions: [] };

  it("answers 403 without ACCESS_CREATE, before touching the service", async () => {
    signedIn.permissions = ["ACCESS_READ", "ACCESS_UPDATE"];

    expect(await createUser(body)).toMatchObject({ ok: false, status: 403 });
    expect(service.createUser).not.toHaveBeenCalled();
  });

  it("answers 400 for a body the schema refuses", async () => {
    signedIn.permissions = ["ACCESS_CREATE"];

    expect(await createUser({ ...body, password: "short" })).toMatchObject({ ok: false, status: 400 });
    expect(service.createUser).not.toHaveBeenCalled();
  });

  it("hands the body to the service and returns the user it made", async () => {
    signedIn.permissions = ["ACCESS_CREATE"];
    service.createUser.mockResolvedValue({ ok: true, data: aUser() });

    expect(await createUser(body)).toEqual({ ok: true, data: aUser() });
    expect(service.createUser).toHaveBeenCalledWith(body);
  });

  it("passes on the failure the service answers with", async () => {
    signedIn.permissions = ["ACCESS_CREATE"];
    service.createUser.mockResolvedValue({ ok: false, status: 409, message: "taken" });

    expect(await createUser(body)).toMatchObject({ ok: false, status: 409 });
  });
});

describe("updateUser", () => {
  it("answers 403 without ACCESS_UPDATE", async () => {
    signedIn.permissions = ["ACCESS_READ", "ACCESS_CREATE"];

    expect(await updateUser(USER_ID, { isActive: false })).toMatchObject({ ok: false, status: 403 });
    expect(service.editUser).not.toHaveBeenCalled();
  });

  it("answers 400 for an id that is not one", async () => {
    signedIn.permissions = ["ACCESS_UPDATE"];

    expect(await updateUser("nope", { isActive: false })).toMatchObject({ ok: false, status: 400 });
  });

  it("hands the changes to the service along with who is making them", async () => {
    signedIn.permissions = ["ACCESS_UPDATE"];
    service.editUser.mockResolvedValue({ ok: true, data: aUser({ isActive: false }) });

    expect(await updateUser(USER_ID, { isActive: false })).toEqual({ ok: true, data: aUser({ isActive: false }) });
    expect(service.editUser).toHaveBeenCalledWith(USER_ID, { isActive: false }, ACTOR_ID);
  });
});

describe("resetUserPassword", () => {
  it("answers 403 without ACCESS_UPDATE", async () => {
    signedIn.permissions = ["ACCESS_CREATE"];

    expect(await resetUserPassword(USER_ID, { newPassword: "12345678" })).toMatchObject({ ok: false, status: 403 });
    expect(service.resetPassword).not.toHaveBeenCalled();
  });

  it("answers 400 for a password shorter than 8", async () => {
    signedIn.permissions = ["ACCESS_UPDATE"];

    expect(await resetUserPassword(USER_ID, { newPassword: "short" })).toMatchObject({ ok: false, status: 400 });
  });

  it("hands the new password to the service", async () => {
    signedIn.permissions = ["ACCESS_UPDATE"];
    service.resetPassword.mockResolvedValue({ ok: true, data: undefined });

    expect(await resetUserPassword(USER_ID, { newPassword: "12345678" })).toEqual({ ok: true });
    expect(service.resetPassword).toHaveBeenCalledWith(USER_ID, "12345678");
  });
});
