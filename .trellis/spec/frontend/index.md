# Frontend Development Guidelines

> Vite + React + **TypeScript** single-page app. One screen: camera preview,
> push-to-talk button, recognized text, send status, streamed answer, recent
> conversation list, and error banner. Speech-to-text and text-to-speech use the
> **browser Web Speech API**; the answer streams in over SSE and is spoken as it
> arrives. No router, no persistence — a refresh clears everything.

---

## How the Pieces Fit

```
useSpeechRecognition ─▶ transcript ─┐
useCamera.captureFrame() ─▶ base64 ─┼─▶ useChatStream.send() ─POST /api/chat─▶ backend
                                    │        │ (SSE deltas)
            ConversationList ◀──────┘        ▼
            AnswerView ◀─── answer ◀─── useSpeechSynthesis.speak() (early playback)
```

- Target browsers: **latest Chrome / Edge** (Web Speech API). Feature-detect and
  show a clear zh-CN message where unsupported.
- The SSE response is consumed with **`fetch()` streaming**, not `EventSource`
  (`EventSource` is GET-only and cannot carry the image + history body).
- The chat request/response shapes mirror the backend
  `backend/app/schemas.py` — see [type-safety.md](./type-safety.md) and
  `guides/cross-layer-thinking-guide.md`.

---

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | `src/` layout: components, hooks, effects, lib, types, styles |
| [Component Guidelines](./component-guidelines.md) | Function components, typed props, CSS Modules, the isolated `effects/` layer, accessibility |
| [Hook Guidelines](./hook-guidelines.md) | The four browser-API hooks, lifecycle cleanup, feature detection |
| [State Management](./state-management.md) | Ephemeral React state, the 6-round history rule, why there's no store/cache library |
| [Type Safety](./type-safety.md) | Strict TS, SSE discriminated unions, isolating the Web Speech `any` |
| [Quality Guidelines](./quality-guidelines.md) | ESLint/Prettier/Vitest, forbidden & required patterns |

---

## Non-Negotiables (project-specific)

1. Consume `/api/chat` with `fetch` + a stream reader; never `EventSource`.
2. Every hook that touches a browser device/API cleans up on unmount (stop
   tracks, abort recognition, cancel speech, abort the fetch).
3. No conversation persistence — state is in memory only; refresh wipes it.
4. Unsupported browser or denied camera/mic permission → a readable zh-CN error,
   never a silent failure or a blank screen.
5. Stream into an `aria-live` region and start speaking early for low perceived latency.

---

**Language**: Spec docs are written in **English**. UI copy and error strings are
**Simplified Chinese** per `plan.md`.
