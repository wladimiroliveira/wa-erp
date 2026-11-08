import { PricingPage } from "@/features/pricing/PricingPage";
import { listPricing } from "@/server/modules/pricing/pricing.service";

// The whole list is priced on the server; the search narrows it on the client.
export default async function Page() {
  return <PricingPage rows={await listPricing()} />;
}
