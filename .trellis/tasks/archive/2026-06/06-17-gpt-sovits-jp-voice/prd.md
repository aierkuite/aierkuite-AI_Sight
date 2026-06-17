# GPT-SoVITS 日文语音播报迁移（中文提问 → 日文回答）

## Goal

两件事一起做：

1. **日文回答**：让助手用**日文**回答——用户**提问仍是中文**，但屏幕显示的回答文字和语音播报都是**日文**（已定方案：日文显示 + 日文参考音色，**无翻译层**）。仅改 `backend/app/services/llm.py:8` 的 `SYSTEM_PROMPT` 一处常量。
2. **TTS 迁移**：把当前**未提交**的 Fish Audio TTS 后端实现，整体改为调用本地 **GPT-SoVITS** 服务（`api_v2.py` 风格的 `POST /tts`，`text_lang=ja`、`prompt_lang=ja`、`media_type=wav`、`streaming_mode=false`）。
3. **等待式整段播报体验**：前端不再显示半截流式回答，也不逐句播报；等待完整日文回答生成后，一次性调用 `/api/tts` 合成整段 WAV，音频返回后再显示完整回答并播放。

前端继续调用 `POST /api/tts { text }`，但主流程改为整段文本合成；保留逐句 Blob 排队播放能力作为可回退实现，当前用户体验以“等待完整回答和语音”为准。

完整原始计划见仓库根 [`plan.md`](../../../plan.md)（本任务的权威依据）。本任务**取代** superseded 的 `06-17-fish-tts-voice`（Fish Audio 因后端 HTTP 402 余额不足不可用，且需求改为 GPT-SoVITS 日文播报）。

## Requirements

### 后端 — LLM 回答语言（中文提问 → 日文回答）

- 改 `backend/app/services/llm.py:8` 的 `SYSTEM_PROMPT`：从「用简洁自然的中文回答」改为**强制日文回答**，并显式声明「提问即使是中文，回答也必须是日文」。用日文书写提示以更强引导日文输出，例如：
  ```python
  SYSTEM_PROMPT = (
      "あなたはローカルデモ用の AI ビジュアル対話アシスタントです。"
      "ユーザーの質問と現在の画面に基づき、簡潔で自然な日本語で答えてください。"
      "ユーザーの質問が中国語であっても、回答は必ず日本語にしてください。"
  )
  ```
- **不动** `build_messages` / `stream_chat` 的其它逻辑（混合语种历史：用户中文 + 助手日文，对模型无碍）。
- **前端无需改**：`frontend/src/lib/sentences.ts` 的 `SENTENCE_ENDINGS = {。！？!?\n}` 已覆盖日文句末标点（与中文同码位），日文回答能正常逐句切分；显示层直接渲染模型输出，天然显示日文。

### 后端 — TTS 服务切换（Fish → GPT-SoVITS）

- **移除** `fish-audio-sdk` 依赖（`requirements.txt`），保留现有 `httpx==0.27.2` 作为 GPT-SoVITS HTTP 客户端，**不引入新依赖**。
- `config.py` 替换 Fish 配置为 GPT-SoVITS 字段：
  - `gpt_sovits_base_url`：默认 `http://127.0.0.1:9880`，`Field(min_length=1)`
  - `gpt_sovits_ref_audio_path`：**必填**，GPT-SoVITS 进程可访问的**日文**参考音频路径
  - `gpt_sovits_prompt_text`：**必填**，参考音频对应的**日文转写文本**
  - `gpt_sovits_prompt_lang`：默认 `ja`
  - `gpt_sovits_text_lang`：默认 `ja`
  - `gpt_sovits_text_split_method`：默认 `cut0`（前端已逐句切分、每次只发一句，`cut0`「不切」最贴切）
  - `gpt_sovits_timeout_seconds`：默认 `60`，正整数（首句冷启动和整段合成都可能较慢，超时后本轮语音报错）
- **校验器**：6 个字符串字段加入 `strip_non_empty`（删掉所有 `fish_*`）；`gpt_sovits_timeout_seconds` 加入 `require_positive_int`。可选用 `typing.Literal` 约束两个 lang 字段为 GPT-SoVITS 支持语种集（`ja/zh/en/ko/yue/auto/...`）。
- `main.py`：`FIELD_TO_ENV` 删 5 个 `fish_*` 映射、新增 `gpt_sovits_*` → `GPT_SOVITS_*`；`validation_error_fields` 兜底列表把 `FISH_API_KEY`/`FISH_REFERENCE_ID` 换成 `GPT_SOVITS_REF_AUDIO_PATH`/`GPT_SOVITS_PROMPT_TEXT`；必填项 = `OPENAI_*` 三项 + `GPT_SOVITS_REF_AUDIO_PATH` + `GPT_SOVITS_PROMPT_TEXT`；启动时先校验配置，然后在 `GPT_SOVITS_AUTO_START=true` 时确保 `api_v2.py` REST 服务可用，必要时按配置启动本机进程并设置 GPT/SoVITS 权重；`lifespan` shutdown 关闭 TTS client，并停止由后端托管启动的子进程。
- **重写** `services/tts.py`：
  - 单例 `httpx.AsyncClient`，惰性创建（首次请求时、事件循环内），`base_url=settings.gpt_sovits_base_url`、`timeout=settings.gpt_sovits_timeout_seconds`；用 `base_url` + `client.post("/tts", json=...)` 规避尾斜杠拼成 `//tts`。
  - `close_tts_client()` 内 `await client.aclose()`（httpx 用 `aclose()`）。
  - **删除** `_coerce_bytes`（httpx `response.content` 已是 bytes）。
  - 改名 `synthesize_mp3` → `synthesize_audio(text: str) -> bytes`。
  - 请求 JSON：`text` / `text_lang`(ja) / `ref_audio_path` / `prompt_text` / `prompt_lang`(ja) / `text_split_method` / `media_type:"wav"` / `streaming_mode:false`。
  - **httpx 异常就地映射成中文 `AppError`**（让 `errors.py` 几乎不用改）：
    - `httpx.TimeoutException` → `AppError("语音合成服务响应超时，请稍后再试")`
    - `httpx.ConnectError`（未启动/连接被拒）→ `AppError("无法连接语音合成服务，请确认 GPT-SoVITS 已启动")`
    - `response.raise_for_status()` 抛 `httpx.HTTPStatusError` → `AppError("语音合成服务返回错误，请稍后再试")`（不回传上游响应体）
- `routes/tts.py`：import 改 `synthesize_audio`；成功返回 `Response(content=audio, media_type="audio/wav")`；失败保持 `except Exception` → `502 + {"message": to_user_message(exc)}`。
- `errors.py`：删 `from fishaudio.exceptions import ...` 和 5 个 Fish 分支；**无需新增分支**——已有 `AppError → str(exc)` 透传，服务层抛的中文 `AppError` 直接生效；OpenAI 分支不动。
- `.env.example`：删 `FISH_*`，新增 `GPT_SOVITS_*`（必填项放 Required 区并注释「日文参考音频/日文转写」；其余放 Optional 区，`GPT_SOVITS_TEXT_LANG=ja`、`GPT_SOVITS_PROMPT_LANG=ja`）；**不提交真实参考音频、本机私有路径、密钥**。

### 前端 — 等待式整段语音体验

- `App.tsx` 主流程：`chat.send()` 仍读取 SSE 完整回答，但不把 delta 逐字显示，也不把 delta 逐句送入 TTS；完整回答返回后调用 `speaker.speakAll(answer, revealAnswer)`。
- `useVoicePlayback.ts` 保留逐句 `speak`/`flush` 能力，同时新增 `speakAll(text, onAudioReady)`：整段文本合成成一个 WAV Blob，音频生成完成后触发显示回调并播放。
- `AnswerView.tsx` 等待期间显示“正在生成完整回答和语音，请稍候”；音频准备好前不显示半截回答。
- `ttsClient.ts` 注释从单句/mp3 改为通用文本/wav。
- 取消/停止：`handleAbort()` 同时中止聊天流和当前语音流程，避免旧请求完成后把回答显示出来。

## Acceptance Criteria

- [ ] 中文提问下，屏幕显示的回答为**日文**、语音播报为**日文**且为 GPT-SoVITS 目标音色（不再是系统默认嗓音）。
- [ ] 代码不再 `import fishaudio`；`requirements.txt` 不再含 `fish-audio-sdk`；后端不再要求 `FISH_API_KEY`/`FISH_REFERENCE_ID`。
- [ ] `/api/tts` 成功响应为 `audio/wav`。
- [ ] GPT-SoVITS 未启动时后端仍能启动；调 `/api/tts` 时前端显示安全中文错误，日文**文字**回答不受影响、不回退默认嗓音。
- [ ] 后端启动时可按 `.env` 自动拉起本机 GPT-SoVITS `api_v2.py`，并自动设置 GPT/SoVITS 权重。
- [ ] 前端在完整回答和整段语音生成完成前保持等待提示，不显示半截回答；WAV 返回后一次性显示完整日文回答并播放；等待期间可停止当前流程。
- [ ] `.env.example` 明确展示 GPT-SoVITS 必填与可选配置（含 `TEXT_LANG=ja`/`PROMPT_LANG=ja` 与「日文参考音频」注释）。
- [ ] 后端 `ruff check .` + `ruff format --check .` + `pytest` 全绿；前端 `lint` + `test` + `build` 全绿。
- [ ] 不提交真实参考音频、真实本机私有路径、密钥或模型权重。
- [ ] **本人现场试听通过**（中文提问→日文显示+日文语音、音色正确、句序、可打断、失败有错误条）。

## Definition of Done

- 上述 Acceptance Criteria 全部满足。
- 测试按 plan.md Test Plan 点名位置更新（见下「Test Plan」），新增 `build_messages` 系统提示含「日本語」断言，且确认现有 trims-history 用例仍绿。
- 提交前由开发者本人现场试听确认（本项目对「声音/视觉」硬性要求，不只看截图/日志/绿测）。

## Technical Approach

后端 TTS 链路：`/api/tts` 路由 → `schemas.TtsRequest`（`text` 1–2000、strip 非空、`extra="forbid"`，**不变**）→ `services/tts.py::synthesize_audio(text) -> bytes`（单例 `httpx.AsyncClient(base_url=...)` + `client.post("/tts", json=...)` + `raise_for_status()`，httpx 异常就地映射成中文 `AppError`）→ 成功 `Response(audio, media_type="audio/wav")`，失败 `JSONResponse(502, {"message": to_user_message(exc)})`。`config.py` 换 GPT-SoVITS 字段 + 验证器，`main.py` 改 `FIELD_TO_ENV`/兜底字段/lifespan shutdown，`errors.py` 删 Fish import 与分支。

LLM 链路：仅改 `llm.py` 的 `SYSTEM_PROMPT` 常量为强制日文；`build_messages`/`stream_chat` 不动。

## Decision (ADR-lite)

**Context**: Fish Audio 后端余额不足（HTTP 402）不可用；需求改为本地 GPT-SoVITS 播报，并让回答为日文（日文音色配日文文本最自然）。
**Decision**: 回答语言靠 `SYSTEM_PROMPT` 引导日文（无翻译层）；TTS 用 GPT-SoVITS `api_v2.py` 的 `POST /tts`（`text_lang=ja`/`prompt_lang=ja`），经现有 `httpx` 单例客户端直连，httpx 异常就地映射中文 `AppError`；失败明确报错不降级，与项目既有哲学一致。
**Consequences**: 依赖小米 MiMo 的日文能力（偶发中文夹杂风险，见 Risks）；冷启动和整段合成等待集中 → `timeout=60` + 演示前预热；WAV 未压缩但 localhost 无碍。

## Test Plan（点名到具体位置，避免采集期 ImportError 或全红）

### Backend

- **`tests/test_chat.py`**：
  - 新增用例断言 `build_messages(...)[0]["content"]` 含「日本語」（锁定回答语言指令）。
  - 确认现有 `test_build_messages_trims_history_and_attaches_current_image_only` **仍绿**（只改 `SYSTEM_PROMPT` 文本、不增删消息，条数 14 与 `messages[1]` 不变）。
  - FISH setenv 有**两处**——`client` fixture 与 `test_stream_chat_reads_async_openai_deltas` 内联——都换成 `GPT_SOVITS_*`。
- **`tests/test_tts.py`**：
  - **删 `from fishaudio.exceptions import ...`**（卸掉 SDK 后会让模块采集期 `ImportError`）。
  - `client` fixture 的 `FISH_*` setenv → `GPT_SOVITS_REF_AUDIO_PATH`/`GPT_SOVITS_PROMPT_TEXT`。
  - `monkeypatch.setattr("app.routes.tts.synthesize_mp3", ...)` 共 3 处 → 改名 `synthesize_audio`。
  - 成功用例：fake 返回 `b"RIFFfakewav"`，断言 `200`、`content-type` 含 `audio/wav`、body 一致。
  - 删两个 Fish 错误用例，替换为三个（在 **httpx 层** mock：替换 `app.services.tts` 单例 client / `get_tts_client` 为 fake，使真实服务层映射被覆盖）：
    - 连接失败：fake `post` 抛 `httpx.ConnectError` → `502` + `{"message":"无法连接语音合成服务，请确认 GPT-SoVITS 已启动"}`
    - 超时：fake `post` 抛 `httpx.ReadTimeout` → `502` + `{"message":"语音合成服务响应超时，请稍后再试"}`
    - 非 2xx：fake 返回 `status_code=400` 触发 `raise_for_status()` → `502` + 通用安全中文，且不含上游原始内容
  - 空文本仍 `422`、超 2000 字仍 `422`（不变）。
- **`tests/test_config.py`**：
  - `REQUIRED_ENV` 把 `FISH_*` 换成 `GPT_SOVITS_REF_AUDIO_PATH`/`GPT_SOVITS_PROMPT_TEXT`。
  - `test_get_settings_reads_required_env` 的 `settings.fish_*` 断言 → `settings.gpt_sovits_ref_audio_path == "gpt_sovits_ref_audio_path-value"` 等。
  - `test_validate_config_fails_fast_without_required_env` 隔离 setenv → 换成两个 `GPT_SOVITS_*`。
  - `test_validate_config_fails_fast_without_fish_api_key`（Fish 专属）**整体替换**：缺 `GPT_SOVITS_REF_AUDIO_PATH` 时退出、stderr 含变量名、不泄露密钥/参考文本；缺 `GPT_SOVITS_PROMPT_TEXT` 时退出、不泄露参考音频路径。

### Frontend

- `fetchSentenceAudio`：成功返回 Blob；非 200 读 `{message}` 抛 `TtsError`（行为不变，仅 mime 字符串改 `audio/wav`）。
- `useVoicePlayback`：两句触发两次 `/api/tts` 并顺序播放；`cancel()` 中止在途 fetch 并暂停音频；`AbortError` 不设错误；同一时刻在途 fetch ≤ `MAX_PREFETCH`（行为不变）。
- 可选：给 `takeSpeakableParts` 补一个日文输入用例（如「こんにちは。元気ですか？」切两句），固化日文标点切分。

### 质量门禁

- 后端：`ruff check .`、`ruff format --check .`、`pytest`（在运行后端所用的同一 Python 环境里跑）。
- 前端：`npm run lint`、`npm run test`、`npm run build`。

## Risks & Mitigations

- **模型偶发中文夹杂**：回答混入中文时 TTS 以 `text_lang=ja` 念中文会怪。缓解：`SYSTEM_PROMPT` 强制日文；试听重点关注，必要时迭代提示。
- **整段合成等待时间集中（最关键）**：前端会等完整回答和整段 WAV 都生成后才展示与播放，长回答会让等待时间变长；整段 TTS 失败时本轮无语音并显示错误。缓解：`timeout=60` + 回答保持简洁 + 演示前预热一次合成。
- **api.py / api_v2.py 字段不兼容**：必须确认启动的是 **v2**（v1 用 `refer_wav_path`/`text_language`/`prompt_language`，跑错脚本直接 400）。
- **base_url 尾斜杠**：用 `httpx.AsyncClient(base_url=...)` + `post("/tts")` 规避 `//tts`。

## Out of Scope

- 任何 Fish Audio 依赖/配置/代码/错误映射（**彻底移除**，不保留运行路径）。
- 显式翻译层（本期靠 `SYSTEM_PROMPT` 引导日文）。
- 端到端流式音频播放、WebAudio 无缝拼接、音色选择 UI。
- GPT-SoVITS WebUI 9872 管理、Windows 开机自启动服务、后台服务守护。

## Technical Notes / Assumptions

- **GPT-SoVITS REST API 可由后端自动启动**：`GPT_SOVITS_AUTO_START=true` 时，后端启动会探测 `GPT_SOVITS_BASE_URL`，不可用则按 `GPT_SOVITS_ROOT_DIR` / `GPT_SOVITS_PYTHON_PATH` / `GPT_SOVITS_API_SCRIPT` / `GPT_SOVITS_API_CONFIG` 启动 `api_v2.py`，并通过 `/set_gpt_weights` 与 `/set_sovits_weights` 切到配置权重。WebUI 9872 不由后端管理。
- **使用 v2 接口**（`api_v2.py`），非旧 `api.py`（字段名不同）。
- **假设 GPU 推理**（CPU 整段合成可能等待很久，演示体验不成立）。
- 参考音频路径是 GPT-SoVITS 进程可访问的路径，不要求位于本仓库内。
- ⚠️ **`.env` 现状**：现场试听前开发者必须在 `backend/.env` 填好 `GPT_SOVITS_REF_AUDIO_PATH` 与 `GPT_SOVITS_PROMPT_TEXT`（指向真实日文参考音频与其转写），否则后端 fail-fast 启动失败。代码与测试不受影响（测试 monkeypatch 注入假值）。
- 目标解释器：运行后端 uvicorn 的同一 Python 环境；卸载 `fish-audio-sdk` 后跑 `pytest` 前确认 `tests/test_tts.py` 不再 `import fishaudio`。
- 现有代码已核对：`llm.py:8`（SYSTEM_PROMPT）、当前 Fish 版 `tts.py`（`synthesize_mp3`/`_coerce_bytes`/`close()`）、`config.py` 验证器风格、`main.py`（`FIELD_TO_ENV`/`validation_error_fields`/lifespan）、`errors.py`（`AppError → str(exc)` 透传）。

## 实施顺序（来自 plan.md）

1. LLM 回答语言：改 `llm.py:8` 的 `SYSTEM_PROMPT` 为日文回答。
2. 后端配置层：`config.py`（字段 + 校验器 + timeout=60 + lang 默认 ja）→ `.env.example` → `main.py`（`FIELD_TO_ENV` + 兜底字段列表）。
3. 后端服务层：重写 `services/tts.py`（单例 `httpx.AsyncClient(base_url=...)` + `post("/tts")` + httpx 异常→`AppError` + shutdown 清理 + 删 `_coerce_bytes`）。
4. 后端路由与错误：`routes/tts.py` 改 `synthesize_audio` + `audio/wav`；`errors.py` 删 Fish import 与分支。
5. 后端测试（按 Test Plan 点名位置改）。
6. 前端必要清理（4 处注释/mime 字符串）。
7. 质量门禁：后端 `ruff check .` / `ruff format --check .` / `pytest`；前端 `lint` / `test` / `build`。
8. **暂停**交付本人现场试听验收，通过后再按 Trellis 提交。
