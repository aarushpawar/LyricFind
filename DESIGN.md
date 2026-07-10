# Design

Dark, type-forward, hi-fi hardware feel. The lyrics are the interface; chrome recedes.

## Color

Restrained strategy: warm-tinted dark neutrals + one amber accent used for state only (live dot, meter, primary buttons). No gradients, no glows-as-decoration.

- `--bg: #100f0d` — body background (near-black, tinted toward the accent hue)
- `--surface: #1a1815` — cards, dock, fallbacks
- `--line: rgba(242,240,235,.09)` — hairline borders
- `--ink: #f2f0eb` — headings, active lyric line
- `--muted: #b3ada2` — body/support text (≥4.5:1 on bg)
- `--faint: #7d786e` — footer, tiny labels (large/incidental text only)
- `--accent: #f2a03d` / `--accent-ink: #201403` — amber "on-air lamp"; button text is dark-on-amber
- Deliberate low contrast (`#565248` etc.) is reserved for de-emphasized karaoke lines

## Typography

One family: **Archivo** 400–800. Fixed rem scale for UI; fluid clamp only on lyric/hero display text. Letter-spacing never tighter than -0.025em. No uppercase tracked labels anywhere — sentence case throughout.

## Voice

Copy reports what the software is doing, in plain sentences: "No match yet.", "Microphone access is blocked.", "In sync". No taglines, no eyebrows, no "we're delighted" energy.

## Components

- **Listen meter**: five amber bars (idle: flat gray stubs; listening: animated; scanning: faster). Replaces any orb/pulse imagery. Reduced motion: bars hold a static mid height.
- **Buttons**: solid amber, 10px radius, dark text; hover lightens, active darkens; visible focus ring. Icon controls are bordered neutrals.
- **Status pill**: dot + short label ("Listening · 4s", "In sync", "Mic off"); amber glowing dot only when live.
- **Controls dock**: fixed bottom, blurred surface panel, hairline border.
- Blurred album artwork as ambient background is content-derived and allowed (opacity ≤ .12, desaturated).

## Motion

State-conveying only, 150–300ms, standard easing. Animations: meter bars, playing bars, spinner, status dot pulse. Full `prefers-reduced-motion` fallback.
