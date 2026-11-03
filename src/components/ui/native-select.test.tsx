import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NativeSelect } from "@/components/ui/native-select";

describe("NativeSelect", () => {
  it("is as tall as an input", () => {
    render(
      <NativeSelect aria-label="Unidade">
        <option>kg</option>
      </NativeSelect>,
    );

    expect(screen.getByRole("combobox")).toHaveClass("h-8");
  });
});
