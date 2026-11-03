import {
  ArrowLeftRight,
  BookOpen,
  Package,
  PackagePlus,
  PackageX,
  Scale,
  ShieldCheck,
  Truck,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/api";

export interface NavItem {
  to: string;
  label: string;
  /** What remains of the destination when the menu is folded down to its icons. */
  icon: LucideIcon;
  permission: Permission;
}

/**
 * The single source of the menu. Each slice adds its own destination here when
 * its screen lands; a path listed here must resolve to a real route.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: "/products", label: "Produtos", icon: Package, permission: "CATALOG_READ" },
  { to: "/suppliers", label: "Fornecedores", icon: Truck, permission: "CATALOG_READ" },
  { to: "/recipes", label: "Receitas", icon: BookOpen, permission: "CATALOG_UPDATE" },
  { to: "/entries", label: "Entradas", icon: PackagePlus, permission: "ENTRIES_CREATE" },
  { to: "/stock-movements", label: "Movimentações", icon: ArrowLeftRight, permission: "ENTRIES_READ" },
  { to: "/stock", label: "Estoque", icon: Warehouse, permission: "REPORTS_READ" },
  { to: "/pre-weighings", label: "Pré-pesagens", icon: Scale, permission: "PRODUCTION_READ" },
  { to: "/loss-reasons", label: "Modalidades de avaria", icon: PackageX, permission: "LOSSES_UPDATE" },
  { to: "/roles", label: "Papéis", icon: ShieldCheck, permission: "ACCESS_READ" },
];
