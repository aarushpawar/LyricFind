# Product

## Register

product

## Users

Someone in a room where music is playing — a party, a kitchen, a passenger seat. They prop a phone or laptop up and glance at it from a few feet away to sing along. Ambient light is usually dim; the screen competes with conversation and the music itself. The job: know what song this is and see the words land on time.

## Product Purpose

LyricFind recognizes the music around you (on-device fingerprint, Shazam relay via a small Worker) and scrolls synchronized lyrics from LRCLIB against a playback clock. Privacy is a feature: raw audio never leaves the browser. Success = lyrics appear fast and stay in time without the user touching anything.

## Brand Personality

Direct, calm, hi-fi. Like well-made audio hardware: quiet until it's doing something, then precise. The interface states facts ("No match yet", "In sync") instead of selling moods.

## Anti-references

- The 2025 AI-generated look: violet→pink gradients, glowing orbs, noise overlays, glassmorphism-by-default.
- Uppercase letter-spaced eyebrow labels above every heading.
- Marketing-poetry microcopy ("Let the music in", "Matching the moment") inside an app surface.
- Spotify-green dark clone.

## Design Principles

1. **Lyrics are the interface.** The active line is the loudest thing on screen; everything else recedes.
2. **Copy reports, it doesn't perform.** Every string describes what the software is actually doing, in sentence case.
3. **One accent, for state only.** Amber marks live/active; it never decorates.
4. **Glanceable at two meters.** Type sizes and contrast tuned for across-the-room reading.

## Accessibility & Inclusion

Reduced motion fully honored (scroll + animation). Status changes announced via role="status". Body/support text ≥ 4.5:1 against background; deliberate low-contrast is reserved for de-emphasized lyric lines, never for instructions or errors.
