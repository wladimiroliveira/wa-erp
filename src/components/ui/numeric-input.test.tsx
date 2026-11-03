import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NumericInput } from "@/components/ui/numeric-input";

const heard = () => vi.fn((event: React.ChangeEvent<HTMLInputElement>) => event.target.value);

describe("NumericInput", () => {
  it("lets through only the digits and one decimal comma", async () => {
    render(<NumericInput aria-label="Quantidade" />);
    const field = screen.getByLabelText("Quantidade");

    await userEvent.type(field, "1a0,5,2 kg");

    expect(field).toHaveValue("10,52");
    expect(field).toHaveAttribute("inputmode", "decimal");
  });

  it("groups the thousands while the operator types", async () => {
    render(<NumericInput aria-label="Quantidade" />);
    const field = screen.getByLabelText("Quantidade");

    await userEvent.type(field, "1234567,5");

    expect(field).toHaveValue("1.234.567,5");
  });

  it("takes the point key as the decimal comma", async () => {
    render(<NumericInput aria-label="Quantidade" />);
    const field = screen.getByLabelText("Quantidade");

    await userEvent.type(field, "10.5");

    expect(field).toHaveValue("10,5");
  });

  it("hands the listener what was kept, not what was typed", async () => {
    const onChange = heard();
    render(<NumericInput aria-label="Quantidade" onChange={onChange} />);

    await userEvent.type(screen.getByLabelText("Quantidade"), "999x9");

    expect(onChange.mock.results.at(-1)?.value).toBe("9.999");
  });

  it("masks a pasted text the same way", async () => {
    render(<NumericInput aria-label="Custo" />);
    const field = screen.getByLabelText("Custo");

    await userEvent.click(field);
    await userEvent.paste("R$ 1.234,50");

    expect(field).toHaveValue("1.234,50");
  });

  it("keeps the caret where the operator was typing", async () => {
    render(<NumericInput aria-label="Quantidade" defaultValue="125" />);
    const field = screen.getByLabelText<HTMLInputElement>("Quantidade");

    await userEvent.type(field, "x3", { initialSelectionStart: 1, initialSelectionEnd: 1 });

    expect(field).toHaveValue("1.325");
    expect(field.selectionStart).toBe(3);
  });

  it("steps the value with the arrow keys and tells the listener", async () => {
    const onChange = heard();
    render(<NumericInput aria-label="Quantidade" defaultValue="998,5" onChange={onChange} />);
    const field = screen.getByLabelText("Quantidade");

    await userEvent.type(field, "{ArrowUp}{ArrowUp}{ArrowDown}");

    expect(field).toHaveValue("999,5");
    expect(onChange.mock.results.map(({ value }) => value as string)).toEqual(["999,5", "1.000,5", "999,5"]);
  });

  it("completes the decimal places on leaving the field, when asked to", async () => {
    const onChange = heard();
    render(<NumericInput aria-label="Custo" minFractionDigits={2} onChange={onChange} />);
    const field = screen.getByLabelText("Custo");

    await userEvent.type(field, "1234,5");
    await userEvent.tab();

    expect(field).toHaveValue("1.234,50");
    expect(onChange.mock.results.at(-1)?.value).toBe("1.234,50");
  });

  it("shows what comes before and after the amount, out of its value", async () => {
    render(<NumericInput aria-label="Custo" leading="R$" trailing="kg" />);
    const field = screen.getByLabelText("Custo");

    await userEvent.type(field, "12");

    expect(screen.getByText("R$")).toBeInTheDocument();
    expect(screen.getByText("kg")).toBeInTheDocument();
    expect(field).toHaveValue("12");
  });

  it("takes only digits when the field is a code, and does not step it", async () => {
    render(<NumericInput aria-label="GTIN" format="digits" />);
    const field = screen.getByLabelText("GTIN");

    await userEvent.type(field, "789-1000,1{ArrowUp}");

    expect(field).toHaveValue("78910001");
    expect(field).toHaveAttribute("inputmode", "numeric");
  });

  it("stops a code at its length, counting only the digits", async () => {
    render(<NumericInput aria-label="GTIN" format="digits" maxLength={14} />);
    const field = screen.getByLabelText("GTIN");

    await userEvent.click(field);
    await userEvent.paste("789-1000-100103-999");
    await userEvent.type(field, "5");

    expect(field).toHaveValue("78910001001039");
  });
});
