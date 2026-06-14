# Quality Guidelines

> Code standards for the frontend. The bar is "type-safe, accessible, and leak-
> free device handling", scaled to a single-screen demo on latest Chrome/Edge.

---

## Tooling & Commands

Package manager is **npm**. From `frontend/`:

```bash
npm install
npm run dev        # Vite dev server (localhost:5173)
npm run build      # tsc + vite build
npm run lint       # ESLint (typescript-eslint)
npm run test       # Vitest
```

- **ESLint** (typescript-eslint) + **Prettier** for formatting.
- **TypeScript strict** mode is the type gate (see [type-safety.md](./type-safety.md)).
- The app must run over `localhost` or HTTPS — the Web Speech API and
  `getUserMedia` require a secure context.

---

## Required Patterns

- **Cleanup in every device/API hook** — stop tracks, abort recognition, cancel
  speech, abort the fetch on unmount (see [hook-guidelines.md](./hook-guidelines.md)).
- **`AbortController`** for the chat stream; treat `AbortError` as a normal cancel.
- **Feature detection + graceful zh-CN fallback** for unsupported browsers and
  denied camera/mic permissions — never a blank screen or console-only error.
- **`aria-live`** regions for streamed transcript/answer; labeled controls
  (see [component-guidelines.md](./component-guidelines.md)).
- **CSS Modules + token variables** for styling; decorative dynamic effects in the
  isolated `effects/` layer.

---

## Forbidden Patterns

| Forbidden | Why |
|-----------|-----|
| `EventSource` for `/api/chat` | GET-only; can't POST the image + history body. Use `fetch` streaming. |
| `any` outside `types/speech.d.ts` | Defeats the type contract (see [type-safety.md](./type-safety.md)) |
| Persisting conversation/transcript/images (`localStorage`, etc.) | No-persistence design (see [state-management.md](./state-management.md)) |
| Device/API calls inside components | No cleanup, untestable — belongs in hooks |
| Skipping hook cleanup | Leaves camera/mic live or the stream dangling |
| Hard-coded colors/spacing | Use `styles/tokens.css` variables |
| Logging conversation content to the console in prod | Privacy; mirrors backend logging rules |
| Blocking the UI until the full answer arrives | Defeats streaming — render deltas as they come |

---

## Testing Requirements

Keep tests light but cover the fragile bits with **Vitest + React Testing Library**:

- `useChatStream`: given a mocked streamed response, deltas accumulate into
  `answer`, `done` ends the stream, an `error` frame surfaces `error.message`,
  and `abort()` cancels cleanly.
- A hook cleanup test: unmount stops media tracks / aborts the request (assert the
  mock's `stop`/`abort` was called).
- The push-to-talk + send flow at the component level with hooks mocked.

The end-to-end voice/vision flow, permission prompts, and latency feel are
verified manually against the `plan.md` test plan (real Chrome/Edge).

---

## Code Review Checklist

- [ ] `/api/chat` consumed via `fetch` streaming, not `EventSource`.
- [ ] Every device/API hook cleans up on unmount; the stream is abortable.
- [ ] Unsupported-browser and permission-denied paths show readable zh-CN errors.
- [ ] Streamed text is in an `aria-live` region; controls are labeled.
- [ ] No `any` outside `speech.d.ts`; `types/chat.ts` matches the backend schema.
- [ ] No persistence of conversation/image data.
- [ ] Styling uses CSS Modules + token variables; effects stay in `effects/`.
