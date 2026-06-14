# Type Safety

> TypeScript in **strict** mode. The chat request/response/event shapes are a
> typed contract mirrored with the backend. The Web Speech API is the one place
> `any` is tolerated — and it must be quarantined.

---

## tsconfig

- `"strict": true` (implies `noImplicitAny`, `strictNullChecks`, …). Keep it on.
- Prefer `unknown` over `any` for genuinely untyped boundaries (e.g. parsed JSON),
  then narrow.

---

## The Chat Contract (`types/chat.ts`)

Define the shapes once, mirroring `backend/app/schemas.py`. When the backend
contract changes, change these in lockstep (cross-layer boundary):

```ts
export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  text: string;
  image: string | null;     // base64 JPEG, current frame
  history: HistoryTurn[];   // last 6 rounds, text only
}

// SSE frames as a discriminated union — branch on `type`
export type ChatEvent =
  | { type: "delta"; delta: string }
  | { type: "done" }
  | { type: "error"; message: string };
```

`useChatStream` parses raw SSE frames into `ChatEvent` and switches on `type`, so
the compiler enforces that every case is handled.

---

## Validation / Defensive Parsing

There's no schema-validation library; the only untyped input is the SSE/JSON over
the network. Parse it defensively:

- Read each frame's `data:` as `unknown`, `JSON.parse`, then check fields before
  trusting them — a malformed frame becomes a handled `error`, not a crash.
- Don't assume `res.body` is non-null without guarding (it can be null for some
  responses).

---

## The Web Speech API `any` (quarantined)

`SpeechRecognition` / `webkitSpeechRecognition` lack stable built-in lib types.
Put the **only** sanctioned ambient declarations in `types/speech.d.ts`, with a
comment explaining why, and keep `any` out of the rest of the app:

```ts
// types/speech.d.ts
// Web Speech API is non-standard / not in the DOM lib; minimal ambient decls.
interface Window {
  SpeechRecognition?: typeof SpeechRecognition;
  webkitSpeechRecognition?: typeof SpeechRecognition;
}
declare var SpeechRecognition: { new (): SpeechRecognition };
// ...the few members useSpeechRecognition actually uses
```

Inside `useSpeechRecognition`, expose a clean typed surface (a `transcript`
string, `listening` boolean) — never let a `SpeechRecognitionEvent` leak out as `any`.

---

## Forbidden Patterns

| Forbidden | Instead |
|-----------|---------|
| `any` outside `types/speech.d.ts` | `unknown` + narrowing, or a real type |
| Non-null `!` to silence the compiler | Guard/narrow (`if (!res.body) return …`) |
| `as SomeType` to force a shape | Validate fields, or fix the source type |
| Untyped hook returns / positional tuples for multi-value returns | Typed return objects |
| Mirroring the backend contract loosely (drift) | Keep `types/chat.ts` aligned with `schemas.py` |

`as` is acceptable only for the speech-API shim where the platform types are
genuinely absent.
