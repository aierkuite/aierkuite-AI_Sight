# 前端深色改造（参照 hashgraphvc 设计语言）

## Goal

在**不改动任何交互逻辑、后端、数据流、可访问性契约**的前提下，把前端
（Vite + React + TS 单屏工具）从浅色青绿重塑为参照 `hashgraphvc` 的深色电影感界面：
近黑微蓝底 `#000209` + periwinkle 蓝紫强调、精致字体、辉光胶囊按钮、克制动效、
Canvas 粒子背景。**视觉换皮，行为不变。**

完整设计规格与逐步实施方案见仓库根 `frontend-redesign-plan.md`（本任务的权威 PRD，
由先前 grill-me 访谈定档）。本 prd.md 仅做 Trellis 侧的需求/验收/范围镜像。

## What I already know

- 当前前端：浅色（青绿 `#0f766e`）、两栏布局（左=摄像头/说话/输入，右=回答/历史），
  CSS Modules + `src/styles/tokens.css` 令牌，无 CSS 框架。
- spec 确认（与计划一致）：颜色/间距一律走 `var(--*)` 令牌，**禁止在 `*.module.css`
  硬编码颜色**；装饰动态视觉只能在 `effects/` 层、**只读 props/CSS、不碰 chat/设备状态**；
  TS strict + `@typescript-eslint/no-explicit-any: error`（仅 `types/speech.d.ts` 豁免）。
- 测试只有 3 个 hooks/lib 行为测试，**不渲染组件、不按 className/文案查询 DOM**
  → 改 CSS/DOM/文案不破坏测试，无需改测试。
- 目标浏览器：最新 Chrome/Edge → 可用 `backdrop-filter`/`color-mix()`/`matchMedia`。

## Requirements（锁定）

- 仅深色主题（移除浅色，不做主题切换）。
- 重写 `tokens.css` 为深色全量令牌（令牌名不变，值整体换深）+ 新增字体/渐变/辉光/缓动令牌。
- `global.css`：body 字体改 `--font-ui`、深色底、细滚动条（可见）、keyframes、
  `prefers-reduced-motion` 全局降级块、保留 `:focus-visible`。
- 重写 `effects/LiveBackdrop.tsx` 为 typed Canvas 粒子 + 辉光，DPR≤2、delta-time、
  rAF 清理、`reduced-motion` 命中只画一帧。**禁止 `any`**。
- 新增 `components/AppHeader/`（presentational）：品牌名（Clash Display）+ 状态点 +
  渐变发丝线；**仅在 `App.tsx` 插入这一处结构**。
- 按钮三层级（TalkButton 实心 accent + 聆听脉冲；sendButton ghost + 辉光/shimmer；
  secondaryButton 弱 ghost），外发光统一 `box-shadow`，hover 包 `@media (hover:hover) and (pointer:fine)`。
- 逐面板玻璃质感 + 展示体标题（AnswerView/TranscriptView/CameraPreview/ConversationList/ErrorBanner），
  颜色全走令牌；AnswerView 仅追加 streaming 类（保留 `aria-live`/`aria-busy`）。

## Acceptance Criteria

- [ ] `npm run lint` 全过（Canvas 无 `any`、无未用变量）。
- [ ] `npm run build`（`tsc --noEmit && vite build`）通过。
- [ ] `npm run test` 仍全绿（0 改动 0 失败）。
- [ ] `npm run dev` 视觉自查：整体深色、Canvas 粒子流动、Header 发丝线、按钮辉光/shimmer、
      聆听脉冲、面板浮现、细滚动条、流式光标。
- [ ] `prefers-reduced-motion` 下动画停用、Canvas 静态、界面完整可用。
- [ ] 窄屏（<860px）两栏堆叠、controls 单列、Header 不溢出。
- [ ] 所有 `aria-label/aria-pressed/aria-live/role="alert"` 与各 h2 `id` 保留；中文文案不动。

## Out of Scope

- 不引入 Three.js/WebGL 粒子栈、不做整页滚动叙事、不做逐词滚动揭示。
- 不保留浅色主题、不做主题切换、不做持久化。
- 不改后端、SSE/语音/摄像头逻辑与数据契约、不改测试。
- 不引入 CSS 框架（继续 CSS Modules + 令牌）。
- 不碰 `backend/**`、`hooks/**`、`lib/**`、`types/**`、`*.test.*`、`vite.config.ts`、
  `tsconfig.json`、`eslint.config.js`、`package.json`、根 `plan.md`。

## Decision (ADR-lite) — 字体交付

**Context**：计划提供 CDN `<link>` 与自托管 woff2 两条路；本机为中国大陆环境，初判 CDN 有被墙风险。
**Measurement**：实测同机可达性 — Google Fonts CSS `200`/0.31s、gstatic 连接成功、Fontshare `200`/1.32s。被墙风险证伪。
**Decision**：走 **CDN `<link>`**（计划默认）。在 `index.html` 加 meta + Space Grotesk(Google) + Clash Display(Fontshare) 链接，`display=swap` 兜底。
**Consequences**：零构建改动、结构上仅动 `index.html` + `App.tsx` 一处，满足「仅 App.tsx 一处插入」约束；运行时依赖 CDN（GFW 间歇性，失败则回退 YaHei/系统字体），Clash Display 首次有轻微 FOUT，可接受。未来若需离线可切自托管（不在本次范围）。

## Technical Notes

- 权威实施步骤见 `frontend-redesign-plan.md`「实施步骤」§1–8 与「执行避坑补充」§1–7。
- 已读 spec：`frontend/{index,component-guidelines,type-safety,quality-guidelines,directory-structure}.md`，
  与计划约束完全一致。
- 视觉对照源：`G:\UI_warehouse\hashgraphvc-main\hashgraphvc-main\_nuxt\*.css`。
