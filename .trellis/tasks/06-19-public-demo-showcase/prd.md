# 公开演示展示页(方案B 独立入口)

## Goal

为项目提供一个免费、永久在线、网址固定、国内可访问的**纯静态展示页**，发到论坛供人浏览。访客能亲自体验可交互的 WebGL 电影化开场，开场后看到 B站嵌入录屏、项目介绍与 GitHub 链接。**不**让访客实时调用后端/GPU（零成本、零运维）。

完整需求与决策记录见仓库根目录 [`plan-public-demo-showcase.md`](../../../plan-public-demo-showcase.md)（本任务的权威依据）。

## Requirements

- 同仓库**新增独立页面入口**（多页构建），现有 `App.tsx` / `src/main.tsx` / `index.html` / 整个 `backend/` **零改动**。
- 展示页**不引入** `useCamera`/`useSpeechRecognition`/`useVoicePlayback`/`useChatStream`——进页面不弹摄像头/麦克风授权，且不发任何 `/api/*` 请求。
- 复用电影开场（`<CinematicLanding/>` + `<Scene/>`/`<LiveBackdrop/>`）与 shell 过渡接线（inert + 末页 peek 抬升）。
- 开场结束后渲染 `<ShowcasePanel/>`：标题+一句话简介、B站 iframe（BV 号占位时显示「演示视频即将上线」）、4–6 条功能亮点、GitHub 链接 + 本地部署提示。
- BV 号先用占位常量（空串），不阻塞；用户给出后再填。
- 新增 Cloudflare Pages `_redirects`：`/ → /showcase.html 200`，公网根路径只暴露展示页。
- 范围：实现 + `npm run build` 通过 + 本地可验证 + 给出 Cloudflare Pages 部署操作文档。**不**实际部署、**不**自动 commit。

## Acceptance Criteria

- [ ] `cd frontend && npm run build` 通过（`tsc --noEmit && vite build`），产物含 `dist/index.html` 与 `dist/showcase.html`。
- [ ] 访问 `/showcase.html` **不触发摄像头/麦克风授权弹窗**。
- [ ] 浏览器控制台**无** `/api/*` 请求或相关报错。
- [ ] WebGL 开场可交互（翻页/掭起/跳过）；无 WebGL 时降级到 2D 背景。
- [ ] 开场后展示 ShowcasePanel：视频区（BV 占位）、功能亮点、可点 GitHub 链接、本地部署提示。
- [ ] `App.tsx` / `src/main.tsx` / `index.html` 未被修改；本地完整应用（`npm run dev`）回归正常。
- [ ] `npm run test` 不被新代码破坏。

## Out of Scope

- 让访客实时调用后端/语音；后端上云、隧道、鉴权限流。
- 绑定自定义/备案域名、国内 CDN 加速。
- 录制演示视频本身（用户完成）。
- 实际执行 Cloudflare 部署 / git commit（留待用户现场审阅后）。

## Notes

- 现场验证（浏览器看不弹摄像头 / 控制台无 /api / 开场流畅）由用户本人在浏览器中完成；本任务负责把 build 跑通。
