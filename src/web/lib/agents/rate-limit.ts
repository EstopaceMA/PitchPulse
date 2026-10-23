/**
 * Best-effort, per-server-instance limiting for the agents route. There are no accounts, so clients are keyed by
 * the address the hosting proxy saw.
 */

/**
 * The client address as reported by the platform proxy. Azure Container Apps appends the address it observed to
 * X-Forwarded-For, so only the rightmost entry is trustworthy; earlier entries come from the client and can be forged.
 */
export function clientAddress(headers: Headers): string {
    const forwarded = headers.get("x-forwarded-for")?.split(",").map(entry => entry.trim()).filter(Boolean).at(-1);
    const address = forwarded || headers.get("x-real-ip")?.trim();
    if (!address) return "local";
    // "203.0.113.5:4711" and "[2001:db8::1]:443" carry ports; a bare IPv6 address does not.
    const bracketed = address.match(/^\[([^\]]+)\](?::\d+)?$/);
    if (bracketed) return bracketed[1];
    return /^[\d.]+:\d+$/.test(address) ? address.slice(0, address.lastIndexOf(":")) : address;
}

export interface RateLimiter {
    /** Records an allowed call; true once the client already made `limit` calls within the window. */
    limited(client: string, now: number): boolean;
    /** Tracked clients; idle ones are pruned once more than `maxClients` are tracked. */
    size(): number;
}
export function createRateLimiter(limit: number, windowMs: number, maxClients = 1000): RateLimiter {
    const recent = new Map<string, number[]>();
    return {
        limited(client, now) {
            const times = (recent.get(client) ?? []).filter(time => now - time < windowMs);
            const blocked = times.length >= limit;
            if (!blocked) times.push(now);
            recent.set(client, times);
            if (recent.size > maxClients) for (const [key, value] of recent) if (value.every(time => now - time >= windowMs)) recent.delete(key);
            return blocked;
        },
        size: () => recent.size,
    };
}
