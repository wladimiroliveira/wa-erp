import { Badge } from "@/components/ui/badge";
import { PRE_WEIGHING_STATUS_LABELS } from "@/features/pre-weighings/status-filter";
import type { PreWeighingStatus } from "@/lib/api";

const VARIANTS = {
  PENDING: "outline",
  IN_PRODUCTION: "secondary",
  PRODUCED: "secondary",
  DAMAGED: "destructive",
} as const;

export function PreWeighingStatusBadge({ status }: { status: PreWeighingStatus }) {
  return <Badge variant={VARIANTS[status]}>{PRE_WEIGHING_STATUS_LABELS[status]}</Badge>;
}
