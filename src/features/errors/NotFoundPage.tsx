import Link from "next/link";

export function NotFoundPage() {
  return (
    <div className="flex flex-col gap-2 p-6">
      <h1 className="text-xl font-semibold">Página não encontrada</h1>
      <p>O endereço que você tentou abrir não existe.</p>
      <Link href="/" className="flex min-h-8 w-fit items-center text-sm underline">
        Voltar ao início
      </Link>
    </div>
  );
}
