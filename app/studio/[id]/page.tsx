import { Suspense } from "react";
import Studio from "@/components/match/simulator";
import { foundryStatus } from "@/lib/foundry/client";

async function StudioRoute({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    // Only the availability flag reaches the client; credentials and endpoints stay on the server.
    return <Studio id={id} aiAvailable={foundryStatus().configured} />;
}
export default function StudioPage({ params }: { params: Promise<{ id: string }> }) {
    return <Suspense fallback={<div className="studio-loading" role="status">PitchPulse Studio…</div>}><StudioRoute params={params} /></Suspense>;
}
