"use client";

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DashboardData } from "./types";
import { formatINR } from "./format";

const COLORS = { revenue: "#2563eb", adCost: "#f59e0b", profit: "#059669" };

export function ProfitTrendChart({ daily }: { daily: DashboardData["report"]["daily"] }) {
  const data = daily.map((d) => ({
    date: d.date.slice(5),
    revenue: d.netRevenue,
    adCost: d.metaCost,
    profit: d.profit,
  }));
  if (data.length === 0) {
    return <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">No data</div>;
  }
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
          <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis
            tickLine={false}
            axisLine={false}
            fontSize={12}
            width={70}
            tickFormatter={(v: number) => formatINR(v)}
          />
          <Tooltip formatter={(value) => formatINR(Number(value))} />
          <Legend />
          <Bar dataKey="revenue" name="Revenue (ex-GST)" fill={COLORS.revenue} radius={[3, 3, 0, 0]} maxBarSize={28} />
          <Bar dataKey="adCost" name="Ad cost (incl. GST)" fill={COLORS.adCost} radius={[3, 3, 0, 0]} maxBarSize={28} />
          <Line dataKey="profit" name="Profit" stroke={COLORS.profit} strokeWidth={2} dot={false} type="monotone" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
