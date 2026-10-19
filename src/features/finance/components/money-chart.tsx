import { useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";

import { Surface } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { fmtCentavos } from "@/lib/money";

import { pesoAxisLabel, type MoneyPoint } from "../finance.utils";

/**
 * Revenue and cost of goods as columns, profit as a line, in pesos. Finance has
 * no CSV export (FR-EX-1: no amounts in a one-click export), so this carries
 * its own surface with a table view instead of the shared ChartSurface.
 */

const PINE = "var(--pine)";
const COGS = "var(--terracotta)";
const PROFIT = "var(--ink)";
const GRID = "var(--border)";
const TICK = { fill: "var(--muted-foreground)", fontSize: 13 };

const SERIES = [
  { key: "revenue", label: "Revenue", color: PINE },
  { key: "cogs", label: "COGS", color: COGS },
  { key: "profit", label: "Profit", color: PROFIT },
] as const;

const pesosText = (pesos: number) => fmtCentavos(Math.round(pesos * 100));

function MoneyTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl bg-card px-3 py-2 text-sm shadow-lift ring-1 ring-border">
      <p className="text-xs text-muted-foreground">{label}</p>
      <ul className="mt-1 space-y-0.5">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full"
              style={{ background: p.color }}
            />
            <span className="font-semibold tabular-nums text-foreground">
              {pesosText(Number(p.value))}
            </span>
            <span className="text-muted-foreground">{p.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MoneyChart({ data }: { data: MoneyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
        <XAxis dataKey="month" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis
          tick={TICK}
          tickLine={false}
          axisLine={false}
          tickFormatter={pesoAxisLabel}
          width={64}
        />
        <ReferenceLine y={0} stroke={GRID} />
        <Tooltip
          cursor={{ fill: "var(--sand)" }}
          content={<MoneyTooltip />}
          isAnimationActive={false}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 13, color: "var(--muted-foreground)" }}
        />
        <Bar
          dataKey="revenue"
          name="Revenue"
          fill={PINE}
          maxBarSize={24}
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
        <Bar
          dataKey="cogs"
          name="COGS"
          fill={COGS}
          maxBarSize={24}
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="profit"
          name="Profit"
          stroke={PROFIT}
          strokeWidth={2}
          dot={{ r: 3, fill: PROFIT }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** The money chart on its own surface, with a table view of the same numbers. */
export function MoneyChartSurface({
  title,
  description,
  data,
}: {
  title: string;
  description?: string;
  data: MoneyPoint[];
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Surface
      title={title}
      description={description}
      actions={
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
        >
          {asTable ? "Chart" : "Table"}
        </Button>
      }
    >
      {asTable ? (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm" aria-label={`${title} as a table`}>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 font-semibold">
                  Month
                </th>
                {SERIES.map((s) => (
                  <th key={s.key} scope="col" className="py-2 text-right font-semibold">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((d, i) => (
                <tr key={`${d.month}-${i}`}>
                  <td className="py-1.5 text-foreground">{d.month}</td>
                  {SERIES.map((s) => (
                    <td key={s.key} className="py-1.5 text-right tabular-nums text-foreground">
                      {pesosText(d[s.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-64" role="img" aria-label={`${title}: revenue, COGS and profit by month`}>
          <MoneyChart data={data} />
        </div>
      )}
    </Surface>
  );
}
