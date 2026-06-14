# Configuration

> How the backend loads, validates, and protects configuration. This service is
> driven entirely by environment variables read from `.env`; there is no
> database and no config UI.

---

## Required Environment Variables

| Variable | Purpose | Notes |
|----------|---------|-------|
| `OPENAI_API_KEY` | Auth for the OpenAI-compatible endpoint | Secret. Backend-only. Never logged or returned. |
| `OPENAI_BASE_URL` | Base URL of the OpenAI-compatible API | e.g. an official or proxy gateway. |
| `OPENAI_MODEL` | Model name to call | **Must support image input** — the request always carries a screenshot. |

All three are **required**. There is no default and no mock fallback: a missing
or empty value aborts startup (see "Fail-fast" below).

### Optional Variables (have safe defaults)

| Variable | Default | Purpose |
|----------|---------|---------|
| `MAX_HISTORY_ROUNDS` | `6` | How many prior text rounds the backend will accept/forward (cost control). |
| `MAX_IMAGE_BYTES` | `2_000_000` | Reject oversized screenshots before calling the model. |
| `REQUEST_TIMEOUT_SECONDS` | `60` | Upstream call timeout. |
| `CORS_ALLOW_ORIGINS` | `http://localhost:5173` | Vite dev origin(s). Comma-separated. Do not use `*`. |

---

## Settings Pattern (`app/config.py`)

Use `pydantic-settings` `BaseSettings` as the single typed source of config.
Expose it through a cached accessor so the `.env` is parsed once.

```python
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openai_api_key: str
    openai_base_url: str
    openai_model: str
    max_history_rounds: int = 6
    max_image_bytes: int = 2_000_000
    request_timeout_seconds: int = 60
    cors_allow_origins: str = "http://localhost:5173"

@lru_cache
def get_settings() -> Settings:
    return Settings()
```

Rules:
- Read config **only** through `get_settings()`. Never call `os.environ` /
  `os.getenv` in routes or services.
- Required fields have no default; Pydantic raises `ValidationError` if absent.
- Keep optional fields typed with explicit defaults matching the table above.

---

## Fail-Fast at Startup (`app/main.py`)

Validate config when the app boots, not on the first request, and print a clear
**Simplified Chinese** message before exiting. Surface *which* variable is
missing, never the value of any that are set.

```python
import sys, logging
from app.config import get_settings

def validate_config() -> None:
    try:
        get_settings()
    except Exception as exc:  # pydantic ValidationError
        logging.getLogger("startup").critical("配置校验失败，服务无法启动")
        # Print missing/invalid field names (NOT values) to stderr in zh-CN.
        print("启动失败：缺少必填环境变量，请检查 .env "
              "(需要 OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL)。",
              file=sys.stderr)
        raise SystemExit(1) from exc
```

Call `validate_config()` from the FastAPI lifespan/startup so `uvicorn` fails
immediately with a readable error. See [error-handling.md](./error-handling.md)
for how this differs from per-request errors.

---

## API Key Protection (hard rules)

- The key lives in `.env` and `Settings` only. It is **never** put into a
  response body, an SSE frame, a log line, or an error message.
- `.env` is gitignored; commit `.env.example` with placeholder values instead.
- The frontend never receives the key, base URL, or model name — it only talks
  to `/api/chat`.

---

## Common Mistakes

- Reading `os.getenv("OPENAI_API_KEY")` inline instead of via `get_settings()` —
  bypasses validation and typing.
- Giving a required var a default (e.g. `openai_model: str = ""`) — hides the
  missing-config failure until a confusing runtime error.
- Echoing the offending value in the startup error — leaks secrets to the console/logs.
- Using `CORS_ALLOW_ORIGINS="*"` — this endpoint streams model output; keep it pinned to the dev origin.
