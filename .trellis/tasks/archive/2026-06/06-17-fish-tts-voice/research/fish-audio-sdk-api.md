# Research: fish-audio-sdk real Python API (v1.3.0)

- **Query**: Verify the actual `fish-audio-sdk` Python API vs. the plan's assumptions; raw HTTP fallback; Python 3.14 Windows compatibility.
- **Scope**: external (PyPI metadata + published wheel source inspection + GitHub repo)
- **Date**: 2026-06-17

## TL;DR

The plan is **mostly correct**, against everyone's expectation. PyPI package `fish-audio-sdk` **v1.3.0** ships **two** importable top-level packages in the *same* wheel:

- `fishaudio` — the **new** SDK: `FishAudio` / `AsyncFishAudio` (this is what the plan targets, and it is real).
- `fish_audio_sdk` — the **classic** SDK: `Session` / `AsyncWebSocketSession` (legacy API).

So `from fishaudio import AsyncFishAudio` and `from fishaudio.types import TTSConfig` are **valid in 1.3.0**. There is exactly **one real bug** in the plan: cleanup is `await client.close()`, **not** `await client.aclose()`.

Python 3.14.2 on Windows is **fine** — all native deps have `cp314-win_amd64` wheels; no source build needed.

Authoritative sources:
- PyPI JSON API: `https://pypi.org/pypi/fish-audio-sdk/json`
- Published wheel `fish_audio_sdk-1.3.0-py3-none-any.whl` (source read directly from the wheel)
- Repo: `https://github.com/fishaudio/fish-audio-python`

---

## Findings (answering each question)

### 1. Exact import & public classes
- Install name: **`fish-audio-sdk`**. Import name: **`fishaudio`** (new API) AND **`fish_audio_sdk`** (classic API). Both are packaged in the 1.3.0 wheel (`pyproject.toml`: `packages = ["src/fishaudio", "src/fish_audio_sdk"]`).
- `fishaudio` top-level exports (`fishaudio/__init__.py`):
  - Clients: **`FishAudio`**, **`AsyncFishAudio`** ✅ (yes, `AsyncFishAudio` exists)
  - Config/types: `TTSConfig`, `ReferenceAudio`, `WebSocketOptions`, `TextEvent`, `FlushEvent`
  - Streams: `AudioStream`, `AsyncAudioStream`
  - Utils: `play`, `save`, `stream`
  - Exceptions: `FishAudioError`, `APIError`, `AuthenticationError`, `PermissionError`, `NotFoundError`, `RateLimitError`, `ServerError`, `WebSocketError`, `ValidationError`, `DependencyError`
- The classic `fish_audio_sdk` exports `Session`, `WebSocketSession`, `AsyncWebSocketSession`, `TTSRequest`, `HttpCodeErr`, etc. **There is NO `Session`/`AsyncSession` in the new `fishaudio` package** — those belong to the classic package. There IS `AsyncFishAudio` (the async client the plan uses).

### 2. Async client construction
`AsyncFishAudio.__init__` (`fishaudio/client.py`) — **all keyword-only** (note the `*`):
```python
AsyncFishAudio(
    *,
    api_key: Optional[str] = None,          # falls back to FISH_API_KEY env var
    base_url: str = "https://api.fish.audio",
    timeout: float = 240.0,                  # seconds
    httpx_client: Optional[httpx.AsyncClient] = None,
)
```
- `api_key` is **keyword-only**, NOT positional. If omitted, it reads `FISH_API_KEY`; if still empty it raises `ValueError`.
- `timeout` and `base_url` are kwargs. ✅ The plan's `AsyncFishAudio(api_key=..., timeout=...)` is correct.

### 3. Synthesize one sentence to mp3 with a persistent voice `reference_id`
Use `client.tts.convert(...)`. Signature (`AsyncTTSClient.convert`, `fishaudio/resources/tts.py`):
```python
async def convert(
    self,
    *,
    text: str,
    reference_id: Optional[str] = None,      # voice model ID (overrides config.reference_id)
    references: Optional[list[ReferenceAudio]] = None,
    format: Optional[AudioFormat] = None,    # "mp3" | "wav" | "pcm" | "opus"
    latency: Optional[LatencyMode] = None,   # "normal" | "balanced"  (NOT "low")
    speed: Optional[float] = None,
    config: TTSConfig = TTSConfig(),
    model: Model = "s2-pro",                 # "speech-1.5"|"speech-1.6"(deprecated)|"s1"|"s2-pro"
    request_options: Optional[RequestOptions] = None,
) -> bytes
```
- Request model class is **`TTSRequest`** (`fishaudio.types.TTSRequest`), but you normally don't build it yourself for HTTP — you pass `TTSConfig` + direct kwargs. Direct kwargs (`reference_id`, `format`, `latency`, `speed`) **override** the matching `config` fields.
- `TTSConfig` fields (defaults): `format="mp3"`, `mp3_bitrate∈{64,128,192}=128`, `opus_bitrate∈{-1000,24,32,48,64}=32`, `sample_rate=None`, `normalize=True`, `chunk_length∈[100,300]=200`, `latency="balanced"`, `reference_id=None`, `references=[]`, `prosody=None`, `top_p=0.7`, `temperature=0.7`, `max_new_tokens=1024`, `repetition_penalty=1.2`, `min_chunk_length=50`, `condition_on_previous_chunks=True`, `early_stop_threshold=1.0`.
- Exact call (matches the plan, both forms work):
```python
audio: bytes = await client.tts.convert(
    text="Hello.",
    reference_id="802e3bc2b27e49c2995d23ef70e6ac89",
    format="mp3",
    latency="balanced",
    model="s2-pro",
)
# equivalently via config:
audio = await client.tts.convert(
    text="Hello.",
    config=TTSConfig(reference_id="...", format="mp3", latency="balanced", mp3_bitrate=128),
)
```

### 4. CRITICAL — does the async TTS call return bytes or stream?
**Both methods exist; pick the right one:**
- **`await client.tts.convert(...) -> bytes`** — it IS an `async` coroutine that returns the **full mp3 `bytes`**. Internally it does `stream = await self.stream(...); return await stream.collect()`. ✅ The plan's `audio = await client.tts.convert(...)` returning `bytes` is **correct**. (The hypothesis that `convert` streams is wrong.)
- **`await client.tts.stream(...) -> AsyncAudioStream`** — returns a stream wrapper. You must `await` the call first, THEN async-iterate or `.collect()`:
```python
stream = await client.tts.stream(text="Hi", reference_id="...")
async for chunk in stream:        # chunk: bytes
    ...
# or collect:
audio = await (await client.tts.stream(text="Hi")).collect()
```
Note: under the hood `convert`/`stream` do a normal (buffered) httpx request, then iterate `response.aiter_bytes()` — not a true low-latency streamed connection. Fine for one-sentence mp3.

### 5. Closing / cleanup the async client
- **`await client.close()`** — the public method (`fishaudio/client.py`). It internally calls `httpx.AsyncClient.aclose()`.
- **There is NO `client.aclose()` on `AsyncFishAudio`.** ⚠️ This is the plan's one real bug.
- Async context manager is supported and preferred:
```python
async with AsyncFishAudio(api_key=...) as client:
    audio = await client.tts.convert(...)
# auto-closed
```

### 6. Exception classes & import paths
Module: **`fishaudio.exceptions`** (also re-exported from top-level `fishaudio`).
- Hierarchy: `FishAudioError(Exception)` → base.
  - `APIError(FishAudioError)` with `.status`, `.message`, `.body`.
    - `AuthenticationError` (HTTP 401), `PermissionError` (403), `NotFoundError` (404), `RateLimitError` (429), `ServerError` (5xx).
  - `WebSocketError(FishAudioError)`, `ValidationError(FishAudioError)`, `DependencyError(FishAudioError)`.
- HTTP error mapping (`core/client_wrapper.py::_raise_for_status`): status code → specific `APIError` subclass; any other non-2xx → `APIError`. **`ValidationError` is defined but NOT raised by the HTTP path** (don't rely on catching it for 422s — those surface as `APIError`). Catch **`FishAudioError`** to cover everything SDK-raised. ✅ The plan's `from fishaudio.exceptions import AuthenticationError, RateLimitError, ValidationError, FishAudioError` is valid (all importable); just be aware `ValidationError` won't fire for server validation errors.

### 7. Latest version + dependencies
- Latest on PyPI: **1.3.0** (`requires-python >=3.9`).
- Dependencies (`requires_dist`): `httpx>=0.27.2`, `httpx-ws>=0.6.2`, **`ormsgpack>=1.5.0`** (Rust native ext), `pydantic>=2.9.1` (pulls native `pydantic-core`), `typing-extensions>=4.15.0`. Optional `[utils]`: `sounddevice`, `soundfile`.
- Yes, it depends on **`ormsgpack`** (a Rust/PyO3 native extension). The wire format for `/v1/tts` is **msgpack**, not JSON.

### 8. Python 3.14 / Windows compatibility — VERIFIED OK
`pip install fish-audio-sdk` on **Python 3.14.2 Windows** will succeed using prebuilt wheels (no Rust toolchain / no source build):
- `ormsgpack` latest **1.12.2** ships `ormsgpack-1.12.2-cp314-cp314-win_amd64.whl` (and cp314t). ✅
- `pydantic-core` latest **2.47.0** ships `pydantic_core-2.47.0-cp314-cp314-win_amd64.whl`. ✅
- `httpx`, `httpx-ws`, `typing-extensions`, `pydantic` are pure-Python. ✅
- The SDK itself is `py3-none-any` (pure Python).

Caveat: this assumes pip resolves to the **latest** deps (default behavior). Pinning old `ormsgpack==1.5.x` (no cp314 wheel) would force a source build. Don't pin native deps below their first cp314 release. `fish-audio-sdk` itself is even classified for `Python :: 3.14` in its metadata.

---

## Corrections to the plan

| # | Plan assumed | Reality | Verdict |
|---|---|---|---|
| 1 | `from fishaudio import AsyncFishAudio` | Valid — 1.3.0 ships the `fishaudio` package with `AsyncFishAudio`. | ✅ correct |
| 2 | `from fishaudio.types import TTSConfig` | Valid (also `from fishaudio import TTSConfig`). | ✅ correct |
| 3 | `AsyncFishAudio(api_key=..., timeout=...)` | Valid; args are keyword-only; defaults `base_url="https://api.fish.audio"`, `timeout=240.0`. | ✅ correct |
| 4 | `audio = await client.tts.convert(text=..., config=TTSConfig(reference_id=..., format="mp3", latency="balanced"))` returns `bytes` | `convert` is an async coroutine returning full mp3 `bytes`. `latency` must be `"normal"`/`"balanced"`. Default `model="s2-pro"`. | ✅ correct |
| 5 | `await client.aclose()` | **WRONG** — method is **`await client.close()`** (or `async with`). `aclose()` does not exist on `AsyncFishAudio`. | ❌ **fix this** |
| 6 | exceptions from `fishaudio.exceptions` | All importable. But `ValidationError` is **not** raised on HTTP 4xx validation — those become `APIError`. Catch `FishAudioError` broadly. | ⚠️ mostly correct |
| — | (user's worry) package is `fish_audio_sdk`, plan's `fishaudio` is wrong | `fish_audio_sdk` = classic `Session` API; `fishaudio` = new `FishAudio`/`AsyncFishAudio` API. Both in the same wheel. Plan targets the new one correctly. | ℹ️ clarification |
| — | (user's worry) SDK/ormsgpack won't build on py3.14 Win | Prebuilt cp314 win_amd64 wheels exist for ormsgpack 1.12.2 & pydantic-core 2.47.0. Installs cleanly. | ℹ️ no problem |

---

## Recommended canonical implementation

### Primary: SDK, persistent async client + FastAPI lifecycle
```python
# tts_client.py
import os
from fishaudio import AsyncFishAudio, TTSConfig
from fishaudio.exceptions import FishAudioError  # noqa: re-export for callers

_client: AsyncFishAudio | None = None

def get_client() -> AsyncFishAudio:
    global _client
    if _client is None:
        _client = AsyncFishAudio(
            api_key=os.environ["FISH_API_KEY"],
            timeout=60.0,
        )
    return _client

async def synthesize_mp3(text: str, reference_id: str) -> bytes:
    """One sentence -> full mp3 bytes using a persistent voice."""
    client = get_client()
    return await client.tts.convert(
        text=text,
        reference_id=reference_id,
        format="mp3",
        latency="balanced",
        model="s2-pro",
        config=TTSConfig(mp3_bitrate=128),
    )

async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.close()   # NOT aclose()
        _client = None
```
```python
# main.py (FastAPI lifespan)
from contextlib import asynccontextmanager
from fastapi import FastAPI
from tts_client import close_client

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await close_client()

app = FastAPI(lifespan=lifespan)
```
Error mapping in the route:
```python
from fishaudio.exceptions import AuthenticationError, RateLimitError, FishAudioError
try:
    audio = await synthesize_mp3(text, reference_id)
except AuthenticationError:
    ... # 401 -> 502/500, log key problem
except RateLimitError:
    ... # 429 -> 429 passthrough
except FishAudioError as e:
    ... # generic upstream failure -> 502
```

### Fallback: raw HTTP (only if you ever need to drop the SDK)
Endpoint **`POST https://api.fish.audio/v1/tts`**, msgpack body, `model` in a **header**, response is mp3 byte stream:
```python
import httpx, ormsgpack   # or: import msgpack  (pure-Python, no native dep)

async def synthesize_mp3_raw(text: str, reference_id: str, api_key: str) -> bytes:
    payload = {
        "text": text,
        "reference_id": reference_id,
        "format": "mp3",
        "mp3_bitrate": 128,
        "chunk_length": 200,
        "normalize": True,
        "latency": "balanced",
        # "references": [],  # omit when using reference_id
    }
    async with httpx.AsyncClient(base_url="https://api.fish.audio", timeout=60.0) as c:
        chunks: list[bytes] = []
        async with c.stream(
            "POST", "/v1/tts",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/msgpack",
                "model": "s2-pro",          # model goes in the HEADER, not the body
            },
            content=ormsgpack.packb(payload),   # or msgpack.packb(payload, use_bin_type=True)
        ) as r:
            r.raise_for_status()
            async for chunk in r.aiter_bytes():
                if chunk:
                    chunks.append(chunk)
        return b"".join(chunks)
```
Notes on the raw path (from `client_wrapper.py` / classic `apis.py`):
- Auth header: `Authorization: Bearer <api_key>`.
- Body content type: `application/msgpack`; body = msgpack-encoded dict of `TTSRequest` fields (omit `None`).
- `model` header values: `"s1"` or `"s2-pro"` (avoid deprecated `"speech-1.5"`/`"speech-1.6"`).
- Response: streamed mp3 bytes; collect via `aiter_bytes()`.
- If you want a **zero-native-dependency** backend, use the pure-Python `msgpack` package instead of `ormsgpack` for the body — but since ormsgpack installs fine on 3.14 Win, the SDK path is recommended.

## Caveats / Not Found
- Did not fetch `docs.fish.audio` HTML (not needed — source-level truth from the published wheel is more authoritative). The endpoint/header/body facts above come directly from the SDK source that calls the live API.
- `convert`/`stream` use a buffered httpx request internally (not chunked streaming over the wire) despite the name; fine for short single-sentence synthesis, but don't expect true first-byte-latency streaming from the HTTP `stream()` method — use the WebSocket `stream_websocket(...)` API for real-time.
- Default request `timeout` in the SDK is 240s; set lower (e.g. 60s) for a web backend.
