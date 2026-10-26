import { useState } from "react";

import { Field, FormDialog } from "@/components/shared/form";
import { RecordLink } from "@/components/shared/links";
import { PageHeader, Surface } from "@/components/shared/page";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";

import { SAMPLE_NOTE, SampleActions } from "../components/sample-bar";
import { FEATURES } from "../plans.sample";
import { dispatchCatalog, useCatalog } from "../plans.store";
import type { GlobalSwitch } from "../plans.types";

function FlipDialog({ sw, plansWithIt }: { sw: GlobalSwitch; plansWithIt: string[] }) {
  const [note, setNote] = useState("");
  const turningOn = !sw.enabled;
  const label = turningOn ? `Turn on ${sw.name}` : `Turn off ${sw.name}`;
  const who =
    plansWithIt.length === 0
      ? "No plan includes it yet, so nobody gets it until a plan does."
      : `Households on ${plansWithIt.join(", ")} get it straight away, on the web and in the app.`;
  return (
    <FormDialog
      trigger={<Button variant={turningOn ? "default" : "destructive"}>{label}</Button>}
      title={label}
      description={
        turningOn
          ? `${who} Turn it on only once it's cleared to go live. ${SAMPLE_NOTE}`
          : `It goes off for every household, whatever their plan. Their records are kept. ${SAMPLE_NOTE}`
      }
      submitLabel={turningOn ? "Turn on" : "Turn off"}
      done={`${sw.name} is ${turningOn ? "on" : "off"}. ${SAMPLE_NOTE}`}
      destructive={!turningOn}
      canSubmit={note.trim().length > 0}
      onSubmit={async () => {
        const res = dispatchCatalog({
          type: "set_switch",
          key: sw.key,
          enabled: turningOn,
          note,
        });
        if (res.ok) setNote("");
        return res;
      }}
    >
      {(id) => (
        <>
          {turningOn ? (
            <div className="space-y-1 text-sm text-foreground">
              <p className="font-semibold">This turns on:</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {sw.covers.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <Field
            label="Why"
            htmlFor={id("note")}
            hint="Kept in the switch's history. The live version also asks for your two-step code."
          >
            <Textarea
              id={id("note")}
              rows={2}
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

/** Features turned off for everyone, whatever their plan (D47, plan R16). */
export function SwitchesPage() {
  const state = useCatalog();
  return (
    <>
      <PageHeader
        title="Global switches"
        description="Turn a feature off for every household, whatever their plan. A preview on sample data: the real Staff pay & HR switch is off in the database, and nothing here changes it."
        actions={<SampleActions />}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="space-y-6">
          {state.switches.map((sw) => {
            const featureKeys = FEATURES.filter((f) => f.switchKey === sw.key).map((f) => f.key);
            const plansWithIt = state.plans
              .filter(
                (p) => p.status !== "retired" && featureKeys.some((k) => p.content.features[k]),
              )
              .sort((a, b) => a.displayOrder - b.displayOrder);
            return (
              <Surface
                key={sw.key}
                title={sw.name}
                description={sw.description}
                actions={
                  sw.enabled ? (
                    <StatusChip tone="done">On</StatusChip>
                  ) : (
                    <StatusChip tone="late">Off for everyone</StatusChip>
                  )
                }
              >
                <div className="space-y-5">
                  <div className="grid gap-5 md:grid-cols-2">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Covers</h3>
                      <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm text-foreground">
                        {sw.covers.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">
                        Plans that include it
                      </h3>
                      {plansWithIt.length ? (
                        <ul className="mt-1.5 space-y-0.5 text-sm">
                          {plansWithIt.map((p) => (
                            <li key={p.id}>
                              <RecordLink to={`/plans/${p.id}`}>{p.content.name}</RecordLink>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1.5 text-sm text-muted-foreground">None yet.</p>
                      )}
                      <p className="mt-2 text-xs text-muted-foreground">
                        {sw.enabled
                          ? "They have it now."
                          : "They don't get it while the switch is off."}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-muted-foreground">
                      Last changed {formatDateTime(sw.updatedAt)}, by {sw.updatedBy}.
                    </p>
                    <FlipDialog
                      key={`${sw.key}:${sw.enabled}`}
                      sw={sw}
                      plansWithIt={plansWithIt.map((p) => p.content.name)}
                    />
                  </div>
                </div>
              </Surface>
            );
          })}
        </div>
        <Surface title="History">
          <ol className="-my-2.5 divide-y divide-border">
            {state.switchHistory.map((h) => {
              const name = state.switches.find((s) => s.key === h.key)?.name ?? h.key;
              return (
                <li key={h.id} className="py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{name}</span>
                    <StatusChip tone={h.enabled ? "done" : "late"}>
                      {h.enabled ? "Turned on" : "Turned off"}
                    </StatusChip>
                  </div>
                  <p className="mt-0.5 break-words text-sm text-foreground">{h.note}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(h.at)}, by {h.by}
                  </p>
                </li>
              );
            })}
          </ol>
        </Surface>
      </div>
    </>
  );
}
