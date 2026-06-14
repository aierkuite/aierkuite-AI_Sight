# Directory Structure

> How the FastAPI backend is organized. Layout: **layered-lite** — thin routes,
> a service that owns the LLM call, one schema module as the IO contract.

---

## Repo Position

The backend is a sibling of the frontend at the repo root:

```
G:\qiniuyun\
├── plan.md
├── frontend/        # Vite + React + TypeScript SPA (see ../frontend spec)
└── backend/         # this layer
```

---

## Directory Layout

```
backend/
├── .env                 # local secrets — gitignored, NEVER committed
├── .env.example         # documents required vars with placeholder values
├── requirements.txt     # pinned dependencies
├── app/
│   ├── __init__.py
│   ├── main.py          # app factory, startup config validation, logging + CORS, router include
│   ├── config.py        # Settings (pydantic-settings) + cached get_settings()
│   ├── schemas.py       # Pydantic models: ChatRequest, HistoryTurn, SSE event payloads
│   ├── errors.py        # AppError hierarchy + OpenAI-exception → zh-CN message mapping
│   ├── routes/
│   │   ├── __init__.py
│   │   └── chat.py      # POST /api/chat — validate request, return EventSourceResponse
│   └── services/
│       ├── __init__.py
│       └── llm.py       # AsyncOpenAI client, multimodal message build, async stream generator
└── tests/
    ├── test_config.py   # missing required var → startup fails
    └── test_chat.py     # /api/chat happy path (mocked AsyncOpenAI) + error mapping
```

Start with this set. Add a module only when a real responsibility appears
(e.g. a second route → keep it in `routes/`; a non-LLM integration → new
`services/<name>.py`). Do not pre-create empty packages.

---

## Layer Responsibilities

| Layer | Owns | Must NOT do |
|-------|------|-------------|
| `routes/` | Parse + validate the HTTP request, pick the response type, delegate | Build provider payloads, call the model directly, format provider errors |
| `services/` | The `AsyncOpenAI` client, multimodal message assembly, the streaming generator, mapping upstream failures to domain errors | Read `request`/`Response` objects, know about FastAPI |
| `schemas.py` | The single definition of every request/response/event shape | Contain logic beyond validators |
| `config.py` | Load + validate env, expose typed settings | Be imported for side effects; read `os.environ` elsewhere |
| `errors.py` | Domain exceptions + `to_user_message()` (zh-CN, secret-free) | Import FastAPI or routes |

The rule of thumb: a route function should read like *validate → call a service
→ stream the result*. If a route is constructing `image_url` dicts or catching
`openai.AuthenticationError`, that logic belongs in `services/llm.py` /
`errors.py`.

---

## Naming Conventions

- Modules and functions: `snake_case`. Pydantic models / exceptions: `PascalCase`.
- One async generator per streaming source, named `stream_*` (e.g. `stream_chat`).
- Settings accessor is `get_settings()` (cached); never instantiate `Settings()` ad hoc.
- Route handlers are `async def` and live under `app/routes/`; include them in
  `main.py` via `app.include_router(...)` with the `/api` prefix.

---

## Reference Files (conventions defined here, code follows)

- App wiring + startup validation: `backend/app/main.py`
- The `/api/chat` contract: `backend/app/routes/chat.py` + [`llm-streaming.md`](./llm-streaming.md)
- The LLM call and SSE generator: `backend/app/services/llm.py`
