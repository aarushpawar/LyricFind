import { describe, expect, it, vi } from "vitest";
import { createWorker } from "../src/index";
import { normalizeShazamResponse } from "../src/shazam";
import type { Env, RateLimitBinding } from "../src/types";

const CLIENT_ID = "7cb4a072-98a1-4b34-91f0-5a51e6fd51d7";
const SIGNATURE =
  "data:audio/vnd.shazam.sig;base64," + "a".repeat(128);
const ALLOWED_ORIGIN = "https://aarushpawar.github.io";

function limiter(success = true): RateLimitBinding {
  return { limit: vi.fn().mockResolvedValue({ success }) };
}

function env(rateLimiter = limiter()): Env {
  return {
    RECOGNITION_CLIENT_RATE_LIMITER: rateLimiter,
    RECOGNITION_IP_RATE_LIMITER: limiter(),
    ALLOWED_ORIGINS:
      "https://aarushpawar.github.io,http://localhost:5173,http://127.0.0.1:5173",
  };
}

function request(
  body: unknown = {
    clientId: CLIENT_ID,
    signatureUri: SIGNATURE,
    sampleMs: 10_000,
  },
  init: RequestInit = {},
): Request {
  const { headers, ...rest } = init;
  return new Request("https://worker.example/recognize", {
    method: "POST",
    ...rest,
    headers: {
      "Content-Type": "application/json",
      Origin: ALLOWED_ORIGIN,
      "CF-Connecting-IP": "203.0.113.42",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const shazamMatch = {
  matches: [{ id: "match-id", offset: 42.125, timeskew: -0.001 }],
  track: {
    key: "track-id",
    title: "Midnight City",
    subtitle: "M83",
    isrc: "FRS631100161",
    images: { coverarthq: "https://img.example/cover.jpg" },
    sections: [
      {
        type: "SONG",
        metadata: [{ title: "Album", text: "Hurry Up, We're Dreaming" }],
      },
    ],
  },
};

describe("normalization", () => {
  it("normalizes only stable match and track fields", () => {
    expect(normalizeShazamResponse(shazamMatch)).toEqual({
      status: "match",
      track: {
        id: "track-id",
        title: "Midnight City",
        artist: "M83",
        album: "Hurry Up, We're Dreaming",
        artworkUrl: "https://img.example/cover.jpg",
        isrc: "FRS631100161",
      },
      matchOffsetSeconds: 42.125,
      timeSkew: -0.001,
    });
  });

  it("normalizes a response without matches as no_match", () => {
    expect(normalizeShazamResponse({ matches: [], track: null })).toEqual({
      status: "no_match",
    });
  });
});

describe("worker routes", () => {
  it("serves health with CORS", async () => {
    const response = await createWorker().fetch(
      new Request("https://worker.example/health", {
        headers: { Origin: ALLOWED_ORIGIN },
      }),
      env(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("handles allowed CORS preflight", async () => {
    const response = await createWorker().fetch(
      new Request("https://worker.example/recognize", {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:5173" },
      }),
      env(),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("rejects an unlisted origin without CORS headers", async () => {
    const response = await createWorker().fetch(
      request(undefined, { headers: { Origin: "https://evil.example" } }),
      env(),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("rejects originless recognition requests", async () => {
    const response = await createWorker().fetch(
      request(undefined, { headers: { Origin: "" } }),
      env(),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "origin_required" },
    });
  });

  it("rejects malformed request fields before rate limiting", async () => {
    const rateLimiter = limiter();
    const response = await createWorker().fetch(
      request({ clientId: "not-a-uuid", signatureUri: "short", sampleMs: 2 }),
      env(rateLimiter),
    );
    expect(response.status).toBe(400);
    expect(rateLimiter.limit).not.toHaveBeenCalled();
  });

  it("fails closed when Cloudflare client identity is unavailable", async () => {
    const clientLimiter = limiter();
    const testEnv = env(clientLimiter);
    const response = await createWorker().fetch(
      request(undefined, { headers: { "CF-Connecting-IP": "" } }),
      testEnv,
    );
    expect(response.status).toBe(400);
    expect(clientLimiter.limit).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "client_identity_unavailable" },
    });
  });

  it("rejects invalid JSON before rate limiting", async () => {
    const rateLimiter = limiter();
    const response = await createWorker().fetch(
      new Request("https://worker.example/recognize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: ALLOWED_ORIGIN,
        },
        body: "{not-json",
      }),
      env(rateLimiter),
    );
    expect(response.status).toBe(400);
    expect(rateLimiter.limit).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_json" },
    });
  });

  it("returns a normalized match from Shazam", async () => {
    const upstream = vi.fn().mockResolvedValue(
      Response.json(shazamMatch),
    ) as unknown as typeof fetch;
    const rateLimiter = limiter();
    const response = await createWorker({ fetchImpl: upstream }).fetch(
      request(),
      env(rateLimiter),
    );
    expect(response.status).toBe(200);
    expect(rateLimiter.limit).toHaveBeenCalledWith({
      key: `recognize:client:${CLIENT_ID}`,
    });
    expect(upstream).toHaveBeenCalledOnce();
    const upstreamInit = vi.mocked(upstream).mock.calls[0]?.[1];
    expect(JSON.parse(String(upstreamInit?.body))).toMatchObject({
      signature: { samplems: 10_000, uri: SIGNATURE },
    });
    await expect(response.json()).resolves.toMatchObject({
      status: "match",
      track: { id: "track-id", title: "Midnight City" },
      matchOffsetSeconds: 42.125,
    });
  });

  it("returns no_match for an upstream miss", async () => {
    const upstream = vi.fn().mockImplementation(async () =>
      Response.json({ matches: [] }),
    ) as unknown as typeof fetch;
    const response = await createWorker({ fetchImpl: upstream }).fetch(
      request(),
      env(),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "no_match" });
  });

  it("hides upstream errors behind a stable 502 response", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const upstream = vi.fn().mockResolvedValue(
      new Response("failure", { status: 503 }),
    ) as unknown as typeof fetch;
    const response = await createWorker({ fetchImpl: upstream }).fetch(
      request(),
      env(),
    );
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "upstream_error",
        message: "Music recognition is temporarily unavailable",
      },
    });
    errorSpy.mockRestore();
  });

  it("returns 429 when the rate-limit binding rejects the client", async () => {
    const upstream = vi.fn() as unknown as typeof fetch;
    const response = await createWorker({ fetchImpl: upstream }).fetch(
      request(),
      env(limiter(false)),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("uses Cloudflare's connecting IP so rotating UUIDs cannot bypass the limit", async () => {
    let calls = 0;
    const ipLimiter: RateLimitBinding = {
      limit: vi.fn().mockImplementation(async () => ({ success: ++calls <= 10 })),
    };
    const testEnv = env();
    testEnv.RECOGNITION_IP_RATE_LIMITER = ipLimiter;
    const upstream = vi.fn().mockImplementation(async () =>
      Response.json({ matches: [] }),
    ) as unknown as typeof fetch;
    const handler = createWorker({ fetchImpl: upstream });

    for (let index = 0; index < 10; index += 1) {
      const clientId = `7cb4a072-98a1-4b34-91f0-${String(index).padStart(12, "0")}`;
      expect((await handler.fetch(request({ clientId, signatureUri: SIGNATURE, sampleMs: 10_000 }), testEnv)).status).toBe(200);
    }
    const rotatedClientId = "7cb4a072-98a1-4b34-91f0-999999999999";
    const blocked = await handler.fetch(
      request({ clientId: rotatedClientId, signatureUri: SIGNATURE, sampleMs: 10_000 }),
      testEnv,
    );
    expect(blocked.status).toBe(429);
    expect(ipLimiter.limit).toHaveBeenLastCalledWith({
      key: "recognize:ip:203.0.113.42",
    });
  });
});
