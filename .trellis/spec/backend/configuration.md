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
| `GPT_SOVITS_REF_AUDIO_PATH` | Path to the **Japanese** reference clip, resolvable **by the GPT-SoVITS process** (not necessarily inside this repo) | Voice timbre source for `/api/tts`. Never logged or returned. |
| `GPT_SOVITS_PROMPT_TEXT` | The **Japanese transcript** of the reference clip | Must match the reference audio. Never logged or returned. |

All five are **required**. There is no default and no mock fallback: a missing
or empty value aborts startup (see "Fail-fast" below). The two `GPT_SOVITS_*`
required vars are validated even when the TTS service itself is down — the
backend fails to boot without them, so fill `backend/.env` before starting.

### Optional Variables (have safe defaults)

| Variable | Default | Purpose |
|----------|---------|---------|
| `MAX_HISTORY_ROUNDS` | `6` | How many prior text rounds the backend will accept/forward (cost control). |
| `MAX_IMAGE_BYTES` | `2_000_000` | Reject oversized screenshots before calling the model. |
| `REQUEST_TIMEOUT_SECONDS` | `60` | Upstream call timeout. |
| `CORS_ALLOW_ORIGINS` | `http://localhost:5173` | Vite dev origin(s). Comma-separated. Do not use `*`. |

---

## GPT-SoVITS TTS Integration

`/api/tts` proxies a local **GPT-SoVITS `api_v2.py`** REST service (the `POST /tts`
contract — `text_lang`/`prompt_lang`/`media_type=wav`/`streaming_mode=false`).
Answers are Japanese, so both langs default to `ja`. Config splits into three
groups, all optional with safe defaults except the two required vars above.

| Variable | Default | Purpose |
|----------|---------|---------|
| `GPT_SOVITS_BASE_URL` | `http://127.0.0.1:9880` | Where the `/tts` client connects. Use `base_url` + `client.post("/tts")` to avoid a `//tts` double slash. |
| `GPT_SOVITS_PROMPT_LANG` / `GPT_SOVITS_TEXT_LANG` | `ja` | Reference + synthesis language. |
| `GPT_SOVITS_TEXT_SPLIT_METHOD` | `cut0` | `cut0` = "no split"; the backend sends one whole answer per request. |
| `GPT_SOVITS_TIMEOUT_SECONDS` | `60` | `/tts` call timeout (cold start + full-answer synth can be slow). Positive int. |

**Audio post-filter** (applied to the returned WAV in `services/audio_filter.py`):
`GPT_SOVITS_AUDIO_FILTER_ENABLED` (`true`), `GPT_SOVITS_NOISE_GATE_THRESHOLD_DB`
(`-45`), `GPT_SOVITS_NOISE_GATE_ATTENUATION` (`0.2`), `GPT_SOVITS_HIGHPASS_HZ`
(`70`), `GPT_SOVITS_LOWPASS_HZ` (`9000`). The four numeric ones are validated as
finite floats.

**Auto-start (the backend may manage a local `api_v2.py` subprocess).** When
`GPT_SOVITS_AUTO_START=true`, startup probes `GPT_SOVITS_BASE_URL/openapi.json`;
if unreachable it launches `api_v2.py` and, once ready, applies weights via
`GET /set_gpt_weights` + `GET /set_sovits_weights`. See
[directory-structure.md](./directory-structure.md) → `services/gpt_sovits_runtime.py`
for the lifecycle. Keys: `GPT_SOVITS_ROOT_DIR`, `GPT_SOVITS_PYTHON_PATH`,
`GPT_SOVITS_API_SCRIPT` (`api_v2.py`), `GPT_SOVITS_API_CONFIG`,
`GPT_SOVITS_API_HOST` (`127.0.0.1`), `GPT_SOVITS_API_PORT` (`9880`),
`GPT_SOVITS_STARTUP_TIMEOUT_SECONDS` (`120`), `GPT_SOVITS_PROBE_TIMEOUT_SECONDS`
(`2`), `GPT_SOVITS_GPT_WEIGHTS_PATH`, `GPT_SOVITS_SOVITS_WEIGHTS_PATH`.

> **Gotcha**: auto-start only manages the process when `GPT_SOVITS_BASE_URL`'s
> host/port match `GPT_SOVITS_API_HOST`/`PORT` (it won't kill a process it didn't
> spawn). Default `GPT_SOVITS_AUTO_START=false` — if the service is down the
> backend still boots and `/api/tts` fails per-request (see
> [error-handling.md](./error-handling.md)); the Japanese **text** answer is
> unaffected and never falls back to a browser voice.

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
              "(需要 OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL / "
              "GPT_SOVITS_REF_AUDIO_PATH / GPT_SOVITS_PROMPT_TEXT)。",
              file=sys.stderr)
        raise SystemExit(1) from exc
```

Call `validate_config()` from the FastAPI lifespan/startup so `uvicorn` fails
immediately with a readable error. See [error-handling.md](./error-handling.md)
for how this differs from per-request errors.

---

## API Key Protection (hard rules)

- The key lives in `.env` and `Settings` only. It is **never** put into a
  response body, an SSE frame, a log line, or an error message. The same applies
  to `GPT_SOVITS_REF_AUDIO_PATH` and `GPT_SOVITS_PROMPT_TEXT` (local paths /
  reference transcript) — keep them out of logs and responses.
- `.env` is gitignored; commit `.env.example` with placeholder values instead.
- The frontend never receives the key, base URL, or model name — it only talks
  to `/api/chat` and `/api/tts`.

---

## Common Mistakes

- Reading `os.getenv("OPENAI_API_KEY")` inline instead of via `get_settings()` —
  bypasses validation and typing.
- Giving a required var a default (e.g. `openai_model: str = ""`) — hides the
  missing-config failure until a confusing runtime error.
- Echoing the offending value in the startup error — leaks secrets to the console/logs.
- Using `CORS_ALLOW_ORIGINS="*"` — this endpoint streams model output; keep it pinned to the dev origin.
