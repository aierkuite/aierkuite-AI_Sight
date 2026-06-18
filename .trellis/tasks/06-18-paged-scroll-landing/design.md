# Design — 落地页离散整屏翻页

> 权威方案：`plan-paged-scroll.md` §3–§7。本文件抽取关键设计与必须守住的技术要点（用户特别点名 §4/§5/§7）。

## 职责切分（沿用「hook 管逻辑、组件做 store→CSS 变量桥接」）

* **新 hook `usePagedScroll(onEnter)`**（替换 `useLenisScroll`）：在 `window` 挂 wheel/keydown/touch 监听，维护翻页状态机，rAF 补间 `scrollProgress` 与 `peek` 写进 store；末页第二段提交调用 `onEnter()`。
* **store `cinematic.ts`**：新增 `peek`(0→1) 与 `setPeek`；`replayIntro` 归零 `peek`。
* **`CinematicLanding.tsx`**：改调 `usePagedScroll(onEnter)`；订阅扩展为同时写 `--sp`(=scrollProgress) 与 `--peek`(=peek) 到 root。
* **`CinematicLanding.module.css`**：`.root` 从 `relative + min-height:380vh` 改为 `fixed + inset:0 + height:100dvh + overflow:hidden`，加 `transform: translateY(calc(var(--peek)*100dvh))`。
* **`App.tsx`**：透明订阅 `peek`，开场期把 `shell` opacity 按 peek 抬起，进入工作台/静止时清内联样式。

## 必须守住的技术要点

### §4.1 不用 CSS transition / scroll-snap
全局 `@media (prefers-reduced-motion: reduce)`（`global.css:98-106`）把所有 CSS animation/transition 压到 0.001ms。用户要求 reduced-motion 也照常滑动 → **所有补间一律 JS rAF 写 CSS 变量**，不走 CSS transition。内容全是 `position:fixed`，scroll-snap 也无从作用。

### §4.2 末页掭起：工作台从底部升起（落地后按用户现场反馈定稿）
原方案设想「落地页当幕布整体下移、露出顶部工作台」，但落地页 `.root` 是**透明文字层**（无不透明背景），整体位移不产生幕布遮挡——实测变成工作台整屏满亮透出、且方向（顶部）也非所愿。**定稿改为**：
- 落地页 `.root` 保持静止；第二段（peek 从 PEEK_STOP→1）整体 `opacity` 淡出退场（CSS `opacity: clamp(0, (1-peek)/0.8, 1)`，0.8 = 1 - PEEK_STOP）。
- **工作台 shell 自身从屏幕底部 `translateY` 升起**：`translateY((1-peek)*100%)`，露出比例 = `peek`（PEEK_STOP=0.2 → 预览露出 20%），并由暗 `opacity 0.3` 渐亮到全亮 `1.0`（`0.3 + 0.7*peek`）。
- z-order 不变（shell z:1 在 landing z:2 之下）：预览阶段透过透明 landing 底部缺口看到升起的 shell；提交时 landing 已淡至 0，全亮 shell 显出，随即 `setStage('workspace')` 卸载 landing。

### §4.3 锚点核验
`ANCHORS=[0,0.32,0.52,0.7,1.0]`，落在各锚点时恰好只有一幕满不透明，现有 crossfade 区间无需改动。page4 取 1.0（进度走满），CTA 比正中略高 16px，可接受；若复核想完美居中可改 0.92。

### §4.4 「一次连续滚动 = 一页」状态机
三态 `phase ∈ {idle, animating, cooldown}` + 单一 `armTimer(REARM_MS=120ms)`：tween 结束时启动；**每个 wheel 事件都重启它**；只在「120ms 内无 wheel 且动画已结束」时把 `cooldown→idle`。连续滚轮流不断重启 armTimer → phase 卡在 animating/cooldown，直到停手 120ms 才回 idle。键盘/触摸为离散手势，无持续 wheel 重启，120ms 后自然回 idle。

### §5 实现要点（命名/注释风格对齐周边：中文块注释 + 作用/参数/返回）
* `usePagedScroll`：Latest Ref Pattern——`onEnterRef` 锁最新 `onEnter`，主 effect 依赖恒 `[]`，监听只挂一次，绝不因 App 高频重渲染传入新 `onEnter` 而反复重挂、漏滚轮事件。导出 `PEEK_STOP` 供 App 复用。删除整段 reduced-motion 原生滚动分支。清理时移除监听、清 armTimer、cancelRaf、`setProgress(0)`、`setPeek(0)`。
* CSS：`.root` 用 `100dvh`（移动端动态视口，规避 100vh 含地址栏溢出），`overscroll-behavior:none`，`will-change:transform`；transform 用 `100dvh` 与 height 同单位。
* App：**关键**——`.shell` 有 `transition: opacity 1.4s`（`--dur-cinematic`）。peek 期间逐帧直驱 `shell` 的 `transform`（translateY 从底部升起）与 `opacity`（暗→亮）时必须临时 `transition:'none'`，否则揭示被拖成「涂抹」；退出 peek / 进入工作台时清空内联 `opacity`/`transition`/`transform`，交还给 `.shell`/`.shellHidden` 类规则，保证「跳过」常规进入的 1.4s 淡入不受影响。露出比例直接用 `peek`（故 App 不再 import `PEEK_STOP`）。`handleEnterWorkspace` 用 `useCallback`。

### §7 边界与兼容（重点）
* 首页上滑 / 末页非预览态：无动作（不进 animating）。
* 「跳过」按钮始终可点，直接 `onEnter` 绕过 peek，保留。
* CTA 按钮 page4（sp=1.0≥0.8）可点；预览态下移后仍可点。
* `Home/End` **仅 `peek===0` 生效**（peek 预览态按 Home/End 不跳页，避免与掭起状态错位；退出预览用上滑）。
* 键盘 `e.repeat` 忽略 → 一次物理按键一页。
* 触摸 `touchmove` `preventDefault` 阻断原生滚动/橡皮筋；仅 `touchend` 按距离判定一次。
* `deltaMode` 对 line(1)/page(2) 归一到像素。
* Mac 触控板惯性：**不要**用「仅 `|delta|>2` 才重置 timer」缓解粘滞（再武装后弱惯性会被 wheelAccum 累加触发第二次翻页）；安全调法是调小 `REARM_MS` 或调大 `WHEEL_THRESHOLD`。
* 进入工作台衔接：提交瞬间 `peek=1`、工作台 opacity 已 1；`setStage('workspace')` 后 apply 走 else 清内联样式、`.shell` 基础 opacity 仍 1，无淡出/闪跳。落地后截图确认无闪跳/位移。

## 参数表（§6，复核可调）

| 常量 | 默认 | 含义 |
|---|---|---|
| `ANCHORS` | `[0,0.32,0.52,0.7,1.0]` | 5 页对应 scrollProgress |
| `DUR_PAGE` | 800ms | 翻页滑动 |
| `DUR_PEEK` | 500ms | 末页下滑① 掭起预览 |
| `DUR_COMMIT` | 650ms | 末页下滑② 掭到离场→提交 |
| `DUR_RETRACT` | 450ms | 预览态上滑退回 |
| `REARM_MS` | 120ms | 动画后再武装所需滚轮静默空档 |
| `WHEEL_THRESHOLD` | 20 | 触发翻页累计 \|deltaY\|（已归一像素） |
| `TOUCH_THRESHOLD` | 40px | 触发翻页最小滑动距离 |
| `PEEK_STOP` | 0.2 | 预览露出比例（工作台从底部升起 ≈20%；露出比例 = peek） |

> 工作台预览暗度在 `App.tsx` peek 订阅里以 `0.3 + 0.7*peek` 控制（基底 0.3=最暗、范围 0.7→全亮）；落地页淡出曲线在 `.root` 的 `opacity: clamp(0, (1-peek)/0.8, 1)`。三者均「复核可调」，已按用户现场反馈定稿。
