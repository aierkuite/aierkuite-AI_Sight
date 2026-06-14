# State Management

> All app state is **ephemeral React state** held in memory. There is no state
> library and no persistence: a page refresh clears the conversation by design
> (privacy — the product stores nothing).

---

## State Categories

| State | Where it lives | Notes |
|-------|----------------|-------|
| Conversation history | `App.tsx` (`useState`/`useReducer`) | Array of rounds; **trimmed to last 6** before each send |
| Live transcript | from `useSpeechRecognition` | Recognized text for the in-progress utterance |
| Streaming answer | from `useChatStream` | Appended delta-by-delta during the request |
| Request/recording status | `App.tsx` | `idle` / `listening` / `streaming` drives button + UI |
| Error | `App.tsx` (fed by hooks) | Permission, unsupported, or request error → `ErrorBanner` |
| Camera/mic stream | inside `useCamera` / `useSpeechRecognition` | Owned by the hook, cleaned up on unmount |

State lives at the top (`App.tsx`) and flows down as props; device hooks are
invoked where their output is owned. Lift state only as high as needed.

---

## The 6-Round History Rule (the one real rule)

`plan.md` keeps only the **last 6 rounds** of text context (cost + relevance).
Keep this trimming in **one place** — a single helper/reducer action — so the
backend never receives more than agreed and the rule isn't duplicated:

```ts
const MAX_HISTORY_ROUNDS = 6; // mirror of backend MAX_HISTORY_ROUNDS — keep in lib/constants.ts

function appendRound(history: HistoryTurn[], userText: string, answer: string) {
  return [...history, { role: "user", content: userText },
                       { role: "assistant", content: answer }
         ].slice(-MAX_HISTORY_ROUNDS * 2);
}
```

History is **text only** — the screenshot is captured fresh per send and never
stored in history (matches `backend/llm-streaming.md`).

---

## When to Use Global State / Context

For a single screen, **don't**. Props from `App.tsx` are sufficient. Reach for
`useContext` only if prop-drilling becomes genuinely deep (3+ levels). There is
no Redux / Zustand / Jotai — adding one for this app is over-engineering.

---

## Server State

There is **no server-state cache library** (React Query / SWR) and that's
deliberate: each `/api/chat` call is a **one-shot streaming request**, not a
cacheable resource. `useChatStream` owns the in-flight request lifecycle
(loading, deltas, error, abort); there's nothing to cache or invalidate.

---

## No Persistence (hard rule)

- No `localStorage` / `sessionStorage` / IndexedDB for conversations, transcripts,
  or images.
- Refresh = clean slate. This mirrors the backend's no-persistence promise; the
  whole product deliberately remembers nothing across sessions.

---

## Common Mistakes

- Trimming history in multiple places (or only on the backend) → drift in what
  "6 rounds" means. Keep it in one helper, with `MAX_HISTORY_ROUNDS` as a shared
  constant.
- Reaching for a store library "to be safe" → unnecessary complexity for one screen.
- Persisting history to `localStorage` "for convenience" → violates the
  no-persistence design.
- Storing derived values (e.g. formatted strings) in state instead of computing
  them in render → stale-state bugs.
