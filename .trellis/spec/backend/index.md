# Backend Development Guidelines

> FastAPI backend for the AI vision-chat web app. The backend protects the
> OpenAI-compatible API key, validates config at startup, and proxies a single
> multimodal chat call back to the browser as a Server-Sent Events (SSE) stream.
> It is **stateless and persistence-free**: no database, no files, no caching of
> images, audio, or conversations.

---

## Architecture at a Glance

```
Browser ──POST /api/chat (text + 1 screenshot + last 6 rounds)──▶ FastAPI
FastAPI ──multimodal chat.completions(stream=True)──▶ OpenAI-compatible model
FastAPI ──SSE: data:{delta} … event:done / event:error──▶ Browser

Browser ──POST /api/tts {text} (full Japanese answer)──▶ FastAPI
FastAPI ──POST /tts (httpx)──▶ local GPT-SoVITS api_v2.py
FastAPI ──audio/wav body (or 502 {message})──▶ Browser
```

- Runtime: Python + FastAPI (ASGI), run with `uvicorn app.main:app`.
- LLM access: `openai` SDK `AsyncOpenAI` pointed at `OPENAI_BASE_URL`.
- TTS access: `httpx.AsyncClient` → local GPT-SoVITS `api_v2.py` `POST /tts`
  (answers are Japanese; `text_lang=prompt_lang=ja`). Optionally auto-starts that
  subprocess at boot (see [Configuration](./configuration.md)).
- Streaming: `sse-starlette` `EventSourceResponse`.
- Config: `pydantic-settings`, validated **fail-fast** at startup.
- Dependency tooling: `venv` + `requirements.txt`.

---

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | Layered-lite module layout (`app/main.py`, `config.py`, `routes/`, `services/`, `schemas.py`) |
| [Configuration](./configuration.md) | `.env` vars (incl. GPT-SoVITS TTS + auto-start), `pydantic-settings`, required-var validation, API key protection |
| [LLM & Streaming](./llm-streaming.md) | `AsyncOpenAI` client, multimodal message build, `/api/chat` SSE contract, cost controls |
| [Error Handling](./error-handling.md) | Startup fail-fast, in-stream `event: error` (`/api/chat`), `/api/tts` 502 + `{message}`, OpenAI + httpx exception → zh-CN mapping |
| [Logging Guidelines](./logging-guidelines.md) | stdlib logging, levels, and what must never be logged (secrets, image bytes, conversation content) |
| [Quality Guidelines](./quality-guidelines.md) | ruff, type hints, pytest, async correctness, forbidden/required patterns |

> **Not applicable**: there is no `database-guidelines.md`. This service has no
> persistence layer (see [LLM & Streaming](./llm-streaming.md) → "No persistence").
> If a datastore is ever introduced, add the file back and update this index.

---

## Non-Negotiables (project-specific)

1. The API key never leaves the backend — not in responses, not in logs, not in errors.
2. The streaming endpoint is `async` and uses `AsyncOpenAI`; never block the event loop with the sync client.
3. Nothing user-supplied is persisted — no DB rows, no image/audio files, no conversation transcripts on disk.
4. Required env vars are validated at startup; a missing var aborts boot with a clear zh-CN console message.
5. The SSE wire format in [LLM & Streaming](./llm-streaming.md) is a contract shared with the frontend — change both sides together (see `guides/cross-layer-thinking-guide.md`).

---

**Language**: Spec docs are written in **English**. Runtime user-facing strings
(errors surfaced to the browser) are **Simplified Chinese** per `plan.md`.
