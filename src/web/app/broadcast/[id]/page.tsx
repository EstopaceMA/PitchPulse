import { Suspense } from "react";
import Broadcast from "@/components/match/broadcast-view";

type Query = Promise<Record<string, string | string[] | undefined>>;

async function BroadcastRoute({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Query }) {
    const [{ id }, raw] = await Promise.all([params, searchParams]);
    // Repeated parameters keep their first value; options are validated against the match on the client.
    const query = Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : Array.isArray(value) && value[0] ? [[key, value[0]]] : []));
    return <Broadcast id={id} query={query} />;
}

/** A transparent 16:9 graphics layer for a live feed: ?sync=1 follows the studio, otherwise it plays on its own. */
export default function BroadcastPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Query }) {
    return <Suspense fallback={null}><BroadcastRoute params={params} searchParams={searchParams} /></Suspense>;
}
