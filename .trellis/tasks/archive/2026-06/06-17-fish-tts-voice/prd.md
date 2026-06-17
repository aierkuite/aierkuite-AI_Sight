# 用 Fish Audio TTS 替换浏览器播报音色

## Goal

把"念 AI 回答"的播报音色，从浏览器内置 `window.speechSynthesis`（系统默认中文嗓音）整段替换为 **Fish Audio TTS** 的指定持久音色（一个 `reference_id`，由开发者填入 `backend/.env`）。保持现有"逐句早播"体验：LLM 流式吐字 → 前端凑齐一句 → 经后端 `/api/tts` 代理调用 Fish Audio 合成该句 mp3 → 前端按句序排队播放。Fish Audio Key 只存在后端。失败时明确报错、本次不播音（不静默降级到浏览器嗓音），与项目"不做 Mock 降级、异常明确报错"的既有哲学一致。

完整原始计划见仓库根 [`plan-custom-voice.md`](../../../plan-custom-voice.md)。

## Requirements

- 后端新增 `/api/tts`：接收 `{text}`，返回 `audio/mpeg` 二进制；失败返回非 200 + `{"message": "<安全中文>"}`（与 `/api/chat` 错误形状对齐）。
- Fish Audio 经官方 `fish-audio-sdk`（`fishaudio.AsyncFishAudio` 异步客户端）调用；**单例 client 复用连接池**，应用 `lifespan` shutdown 统一关闭。
- 配置：`FISH_API_KEY`、`FISH_REFERENCE_ID` **启动即必填**（fail-fast，与 `OPENAI_*` 一致）；`FISH_MODEL`（可选，空=SDK 默认 `s2-pro`）、`FISH_LATENCY`（`Literal["normal","balanced"]`，默认 `balanced`）、`FISH_TIMEOUT_SECONDS`（正整数，默认 30）。
- Key/reference_id **不硬编码**，只走 env。错误信息不泄露 Key/原始错误/内部路径。
- 前端：删除 `useSpeechSynthesis`（浏览器 TTS），新增 `useVoicePlayback`（单个常驻 `HTMLAudioElement` 顺序播放 + pending 文本 FIFO + `pump()` 限流，`MAX_PREFETCH≈2`）。
- 保持对外接口核心语义 `{ supported, speaking, speak, flush, cancel }` 不变，新增 `error: string | null`，让 `App.tsx` 接线改动最小。
- 打断：新增 `handleAbort()` = `chat.abort()` + `speaker.cancel()`，并把"停止回答"按钮从 `chat.abort` 改成 `handleAbort`（修复旧播报不停的问题）。
- AbortError 不报错：fetch/播放 catch 先判 `error instanceof DOMException && error.name==="AbortError"`（镜像 `useChatStream.isAbortError`），主动取消不设 `error`、不算失败。
- 失败仅本轮一次：`failedRef` 置位后停掉本轮后续 TTS，下一轮 `cancel()` 复位（`App` 的 `handleStartTalking`/`handleSubmit` 已调 `cancel()`）。

## Acceptance Criteria

- [ ] 播报音色为 Fish Audio 指定 `reference_id`，浏览器默认嗓音彻底不再出现在播报路径。
- [ ] 逐句早播生效（约第一句即开口）、句序正确、可打断。
- [ ] 失败明确报错、不降级、文字回答不受影响、不泄露 Key/内部细节。
- [ ] 同时在途 TTS fetch 数 ≤ `MAX_PREFETCH`（pending 队列 + pump 真正限流）。
- [ ] 氛围音（SoundToggle）与语音识别输入不受影响。
- [ ] 后端 `ruff check` + `pytest` 全绿；前端 `npm run lint` + `test` + `build` 全绿。
- [ ] 本人现场试听通过（提交前暂停）。

## Definition of Done

- 上述 Acceptance Criteria 全部满足。
- 新增/更新测试：`test_tts.py`、`test_config.py`/`test_chat.py` 的必填项修复、前端 `sentences.test.ts` / `ttsClient.test.ts` / `useVoicePlayback.test.tsx`。
- 提交前由开发者本人启动应用现场试听确认（本项目对"声音/视觉"硬性要求）。

## Technical Approach

后端链路：`/api/tts` 路由 → `schemas.TtsRequest`（`text` 1–2000、strip 非空、`extra="forbid"`）→ `services/tts.py::synthesize_mp3(text) -> bytes`（单例 `AsyncFishAudio` + `tts.convert(...)`）→ 成功 `Response(audio, media_type="audio/mpeg")`，失败 `JSONResponse(502, {"message": to_user_message(exc)})`。`config.py` 加 Fish 字段 + 验证器，`main.py` 注册路由 + `FIELD_TO_ENV` + lifespan shutdown 关闭 client，`errors.py` 追加 Fish 异常映射。

前端链路：`onDelta=speaker.speak` 累计 buffer → `lib/sentences.ts::takeSpeakableParts` 切句 → push 进 `pendingRef` → `pump()` 在 `inFlight < MAX_PREFETCH` 时取文本起 fetch（`lib/ttsClient.ts::fetchSentenceAudio` 带 `AbortSignal`）→ 播放循环按句序 await Blob → `HTMLAudioElement` 播放 → ended → 出队 → pump 补位。

## Decision (ADR-lite)

**Context**: 需替换播报音色为可控的指定音色，且 Key 不能进前端、失败不能降级。
**Decision**: 用 Fish Audio 官方 SDK 的新版 `fishaudio.AsyncFishAudio`，全部走后端 `/api/tts` 代理；逐句早播 + 前端 prefetch≤2 限流；失败明确报错不降级。
**Consequences**: 逐句 = 多次请求（prefetch 上限 + text≤2000 控量）；句间可能有间隙（`latency="balanced"` 缓解，后续可升级 WebAudio 拼接/websocket 实时通道，本期不做）。

## Research References

- [`research/fish-audio-sdk-api.md`](research/fish-audio-sdk-api.md) — 实测 `fish-audio-sdk` v1.3.0 源码：计划的 SDK API 基本正确。

### 计划的修正点（来自研究，实施时务必应用）

1. **关闭方法**：`AsyncFishAudio` 只有 `await client.close()`，**没有 `aclose()`**。`services/tts.py::close_tts_client` 用 `close()`（计划里写的 `aclose()` 是唯一真 bug）。
2. **异常捕获**：`fishaudio.exceptions` 的 `AuthenticationError/RateLimitError/ValidationError/FishAudioError` 均可导入；但 HTTP 4xx 校验错误**不会**抛 `ValidationError`（会变成 `APIError`/`FishAudioError`）。以 `FishAudioError` 作兜底分支即可覆盖（计划已有该兜底，保留 `ValidationError` 分支无害）。
3. **`convert()` 返回 `bytes`**（实测正确，非流式 chunk）；`_coerce_bytes` 兜底可保留为防御，但通常用不上。
4. **构造参数 keyword-only**：`AsyncFishAudio(*, api_key=..., timeout=..., base_url=...)`——计划用 kwargs，正确。
5. **`model`** 是 `convert()` 的调用级 kwarg，默认 `s2-pro`；`FISH_MODEL` 为空就不传，用 SDK 默认。
6. **Python 3.14.2 Windows 可直接装**：`ormsgpack` 1.12.2 / `pydantic-core` 2.47.0 均有 cp314 win_amd64 wheel，无需 Rust 构建。**兜底 httpx 方案本期无需启用**（除非安装意外失败）。

## Out of Scope

- 应用内多音色切换 UI、音色管理。
- 声音克隆流程（已有 reference_id）。
- WebAudio 无缝拼接 / `stream_websocket` 实时通道（后续可选增强）。
- 氛围音、语音识别、3D 场景相关改动。

## Technical Notes

- 实施阶段为 **inline**（主会话直接改代码，不派 trellis-implement/trellis-check 子代理）；故 `implement.jsonl`/`check.jsonl` 仅作"本次须遵循的 spec 选读清单"，实际由主会话在 Phase 2 亲自 `Read`。
- 目标解释器：`backend/.venv/Scripts/python.exe`（Python 3.14.2）；`pip install "fish-audio-sdk"` 后用 `python -c "import fishaudio"` 验证。
- ⚠️ **`.env` 现状**：当前 `backend/.env` **缺 `FISH_API_KEY` / `FISH_REFERENCE_ID` 两行**（与"已填入"的说法不符）。代码与测试不受影响（测试 monkeypatch 注入假值），但**现场试听前开发者必须补填这两行**，否则后端 fail-fast 启动失败。
- 现有代码已核对：`config.py`（strip/positive-int 验证器风格）、`main.py`（`FIELD_TO_ENV`/`validation_error_fields`/lifespan）、`schemas.py`（`extra="forbid"`+strip 验证器）、`errors.py`（`to_user_message` 分支顺序）、`App.tsx`（停止回答按钮 `:222`、`errors` useMemo `:82`）、`useChatStream.ts`（`isAbortError` `:19`）。

## 实施顺序（inline）

1. 后端：装 SDK 并验证导入 → `config.py` → `.env.example` → `schemas.py` → `services/tts.py`（单例 + `close_tts_client` 用 `close()`）→ `errors.py` → `routes/tts.py` → `main.py`（注册 + lifespan shutdown）→ 修 `test_chat.py`/`test_config.py` 必填项 → 加 `test_tts.py` + 配置失败用例 → `ruff` + `pytest`。
2. 前端：`constants.ts` → `lib/sentences.ts`（迁移）→ `lib/ttsClient.ts` → `hooks/useVoicePlayback.ts` → 改 `App.tsx`（接线 + `handleAbort` + 错误并入 `errors`）→ 删 `useSpeechSynthesis.ts` → 加测试 → `lint`+`test`+`build`。
3. 端到端：暂停交付，开发者本人现场试听（先补 `.env` 两行）。
