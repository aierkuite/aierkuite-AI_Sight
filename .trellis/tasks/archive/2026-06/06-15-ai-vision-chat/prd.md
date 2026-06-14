# 实现 AI 视觉对话助手 MVP

> 需求来源 `plan.md`；技术决策已在 `.trellis/spec/backend/` 与 `.trellis/spec/frontend/` 锁定，本 PRD 只提炼并引用，不重新讨论。

## Goal

在 `G:\qiniuyun` 根目录交付一个**本地运行**的网页应用：用户在最新版 Chrome/Edge 打开页面，授权摄像头与麦克风后，用中文语音提问；前端在提交时截取当前摄像头画面，连同问题与最近对话发给后端；后端调用 OpenAI-compatible 多模态模型，以 SSE 流式把回答推回浏览器；前端边收边显示并尽早语音播报。面向本地开发与课程展示，**零持久化、不做 Mock 降级**，缺配置或接口异常时明确报错。

## Requirements

### 后端（FastAPI，`backend/`）
- R1 **分层骨架** layered-lite：`app/main.py · config.py · schemas.py · errors.py · routes/chat.py · services/llm.py` + `tests/`，依赖用 `venv` + 固定版本 `requirements.txt`。〔spec: backend/directory-structure.md〕
- R2 **配置 fail-fast**：`pydantic-settings` 读取 `.env`；必填 `OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL`（模型须支持图片输入），缺失则启动即退出并打印清晰中文 stderr，只报字段名不报值；可选项 `MAX_HISTORY_ROUNDS=6 / MAX_IMAGE_BYTES=2_000_000 / REQUEST_TIMEOUT_SECONDS=60 / CORS_ALLOW_ORIGINS=http://localhost:5173`。配置只经 `get_settings()` 读取。〔spec: backend/configuration.md〕
- R3 **`POST /api/chat` SSE 通路**：请求 `{text, image|null(base64 JPEG 无 data: 前缀), history[]}`；响应 `text/event-stream`：token 用 `data:{"delta":"…"}`，正常结束 `event: done`/`data:{}`，失败 `event: error`/`data:{"message":"<中文安全消息>"}`。空 `text` → 422、超 `MAX_IMAGE_BYTES` → 4xx，均在开流前返回。〔spec: backend/llm-streaming.md〕
- R4 **多模态调用**：`AsyncOpenAI` 指向 `OPENAI_BASE_URL`；仅**当前轮**带图（content-parts 数组），历史**纯文本**且发送前裁到最近 `MAX_HISTORY_ROUNDS` 轮，**绝不重发历史图片**；`stream=True` 异步生成器 `stream_chat`。客户端断开时让 `CancelledError` 正常传播以停止上游计费。〔spec: backend/llm-streaming.md〕
- R5 **错误映射**：`errors.py` 的 `to_user_message()` 把 OpenAI 异常映射为安全中文消息（认证/限流/超时/连接/拒绝/兜底）；开流后异常走 `event: error` 而非 HTTP 500。〔spec: backend/error-handling.md〕
- R6 **日志与保密**：stdlib `logging`，记录生命周期/时长/图片字节长度/异常类型（`exc_info=True`）；**绝不**记录 API Key、图片字节、对话内容；API Key 不进任何响应/日志/错误。〔spec: backend/logging-guidelines.md, configuration.md〕
- R7 **零持久化**：无数据库、不落盘图片/音频/对话、不跨请求累积；历史由客户端每次带上、用完即弃。〔spec: backend/llm-streaming.md〕

### 前端（Vite + React + TypeScript，`frontend/`）
- R8 **单屏骨架** `src/` 布局：`components/`（CameraPreview · TalkButton · TranscriptView · AnswerView · ConversationList · ErrorBanner）、`hooks/`、独立 `effects/`、`lib/`（chatStream.ts + constants.ts）、`types/`（chat.ts + speech.d.ts）、`styles/`（tokens.css + global.css）；状态集中在 `App.tsx` 下发。〔spec: frontend/directory-structure.md〕
- R9 **四个浏览器 API hook**：`useCamera`（getUserMedia + canvas，`captureFrame()` 返回压缩 base64 JPEG，提交时单帧截取）、`useSpeechRecognition`（zh-CN、interimResults、push-to-talk）、`useSpeechSynthesis`（`speak()` 支持分句增量早播、`cancel()`）、`useChatStream`（**`fetch` 流式读 SSE，禁用 EventSource**）。每个 hook 特性检测 `supported` + 卸载清理（停轨道/abort 识别/cancel 合成/abort fetch）。〔spec: frontend/hook-guidelines.md〕
- R10 **样式与可访问性**：CSS Modules + `tokens.css` CSS 变量；装饰性动效隔离在 `effects/`；流式文本进 `aria-live="polite"`，TalkButton 有 `aria-label`/`aria-pressed`，ErrorBanner `role="alert"`。〔spec: frontend/component-guidelines.md〕
- R11 **类型契约**：strict TS；`types/chat.ts` 的 `ChatRequest/HistoryTurn/ChatEvent(discriminated union)` 与后端 `schemas.py` 对齐；SSE 帧按 `unknown`→`JSON.parse`→校验防御式解析；Web Speech 的 `any` 只隔离在 `types/speech.d.ts`。〔spec: frontend/type-safety.md〕
- R12 **状态与零持久化**：纯内存 React 状态，无 store 库、无 React Query；6 轮裁剪只在一处（`lib/constants.ts` 的 `MAX_HISTORY_ROUNDS`，与后端镜像）；历史纯文本；无 `localStorage/sessionStorage/IndexedDB`，刷新清空。〔spec: frontend/state-management.md〕
- R13 **降级与错误**：不支持的浏览器或被拒的摄像头/麦克风权限 → 可读中文提示，绝不白屏或仅 console。〔spec: frontend/component-guidelines.md, quality-guidelines.md〕

## Acceptance Criteria

- [ ] AC1 缺任一必填环境变量时 `uvicorn app.main:app` 启动失败并打印清晰中文错误（含缺失字段名、不含值）；三项齐全时前后端均能正常启动。
- [ ] AC2 Chrome/Edge 能弹出摄像头与麦克风授权；拒绝任一权限时页面显示可理解的中文提示（非白屏/非纯 console）。
- [ ] AC3 点击/按住说话能把中文语音实时识别为文本（interim 更新）；提交时截取当前画面一帧。
- [ ] AC4 `POST /api/chat` 以 SSE 流式返回：前端边收 `delta` 边渲染到 `aria-live` 区域，并在缓冲到分句时尽早开始 TTS 播报。
- [ ] AC5 验收场景可用：识别日常物品、读取纸面文字、解释屏幕/物体细节、针对上一轮回答继续追问（多轮上下文生效）。
- [ ] AC6 成本策略可验证：每次提问只发 1 张（设计上限 3 张）压缩截图 + 仅最近 6 轮纯文本历史，历史不带图；服务端不落盘任何图片/音频/对话。
- [ ] AC7 异常路径：上游认证/限流/超时/连接/被拒错误，前端收到 `event: error` 并显示对应安全中文消息，服务不崩、API Key 不泄漏。
- [ ] AC8 刷新页面后对话历史清空（无任何持久化）。

## Definition of Done

- 后端 `ruff check .` / `ruff format --check .` 通过；`pytest` 通过（`test_config.py` 缺配置不启动 + `test_chat.py` mock AsyncOpenAI 验 SSE 帧与错误映射、payload 不含密钥）。
- 前端 `npm run build`（tsc + vite）/ `npm run lint` / `npm run test`（Vitest：useChatStream 累积 delta、done 结束、error 暴露 message、abort 干净；hook 卸载清理）通过。
- 端到端语音/视觉流程、权限弹窗、首字延迟在真实 Chrome/Edge 手测，符合 `plan.md` Test Plan。
- 跨层契约一致：SSE 线协议与请求/响应形状在 `backend/app/schemas.py` 与 `frontend/src/types/chat.ts` 同步（见 guides/cross-layer-thinking-guide.md）。

## Technical Approach

- **后端** layered-lite + `AsyncOpenAI` + `sse-starlette` `EventSourceResponse` + `pydantic-settings`；fail-fast 在 lifespan 校验；薄路由、服务层负责 provider payload 与异常映射。细节见 backend/index.md 及其引用文件。
- **前端** Vite+React+TS 单屏；四个设备/API hook 封装浏览器能力；`fetch` 流式读 SSE（非 EventSource，因需 POST 图片+历史 body）；CSS Modules + 变量 + 独立 effects 层；纯内存状态。细节见 frontend/index.md 及其引用文件。
- **跨层边界** `/api/chat` 线协议是前后端共享契约，改动必须两侧同步。

## Decision (ADR-lite)

- **Context**：本地课程展示用的多模态视觉对话应用，要求低延迟、强保密、低成本、零持久化。
- **Decision**：技术栈与架构已在 `plan.md` + `.trellis/spec/` 锁定（Vite/React/TS 前端、FastAPI 后端、浏览器 Web Speech、SSE 流式、提问时截图、6 轮文本上下文、env fail-fast、无 DB）。本任务按既定决策实现，不引入新框架/持久化/Mock 降级。
- **Consequences**：依赖联网的浏览器云端语音识别与安全上下文（localhost/https）；图片成本由“当前轮单图 + 历史纯文本”控制；零持久化意味着刷新即清空（符合隐私目标）。

## Out of Scope

- 公网部署、鉴权/多用户、对话持久化或导出。
- Mock/降级回退（缺配置必须显式报错）。
- 设计文档/视觉稿；`effects/` 仅预留扩展位，不在 MVP 做复杂动效。
- 动态场景多帧（1~3 帧）默认不启用，仅在 spec 中保留硬上限余地。

## Technical Notes

- 后端 spec 索引：`.trellis/spec/backend/index.md`（→ directory-structure / configuration / llm-streaming / error-handling / logging-guidelines / quality-guidelines）。
- 前端 spec 索引：`.trellis/spec/frontend/index.md`（→ directory-structure / component-guidelines / hook-guidelines / state-management / type-safety / quality-guidelines）。
- 跨层思考：`.trellis/spec/guides/cross-layer-thinking-guide.md`、`code-reuse-thinking-guide.md`。
- 平台：Windows 11 + Git Bash；Python venv 激活 `.venv/Scripts/activate`；前端 npm，dev 端口 5173。

## Implementation Plan（待用户确认的 MVP 切片）

- **PR1 — 通路打通**：前后端脚手架（`backend/` layered-lite 空实现 + `frontend/` Vite 单屏）；后端配置 fail-fast + `.env.example`；`POST /api/chat` SSE 端到端连通（先回简单 delta/done，前端 `useChatStream` 能收并显示）；最小测试（test_config + useChatStream）。
- **PR2 — 多模态 + 输入链路**：后端接 `AsyncOpenAI` 多模态消息构建 + 流式 + 错误映射 + test_chat；前端 `useCamera`（提交截图）+ `useSpeechRecognition`（中文识别）接入提交流程；6 轮历史裁剪。
- **PR3 — 体验闭环 + 收尾**：`useSpeechSynthesis` 边收边播（分句早播）；ConversationList 最近对话；ErrorBanner + 无权限/不支持浏览器降级；可访问性 aria-live；前端 lint/test、后端 ruff/pytest 全绿，手测验收。
