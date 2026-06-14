# Quality Guidelines

> Code standards for the FastAPI backend. The bar is "correct, async-safe, and
> leak-free", scaled to a small single-endpoint demo — not enterprise ceremony.

---

## Tooling & Commands

Dependency management is `venv` + `requirements.txt` (pinned). From `backend/`:

```bash
python -m venv .venv
source .venv/Scripts/activate    # Windows Git Bash; or .venv\Scripts\activate
pip install -r requirements.txt

ruff check .                     # lint
ruff format --check .            # formatting (run `ruff format .` to fix)
pytest                           # tests
uvicorn app.main:app --reload    # run locally
```

- `ruff` is the linter **and** formatter — no separate black/flake8/isort.
- Add new deps to `requirements.txt` with a pinned version; do not rely on
  globally installed packages.

---

## Required Patterns

- **Type hints on every function** (params and return). Pydantic v2 models for
  all request/response/event shapes (`app/schemas.py`).
- **Config via `get_settings()`** only — never `os.getenv` in routes/services
  (see [configuration.md](./configuration.md)).
- **`AsyncOpenAI`** for the streaming call inside the `async` route.
- **Fail-fast config validation** at startup; **`event: error`** frames for
  in-stream failures (see [error-handling.md](./error-handling.md)).
- **Thin routes, fat-ish services**: provider payloads and exception mapping live
  in `services/` / `errors.py`, not in route handlers.

---

## Forbidden Patterns

| Forbidden | Why |
|-----------|-----|
| Sync `OpenAI` client in an `async` route | Blocks the event loop; serializes all users; kills streaming |
| Hard-coded API key / base URL / model | Must come from `.env` via `Settings` |
| Logging secrets, image bytes, or conversation content | Privacy + no-persistence promise (see [logging-guidelines.md](./logging-guidelines.md)) |
| Persisting user data (DB rows, image/audio files, transcript logs) | Service is stateless by design (see [llm-streaming.md](./llm-streaming.md)) |
| Returning raw upstream/provider error strings to the client | Leaks internals; not user-readable zh-CN |
| `except: pass` / bare `except` that swallows | Hides failures; breaks disconnect handling |
| `CORS_ALLOW_ORIGINS="*"` | Pin to the Vite dev origin |
| Mock/degraded fallback when config is missing | `plan.md` requires an explicit error, not a silent mock |

---

## Testing Requirements

Keep tests light but cover the two things most likely to break a demo:

- **Config validation** (`tests/test_config.py`): clearing a required var makes
  `get_settings()` / startup validation fail. Missing config must not boot.
- **`/api/chat` contract** (`tests/test_chat.py`): with `AsyncOpenAI` mocked to
  yield fake deltas, assert the SSE stream emits `data:{"delta":...}` frames then
  `event: done`; assert a raised `openai.AuthenticationError` produces an
  `event: error` frame with the mapped zh-CN message (and **no** key/base-URL in
  the payload).

Use `pytest` + FastAPI's `TestClient`/`httpx`. Mock the OpenAI client — tests
never make real network calls.

---

## Code Review Checklist

- [ ] No `os.getenv` outside `config.py`; config flows through `get_settings()`.
- [ ] Streaming path is `async` end-to-end with `AsyncOpenAI`.
- [ ] No secrets / image bytes / conversation content in logs or responses.
- [ ] In-stream errors emit `event: error`; pre-stream validation returns HTTP 4xx.
- [ ] No data written to disk or a datastore.
- [ ] Type hints present; IO uses Pydantic models; `ruff` clean.
- [ ] If the SSE wire format changed, the frontend contract changed in lockstep.
