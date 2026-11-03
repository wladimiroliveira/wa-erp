import { screen, type BoundFunctions, type queries } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** Opens the actions menu named `menu` and picks `action` from it, as the user would. */
export async function chooseRowAction(
  menu: string,
  action: string,
  scope: BoundFunctions<typeof queries> = screen,
): Promise<void> {
  await userEvent.click(await scope.findByRole("button", { name: menu }));
  // The menu opens in a portal, outside the row the button sits in.
  await userEvent.click(await screen.findByRole("menuitem", { name: action }));
}
