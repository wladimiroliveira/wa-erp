import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RowActions, RowActionsItem } from "@/components/common/RowActions";

describe("RowActions", () => {
  it("keeps the actions of a row behind one small button until it is pressed", async () => {
    render(
      <RowActions label="Ações de Farinha de trigo">
        <RowActionsItem onClick={() => {}}>Editar</RowActionsItem>
      </RowActions>,
    );

    const trigger = screen.getByRole("button", { name: "Ações de Farinha de trigo" });
    // No taller than a line of text or a badge, so a row with actions is as short as one without.
    expect(trigger).toHaveClass("size-5");
    expect(trigger).not.toHaveClass("size-7");
    expect(screen.queryByRole("menuitem", { name: "Editar" })).not.toBeInTheDocument();

    await userEvent.click(trigger);

    expect(await screen.findByRole("menuitem", { name: "Editar" })).toBeInTheDocument();
  });

  it("runs the action chosen and closes the menu", async () => {
    const edit = vi.fn();
    render(
      <RowActions label="Ações de Farinha de trigo">
        <RowActionsItem onClick={edit}>Editar</RowActionsItem>
      </RowActions>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Ações de Farinha de trigo" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Editar" }));

    expect(edit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
