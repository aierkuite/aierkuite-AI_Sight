# Implement — 落地页离散整屏翻页

> 严格按方案 `plan-paged-scroll.md` §8「实施顺序」。代码块以方案 §5 为准，常量取 §6 参数表。

## 执行顺序（§8）

1. **`frontend/src/store/cinematic.ts`**：加 `peek:number` 字段 + `setPeek`，`replayIntro` 改为同时归零 `peek`（`set({ stage:"intro", scrollProgress:0, peek:0 })`）。
2. **新建 `frontend/src/cinematic/usePagedScroll.ts`**（含状态机、rAF 补间、wheel/keydown/touch 监听），并**删除 `useLenisScroll.ts`**。导出 `PEEK_STOP`。Latest Ref Pattern + 空依赖。删除整段 reduced-motion 原生滚动分支。
3. **`CinematicLanding.tsx`**：`import { usePagedScroll }`，调用 `usePagedScroll(onEnter)`；订阅同时写 `--sp` 与 `--peek` 到 root。其余 JSX 不变。
4. **`CinematicLanding.module.css`**：`.root` 改 `fixed + inset:0 + height:100dvh + overflow:hidden + overscroll-behavior:none`，去 `min-height:380vh`，加 `--peek:0` 与末页整体淡出 `opacity: clamp(0,(1-var(--peek))/0.8,1)`（0.8=1-PEEK_STOP）+ `will-change:opacity`。其余规则不变。
5. **`App.tsx`**：`handleEnterWorkspace` 用 `useCallback`；新增透明订阅，仅 `stage==='intro' && peek>0` 时临时 `transition:'none'` + `transform: translateY((1-peek)*100%)`（工作台从屏幕底部升起，露出比例=peek）+ `opacity: 0.3+0.7*peek`（暗→亮），否则清空 `opacity`/`transition`/`transform`。露出比例直接用 `peek`，App 不 import `PEEK_STOP`。
6. （可选）确认全仓无 `lenis` 引用后移除 `package.json` 依赖并 `npm install` 更新 lockfile。**推荐一并移除**。
7. 校验 + 人工复核（见下）。

## Validation（在 `frontend/`）

```bash
npm run lint
npm run build      # tsc --noEmit + vite build，必须零类型错误
npm run test       # 既有测试全绿（不涉及落地页）
npm run dev        # 启动后人工复核，先别提交
```

汇报每条结果与任何未能运行的检查。

## Review Gate（提交前必过）

`npm run dev` 后按 prd.md 的验收清单（= §9）逐项自查，并**暂停让用户现场看运行效果**，尤其确认**末页掭起的揭示方向/幅度**。用户确认后才提交。

实现完成后改完 inline，再派一个 channel `check` worker 做独立评审（workflow inline 模式建议）。

## Rollback（§10）

改动集中在落地页装饰层，零后端/业务影响：
* `git checkout -- frontend/src/cinematic/CinematicLanding.tsx CinematicLanding.module.css frontend/src/store/cinematic.ts frontend/src/App.tsx`
* 恢复 `useLenisScroll.ts`（`git checkout`），删新增 `usePagedScroll.ts`
* 若动过 `package.json` 则还原并 `npm install`
