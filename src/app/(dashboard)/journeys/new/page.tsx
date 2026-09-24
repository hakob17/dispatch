"use client";

import { PageHeader } from "@/components/ui";
import JourneyBuilder from "@/components/journey/JourneyBuilder";

export default function NewJourneyPage() {
  return (
    <div>
      <PageHeader kicker="Orchestration" title="New journey" />
      <JourneyBuilder />
    </div>
  );
}
