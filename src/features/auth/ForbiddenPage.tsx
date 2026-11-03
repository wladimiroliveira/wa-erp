import { PageTitle } from "@/components/layout/PageTitle";

export function ForbiddenPage() {
  return (
    <div className="flex flex-col gap-2 p-6">
      <PageTitle>Acesso negado</PageTitle>
      <p>Você não tem permissão para ver esta tela.</p>
      <p className="text-sm text-muted-foreground">Fale com quem administra o acesso se precisar dela.</p>
    </div>
  );
}
