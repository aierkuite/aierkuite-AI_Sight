import type { RefObject } from "react";

import styles from "./CameraPreview.module.css";

interface CameraPreviewProps {
  videoRef: RefObject<HTMLVideoElement>;
  ready: boolean;
  supported: boolean;
}

/**
 * 作用：展示摄像头实时预览与就绪状态
 * 参数：videoRef 视频元素引用，ready 摄像头是否可截图，supported 浏览器是否支持摄像头 API
 * 返回：摄像头预览组件
 */
export function CameraPreview({ videoRef, ready, supported }: CameraPreviewProps) {
  const statusText = supported ? (ready ? "画面已就绪" : "等待摄像头授权") : "摄像头不可用";

  return (
    <section className={styles.preview} aria-label="摄像头画面">
      <video
        ref={videoRef}
        className={styles.video}
        autoPlay
        muted
        playsInline
        aria-label="当前摄像头画面"
      />
      <div className={styles.status} aria-live="polite">
        <span className={ready ? styles.dotReady : styles.dotIdle} />
        {statusText}
      </div>
    </section>
  );
}
