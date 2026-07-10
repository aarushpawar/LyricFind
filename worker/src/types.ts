export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  RECOGNITION_RATE_LIMITER: RateLimitBinding;
  ALLOWED_ORIGINS?: string;
  SHAZAM_RECOGNITION_URL?: string;
}

export interface RecognizeRequest {
  clientId: string;
  signatureUri: string;
  sampleMs: number;
}

export interface NormalizedTrack {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  artworkUrl: string | null;
  isrc: string | null;
}

export type RecognitionResponse =
  | {
      status: "match";
      track: NormalizedTrack;
      matchOffsetSeconds: number;
      timeSkew: number;
    }
  | { status: "no_match" };
