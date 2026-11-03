import { StockPositionPage } from "@/features/stock/StockPositionPage";
import { stockPosition } from "@/server/modules/stock/stock.service";

export default async function Page() {
  return <StockPositionPage position={await stockPosition()} />;
}
