import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

describe("Table", () => {
  it("sits on its own bordered surface, apart from the rest of the page", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Descrição</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Farinha de trigo</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    const container = screen.getByRole("table").parentElement!;
    expect(container).toHaveAttribute("data-slot", "table-container");
    expect(container).toHaveClass("rounded-xl", "border", "bg-card", "text-card-foreground", "overflow-auto");
  });

  it("sets the header apart from the content", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Descrição</TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    );

    const header = screen.getByRole("columnheader").closest("thead")!;
    expect(header).toHaveClass("bg-muted");
    // The header is not a row of content, so it does not light up under the pointer as one.
    expect(header).toHaveClass("[&_tr]:hover:bg-transparent");
    expect(screen.getByRole("columnheader")).toHaveClass("text-muted-foreground");
  });

  it("draws a grid between its rows and between its columns", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Descrição</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Farinha de trigo</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    for (const row of screen.getAllByRole("row")) expect(row).toHaveClass("border-b");
    // The surface already draws the outer edge, so the last column leaves it alone.
    for (const cell of [screen.getByRole("columnheader"), screen.getByRole("cell")]) {
      expect(cell).toHaveClass("border-r", "last:border-r-0");
    }
  });

  it("keeps its rows short, to fit more of them on the screen", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Descrição</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Farinha de trigo</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(screen.getByRole("columnheader")).toHaveClass("h-9");
    expect(screen.getByRole("cell")).toHaveClass("py-1");
  });

  it("takes the height left on the screen when asked, scrolling inside itself", () => {
    render(
      <Table fill>
        <TableBody>
          <TableRow>
            <TableCell>Farinha de trigo</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    const container = screen.getByRole("table").parentElement!;
    expect(container).toHaveAttribute("data-fill", "true");
    expect(container).toHaveClass("flex-1", "overflow-auto");
  });

  it("closes its last row with a line when filling the screen, as the rows may stop short of the bottom", () => {
    render(
      <Table fill>
        <TableBody>
          <TableRow>
            <TableCell>Farinha de trigo</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(screen.getByRole("table").parentElement).toHaveClass("[&_tbody_tr:last-child]:border-b");
  });

  it("sizes itself to its rows unless asked to fill the screen", () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>Farinha de trigo</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(screen.getByRole("table").parentElement).not.toHaveClass("flex-1");
  });

  it("keeps the edge cells off the border of its surface", () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>Farinha de trigo</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(screen.getByRole("cell")).toHaveClass("first:pl-4", "last:pr-4");
  });
});
