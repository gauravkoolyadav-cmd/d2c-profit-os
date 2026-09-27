import type { ProfitDashboard } from "@/lib/profit-v1/service";

/** JSON shape returned by GET /api/brands/[id]/profit-dashboard */
export type DashboardData = ProfitDashboard;
export type Totals = ProfitDashboard["report"]["totals"];
