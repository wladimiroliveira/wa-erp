import { screen } from "@testing-library/react";

/** The headers of the table on screen, as the user reads them. */
export const columnHeaders = () => screen.getAllByRole("columnheader").map((header) => header.textContent);
