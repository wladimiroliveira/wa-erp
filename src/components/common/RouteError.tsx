"use client";

import { Button } from "@/components/ui/button";
import { messageForFailure } from "@/lib/form-errors";

/** Keeps one screen's failure from taking the whole application down with it. */
export function RouteError({ error }: { error: unknown }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 p-6">
      <h1 className="text-xl font-semibold">Algo deu errado</h1>
      <p>{messageForFailure(error)}</p>
      <Button type="button" variant="outline" onClick={() => window.location.reload()}>
        Recarregar
      </Button>
    </div>
  );
}
