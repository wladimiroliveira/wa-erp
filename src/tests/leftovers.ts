import { screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";

/**
 * Waits for a stage form's leftovers preview to settle. It resolves after the test body: a test that
 * ends before then would leave its state update outside act().
 */
export const leftoversSettled = () =>
  waitFor(() => expect(screen.queryByText("Calculando as sobras…")).not.toBeInTheDocument());
