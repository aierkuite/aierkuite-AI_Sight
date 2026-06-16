import { useEffect, useRef } from "react";

import { useCinematicStore } from "../store/cinematic";
import { createAmbientDrone, type AmbientDrone } from "./ambientAudio";
import styles from "./SoundToggle.module.css";

/**
 * 作用：右上角 chrome 的氛围音开关。默认静音；点击切换并（plan §12-⑤）在点击手势内首次
 *   创建/恢复 AudioContext。氛围音仅在 `stage==='intro' && soundOn` 时发声，进入工作台或关闭即淡出，
 *   故与工作台的 TTS 天然错开——本组件只读 store 的 soundOn/stage，绝不触碰任何 chat/语音状态。
 *   卸载（进入工作台→落地页卸载）时 dispose 控制器，淡出并关闭 AudioContext。
 * 参数：无
 * 返回：chrome 内的开关按钮
 */
export function SoundToggle() {
  const soundOn = useCinematicStore((state) => state.soundOn);
  const stage = useCinematicStore((state) => state.stage);
  const toggleSound = useCinematicStore((state) => state.toggleSound);
  const droneRef = useRef<AmbientDrone | null>(null);

  // 让 drone 与 (soundOn, stage) 保持一致：仅在 intro 且开启时发声，其余淡出。
  // 安全性：首次解锁由下面的 onClick（用户手势）完成；此处的 start() 只在 context 已解锁后调整音量，
  // 不依赖手势（对已运行 context 再 resume/ramp 是幂等的）。drone 未创建（从未点击）时跳过。
  useEffect(() => {
    const drone = droneRef.current;
    if (drone === null) {
      return;
    }
    if (soundOn && stage === "intro") {
      drone.start();
    } else {
      drone.stop();
    }
  }, [soundOn, stage]);

  // 卸载时彻底拆除（淡出 + 关闭 AudioContext），杜绝常驻发声/泄漏
  useEffect(() => () => droneRef.current?.dispose(), []);

  /**
   * 作用：点击切换氛围音；开启时在用户手势栈内首次解锁 AudioContext（plan §12-⑤）
   * 参数：无
   * 返回：无
   */
  function handleClick(): void {
    if (droneRef.current === null) {
      droneRef.current = createAmbientDrone();
    }
    // 仅在「开启」这一侧需要手势解锁；关闭无需手势
    if (!soundOn) {
      droneRef.current.start();
    }
    toggleSound();
  }

  return (
    <button
      type="button"
      className={styles.toggle}
      aria-label={soundOn ? "关闭氛围音" : "打开氛围音"}
      aria-pressed={soundOn}
      onClick={handleClick}
    >
      <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          className={styles.speaker}
          d="M4 9v6h4l5 4V5L8 9H4z"
          fill="currentColor"
          stroke="none"
        />
        {soundOn ? (
          <>
            <path className={styles.wave} d="M16.5 8.5a5 5 0 0 1 0 7" />
            <path className={styles.wave} d="M18.5 6a8 8 0 0 1 0 12" />
          </>
        ) : (
          <path className={styles.wave} d="M17 9.5l4 5M21 9.5l-4 5" />
        )}
      </svg>
    </button>
  );
}
