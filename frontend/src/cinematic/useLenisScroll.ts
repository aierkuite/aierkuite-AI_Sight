import { useEffect } from "react";
import Lenis from "lenis";

import { useCinematicStore } from "../store/cinematic";

/** 把数值夹到 [0,1]，并把 NaN/Infinity 兜底为 0（limit 为 0 时 lenis.progress 可能为 NaN） */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0), 1);
}

/**
 * 作用：把落地页滚动进度写入装饰 store（三幕滚动编排的唯一数据源）。
 *   - 普通态：初始化 Lenis 平滑滚动；rAF 循环里 `lenis.raf(t)` 推进，并把 `lenis.progress`
 *     透明写进 `store.setScrollProgress`（不触发 React 重渲染，3D 层在 useFrame 内读取）。
 *   - reduced-motion：不启用 Lenis，改用原生滚动 + 一个 scroll 监听仍把进度写进 store
 *     （保证三幕文字随原生滚动完整揭示；3D 场景由 App 走 2D 静态兜底）。
 *   卸载时销毁 Lenis / 取消 rAF / 移除监听，并把进度归零、滚回顶部（呼应「每次打开都放全程」）。
 * 参数：无（reduced-motion 在内部 matchMedia 探测，与 LiveBackdrop 同款约定）
 * 返回：无
 */
export function useLenisScroll(): void {
  useEffect(() => {
    const setProgress = useCinematicStore.getState().setScrollProgress;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // 每次进入开场都从顶部开始
    window.scrollTo(0, 0);
    setProgress(0);

    // reduced-motion：原生滚动 + 监听，仍把进度写进 store（场景静态由 App 的 2D 兜底负责）
    if (reduced) {
      const onScroll = (): void => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        setProgress(max > 0 ? clamp01(window.scrollY / max) : 0);
      };
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        window.removeEventListener("scroll", onScroll);
        window.scrollTo(0, 0);
        setProgress(0);
      };
    }

    // 普通态：Lenis 平滑滚动；rAF 仅推进 lenis 并把 progress 写进 store
    const lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
    lenis.scrollTo(0, { immediate: true });

    let rafId = 0;
    const loop = (time: number): void => {
      lenis.raf(time);
      setProgress(clamp01(lenis.progress));
      rafId = window.requestAnimationFrame(loop);
    };
    rafId = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(rafId);
      lenis.destroy();
      window.scrollTo(0, 0);
      setProgress(0);
    };
  }, []);
}
