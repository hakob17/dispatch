"use client";

import { use, useMemo } from "react";
import useFetch from "@/lib/useFetch";
import { PageHeader } from "@/components/ui";
import JourneyBuilder from "@/components/journey/JourneyBuilder";
import { toTree, type StoredStep } from "@/components/journey/model";

interface Detail {
  journey: { id: string; name: string; status: string; entryKey: string | null; triggerEvent: string | null; exitEvent: string | null; segmentId: string | null; steps: StoredStep[] };
}

export default function EditJourneyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data } = useFetch<Detail>(`/api/journeys/${id}`);
  const tree = useMemo(() => (data ? toTree(data.journey.steps, data.journey.entryKey) : null), [data]);
  if (!data) return null;
  const j = data.journey;
  if (j.status !== "DRAFT") return <p className="text-sm">Only draft journeys can be edited.</p>;
  return (
    <div>
      <PageHeader kicker="Edit journey" title={j.name} />
      <JourneyBuilder
        journeyId={id}
        initial={{ name: j.name, segmentId: j.segmentId ?? "", triggerEvent: j.triggerEvent ?? "", exitEvent: j.exitEvent ?? "" }}
        initialTree={tree}
      />
    </div>
  );
}
