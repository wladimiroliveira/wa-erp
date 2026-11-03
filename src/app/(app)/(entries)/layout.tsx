import type { ReactNode } from "react";
import { RequirePermission } from "@/features/auth/RequirePermission";

// The form cannot offer a product without reading the catalog.
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequirePermission permission="ENTRIES_CREATE">
      <RequirePermission permission="CATALOG_READ">{children}</RequirePermission>
    </RequirePermission>
  );
}
