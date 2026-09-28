import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export type DashboardFilters = { from: string; to: string; user: string };
export type RankingItem = { user_name: string; metric_value: number };
export type TrendItem = { work_date: string; orders_count: number; boxes_count: number; weight_kg: number };
export type KpiItem = TrendItem & { id: string; user_name: string };
type KpiResponse = {
  cards: { total_orders: string; total_boxes: string; total_weight: string };
  trend: TrendItem[];
  items: KpiItem[];
};

export function useDashboard(filters: DashboardFilters, page: number, pageSize: number) {
  const kpi = useQuery({
    queryKey: ["dashboard", "kpi", filters, page, pageSize],
    queryFn: async ({ signal }) => (await api.get<KpiResponse>("/kpi", {
      params: { ...filters, user: filters.user || undefined, page, pageSize }, signal,
    })).data,
  });
  // Rankings do not depend on pagination; changing a page reuses their cache.
  const rankings = useQuery({
    queryKey: ["dashboard", "rankings", filters],
    queryFn: async ({ signal }) => {
      const [orders, boxes, weight] = await Promise.all(
        ["orders", "boxes", "weight"].map(async (metric) => (await api.get<{ items: RankingItem[] }>("/kpi/ranking", {
          params: { ...filters, user: filters.user || undefined, metric }, signal,
        })).data.items),
      );
      return { orders, boxes, weight };
    },
  });
  return { kpi, rankings };
}
