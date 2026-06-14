# Logging Guidelines

> Logging exists for **operability** (did the request reach the model? how long
> did it take? why did it fail?) — never for capturing user content. This
> service promises no persistence, and logs are persistence too.

---

## Library & Setup

Use the Python **standard library `logging`**, configured once in `app/main.py`
(or a small `app/logging_config.py`). No extra logging dependency is needed for
a single-service app.

- Configure at startup: a formatter with `timestamp level logger message`, level
  from an optional `LOG_LEVEL` env (default `INFO`).
- Get module loggers with `logging.getLogger(__name__)`; do not use the root
  logger or `print()` for request logging (startup fail-fast may use `print` to
  stderr — see [configuration.md](./configuration.md)).

---

## Log Levels

| Level | Use for | Examples |
|-------|---------|----------|
| `DEBUG` | Local troubleshooting only; off by default | content previews (truncated), message counts |
| `INFO` | Normal request lifecycle | request received, model name, image byte size, history rounds, stream started/finished, duration ms |
| `WARNING` | Recoverable / expected anomalies | client disconnect mid-stream, oversized image rejected, retryable upstream blip |
| `ERROR` | Upstream/model failures | auth/rate-limit/connection/timeout errors, with `exc_info=True` |
| `CRITICAL` | Startup config failure | missing required env var (process aborts) |

---

## What to Log

- Request lifecycle: `"/api/chat received: model=%s image_bytes=%d history_rounds=%d"`
- Outcome + timing: stream completed in N ms, or failed with which exception type.
- Errors: log the **real** exception (`logger.error(..., exc_info=True)`) so the
  cause is debuggable, even though the client only sees the mapped zh-CN message.

---

## What NOT to Log (hard rules)

- **Secrets**: `OPENAI_API_KEY` and anything derived from it — never, at any level.
- **Image bytes**: never log the base64 screenshot. Log its **byte length** only.
- **Conversation content**: do not log the user's full text, the model's full
  answer, or the history at `INFO`/`WARNING`. This mirrors the product's
  no-persistence promise — durable logs of what the user said/saw are a privacy
  leak. Content previews are `DEBUG`-only, truncated, and off in normal runs.
- **PII / config values**: do not echo env values (including `OPENAI_BASE_URL`)
  into error logs that might be shared.

---

## Common Mistakes

- `logger.info("payload=%s", request_body)` — dumps the base64 image and user
  text into logs; both forbidden.
- Logging the mapped zh-CN message but **not** the underlying exception — you
  lose the ability to debug ("服务异常" tells you nothing).
- Using `print()` for request logging — bypasses level control and formatting.
- Logging the API key while debugging auth issues — log the exception *type*
  (`AuthenticationError`), never the key.
