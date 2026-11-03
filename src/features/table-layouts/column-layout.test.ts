import { describe, expect, it } from "vitest";
import {
  arrangeColumns,
  clampWidth,
  dropIndexAt,
  moveColumn,
  resizeBetween,
} from "@/features/table-layouts/column-layout";

describe("arrangeColumns", () => {
  it("keeps the designed order when nothing was saved", () => {
    expect(arrangeColumns(["a", "b", "c"], undefined)).toEqual(["a", "b", "c"]);
  });

  it("follows the saved order", () => {
    expect(arrangeColumns(["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });

  it("drops a saved column the table no longer shows", () => {
    expect(arrangeColumns(["a", "b"], ["b", "gone", "a"])).toEqual(["b", "a"]);
  });

  it("places a column the saved order never knew right after the one designed before it", () => {
    expect(arrangeColumns(["a", "b", "new", "c"], ["c", "b", "a"])).toEqual(["c", "b", "new", "a"]);
  });

  it("places a new first column first", () => {
    expect(arrangeColumns(["new", "a", "b"], ["b", "a"])).toEqual(["new", "b", "a"]);
  });
});

describe("moveColumn", () => {
  it("moves a column to the place asked, shifting the others", () => {
    expect(moveColumn(["a", "b", "c", "d"], "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveColumn(["a", "b", "c", "d"], "d", 0)).toEqual(["d", "a", "b", "c"]);
  });

  it("keeps a move inside the table", () => {
    expect(moveColumn(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveColumn(["a", "b", "c"], "b", 9)).toEqual(["a", "c", "b"]);
  });

  it("leaves the order alone for a column it does not hold", () => {
    expect(moveColumn(["a", "b"], "x", 0)).toEqual(["a", "b"]);
  });
});

describe("dropIndexAt", () => {
  // Each header is told by the horizontal middle of its box.
  const middles = [50, 150, 250];

  it("answers the gap before the first header whose middle lies past the pointer", () => {
    expect(dropIndexAt(middles, 10)).toBe(0);
    expect(dropIndexAt(middles, 120)).toBe(1);
    expect(dropIndexAt(middles, 200)).toBe(2);
  });

  it("answers the gap after the last header past every middle", () => {
    expect(dropIndexAt(middles, 400)).toBe(3);
  });
});

describe("clampWidth", () => {
  it("rounds to whole pixels", () => {
    expect(clampWidth(120.6)).toBe(121);
  });

  it("keeps a column wide enough to grab again, and no wider than the server takes", () => {
    expect(clampWidth(10)).toBe(60);
    expect(clampWidth(5000)).toBe(2000);
  });
});

describe("resizeBetween", () => {
  const widths = { a: 200, b: 150, c: 100 };

  it("widens a column by taking the room from its neighbour on the right, leaving the rest alone", () => {
    expect(resizeBetween(widths, "a", "b", 30)).toEqual({ a: 230, b: 120, c: 100 });
  });

  it("narrows a column by giving the room to its neighbour on the right", () => {
    expect(resizeBetween(widths, "a", "b", -30)).toEqual({ a: 170, b: 180, c: 100 });
  });

  it("pushes the table wider only once the neighbour is down to the least width", () => {
    expect(resizeBetween(widths, "a", "b", 120)).toEqual({ a: 320, b: 60, c: 100 });
  });

  it("stops narrowing a column at the least width, giving the neighbour only what it gave up", () => {
    expect(resizeBetween(widths, "a", "b", -200)).toEqual({ a: 60, b: 290, c: 100 });
  });

  it("resizes the last column alone, as it has no neighbour to trade with", () => {
    expect(resizeBetween(widths, "c", undefined, 40)).toEqual({ a: 200, b: 150, c: 140 });
    expect(resizeBetween(widths, "c", undefined, -90)).toEqual({ a: 200, b: 150, c: 60 });
  });
});
