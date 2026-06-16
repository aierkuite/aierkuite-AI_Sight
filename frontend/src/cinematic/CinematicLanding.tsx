import { useEffect, useRef } from "react";

import { useCinematicStore } from "../store/cinematic";
import { useLenisScroll } from "./useLenisScroll";
import styles from "./CinematicLanding.module.css";

interface CinematicLandingProps {
  /** 进入工作台（CTA 与「跳过」共用） */
  onEnter: () => void;
}

/** CTA 进入工作台的滚动阈值：到达 Act3 才让按钮可点（隐形态不吞点击） */
const CTA_ACTIVE_FROM = 0.8;

/**
 * 作用：电影开场滚动长卷（~380vh）——三幕文字叠层按 scrollProgress 区间 crossfade + 轻位移，
 *   始终可见可点的角标（logo + 跳过）。Act1 Hero / Act2 三拍能力 / Act3 CTA。
 *   滚动进度由 useLenisScroll 写进 store；此处透明订阅 store 把进度写成 CSS 变量 --sp，
 *   交给 CSS 用 clamp/min 做区间映射（不触发 React 重渲染），并按阈值开关 CTA 的 pointer-events。
 *   纯叠层：容器 pointer-events:none，仅交互元素 auto；颜色全部走 CSS 令牌。
 * 参数：onEnter 进入工作台回调
 * 返回：撑出文档可滚高度的滚动长卷
 */
export function CinematicLanding({ onEnter }: CinematicLandingProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);

  // Lenis 平滑滚动（reduced-motion 时退化为原生滚动）→ store.scrollProgress
  useLenisScroll();

  // 透明订阅 store：把进度写成 CSS 变量 --sp 驱动三幕区间 crossfade，并按阈值门控 CTA 点击
  useEffect(() => {
    const apply = (p: number): void => {
      rootRef.current?.style.setProperty("--sp", p.toFixed(4));
      const cta = ctaRef.current;
      if (cta !== null) {
        cta.style.pointerEvents = p >= CTA_ACTIVE_FROM ? "auto" : "none";
      }
    };
    apply(useCinematicStore.getState().scrollProgress);
    return useCinematicStore.subscribe((state) => apply(state.scrollProgress));
  }, []);

  return (
    <div className={styles.root} ref={rootRef}>
      <div className={styles.chrome}>
        <span className={styles.logo}>AI 视觉对话助手</span>
        <button type="button" className={styles.skip} onClick={onEnter}>
          跳过
        </button>
      </div>

      <div className={styles.stage}>
        <div className={`${styles.act} ${styles.hero}`}>
          <div className={styles.actInner}>
            {/* 主标题两句间用全角空格(U+3000)拉开电影感间距；写成字符串字面量以规避 no-irregular-whitespace */}
            <h1 className={styles.title}>{"看见你所见　听懂你所说"}</h1>
            <p className={styles.subtitle}>按住说话，它便看着你的世界，回答你。</p>
          </div>
        </div>

        <div className={`${styles.act} ${styles.beat1}`}>
          <div className={styles.actInner}>
            <h2 className={styles.beatTitle}>它看得见</h2>
            <p className={styles.beatLead}>摄像头里的字、物、屏幕，一眼读懂。</p>
          </div>
        </div>

        <div className={`${styles.act} ${styles.beat2}`}>
          <div className={styles.actInner}>
            <h2 className={styles.beatTitle}>它听得懂</h2>
            <p className={styles.beatLead}>按住说话，中文即时成文。</p>
          </div>
        </div>

        <div className={`${styles.act} ${styles.beat3}`}>
          <div className={styles.actInner}>
            <h2 className={styles.beatTitle}>它边想边答</h2>
            <p className={styles.beatLead}>回答边生成边播报，几乎没有等待。</p>
          </div>
        </div>

        <div className={`${styles.act} ${styles.cta}`}>
          <div className={styles.actInner}>
            <h2 className={styles.ctaTitle}>准备好了吗</h2>
            <button type="button" className={styles.ctaButton} ref={ctaRef} onClick={onEnter}>
              开始对话
            </button>
          </div>
        </div>
      </div>

      <div className={styles.scrollHint} aria-hidden="true">
        <span>向下滚动</span>
        <span className={styles.scrollChevron} />
      </div>
    </div>
  );
}
