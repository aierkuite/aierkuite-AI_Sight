# Directory Structure

> How the Vite + React + TypeScript frontend is organized. The app is a single
> screen, so the structure is shallow: components, the four device/API hooks, an
> isolated effects layer, a small lib, shared types, and style tokens.

---

## Repo Position

The frontend is a sibling of the backend at the repo root:

```
G:\qiniuyun\
├── plan.md
├── backend/         # FastAPI (see ../backend spec)
└── frontend/        # this layer
```

---

## Directory Layout

```
frontend/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── main.tsx              # React root render
    ├── App.tsx              # screen composition + top-level state (conversation, status, error)
    ├── components/          # one folder per component: Name.tsx + Name.module.css
    │   ├── CameraPreview/    # <video> bound to useCamera's stream
    │   ├── TalkButton/       # push-to-talk control (start/stop recognition)
    │   ├── TranscriptView/   # live recognized text (aria-live)
    │   ├── AnswerView/       # streamed model answer (aria-live)
    │   ├── ConversationList/ # last rounds, newest first
    │   └── ErrorBanner/      # permission/unsupported/request errors (role="alert")
    ├── hooks/               # useCamera, useSpeechRecognition, useSpeechSynthesis, useChatStream
    ├── effects/             # isolated dynamic visuals (e.g. particle background) — see below
    ├── lib/                 # chatStream.ts (fetch + SSE parse), constants.ts
    ├── types/               # chat.ts (shared shapes) + speech.d.ts (Web Speech ambient decls)
    └── styles/              # tokens.css (CSS custom properties), global.css
```

Add a component folder only when a real UI piece exists; do not scaffold empty
folders. Keep one component per folder with its `.module.css` co-located.

---

## Layer Responsibilities

| Folder | Owns | Must NOT do |
|--------|------|-------------|
| `components/` | Rendering + user interaction; props in, callbacks out | Call `getUserMedia`/`fetch` directly — delegate to hooks |
| `hooks/` | Browser-API lifecycle (camera, speech, SSE), with cleanup | Render JSX |
| `effects/` | Decorative dynamic visuals, isolated from functional UI | Touch chat state or device APIs |
| `lib/` | Pure helpers: the SSE fetch client, constants (e.g. `MAX_HISTORY_ROUNDS`) | Hold React state |
| `types/` | Shared TS types + the Web Speech ambient declaration | — |
| `styles/` | Design tokens (CSS variables) + global base styles | Component-specific rules (those go in `*.module.css`) |

State lives at the top (`App.tsx`) and flows down as props; the device hooks are
invoked where their output is owned (see [state-management.md](./state-management.md)).

---

## The `effects/` Layer (extensibility)

Dynamic visual effects — the kind that may grow over time (particles, animated
backgrounds) — live in `effects/` as **self-contained components decoupled from
app logic**:

- An effect renders into its own layer (e.g. a fixed background canvas) and reads
  only from props/CSS variables, never from chat state.
- A heavier/animated effect (particles, glow fields) is either a hand-written
  self-contained `<canvas>` component or a dedicated library mounted as one
  isolated component (e.g. `effects/LiveBackdrop.tsx`), so the functional UI and
  the visual layer evolve independently.
- This keeps "make it fancier later" a localized change, not a refactor of the
  chat flow.

### Canvas effect contract (`effects/LiveBackdrop.tsx`)

`LiveBackdrop` is the reference hand-written canvas effect; a new animated canvas
in this layer MUST follow the same contract:

- Render one `aria-hidden` `<canvas>`; keep all logic in a single `useEffect`.
- **Fully typed, no `any`** — explicit interfaces for particles/entities and a
  `getContext("2d")` null-guard (see [type-safety.md](./type-safety.md)).
- **Colors come from CSS tokens, not literals**: `getComputedStyle(canvas)
  .getPropertyValue("--color-accent")` → parse → build `rgba()`. The effect reads
  only CSS variables — never chat state or device APIs — so re-theming
  `tokens.css` re-colors the canvas for free.
- **Cap DPR**: `const dpr = Math.min(window.devicePixelRatio || 1, 2)` then
  `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` — uncapped DPR tanks perf on hi-dpi.
- **Delta-time motion**: advance by `vx * dt` from the rAF timestamp (clamp `dt`,
  e.g. `Math.min((t - last) / 1000, 0.05)`), not a fixed per-frame increment —
  keeps drift speed identical at 60/120/144 Hz.
- **`prefers-reduced-motion`**: `window.matchMedia("(prefers-reduced-motion:
  reduce)")` → draw exactly one static frame and start no rAF loop; also subscribe
  to its `change` event.
- **Cleanup is mandatory**: the `useEffect` return calls `cancelAnimationFrame`
  and removes the `resize` + `matchMedia` listeners (mirrors the device-hook
  cleanup rule).

> **Design decision — hand-written canvas over a particle library.** For
> `LiveBackdrop` we deliberately hand-wrote a typed `<canvas>` (additive-blended
> glows + drifting particles + vignette) instead of adding a WebGL/particle
> library: zero new dependency, full control, and it satisfies this layer's real
> intent (self-contained, reads only props/CSS, decoupled from chat). Reach for a
> library only if an effect outgrows a few hundred 2D primitives.

---

## Naming Conventions

- Components: `PascalCase` files/folders (`CameraPreview/CameraPreview.tsx`).
- Hooks: `useX.ts` (`useCamera.ts`).
- Style modules: `Name.module.css`; design tokens in `styles/tokens.css` as
  `--color-*`, `--space-*` custom properties.
- Shared types: `types/chat.ts`; ambient browser-API types: `types/speech.d.ts`.

---

## Reference Files (conventions defined here, code follows)

- Screen composition + state ownership: `frontend/src/App.tsx`
- SSE client: `frontend/src/lib/chatStream.ts` (see [hook-guidelines.md](./hook-guidelines.md))
- Shared contract types: `frontend/src/types/chat.ts` (see [type-safety.md](./type-safety.md))
