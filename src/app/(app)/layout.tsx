import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { SessionProvider } from "@/features/auth/session-context";
import { TableLayoutsProvider } from "@/features/table-layouts/table-layouts-context";
import { requireUser } from "@/server/auth/current-user";
import { currentUserOf } from "@/server/modules/auth/auth.service";
import { listTableLayouts } from "@/server/modules/table-layouts/table-layouts.repository";

// The one place the session is read for the screens: whoever reaches a page under here is signed
// in, and the shell and the screens read who from the provider rather than asking again.
export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const current = await requireUser();
  const [user, tableLayouts] = await Promise.all([currentUserOf(current), listTableLayouts(current.id)]);

  return (
    <SessionProvider user={user}>
      <TableLayoutsProvider initial={tableLayouts}>
        <AppShell>{children}</AppShell>
      </TableLayoutsProvider>
    </SessionProvider>
  );
}
