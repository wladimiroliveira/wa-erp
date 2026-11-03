import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlusIcon } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { IconButton } from "@/components/common/IconButton";

describe("IconButton", () => {
  it("shows only its icon, and is named by its label", () => {
    render(
      <IconButton label="Novo produto" onClick={() => {}}>
        <PlusIcon />
      </IconButton>,
    );

    const button = screen.getByRole("button", { name: "Novo produto" });
    expect(button).toHaveTextContent("");
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("explains itself on hover with its label, unless given a longer hint", async () => {
    const { rerender } = render(
      <IconButton label="Novo produto" onClick={() => {}}>
        <PlusIcon />
      </IconButton>,
    );

    await userEvent.hover(screen.getByRole("button", { name: "Novo produto" }));
    expect(await screen.findByText("Novo produto")).toBeInTheDocument();

    rerender(
      <IconButton label="Novo produto" hint="Cadastrar um produto" onClick={() => {}}>
        <PlusIcon />
      </IconButton>,
    );
    expect(await screen.findByText("Cadastrar um produto")).toBeInTheDocument();
  });

  it("leads to an address when given one instead of an action", () => {
    render(
      <IconButton label="Nova pré-pesagem" to="/pre-weighings/new">
        <PlusIcon />
      </IconButton>,
    );

    const link = screen.getByRole("link", { name: "Nova pré-pesagem" });
    expect(link).toHaveAttribute("href", "/pre-weighings/new");
    expect(link).toHaveTextContent("");
  });

  it("runs its action when pressed", async () => {
    const press = vi.fn();
    render(
      <IconButton label="Novo produto" onClick={press}>
        <PlusIcon />
      </IconButton>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Novo produto" }));

    expect(press).toHaveBeenCalledTimes(1);
  });
});
