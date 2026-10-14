import { useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";

import { Button } from "@/components/ui/button";
import type { CsvColumn } from "@/lib/csv";
import { formatCount } from "@/lib/format";

import { ExportCsvButton } from "./export-button";
import { Surface } from "./page";

/**
 * Charts follow the dataviz method: one series each, in Pine (the brand's
 * anchor, well over 3:1 on Cream); thin marks; hairline, recessive grid; a
 * hover layer; and a table view, so no value is reachable only by hovering.
 */
export type ChartPoint = {
  /** Shown on the axis and in the tooltip, e.g. "Oct 7". */
  label: string;
  value: number;
  /** Written to the CSV, e.g. an ISO date or a category id. */
  key: string;
};

const PINE = "var(--pine)";
const GRID = "var(--border)";
const INK_MUTED = "var(--muted-foreground)";
const SURFACE = "var(--card)";
const TICK = { fill: INK_MUTED, fontSize: 13 };

function compact(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n);
}

/** Value first and strong, label after it (dataviz: values lead, labels follow). */
function ChartTooltip({ active, payload, unit }: TooltipProps<number, string> & { unit: string }) {
  const point = payload?.[0]?.payload as ChartPoint | undefined;
  if (!active || !point) return null;
  return (
    <div className="rounded-xl bg-card px-3 py-2 text-sm shadow-lift ring-1 ring-border">
      <p className="flex items-center gap-2">
        <span aria-hidden="true" className="h-0.5 w-3 rounded-full bg-pine" />
        <span className="font-semibold text-foreground">{formatCount(point.value)}</span>
        <span className="text-muted-foreground">{unit}</span>
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{point.label}</p>
    </div>
  );
}

/** A trend over time: 2px line over a 10% wash, with a crosshair. */
export function TrendChart({ data, unit }: { data: ChartPoint[]; unit: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
        <XAxis
          dataKey="label"
          tick={TICK}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          interval="preserveStartEnd"
          minTickGap={32}
        />
        <YAxis
          tick={TICK}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          tickFormatter={compact}
          width={44}
        />
        <Tooltip
          cursor={{ stroke: INK_MUTED, strokeWidth: 1 }}
          content={<ChartTooltip unit={unit} />}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={PINE}
          strokeWidth={2}
          fill={PINE}
          fillOpacity={0.1}
          isAnimationActive={false}
          activeDot={{ r: 4, fill: PINE, stroke: SURFACE, strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Counts per period: columns at most 24px, 4px rounded tops, square at the baseline. */
export function ColumnChart({ data, unit }: { data: ChartPoint[]; unit: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
        <XAxis
          dataKey="label"
          tick={TICK}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis
          tick={TICK}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          tickFormatter={compact}
          width={44}
        />
        <Tooltip
          cursor={{ fill: "var(--sand)" }}
          content={<ChartTooltip unit={unit} />}
          isAnimationActive={false}
        />
        <Bar
          dataKey="value"
          fill={PINE}
          maxBarSize={24}
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        >
          {/* Only the latest period is labelled; the axis and tooltip carry the rest. */}
          <LabelList
            dataKey="value"
            position="top"
            fill="var(--foreground)"
            fontSize={13}
            content={({ x, y, width, value, index }) =>
              index === data.length - 1 ? (
                <text
                  x={Number(x) + Number(width) / 2}
                  y={Number(y) - 6}
                  textAnchor="middle"
                  fill="var(--foreground)"
                  fontSize={13}
                  fontWeight={600}
                >
                  {String(value)}
                </text>
              ) : null
            }
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** A few categories compared: horizontal bars, value at the tip. */
export function BarList({ data, unit }: { data: ChartPoint[]; unit: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-2.5" aria-label={`${unit} by category`}>
      {data.map((d) => (
        <li
          key={d.key}
          className="grid grid-cols-[7.5rem_1fr] items-center gap-3"
          title={`${d.label}: ${formatCount(d.value)} ${unit}`}
        >
          <span className="truncate text-sm text-foreground">{d.label}</span>
          <span className="flex items-center gap-2">
            <span
              className="h-3 rounded-r-[4px] bg-pine"
              style={{ width: `${(d.value / max) * 85}%`, minWidth: d.value ? 4 : 0 }}
              aria-hidden="true"
            />
            <span className="text-sm tabular-nums text-foreground">{formatCount(d.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A chart on its own surface, with the two things every chart here offers:
 * a table view of the same numbers, and a one-click CSV of them.
 */
export function ChartSurface({
  title,
  description,
  data,
  slug,
  labelHeader,
  valueHeader,
  chart,
  height = "h-56",
}: {
  title: string;
  description?: ReactNode;
  data: ChartPoint[];
  slug: string;
  /** Column names for the table and the CSV, e.g. "Date" and "Tasks done". */
  labelHeader: string;
  valueHeader: string;
  chart: ReactNode;
  /** Includes the axis band, so the axis labels never scroll inside the card. */
  height?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const columns: CsvColumn<ChartPoint>[] = [
    { header: labelHeader, value: (p) => p.key },
    { header: valueHeader, value: (p) => p.value },
  ];

  return (
    <Surface
      title={title}
      description={description}
      actions={
        <>
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={asTable}
            onClick={() => setAsTable((v) => !v)}
          >
            {asTable ? "Chart" : "Table"}
          </Button>
          <ExportCsvButton slug={slug} columns={columns} rows={data} label="CSV" size="sm" />
        </>
      }
    >
      {asTable ? (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 font-semibold">
                  {labelHeader}
                </th>
                <th scope="col" className="py-2 text-right font-semibold">
                  {valueHeader}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((d) => (
                <tr key={d.key}>
                  <td className="py-1.5 text-foreground">{d.label}</td>
                  <td className="py-1.5 text-right tabular-nums text-foreground">
                    {formatCount(d.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={height}>{chart}</div>
      )}
    </Surface>
  );
}
