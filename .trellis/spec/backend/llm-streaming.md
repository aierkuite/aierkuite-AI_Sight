# LLM & Streaming

> The core of the backend: build a multimodal chat request, call the
> OpenAI-compatible model with streaming, and relay tokens to the browser as
> Server-Sent Events. This file defines the `/api/chat` **wire contract** shared
> with the frontend — treat it as a cross-layer boundary.

---

## Client (`app/services/llm.py`)

Use the `openai` SDK's **async** client, pointed at the configured base URL.
The streaming endpoint is `async`, so the sync client is forbidden (it blocks
the event loop — see [quality-guidelines.md](./quality-guidelines.md)).

```python
from openai import AsyncOpenAI
from app.config import get_settings

def get_client() -> AsyncOpenAI:
    s = get_settings()
    return AsyncOpenAI(
        api_key=s.openai_api_key,
        base_url=s.openai_base_url,
        timeout=s.request_timeout_seconds,
    )
```

---

## Multimodal Message Construction

Each request carries the user's text, **one** current screenshot, and the
recent text history. Build OpenAI-style `messages`:

- History turns are **text only** — `{"role": ..., "content": "<text>"}`.
- The **latest** user turn carries text **and** the image, using the content-parts array:

```python
latest_user = {
    "role": "user",
    "content": [
        {"type": "text", "text": user_text},
        {"type": "image_url",
         "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
    ],
}
```

Rules:
- Attach the image to the **current** turn only. **Never re-send images from
  history** — it multiplies cost for no benefit (the screenshot is "now").
- Trim history to the last `MAX_HISTORY_ROUNDS` (default 6) rounds before sending.
- If `image_b64` is absent, send a text-only latest turn (the frontend normally
  always sends a frame, but the service must not crash without one).
- A short system prompt may set language/behavior (answer in the user's
  language, be concise). Keep it in one place in `llm.py`.

---

## Streaming Generator

```python
async def stream_chat(user_text, image_b64, history):
    client = get_client()
    messages = build_messages(user_text, image_b64, history)
    stream = await client.chat.completions.create(
        model=get_settings().openai_model,
        messages=messages,
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
```

The route wraps this generator into SSE frames (below). Map any exception raised
here to a domain error in [error-handling.md](./error-handling.md).

---

## `/api/chat` Wire Contract

### Request (`POST /api/chat`, JSON — `schemas.ChatRequest`)

```jsonc
{
  "text": "string, required, non-empty",
  "image": "string | null — base64 JPEG (no data: prefix), the current frame",
  "history": [           // optional, server trims to last MAX_HISTORY_ROUNDS rounds
    { "role": "user" | "assistant", "content": "string" }
  ]
}
```

Validate with Pydantic. Reject empty `text` (422) and images over
`MAX_IMAGE_BYTES` (413/400) **before** calling the model.

### Response — `text/event-stream` via `sse-starlette`

Token chunks and lifecycle are distinct SSE event types so the frontend can
branch on a discriminated union (mirrors `frontend` `type-safety.md`):

| When | Frame |
|------|-------|
| Each token chunk | `data: {"delta": "<text>"}` |
| Normal completion | `event: done` / `data: {}` |
| Failure (any stage) | `event: error` / `data: {"message": "<zh-CN safe message>"}` |

```python
from sse_starlette.sse import EventSourceResponse
import json

@router.post("/api/chat")
async def chat(req: ChatRequest):
    async def event_source():
        try:
            async for delta in stream_chat(req.text, req.image, req.history):
                yield {"data": json.dumps({"delta": delta}, ensure_ascii=False)}
            yield {"event": "done", "data": "{}"}
        except Exception as exc:
            yield {"event": "error",
                   "data": json.dumps({"message": to_user_message(exc)},
                                      ensure_ascii=False)}
    return EventSourceResponse(event_source())
```

- Emit errors as an `event: error` frame, **not** an HTTP 500 — once the stream
  has started the status is already `200`, and the frontend listens for `error`.
- Pre-stream validation failures (bad body, oversized image) are normal HTTP
  4xx responses, since no stream has opened yet.

---

## Cost & Disconnect Controls (project requirement)

`plan.md` makes cost discipline explicit. Enforce it here:

- **One image per request** (the design reserves up to 3 frames for dynamic
  scenes; if added, cap hard and document it — never stream an unbounded burst).
- **Last 6 rounds only**, text only, no historical images.
- **Stop on client disconnect**: `sse-starlette` cancels the generator when the
  browser goes away — do not swallow `asyncio.CancelledError`; let it propagate
  so the upstream stream closes and we stop paying for tokens.

---

## No Persistence (hard rule)

Nothing user-supplied is stored. No database, no writing the screenshot/audio to
disk, no conversation log files, no in-memory accumulation across requests. The
backend is a stateless relay. History is supplied by the client on each request
and discarded after the response. This is why there is no `database-guidelines.md`.

---

## Common Mistakes

- Using the **sync** `OpenAI` client in the async route → blocks the event loop,
  serializes all users, defeats streaming.
- Re-sending history images → silent cost blowup.
- Returning HTTP 500 mid-stream → the frontend already received `200`; it will
  hang. Use an `event: error` frame.
- Forgetting `ensure_ascii=False` → Chinese deltas arrive as `\uXXXX` escapes.
- Catching `CancelledError` on disconnect → keeps pulling upstream tokens after
  the user left.
