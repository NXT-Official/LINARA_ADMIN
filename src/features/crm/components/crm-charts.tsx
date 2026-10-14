import { BarList, ChartSurface, type ChartPoint } from "@/components/shared/charts";
import { LEAD_STAGE_LABEL, SOURCE_LABEL } from "@/data/labels";
import type { ContactRow } from "@/data/queries";
import type { ContactSource, LeadStage } from "@/data/types";

const SOURCES = Object.keys(SOURCE_LABEL) as ContactSource[];
const LEAD_STAGES: LeadStage[] = ["new", "contacted", "interested", "lost"];

/** Two small views over all contacts: where they come from, and where the leads stand. */
export function CrmCharts({ contacts }: { contacts: ContactRow[] }) {
  const sources: ChartPoint[] = [
    ...SOURCES.map((s) => ({
      key: s,
      label: SOURCE_LABEL[s],
      value: contacts.filter((c) => c.source === s).length,
    })),
    {
      key: "signed_up",
      label: "Signed up directly",
      value: contacts.filter((c) => !c.source).length,
    },
  ]
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value);

  const leads = contacts.filter((c) => c.kind === "lead");
  const stages: ChartPoint[] = LEAD_STAGES.map((s) => ({
    key: s,
    label: LEAD_STAGE_LABEL[s],
    value: leads.filter((c) => c.stage === s).length,
  }));

  return (
    <div className="mb-6 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
      <ChartSurface
        title="Where contacts come from"
        description="All leads and customers"
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
