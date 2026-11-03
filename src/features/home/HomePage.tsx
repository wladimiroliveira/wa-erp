"use client";

import { useSession } from "@/features/auth/use-session";
import { PageTitle } from "@/components/layout/PageTitle";

export function HomePage() {
  const { user } = useSession();

  return (
    <div className="flex flex-col gap-2">
      <PageTitle>Bem-vindo, {user.name}</PageTitle>
      <p className="text-muted-foreground">Escolha uma opção no menu para começar.</p>
    </div>
  );
}
