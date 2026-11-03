import { LossReasonsPage } from "@/features/losses/LossReasonsPage";
import { listLossReasons } from "@/server/modules/losses/losses.service";

export default async function Page() {
  return <LossReasonsPage reasons={await listLossReasons()} />;
}
