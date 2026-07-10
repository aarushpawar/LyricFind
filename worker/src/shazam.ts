import type {
  NormalizedTrack,
  RecognitionResponse,
  RecognizeRequest,
} from "./types";

const DEFAULT_SHAZAM_URL =
  "https://amp.shazam.com/discovery/v5/en/US/android/-/tag";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asFiniteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstRecord(value: unknown): UnknownRecord | null {
  return Array.isArray(value) ? asRecord(value[0]) : null;
}

function songMetadata(track: UnknownRecord, title: string): string | null {
  const sections = Array.isArray(track.sections) ? track.sections : [];
  for (const sectionValue of sections) {
    const section = asRecord(sectionValue);
    if (!section || section.type !== "SONG" || !Array.isArray(section.metadata)) {
      continue;
    }

    for (const metadataValue of section.metadata) {
      const metadata = asRecord(metadataValue);
      if (metadata?.title === title) {
        return asString(metadata.text);
      }
    }
  }
  return null;
}

function findIsrc(track: UnknownRecord): string | null {
  const direct = asString(track.isrc);
  if (direct) return direct;

  const sections = Array.isArray(track.sections) ? track.sections : [];
  for (const sectionValue of sections) {
    const section = asRecord(sectionValue);
    if (!section || !Array.isArray(section.metadata)) continue;
    for (const metadataValue of section.metadata) {
      const metadata = asRecord(metadataValue);
      if (typeof metadata?.title === "string" && metadata.title.toLowerCase() === "isrc") {
        return asString(metadata.text);
      }
    }
  }
  return null;
}

export function normalizeShazamResponse(payload: unknown): RecognitionResponse {
  const response = asRecord(payload);
  const matches = Array.isArray(response?.matches) ? response.matches : [];
  if (matches.length === 0) return { status: "no_match" };

  const match = firstRecord(response?.matches);
  const track = asRecord(response?.track);
  if (!match || !track) throw new Error("Shazam returned an incomplete match");

  const id = asString(track.key) ?? asString(match.id);
  const title = asString(track.title);
  const artist = asString(track.subtitle);
  const offset = asFiniteNumber(match.offset);
  if (!id || !title || !artist || offset === null || offset < 0) {
    throw new Error("Shazam returned an incomplete match");
  }

  const images = asRecord(track.images);
  const normalizedTrack: NormalizedTrack = {
    id,
    title,
    artist,
    album: songMetadata(track, "Album"),
    artworkUrl:
      asString(images?.coverarthq) ?? asString(images?.coverart) ?? null,
    isrc: findIsrc(track),
  };

  return {
    status: "match",
    track: normalizedTrack,
    matchOffsetSeconds: offset,
    timeSkew: asFiniteNumber(match.timeskew) ?? 0,
  };
}

export async function recognizeWithShazam(
  input: RecognizeRequest,
  fetchImpl: typeof fetch,
  baseUrl = DEFAULT_SHAZAM_URL,
): Promise<RecognitionResponse> {
  const requestId = crypto.randomUUID();
  const timestamp = Date.now();
  const endpoint = new URL(
    `${baseUrl.replace(/\/$/, "")}/${requestId}/${crypto.randomUUID()}`,
  );
  endpoint.search = new URLSearchParams({
    sync: "true",
    webv3: "true",
    sampling: "true",
    connected: "",
    shazamapiversion: "v3",
    sharehub: "true",
    video: "v3",
  }).toString();

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/122 Mobile Safari/537.36",
    },
    body: JSON.stringify({
      geolocation: { altitude: 0, latitude: 0, longitude: 0 },
      signature: {
        samplems: input.sampleMs,
        timestamp,
        uri: input.signatureUri,
      },
      timestamp,
      timezone: "Etc/UTC",
    }),
  });

  if (!response.ok) {
    throw new Error(`Shazam request failed with status ${response.status}`);
  }

  return normalizeShazamResponse(await response.json());
}
