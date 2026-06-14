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
  **Isolate the test from any local `.env`** — clearing the process env var is
  not enough on its own (see the gotcha below).
- **`/api/chat` contract** (`tests/test_chat.py`): with `AsyncOpenAI` mocked to
  yield fake deltas, assert the SSE stream emits `data:{"delta":...}` frames then
  `event: done`; assert a raised `openai.AuthenticationError` produces an
  `event: error` frame with the mapped zh-CN message (and **no** key/base-URL in
  the payload).

Use `pytest` + FastAPI's `TestClient`/`httpx`. Mock the OpenAI client — tests
never make real network calls.

### Gotcha: config tests must disable `.env`, not just clear the env var

**Symptom**: `test_validate_config_fails_fast_without_required_env` passes in CI
(and for reviewers with no `.env`) but fails locally with
`Failed: DID NOT RAISE <class 'SystemExit'>` for anyone who has a real
`backend/.env`.

**Cause**: `Settings` sets `model_config = SettingsConfigDict(env_file=".env")`.
`pydantic-settings` re-reads `.env` on every instantiation, so
`monkeypatch.delenv("OPENAI_BASE_URL")` is silently undone — the value is
re-loaded from the file, validation "succeeds", and fail-fast never triggers.

**Fix / Prevention**: neutralize `.env` for the whole test package with an
autouse fixture in `tests/conftest.py`, so tests depend only on the process
environment they set explicitly:

```python
# backend/tests/conftest.py
import pytest
from app.config import Settings

@pytest.fixture(autouse=True)
def isolate_dotenv(monkeypatch: pytest.MonkeyPatch) -> None:
    """阻止测试读取开发者本地 .env，保证配置校验测试可重现"""
    monkeypatch.setitem(Settings.model_config, "env_file", None)
```

Tests that need config *present* then `monkeypatch.setenv(...)` the required
vars themselves (process env is the only source once `.env` is off).

---

## Code Review Checklist

- [ ] No `os.getenv` outside `config.py`; config flows through `get_settings()`.
- [ ] Streaming path is `async` end-to-end with `AsyncOpenAI`.
- [ ] No secrets / image bytes / conversation content in logs or responses.
- [ ] In-stream errors emit `event: error`; pre-stream validation returns HTTP 4xx.
- [ ] No data written to disk or a datastore.
- [ ] Type hints present; IO uses Pydantic models; `ruff` clean.
- [ ] If the SSE wire format changed, the frontend contract changed in lockstep.
