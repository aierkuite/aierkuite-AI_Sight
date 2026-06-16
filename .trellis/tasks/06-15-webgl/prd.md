# PRD — 电影感 WebGL 入场 + 工作台改造

> **权威源**：`G:\qiniuyun\plan-cinematic.md`（grill-me 访谈定稿）。本文件是 task 视角的
> 浓缩 PRD + 护栏映射，逐字细节以 `plan-cinematic.md` 为准。执行按它的 §8 分阶段、§12 避坑。

---

## 目标（一句话）

把现有双栏 AI 视觉语音工作台的入口，改造成参照 hashgraphvc「魂」的电影感 WebGL 落地页：
一打开就是 3D Hero（漂浮人形 + GPU 流体粒子 + bloom），滚动三幕叙事，点 CTA/跳过后
3D 退为背景、双栏工作台满屏接管；无 WebGL / reduced-motion 体面回退到现有 2D `LiveBackdrop`。

## 范围

- 全站「克魂」克隆 + 三幕入场叙事；单页、**不加路由**；stage 状态机 `'intro' → 'workspace'`。
- 渲染栈：`@react-three/fiber` + `@react-three/drei` + `@react-three/postprocessing`（React 18 兼容版）。
- 资产复用 hashgraphvc 通用资产（human/rocks/纹理），换文案/品牌为本项目内容；不拷品牌标识资产。

## 分阶段交付（每阶段独立验收 + commit）

- **Phase 1（本次）**：Hero + 工作台接管 + 兜底。装依赖 → 拷 Hero 资产 → zustand store →
  `Scene.tsx`（Canvas/ACESFilmic/Bloom mipmapBlur）→ `HeroFigure`（human.glb 漂浮）→
  `FluidParticles`（GPU shader 粒子）→ `CinematicLanding`（Hero 叠层 + CTA + 跳过）→
  `App.tsx` 按 stage 渲染 + WebGL 探测兜底 → 进工作台切 ambient 低强度。
- **Phase 2**：Lenis 平滑滚动 + 三幕滚动编排（MathUtils 插值，不堆 if/else）+ RocksField。
- **Phase 3**：WebAudio drone + SoundToggle（onClick 唤醒 AudioContext）+ 自托管字体 +
  移动端降画质 + reduced-motion 全路径复核 + 终检截图矩阵。

## 护栏（沿用上一个 task 已确立的 frontend spec，仍然生效）

1. **effects/3D 层纯装饰**：只读 `stage/scrollProgress/soundOn` 与 CSS 令牌，**绝不读 chat/设备状态**
   （摄像头/语音/SSE）。遵循 `spec/frontend/directory-structure.md` 的 effects 层契约与
   `LiveBackdrop` 引用实现（DPR≤2、delta-time、reduced-motion 画一帧、cleanup 强制）。
2. **TS strict + `no-explicit-any: error`**：3D 代码零 `any`。shader 材质用 drei `shaderMaterial()`
   工厂 + `extend()` + module augmentation 补 JSX 类型；`types/speech.d.ts` 是唯一既有豁免，不扩大。
3. **不破坏现有 3 个测试**：vitest 跑 jsdom 无 WebGL，**任何测试都不得 import `<Canvas>`/three**；
   落地页与场景只在 `App.tsx` 运行时挂载，不进测试路径。
4. **颜色走 `var(--*)` 令牌**；新增令牌（plan §5）写进 `tokens.css`，不改既有值。
5. **`prefers-reduced-motion`**：命中时停动画、画一帧静态、可跳过开场；hover 动效包在
   `@media (hover: hover) and (pointer: fine)`。
6. **Canvas 全程 `pointer-events:none`**（plan §12-④）：纯装饰绝不吞点击；鼠标视差走 window
   `mousemove` 写 store，不挂 OrbitControls。
7. **工作台无障碍/中文文案/逻辑不动**：所有 `aria-*`、`role="alert"`、`h2 id`、双栏结构保留。

### 不碰清单（plan §2.1）

`backend/**`、`frontend/src/hooks/**`、`frontend/src/lib/**`、`frontend/src/types/**`、`*.test.*`、
`test/setup.ts`、`tsconfig.json`、`eslint.config.js`、根 `plan.md`。`package.json` 仅允许新增依赖。

## 已知与 spec 的张力（显式例外，check 阶段勿误判）

- **引入 zustand**：`spec/frontend/state-management.md` 写明「单屏不用 Zustand，加它是过度设计」——
  那条约束针对 **chat/业务状态**。本次 zustand store **仅服务装饰性 3D 层**，持有
  `{ stage, scrollProgress, soundOn }`，用 **transient 更新**（`useFrame` 内读，不触发 React 重渲染），
  这正是 r3f 生态规避「滚动 → setState 重渲染风暴」的惯用法。**业务/chat 状态仍留在 `App.tsx` useState，
  绝不进 store**。完工后将此例外补进 `state-management.md`（Phase 3 终检或 update-spec）。
- **新增 three 栈是大依赖**：用 `React.lazy` 懒加载落地页（plan §10），首屏兜底先上轻量 2D。

## Phase 1 验收（DoD）

- `npm run lint` / `npm run build` / `npm run test` 全过（0 改测试、0 失败、3D 代码无 `any`）。
- `npm run dev` 截图自验：Hero 有**肉眼明显**的 3D 漂浮主体 + 流动发光粒子 + bloom（非「什么都没有」）。
- 点 CTA → 平滑进入双栏工作台，摄像头/说话/发送全部照常工作。
- 关 WebGL / 模拟 reduced-motion → 回退 2D 背景 + 可一键进工作台，无报错。
- 窄屏（<860px）Hero 不溢出、工作台仍单列堆叠。

> 记忆约束：该用户会把「微妙效果」读成「什么都没有」→ **强度大胆、并用截图自证**后才声称完成。

## Phase 1 验收记录（已通过，2026-06-16）

- lint / build / test 三门全绿；trellis-check 7 条护栏逐条通过、零违规。
- 真实 GPU（Intel Iris Xe / D3D11，headful puppeteer）截图自验：Hero 暗底 + 发光漂浮人形 + 细密流动粒子 + bloom，肉眼明显；CTA/跳过 → 双栏工作台（3D 降低强度 ambient）；reduced-motion → 2D LiveBackdrop 兜底完好。
- 修复一处白屏 bug：`FluidParticles` 的 `gl_PointSize` 过大（`uSize=26`），28000 加法混合粒子把整屏冲成白 → 降到 `uSize=0.22` + `gl.setClearColor(palette.bg,1)` 兜底。
- 用户验收：「还可以」（认可 Hero）。

## Phase 2 用户反馈（落地页滚动编排时务必遵守）

- **粒子减量**：用户指出后续幕粒子过密像「光污染」。Hero/Act-1 密度保留；**Act 2（能力）/ Act 3（CTA）必须按 `scrollProgress` 把粒子数/不透明度/辉光逐幕降下来**（如用密度 uniform 或 count 淡出），不要全程维持 Hero 密度。详见 auto-memory `cinematic-particle-density`。

## Phase 2 验收记录（已通过，2026-06-16）

- 实现：`useLenisScroll`（Lenis 1.3.23 平滑滚动 → `store.scrollProgress`，reduced-motion 走原生滚动 + 监听仍写 progress）；`CinematicLanding` 改 ~380vh 长卷、五幕文字按 `--sp` crossfade；`Scene` 按 scrollProgress 用 `MathUtils.mapLinear/damp` 编排相机 dolly + `FogExp2` + 焦点；`FluidParticles` 加 `uVisible`(真实裁剪减量) + `uMorph`(眼/声波/数据流三态)；新增 `RocksField`（rocks.glb + waternormals 法线）；`.shellHidden→position:fixed` 解决长卷双滚动条。
- lint / build / test 三门全绿；trellis-check 10 条护栏逐条通过、零违规（含 Lenis cleanup、StrictMode 安全、reduced-motion 分支、布局接缝、零 any、零耦合）。
- 真实 GPU 逐幕截图自验：五幕（看见你所见 / 它看得见 / 它听得懂 / 它边想边答 / 准备好了吗）文字与 3D 焦点同步揭示、过场连贯；`--sp` 与实际滚动比吻合（Lenis 链路通）；**粒子密度 Hero→CTA 单调递减**（PNG 体积 1.25MB→322KB 佐证），落实用户「后幕减量」反馈；滚到底点 CTA → 工作台接管正常。
- 两处合理偏离：Bloom intensity 静态（辉光改由 fog.density + 粒子减量物理递减，规避 postprocessing@2.19 ref 类型缺陷的 any/as）；CTA 点击进入（非滚到底自动进），「跳过」始终兜底。

### Phase 2 视觉迭代：每幕差异化（用户反馈「每个画面就字不一样，应像原站每屏不同背景」）

- 把单一弱 `uMorph` 拆成四个明确形态函数 + 权重混合，每幕在「相机机位 / 主导形态 / 人形可见度 / 色调雾」四维拉开：
  - Act1 Hero：人形 + 球壳粒子云（满）；Act2a 它看得见：同心环「眼/虹膜」；Act2b 它听得懂：低视角水平声波涟漪场；Act2c 它边想边答：朝相机贯穿的放射数据流隧道；Act3 准备好了吗：粒子汇聚柔光核 + 人形远小回归（最稀最静）。
  - 新增 `aSeed` 属性、`uTone`/`uColorDeep` uniform；`gl_PointSize` 加 48px 上限防数据流幕穿越相机平面的加法饱和白屏（Phase1 同款坑的预防）。
- 粒子减量仍保留（`uVisible 1.08→0.25`、`uOpacity 0.95→0.5`、count 仍 28000 只重定位）。
- trellis-check 二轮（rework delta）7 护栏 + 白屏防护 + uniform 类型化逐条通过；三门绿；真实 GPU 逐幕截图自验「相邻幕一眼可辨不同」。**用户验收：「可以」。**



