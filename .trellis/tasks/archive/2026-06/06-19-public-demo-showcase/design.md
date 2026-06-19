# 技术设计 — 公开演示展示页(方案B)

> 权威依据：根目录 [`plan-public-demo-showcase.md`](../../../plan-public-demo-showcase.md) §3。本文件只记录落地时确认的关键事实与契约。

## 为什么必须独立入口（不能复用 `<App/>`）

`App` 顶层调用 `useCamera()`（App.tsx:58），而 `useCamera` 在挂载 effect 里立即 `navigator.mediaDevices.getUserMedia(...)`（useCamera.ts:34-61）——一进页面就弹摄像头授权。展示页是给陌生访客的，必须杜绝。故新建 `ShowcaseApp`，**不引入**任何 camera/chat/speech hook。

`/api/*` 是相对路径（constants.ts:4-5），仅由 `useChatStream`/`useVoicePlayback` 触发；展示页不引入这些 hook → 零后端请求 → 可纯静态托管。

## 多页入口（App/main.tsx 零改动）

`vite.config.ts` 当前仅 `plugins` + `server`（无 `build` 段）。**追加** `build.rollupOptions.input`：
```ts
build: { rollupOptions: { input: {
  main: fileURLToPath(new URL("./index.html", import.meta.url)),
  showcase: fileURLToPath(new URL("./showcase.html", import.meta.url)),
} } }
```
`server`/`plugins` 不动。产物：`dist/index.html`（完整应用，仅本地）+ `dist/showcase.html`（公网）。

## `ShowcaseApp` = App 的装饰层子集

保留并**原样照搬** App 的：
- 场景探测 `detectSceneEnabled()` + `<Scene/>`(lazy)/`<LiveBackdrop/>` 二选一渲染。
- `<CinematicLanding onEnter={handleEnterWorkspace} />`，`handleEnterWorkspace = () => setStage("workspace")`（useCallback 固定引用）。
- shell `inert` 切换（App.tsx:81-83）。
- 末页 peek 逐帧抬 opacity/transform 的 store 订阅（App.tsx:87-111），**逐行照搬**——这是开场→展示无缝衔接的关键。
- `import App.module.css` 复用 `.shell`/`.shellHidden`（不改该文件）。

去掉：双栏工作台、所有 errors/busy/handleSubmit 等。`stage === "workspace"` 时 shell 内渲染 `<ShowcasePanel/>`。

样式入口：`showcase-main.tsx` 必须 import `styles/tokens.css` + `fonts.css` + `global.css`（镜像 main.tsx:5-7），否则展示页无样式/无 CSS 令牌。

## `ShowcasePanel` 分区

标题+简介（README:3 文案）/ B站 iframe（`//player.bilibili.com/player.html?bvid=${BVID}&autoplay=0&high_quality=1`，空 BVID 显示占位）/ 功能亮点 4–6 条（取自 README「功能特性」）/ GitHub 按钮 + 本地部署提示。视觉沿用深色电影质感（用 tokens.css 的 `--color-*`/`--space-*`/`--font-*` 令牌 + App.module.css 同款手法）。

## 常量 `src/lib/showcase.ts`

```ts
export const SHOWCASE_VIDEO_BVID = "";
export const GITHUB_REPO_URL = "https://github.com/aierkuite/aierkuite-AI_Sight";
```

## `_redirects`（Cloudflare Pages，放 `frontend/public/`）

```
/    /showcase.html    200
```
仅对 Cloudflare 生效；本地 dev/preview 忽略，不影响完整应用。

## 兼容性 / 回滚

独立入口与默认应用互不影响。回滚=删新增文件 + 还原 vite input 追加；`App.tsx`/`main.tsx` 本就没改。
