# 执行计划 — 公开演示展示页(方案B)

## 有序检查清单

- [x] 1. 新增 `frontend/src/lib/showcase.ts`：`SHOWCASE_VIDEO_BVID`(空串) + `GITHUB_REPO_URL`。
- [x] 2. 新增 `frontend/src/components/ShowcasePanel/ShowcasePanel.tsx` + `ShowcasePanel.module.css`：标题/B站 iframe(空 BVID 占位)/功能亮点/GitHub 按钮+本地部署提示。
- [x] 3. 新增 `frontend/src/ShowcaseApp.tsx`：照搬 App 的场景+开场+shell 过渡(inert + peek 订阅)，去掉 camera/chat/speech，`workspace` 阶段渲染 `<ShowcasePanel/>`；`import App.module.css`。
- [x] 4. 新增 `frontend/src/showcase-main.tsx`：镜像 main.tsx(含三个 styles 导入)，根组件换 `<ShowcaseApp/>`。
- [x] 5. 新增 `frontend/showcase.html`：复制 index.html，脚本入口改 `/src/showcase-main.tsx`，title 改「AI 视觉对话助手 · 在线演示」。
- [x] 6. 改 `frontend/vite.config.ts`：追加 `build.rollupOptions.input`(main+showcase)。**适配**：用相对路径字符串而非 `fileURLToPath(node:url)`——仓库未装 `@types/node`，`node:url` 过不了 `tsc --noEmit`；相对路径以 root(frontend) 解析，效果相同、零新依赖。`server`/`plugins` 不动。
- [x] 7. 新增 `frontend/public/_redirects`：`/  /showcase.html  200`。
- [x] 8. 构建校验：`npm run build` 通过，产物含 `dist/index.html` 与 `dist/showcase.html`（+ `dist/_redirects`）。
- [x] 9. 回归校验：`npm run test` 20 用例全过；git 确认 `App.tsx`/`main.tsx`/`index.html`/`backend` 未改，仅 `vite.config.ts` M + 新增文件。
- [x] 10. 产物硬验证：grep `dist/assets/*.js` → `getUserMedia` 与 `/api/(chat|tts)` 仅存在于 `main` 包，showcase 包无 → 展示页不含摄像头/后端调用。

## 验证命令

```bash
cd frontend
npm run build         # tsc --noEmit && vite build；检查 dist/index.html + dist/showcase.html
npm run test          # 不被新代码破坏
```

## 交给用户的现场验证（不由本任务执行）

- `npm run dev` → 默认应用开场+工作台行为不变。
- `npm run preview` → 访问 `/showcase.html`：不弹摄像头授权、开场可交互、开场后见 ShowcasePanel、GitHub 链接正确、控制台无 `/api/*`。

## 复核门 / 回滚点

- build 失败 → 不继续，修类型/导入。
- 删新增文件 + 还原 vite input 追加即可完全回滚（见 design.md）。

## 不在本任务执行

- 填真实 BV 号（用户给出后再填并重构验证）。
- 实际 Cloudflare Pages 部署（仅产出操作文档）。
- git commit（留待用户现场审阅后，Trellis Phase 3）。
