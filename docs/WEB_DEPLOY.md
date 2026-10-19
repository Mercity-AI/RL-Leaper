# The hosted web game (GitHub Pages)

This page explains how the game gets onto the web, what the hosted copy can
and cannot do yet, and which settings matter for it.

## How it is published

- `.github/workflows/pages.yml` runs on **every push to `main`, and only
  then**. Feature branches never deploy; they only run CI (`ci.yml`).
- It installs the locked packages, runs `pnpm lint` and `pnpm test` (a broken
  game is never published), then `pnpm build` with `LEAPER_BASE` set to the
  site's sub-folder (`/RL-Leaper/` for `https://<owner>.github.io/RL-Leaper/`;
  nothing with a custom domain). `vite.config.js` uses it as the base path, so
  every script, model, sound and the collision worker load from that folder.
- The built `dist/` folder is uploaded and published with the official Pages
  actions.
- One-time setting in the repository: **Settings → Pages → Build and
  deployment → Source: GitHub Actions**.

To try the Pages build locally:

```sh
LEAPER_BASE=/RL-Leaper/ pnpm build
LEAPER_BASE=/RL-Leaper/ pnpm preview      # then open http://localhost:4173/RL-Leaper/
```

## What the hosted game does today

The Leaper's movement brain currently runs in a local Python service
(`pnpm play` starts it next to the game). A static web page cannot start that
service, so on the hosted page:

- the junkyard, Lola, the guns, the camera and every effect work as usual;
- **the Leaper does not walk: START RUN plays in turret mode.** The status line
  says `NO BRAIN SERVICE // TURRET MODE`; the Leaper stays where it is but still
  turns, aims and shoots, and the fight result is marked `TURRET MODE`;
- a brain service running on the player's own computer may not be reachable
  from the hosted page (browsers restrict public sites talking to `127.0.0.1`).
  For the full fight, play locally with `pnpm play`.

A parallel effort is porting the frozen brain into the browser (no server
needed). Once it lands, the hosted game gets the walking, hunting Leaper with
no other change to this workflow.

The RL lab pages (`?arena`, `?training`) are not part of the hosted game:
`?arena` still loads its model, fixtures and player model from the site root
(`src/brain/LeaperBrain.js`, `src/brain/BrainDriver.js`, `src/modes/arena.js`), so it
stays at "LOADING…" under a sub-folder until those paths use
`import.meta.env.BASE_URL`.

## Download size

The game loads compressed copies of the map, Lola and the sounds
(`assets/build/`, made by `pnpm assets`, see `scripts/assets/build-assets.mjs`).
The source files stay in the repository for the Blender and Python tools.
Measured with the production build (headless Chromium, nothing cached, file
bodies before any server compression): the code, models and sounds were
14.7 MB before the asset pipeline and are 5.1 MB now. The collision file
(`collision.json`, 5.9 MB, also read by the Python brain) comes on top in
both cases; hosts that compress text, like GitHub Pages, send it as about
0.8 MB.

## Graphics quality

The game picks a graphics tier for the device (`src/core/Quality.js`):

| Tier | Picked for | What changes |
| --- | --- | --- |
| low | software rendering (no graphics card) | pixel ratio 1, no anti-aliasing, 1024 px hard-edged shadows, small props and Leaper parts cast no shadow, no glow, flat sky, no dust or scorch marks |
| medium | phones, tablets, machines with ≤ 4 cores or ≤ 4 GB | pixel ratio up to 1.5, soft 2048 px shadows, glow, sky gradient, dust |
| high | everything else | pixel ratio up to 2, every prop's shadow, glow, sky gradient, dust and scorch marks |

Add `?quality=low`, `?quality=medium` or `?quality=high` to the address to
choose by hand. Every number is a plain setting in `src/core/Quality.js`.
