import type { Permission } from "@/lib/api";

/**
 * Display order, and the list a form iterates over. A union type cannot be
 * enumerated at runtime, so this array is written by hand — and `PermissionCoverage`
 * below is what stops it from drifting: add a permission to the API, regenerate
 * the types, and the build fails here until the new one is listed and named.
 */
export const PERMISSIONS = [
  "CATALOG_READ",
  "CATALOG_CREATE",
  "CATALOG_UPDATE",
  "ENTRIES_READ",
  "ENTRIES_CREATE",
  "PRODUCTION_READ",
  "PRODUCTION_CREATE",
  "SALES_READ",
  "SALES_CREATE",
  "REPORTS_READ",
  "LOSSES_CREATE",
  "LOSSES_UPDATE",
  "ACCESS_READ",
  "ACCESS_CREATE",
  "ACCESS_UPDATE",
] as const satisfies readonly Permission[];

type AssertNever<T extends never> = T;

/** Fails to compile if the API grows a permission this file does not know about. */
export type PermissionCoverage = AssertNever<Exclude<Permission, (typeof PERMISSIONS)[number]>>;

export const PERMISSION_LABELS: Record<Permission, string> = {
  CATALOG_READ: "Ver catálogo",
  CATALOG_CREATE: "Cadastrar no catálogo",
  CATALOG_UPDATE: "Editar o catálogo",
  ENTRIES_READ: "Ver lançamentos",
  ENTRIES_CREATE: "Registrar lançamento",
  PRODUCTION_READ: "Ver produção",
  PRODUCTION_CREATE: "Registrar produção",
  SALES_READ: "Ver vendas",
  SALES_CREATE: "Registrar venda",
  REPORTS_READ: "Ver relatórios",
  LOSSES_CREATE: "Registrar avaria",
  LOSSES_UPDATE: "Gerenciar modalidades de avaria",
  ACCESS_READ: "Ver usuários e papéis",
  ACCESS_CREATE: "Criar usuários e papéis",
  ACCESS_UPDATE: "Editar usuários e papéis",
};

export const PERMISSION_GROUPS = [
  { title: "Catálogo", permissions: ["CATALOG_READ", "CATALOG_CREATE", "CATALOG_UPDATE"] },
  { title: "Lançamentos", permissions: ["ENTRIES_READ", "ENTRIES_CREATE"] },
  { title: "Produção", permissions: ["PRODUCTION_READ", "PRODUCTION_CREATE"] },
  { title: "Vendas", permissions: ["SALES_READ", "SALES_CREATE"] },
  { title: "Relatórios", permissions: ["REPORTS_READ"] },
  { title: "Avarias", permissions: ["LOSSES_CREATE", "LOSSES_UPDATE"] },
  { title: "Acesso", permissions: ["ACCESS_READ", "ACCESS_CREATE", "ACCESS_UPDATE"] },
] as const satisfies readonly { title: string; permissions: readonly Permission[] }[];

export function labelFor(permission: Permission): string {
  return PERMISSION_LABELS[permission];
}
