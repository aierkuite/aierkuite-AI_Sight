import { create } from "zustand";

/** 落地页阶段：'intro' 电影开场叙事 → 'workspace' 双栏工作台满屏接管 */
export type CinematicStage = "intro" | "workspace";

interface CinematicState {
  /** 当前阶段（CTA / 跳过 → 'workspace'；replayIntro → 'intro'） */
  stage: CinematicStage;
  /** 滚动进度 0→1：离散整屏翻页在 5 个锚点间 rAF 补间写入，驱动三幕 crossfade 与 3D 编排 */
  scrollProgress: number;
  /** 末页掭起进度 0→1：0=CTA 静止，PEEK_STOP=预览露出工作台顶部，1=完全离场（提交进工作台）。仅开场用 */
  peek: number;
  /** 氛围音开关。Phase 1 仅占位字段；Phase 3 接 WebAudio drone */
  soundOn: boolean;
  /** 切换阶段 */
  setStage: (stage: CinematicStage) => void;
  /** 写入滚动进度（transient：3D 层在 useFrame 内用 getState 读取，不触发 React 重渲染） */
  setScrollProgress: (value: number) => void;
  /** 写入末页掭起进度（transient：CinematicLanding 写 --peek、App 抬 shell opacity，不触发重渲染） */
  setPeek: (value: number) => void;
  /** 设置氛围音开关（Phase 3：SoundToggle 点击时调用） */
  setSoundOn: (value: boolean) => void;
  /** 翻转氛围音开关 */
  toggleSound: () => void;
  /** 重播开场：回到 intro 并归零滚动 */
  replayIntro: () => void;
}

/**
 * 作用：仅服务装饰性 3D / 落地页层的极小 store —— 只持 stage/scrollProgress/soundOn。
 *   绝不放任何 chat/设备状态（摄像头、语音、SSE 仍留在 App.tsx 的 useState）。
 *   三维对象在 useFrame 里以 useCinematicStore.getState() 透明读取，规避滚动→重渲染风暴。
 * 参数：无
 * 返回：zustand store hook
 */
export const useCinematicStore = create<CinematicState>((set) => ({
  stage: "intro",
  scrollProgress: 0,
  peek: 0,
  soundOn: false,
  setStage: (stage) => set({ stage }),
  setScrollProgress: (value) => set({ scrollProgress: value }),
  setPeek: (value) => set({ peek: value }),
  setSoundOn: (value) => set({ soundOn: value }),
  toggleSound: () => set((state) => ({ soundOn: !state.soundOn })),
  replayIntro: () => set({ stage: "intro", scrollProgress: 0, peek: 0 }),
}));
