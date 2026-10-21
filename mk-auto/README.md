# M&K Auto Services website

Open `index.html` through a local server (the hero reads pixels from its photo, which browsers block on `file://`):

    python3 -m http.server 8000   # then visit http://localhost:8000

- `hero.js`: the animated intro. Outline traced from the photo, light sweep, LED and headlight ignition with bloom, floor reflections, chrome logo.
- `assets/amg-front.jpg`: the base plate. Replace it with a photo you own or have licensed before going live. If you change it, re-measure the `DRL`, `LEDS`, `LAMPS` and `REFL` values at the top of `hero.js`.
- `media/`: the same intro rendered as MP4 for social (9:16 Reels/TikTok, 16:9 Facebook/YouTube).
- Re-render a frame for checks: `index.html?capture` exposes `MKHero.seek(t)`; add `&view=v&card` for the vertical social version.
