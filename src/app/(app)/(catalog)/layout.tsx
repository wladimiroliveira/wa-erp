import type { ReactNode } from "react";
import { RequirePermission } from "@/features/auth/RequirePermission";

export default function Layout({ children }: { children: ReactNode }) {
  return <RequirePermission permission="CATALOG_READ">{children}</RequirePermission>;
}
