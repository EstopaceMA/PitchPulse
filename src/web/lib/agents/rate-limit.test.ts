import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { clientAddress, createRateLimiter, sameOrigin } from "./rate-limit";

const headers = (values: Record<string, string>) => new Headers(values);

describe("same-origin check", () => {
    test("allows no Origin and this host, and blocks other sites and malformed origins", () => {
        assert.equal(sameOrigin(headers({ host: "pitchpulse.example" })), true);
        assert.equal(sameOrigin(headers({ origin: "https://pitchpulse.example", host: "pitchpulse.example" })), true);
        assert.equal(sameOrigin(headers({ origin: "https://pitchpulse.example", "x-forwarded-host": "pitchpulse.example", host: "10.0.0.4:8080" })), true);
        assert.equal(sameOrigin(headers({ origin: "https://evil.example", host: "pitchpulse.example" })), false);
        assert.equal(sameOrigin(headers({ origin: "https://evil.example", "x-forwarded-host": "pitchpulse.example", host: "evil.example" })), false);
        assert.equal(sameOrigin(headers({ origin: "not a url", host: "pitchpulse.example" })), false);
    });
});

describe("client address behind the hosting proxy", () => {
    test("uses the rightmost X-Forwarded-For entry, which the platform appended", () => {
        assert.equal(clientAddress(headers({ "x-forwarded-for": "203.0.113.5" })), "203.0.113.5");
        assert.equal(clientAddress(headers({ "x-forwarded-for": "1.1.1.1, 9.9.9.9, 203.0.113.5" })), "203.0.113.5");
        assert.equal(clientAddress(headers({ "x-forwarded-for": "spoofed, 203.0.113.5 , " })), "203.0.113.5");
    });

    test("strips ports from IPv4 and bracketed IPv6, and keeps bare IPv6", () => {
        assert.equal(clientAddress(headers({ "x-forwarded-for": "203.0.113.5:4711" })), "203.0.113.5");
        assert.equal(clientAddress(headers({ "x-forwarded-for": "[2001:db8::1]:443" })), "2001:db8::1");
        assert.equal(clientAddress(headers({ "x-forwarded-for": "2001:db8::1" })), "2001:db8::1");
        assert.equal(clientAddress(headers({ "x-forwarded-for": "::ffff:203.0.113.5" })), "::ffff:203.0.113.5");
    });

    test("falls back to X-Real-IP, then to a single local bucket", () => {
        assert.equal(clientAddress(headers({ "x-real-ip": "198.51.100.7" })), "198.51.100.7");
        assert.equal(clientAddress(headers({ "x-forwarded-for": " , " })), "local");
        assert.equal(clientAddress(headers({})), "local");
    });
});

describe("rate limiter", () => {
    test("blocks the call after the limit within the window and allows it again afterwards", () => {
        const limiter = createRateLimiter(30, 600_000);
        for (let call = 0; call < 30; call++) assert.equal(limiter.limited("a", 1000 + call), false, `call ${call + 1}`);
        assert.equal(limiter.limited("a", 2000), true);
        assert.equal(limiter.limited("b", 2000), false, "other clients are unaffected");
        assert.equal(limiter.limited("a", 1000 + 600_000), false, "the first call has left the window");
    });

    test("prunes idle clients once too many are tracked", () => {
        const limiter = createRateLimiter(1, 1000, 2);
        limiter.limited("a", 0);
        limiter.limited("b", 0);
        limiter.limited("c", 5000);
        assert.equal(limiter.size(), 1);
        assert.equal(limiter.limited("c", 5001), true);
    });
});
