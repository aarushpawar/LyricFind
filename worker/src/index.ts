import { recognizeWithShazam } from "./shazam";
import type { Env, RecognitionResponse, RecognizeRequest } from "./types";

const DEFAULT_ORIGINS = [
  "https://aarushpawar.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];
const MAX_BODY_BYTES = 64 * 1024;
const MIN_SIGNATURE_LENGTH = 64;
const MAX_SIGNATURE_LENGTH = 50_000;
const MIN_SAMPLE_MS = 1_000;
const MAX_SAMPLE_MS = 20_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE_PREFIX = "data:audio/vnd.shazam.sig;base64,";

interface HandlerDependencies {
  fetchImpl?: typeof fetch;
}

function configuredOrigins(env: Env): Set<string> {
  const values = env.ALLOWED_ORIGINS?.split(",") ?? DEFAULT_ORIGINS;
  return new Set(values.map((origin) => origin.trim()).filter(Boolean));
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("Origin");
  if (!origin || !configuredOrigins(env).has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(
  request: Request,
  env: Env,
  body: unknown,
  status = 200,
  extraHeaders: HeadersInit = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders(request, env),
      ...extraHeaders,
    },
  });
}

function error(
  request: Request,
  env: Env,
  status: number,
  code: string,
  message: string,
  extraHeaders: HeadersInit = {},
): Response {
  return json(request, env, { error: { code, message } }, status, extraHeaders);
}

function validatePayload(value: unknown): RecognizeRequest | string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return "Request body must be a JSON object";
  }

  const payload = value as Record<string, unknown>;
  if (typeof payload.clientId !== "string" || !UUID_PATTERN.test(payload.clientId)) {
    return "clientId must be a valid UUID";
  }
  if (
    typeof payload.signatureUri !== "string" ||
    !payload.signatureUri.startsWith(SIGNATURE_PREFIX) ||
    payload.signatureUri.length < MIN_SIGNATURE_LENGTH ||
    payload.signatureUri.length > MAX_SIGNATURE_LENGTH
  ) {
    return "signatureUri must be a valid Shazam signature between 64 and 50000 characters";
  }
  if (
    typeof payload.sampleMs !== "number" ||
    !Number.isInteger(payload.sampleMs) ||
    payload.sampleMs < MIN_SAMPLE_MS ||
    payload.sampleMs > MAX_SAMPLE_MS
  ) {
    return "sampleMs must be an integer between 1000 and 20000";
  }

  return {
    clientId: payload.clientId,
    signatureUri: payload.signatureUri,
    sampleMs: payload.sampleMs,
  };
}

async function parseRequestBody(
  request: Request,
): Promise<{ payload?: unknown; tooLarge?: true; malformed?: true }> {
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { tooLarge: true };
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return { tooLarge: true };
  }
  try {
    return { payload: JSON.parse(text) };
  } catch {
    return { malformed: true };
  }
}

function originAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  return !origin || configuredOrigins(env).has(origin);
}

function connectingIp(request: Request): string | null {
  const value = request.headers.get("CF-Connecting-IP")?.trim();
  return value || null;
}

export function createWorker(dependencies: HandlerDependencies = {}) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);

      if (!originAllowed(request, env)) {
        return error(request, env, 403, "origin_not_allowed", "Origin is not allowed");
      }

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request, env) });
      }

      if (url.pathname === "/health") {
        if (request.method !== "GET") {
          return error(request, env, 405, "method_not_allowed", "Method not allowed", {
            Allow: "GET, OPTIONS",
          });
        }
        return json(request, env, { status: "ok" });
      }

      if (url.pathname !== "/recognize") {
        return error(request, env, 404, "not_found", "Route not found");
      }
      if (request.method !== "POST") {
        return error(request, env, 405, "method_not_allowed", "Method not allowed", {
          Allow: "POST, OPTIONS",
        });
      }
      if (!request.headers.get("Origin")) {
        return error(
          request,
          env,
          403,
          "origin_required",
          "Recognition requests must come from an allowed browser origin",
        );
      }
      if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
        return error(
          request,
          env,
          415,
          "unsupported_media_type",
          "Content-Type must be application/json",
        );
      }

      const parsed = await parseRequestBody(request);
      if (parsed.tooLarge) {
        return error(request, env, 413, "payload_too_large", "Request body is too large");
      }
      if (parsed.malformed) {
        return error(request, env, 400, "invalid_json", "Request body is not valid JSON");
      }

      const validated = validatePayload(parsed.payload);
      if (typeof validated === "string") {
        return error(request, env, 400, "invalid_request", validated);
      }

      const clientIp = connectingIp(request);
      if (!clientIp) {
        return error(
          request,
          env,
          400,
          "client_identity_unavailable",
          "Cloudflare client identity is unavailable",
        );
      }

      // Enforce both a server-controlled identity and the persistent browser ID.
      // Rotating clientId values cannot evade the IP limit, while the client limit
      // also follows one browser across network changes.
      const ipRateLimit = await env.RECOGNITION_IP_RATE_LIMITER.limit({
        key: `recognize:ip:${clientIp}`,
      });
      if (!ipRateLimit.success) {
        return error(
          request,
          env,
          429,
          "rate_limited",
          "Recognition limit exceeded; try again in one minute",
          { "Retry-After": "60" },
        );
      }

      const clientRateLimit = await env.RECOGNITION_CLIENT_RATE_LIMITER.limit({
        key: `recognize:client:${validated.clientId}`,
      });
      if (!clientRateLimit.success) {
        return error(
          request,
          env,
          429,
          "rate_limited",
          "Recognition limit exceeded; try again in one minute",
          { "Retry-After": "60" },
        );
      }

      try {
        const result: RecognitionResponse = await recognizeWithShazam(
          validated,
          dependencies.fetchImpl ?? fetch,
          env.SHAZAM_RECOGNITION_URL,
        );
        return json(request, env, result);
      } catch (cause) {
        const transient = (cause as { transient?: boolean })?.transient === true;
        console[transient ? "warn" : "error"]("Recognition upstream failed", cause);
        return error(
          request,
          env,
          502,
          "upstream_error",
          "Music recognition is temporarily unavailable",
        );
      }
    },
  } satisfies ExportedHandler<Env>;
}

export default createWorker();
