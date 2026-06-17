# Error Handling

> Two distinct error domains in this backend: **startup/config** errors (fail
> fast, kill the process) and **per-request** errors (surface a safe zh-CN
> message, keep the server up). Never leak secrets or raw upstream errors.

---

## Domain 1 — Startup / Configuration (fail-fast)

Missing or invalid required config is unrecoverable, so the process must not
start. Validate in the FastAPI lifespan/startup and `SystemExit(1)` with a clear
**Simplified Chinese** stderr message. See [configuration.md](./configuration.md)
for `validate_config()`.

- Surface *which* required var is missing — never its value.
- Do not start `uvicorn` into a half-configured state and fail on first request;
  that hides the real cause behind a confusing runtime stack trace.

---

## Domain 2 — Per-Request (graceful)

Per-request failures must not crash the server. **Where** the error surfaces
depends on whether the SSE stream has already opened:

| Stage | Channel | Example |
|-------|---------|---------|
| Before stream opens (request validation) | HTTP 4xx (FastAPI/Pydantic) | empty `text` → 422, image over `MAX_IMAGE_BYTES` → 413/400 |
| After stream opens (upstream/model failure) | SSE `event: error` frame, HTTP stays 200 | auth failure, rate limit, timeout, bad request from model |

Once `EventSourceResponse` has begun, the HTTP status is already `200` — emit
errors as `event: error` / `data: {"message": "..."}` (see
[llm-streaming.md](./llm-streaming.md)), not as an exception that 500s.

---

## Domain 2b — `/api/tts` (non-SSE, HTTP status carries the error)

Unlike `/api/chat`, `/api/tts` returns a **single binary WAV body**, not a
stream — there is no `event: error` channel, so failures use the HTTP status:

| Outcome | Response |
|---------|----------|
| Success | `200` + `Response(content=audio, media_type="audio/wav")` |
| Request validation (empty / >2000 chars) | `422` (FastAPI/Pydantic, before the service runs) |
| Upstream synth failure | `502` + `JSONResponse({"message": "<safe zh-CN>"})` |

The route catches **everything** and maps via `to_user_message(exc)`; the `{message}`
shape matches `/api/chat` so the frontend reads `message` uniformly.

### httpx exception → zh-CN, mapped in the **service layer**

`services/tts.py` translates `httpx` errors into `AppError` at the call site, so
`errors.py` needs no `httpx` branches — its existing `AppError → str(exc)`
pass-through delivers the message. This keeps provider-specific exception types
out of `errors.py`.

| `httpx` exception (in `synthesize_audio`) | `AppError` message (zh-CN) |
|-------------------------------------------|-----------------------------|
| `httpx.TimeoutException` | `语音合成服务响应超时，请稍后再试` |
| `httpx.ConnectError` | `无法连接语音合成服务，请确认 GPT-SoVITS 已启动` |
| `httpx.HTTPStatusError` (from `raise_for_status()`) | `语音合成服务返回错误，请稍后再试` |

The upstream response body is **never** forwarded — only the fixed mapped string.

---

## Domain Exceptions (`app/errors.py`)

Define a small hierarchy and one mapping function. Routes/services raise/catch
domain errors; `errors.py` owns the user-facing translation.

```python
class AppError(Exception):
    """Base for expected, user-surfaceable failures."""

def to_user_message(exc: Exception) -> str:
    """Map any exception to a safe Simplified-Chinese message. Secret-free."""
```

### OpenAI exception → zh-CN message map

| Upstream exception | User message (zh-CN) |
|--------------------|----------------------|
| `openai.AuthenticationError` | `AI 服务认证失败，请检查 API Key 配置` |
| `openai.RateLimitError` | `请求过于频繁，请稍后再试` |
| `openai.APITimeoutError` | `AI 服务响应超时，请稍后再试` |
| `openai.APIConnectionError` | `无法连接 AI 服务，请检查网络或 OPENAI_BASE_URL` |
| `openai.BadRequestError` | `请求被模型拒绝（可能图片过大或模型不支持图片输入）` |
| anything else | `服务异常，请稍后再试` |

The full exception (with type and detail) is **logged server-side**
(see [logging-guidelines.md](./logging-guidelines.md)); only the mapped message
reaches the browser.

---

## Never Leak

The message returned to the client must never contain:

- The API key, base URL, or model name.
- The raw upstream error string or provider stack trace.
- Internal file paths or Python tracebacks.

---

## Common Mistakes

- Returning the raw `str(exc)` from the model provider to the frontend — leaks
  base URL / internal detail and is unreadable to a Chinese-speaking user.
- 500-ing mid-stream instead of emitting `event: error` → the frontend hangs
  waiting for `done`/`error`.
- Swallowing `asyncio.CancelledError` (client disconnect) and converting it to an
  error frame — disconnect is normal, let it propagate so the upstream closes.
- Catching config errors and continuing — the server should die at startup, not
  serve broken requests.
