import { Suspense } from "react";
import Studio from "@/components/match/simulator";

async function StudioRoute({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <Studio id={id} />;
}
export default function StudioPage({ params }: { params: Promise<{ id: string }> }) {
    return <Suspense fallback={<div className="studio-loading" role="status">PitchPulse Studio…</div>}><StudioRoute params={params} /></Suspense>;
}
