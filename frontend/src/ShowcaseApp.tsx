import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import { ShowcasePanel } from "./components/ShowcasePanel/ShowcasePanel";
import { CinematicLanding } from "./cinematic/CinematicLanding";
import { LiveBackdrop } from "./effects/LiveBackdrop";
import { useCinematicStore } from "./store/cinematic";
import styles from "./App.module.css";

/** 懒加载 3D 电影场景：three 栈较大，仅在 WebGL 可用时按需加载（与 App 同款） */
const Scene = lazy(() => import("./cinematic/Scene"));

/**
 * 作用：探测是否启用 3D 场景——需 WebGL 可用且系统未开启「减少动态效果」
 * 参数：无
 * 返回：true 则常驻 <Scene/>，否则回退 2D <LiveBackdrop/>
 */
function detectSceneEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return false;
  }
  try {
    return document.createElement("canvas").getContext("webgl") !== null;
  } catch {
    return false;
  }
}

/**
 * 作用：渲染公开展示页——App 的「装饰层子集」。复用电影开场（Scene/LiveBackdrop + CinematicLanding）
 *   与 shell 的开场过渡接线（inert 切换 + 末页 peek 逐帧抬升），但**不引入**任何
 *   camera/chat/speech hook——彻底杜绝摄像头授权弹窗与后端 /api 请求。
 *   开场结束（stage==="workspace"）后，shell 内渲染 <ShowcasePanel/> 而非双栏工作台。
 * 参数：无
 * 返回：展示页节点
 */
export function ShowcaseApp() {
  const stage = useCinematicStore((state) => state.stage);
  const setStage = useCinematicStore((state) => state.setStage);
  const [sceneEnabled] = useState(detectSceneEnabled);
  const shellRef = useRef<HTMLElement>(null);

  // 开场阶段把展示壳标记为 inert：保持挂载，但移出焦点与无障碍树（与 App.tsx 同款）
  useEffect(() => {
    shellRef.current?.toggleAttribute("inert", stage === "intro");
  }, [stage]);

  // 末页两段式「掭起」期间，逐帧把 shell 的 opacity/transform 按 peek 抬起（原样照搬 App.tsx 接线）：
  // peek 期间临时关掉 .shell 的 1.4s opacity 过渡、直驱，避免揭示被拖成「涂抹」；其余时刻清空内联样式，
  // 交还给 .shell / .shellHidden 的类规则（保证「跳过」常规进入的淡入照常生效）。
  useEffect(() => {
    const apply = (): void => {
      const { peek, stage: currentStage } = useCinematicStore.getState();
      const el = shellRef.current;
      if (el === null) {
        return;
      }
      if (currentStage === "intro" && peek > 0) {
        el.style.transition = "none";
        el.style.transform = `translateY(${((1 - peek) * 100).toFixed(2)}%)`;
        el.style.opacity = (0.3 + 0.7 * peek).toFixed(3);
      } else {
        el.style.opacity = "";
        el.style.transition = "";
        el.style.transform = "";
      }
    };
    apply();
    return useCinematicStore.subscribe(apply);
  }, []);

  /**
   * 作用：进入展示内容（CTA 与「跳过」共用）；用 useCallback 固定引用，避免向开场 hook 传入新回调
   * 参数：无
   * 返回：无
   */
  const handleEnterWorkspace = useCallback((): void => {
    setStage("workspace");
  }, [setStage]);

  return (
    <>
      {sceneEnabled ? (
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      ) : (
        <LiveBackdrop />
      )}

      <main
        ref={shellRef}
        className={stage === "intro" ? `${styles.shell} ${styles.shellHidden}` : styles.shell}
      >
        <ShowcasePanel />
      </main>

      {stage === "intro" ? <CinematicLanding onEnter={handleEnterWorkspace} /> : null}
    </>
  );
}
