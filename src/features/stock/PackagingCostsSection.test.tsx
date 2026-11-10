import type { ReactNode } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PackagingCostsSection } from "@/features/stock/PackagingCostsSection";
import { renderWithProviders } from "@/tests/render";
import { HISTORY_LIMIT } from "@/server/modules/stock/stock.schemas";
import { aPackagingCost } from "@/tests/samples";

// A dialog that stays on screen after it is closed, as a real one does while it animates out.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: ReactNode;
  }) => (
    <div role="dialog" data-open={open}>
      <button type="button" onClick={() => onOpenChange(false)}>
        Fechar
      </button>
      {children}
    </div>
  ),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

describe("PackagingCostsSection", () => {
  it("tells the packagings apart by brand", () => {
    renderWithProviders(
      <PackagingCostsSection
        packagings={[
          aPackagingCost({ id: "italac", brand: "ITALAC", content: "395" }),
          aPackagingCost({ id: "moça", brand: "MOÇA", content: "395" }),
        ]}
        unit="GRAM"
      />,
    );

    expect(screen.getByRole("cell", { name: "ITALAC 395 g" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "MOÇA 395 g" })).toBeInTheDocument();
  });

  it("keeps the entries of a packaging on screen while its dialog closes", async () => {
    const bag = aPackagingCost({
      content: "380",
      lastEntry: { price: "12.91", createdAt: "2026-11-05T12:00:00.000Z", supplier: null },
      history: [{ lotId: "lot-1", createdAt: "2026-11-05T12:00:00.000Z", supplier: null, count: 10, price: "12.91" }],
    });
    renderWithProviders(<PackagingCostsSection packagings={[bag]} unit="GRAM" />);

    await userEvent.click(screen.getByRole("button", { name: "Histórico de MOÇA 380 g" }));
    await userEvent.click(screen.getByRole("button", { name: "Fechar" }));

    expect(screen.getByRole("dialog")).toHaveAttribute("data-open", "false");
    expect(screen.getByRole("heading", { name: "Entradas de MOÇA 380 g" })).toBeInTheDocument();
  });

  const withEntries = (count: number) =>
    aPackagingCost({
      content: "380",
      lastEntry: { price: "12.91", createdAt: "2026-11-05T12:00:00.000Z", supplier: null },
      history: Array.from({ length: count }, (_, index) => ({
        lotId: `lot-${index}`,
        createdAt: "2026-11-05T12:00:00.000Z",
        supplier: null,
        count: 1,
        price: "12.91",
      })),
    });

  it("says when the history shows only the latest entries", async () => {
    renderWithProviders(<PackagingCostsSection packagings={[withEntries(HISTORY_LIMIT)]} unit="GRAM" />);

    await userEvent.click(screen.getByRole("button", { name: "Histórico de MOÇA 380 g" }));

    expect(screen.getByText(`Mostrando as ${HISTORY_LIMIT} entradas mais recentes.`)).toBeInTheDocument();
  });

  it("says nothing of a limit when the history is whole", async () => {
    renderWithProviders(<PackagingCostsSection packagings={[withEntries(2)]} unit="GRAM" />);

    await userEvent.click(screen.getByRole("button", { name: "Histórico de MOÇA 380 g" }));

    expect(screen.queryByText(/entradas mais recentes/)).not.toBeInTheDocument();
  });
});
