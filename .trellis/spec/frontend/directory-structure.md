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
- Heavy/animated effects (particles) should use a dedicated library mounted as
  one isolated component (e.g. `effects/ParticleBackground.tsx`), so the
  functional UI and the visual layer evolve independently.
- This keeps "make it fancier later" a localized change, not a refactor of the
  chat flow.

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
