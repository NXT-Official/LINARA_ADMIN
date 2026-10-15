import { BarList, ChartSurface, type ChartPoint } from "@/components/shared/charts";
import { LEAD_STAGE_LABEL, SOURCE_LABEL } from "@/data/labels";

import { LEAD_STAGES, SOURCES, type CrmDashboard } from "../crm.types";

/**
 * Two small views over the saved contacts: where they come from, and where
 * the leads stand. Each has a table view and a CSV (FR-EX-1, FR-EX-4).
 */
export function CrmCharts({ crm }: { crm: CrmDashboard }) {
  const sources: ChartPoint[] = SOURCES.map((s) => ({
    key: s,
    label: SOURCE_LABEL[s],
    value: crm.sources[s],
  }))
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value);

  const stages: ChartPoint[] = LEAD_STAGES.map((s) => ({
    key: s,
    label: LEAD_STAGE_LABEL[s],
    value: crm.leadsByStage[s],
  }));

  return (
    <div className="mb-6 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
      <ChartSurface
        title="Where contacts come from"
        description="Saved leads and customers with a source"
        slug="crm-sources"
        labelHeader="source"
        valueHeader="contacts"
        data={sources}
        height="h-auto"
        chart={<BarList data={sources} unit="contacts" />}
      />
      <ChartSurface
        title="Leads by stage"
        description="People who haven't signed up yet"
        slug="crm-lead-stages"
        labelHeader="stage"
        valueHeader="leads"
        data={stages}
        height="h-auto"
        chart={<BarList data={stages} unit="leads" />}
      />
    </div>
  );
}
