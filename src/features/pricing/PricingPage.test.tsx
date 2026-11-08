import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveMarkup } from "@/features/pricing/actions";
import { PricingPage } from "@/features/pricing/PricingPage";
import type { Permission, PricingRow } from "@/lib/api";
import { renderWithProviders } from "@/tests/render";
import { aCurrentUser, aPricingRow } from "@/tests/samples";

vi.mock("@/features/pricing/actions", () => ({ saveMarkup: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const saveMock = vi.mocked(saveMarkup);

const BREAD = aPricingRow();
const CAKE = aPricingRow({
  product: { sku: "018f0000-0000-7000-8000-000000000091", description: "Bolo de fubá", unit: "UNIT" },
  costPerUnit: "2.000000",
  markupPercent: "10.00",
  pricePerUnit: "2.20",
});

function renderPage(rows: PricingRow[] = [BREAD], permissions: Permission[] = ["PRICING_READ", "PRICING_UPDATE"]) {
  return renderWithProviders(<PricingPage rows={rows} />, {
    route: "/pricing",
    user: aCurrentUser({ permissions }),
  });
}

const rowOf = (description: string) => screen.getByRole("row", { name: new RegExp(description) });

const markupOf = (description: string) => screen.getByRole("textbox", { name: `Markup de ${description}` });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PricingPage", () => {
  it("shows cost, markup and price formatted", () => {
    renderPage([BREAD], ["PRICING_READ"]);

    const row = within(rowOf("Pão francês"));

    expect(row.getByText("R$ 1,50")).toBeInTheDocument();
    expect(row.getByText("35,00 %")).toBeInTheDocument();
    expect(row.getByText("R$ 2,03")).toBeInTheDocument();
  });

  it("shows the badge and — for no-markup and incomplete-cost", () => {
    renderPage([
      aPricingRow({ status: "no-markup", markupPercent: null, pricePerUnit: null }),
      aPricingRow({
        product: CAKE.product,
        status: "incomplete-cost",
        costPerUnit: null,
        pricePerUnit: null,
      }),
    ]);

    expect(within(rowOf("Pão francês")).getByText("Sem markup")).toBeInTheDocument();
    expect(within(rowOf("Bolo de fubá")).getByText("Custo incompleto")).toBeInTheDocument();
    expect(within(rowOf("Bolo de fubá")).getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("shows plain text, no input, without PRICING_UPDATE", () => {
    renderPage([BREAD], ["PRICING_READ"]);

    expect(screen.queryByRole("textbox", { name: "Markup de Pão francês" })).not.toBeInTheDocument();
  });

  it("recalculates the price while the markup is typed", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.clear(markupOf("Pão francês"));
    await user.type(markupOf("Pão francês"), "50");

    expect(within(rowOf("Pão francês")).getByText("R$ 2,25")).toBeInTheDocument();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("reads a comma markup", async () => {
    const user = userEvent.setup();
    renderPage([aPricingRow({ costPerUnit: "1.000000" })]);

    await user.clear(markupOf("Pão francês"));
    await user.type(markupOf("Pão francês"), "12,5");

    expect(within(rowOf("Pão francês")).getByText("R$ 1,13")).toBeInTheDocument();
  });

  it("saves on Enter with sku and markup", async () => {
    const user = userEvent.setup();
    saveMock.mockResolvedValue({ ok: true, data: { markupPercent: "50.00" } });
    renderPage();

    await user.clear(markupOf("Pão francês"));
    await user.type(markupOf("Pão francês"), "50{Enter}");

    await waitFor(() => expect(saveMock).toHaveBeenCalledWith({ productSku: BREAD.product.sku, markupPercent: "50" }));
  });

  it("sends one save while it is pending, and locks the field until it ends", async () => {
    const user = userEvent.setup();
    let finish: (value: Awaited<ReturnType<typeof saveMarkup>>) => void = () => {};
    saveMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderPage();

    await user.clear(markupOf("Pão francês"));
    await user.type(markupOf("Pão francês"), "50{Enter}");

    expect(markupOf("Pão francês")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect(saveMock).toHaveBeenCalledTimes(1);

    finish({ ok: true, data: { markupPercent: "50.00" } });

    await waitFor(() => expect(markupOf("Pão francês")).toBeEnabled());
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("restores the saved markup on Esc", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.clear(markupOf("Pão francês"));
    await user.type(markupOf("Pão francês"), "50{Escape}");

    expect(markupOf("Pão francês")).toHaveValue("35,00");
    expect(within(rowOf("Pão francês")).getByText("R$ 2,03")).toBeInTheDocument();
  });

  it("refuses an invalid markup without calling the action", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.clear(markupOf("Pão francês"));
    await user.type(markupOf("Pão francês"), "1000,01{Enter}");

    expect(within(rowOf("Pão francês")).getByText("Markup entre 0 e 1000, até 2 casas.")).toBeInTheDocument();
    expect(within(rowOf("Pão francês")).getByText("—")).toBeInTheDocument();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("shows a toast and restores the value when the action fails", async () => {
    const user = userEvent.setup();
    saveMock.mockResolvedValue({ ok: false, status: 409, message: "Only a manufactured product has a markup." });
    renderPage();

    await user.clear(markupOf("Pão francês"));
    await user.type(markupOf("Pão francês"), "50{Enter}");

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(markupOf("Pão francês")).toHaveValue("35,00");
  });

  it("keeps each row's draft separate", async () => {
    const user = userEvent.setup();
    renderPage([BREAD, CAKE]);

    await user.clear(markupOf("Pão francês"));
    await user.type(markupOf("Pão francês"), "50");

    expect(markupOf("Bolo de fubá")).toHaveValue("10,00");
    expect(within(rowOf("Bolo de fubá")).getByText("R$ 2,20")).toBeInTheDocument();
  });

  it("opens the sheet with each ingredient's quantity, cost and subtotal, flagging those without cost", async () => {
    const user = userEvent.setup();
    const [flour, butter] = BREAD.ingredients;
    renderPage([
      aPricingRow({
        status: "incomplete-cost",
        costPerUnit: null,
        pricePerUnit: null,
        ingredients: [flour!, { ...butter!, averageCost: null, subtotal: null }],
      }),
    ]);

    await user.click(screen.getByRole("button", { name: "Pão francês" }));

    const sheet = within(await screen.findByRole("dialog"));
    expect(sheet.getByText("Farinha de trigo")).toBeInTheDocument();
    expect(sheet.getByText("R$ 11,00")).toBeInTheDocument();
    expect(within(sheet.getByText("Manteiga").closest("tr")!).getByText("Sem custo médio")).toBeInTheDocument();
  });

  it("shows an empty state without rows", () => {
    renderPage([]);

    expect(screen.getByText("Nenhum produto fabricado com receita.")).toBeInTheDocument();
  });
});
