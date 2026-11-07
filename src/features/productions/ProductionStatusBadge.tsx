import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS } from "@/features/productions/status-filter";
import type { ProductionStatus } from "@/lib/api";

const VARIANTS = { IN_PROGRESS: "outline", FINISHED: "secondary", CANCELED: "destructive" } as const;

export function ProductionStatusBadge({ status }: { status: ProductionStatus }) {
  return <Badge variant={VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>;
}
