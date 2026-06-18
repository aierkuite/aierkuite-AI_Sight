import { useEffect, useRef } from "react";

import { useCinematicStore } from "../store/cinematic";
import { SoundToggle } from "./SoundToggle";
import { usePagedScroll } from "./usePagedScroll";
import styles from "./CinematicLanding.module.css";

interface CinematicLandingProps {
  /** 进入工作台（CTA 与「跳过」共用） */
  onEnter: () => void;
}

/** CTA 进入工作台的滚动阈值：到达 Act3 才让按钮可点（隐形态不吞点击） */
const CTA_ACTIVE_FROM = 0.8;

/**
 * 作用：电影开场离散整屏翻页（5 页：Hero / 看得见 / 听得懂 / 边想边答 / CTA）——三幕文字叠层按
 *   scrollProgress 区间 crossfade + 轻位移，始终可见可点的角标（logo + 跳过）。
 *   翻页由 usePagedScroll 接管滚轮/键盘/触摸（一次手势一页），rAF 补间写进 store；此处透明订阅 store
 *   把 scrollProgress / peek 写成 CSS 变量 --sp / --peek（不触发 React 重渲染）——--sp 驱动三幕区间映射，
 *   --peek 驱动 .root 末页整体淡出退场（让位给 App 里从屏幕底部升起的工作台 shell）；并按阈值开关 CTA 的 pointer-events。
 *   纯叠层：容器 pointer-events:none，仅交互元素 auto；颜色全部走 CSS 令牌。
 * 参数：onEnter 进入工作台回调
 * 返回：满视口的离散翻页开场叠层
 */
export function CinematicLanding({ onEnter }: CinematicLandingProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);

  // 离散整屏翻页（滚轮/键盘/触摸一次手势一页；末页两段式掭起 → onEnter）→ store.scrollProgress / peek
  usePagedScroll(onEnter);

  // 透明订阅 store：把 scrollProgress / peek 写成 CSS 变量 --sp / --peek，并按阈值门控 CTA 点击
  useEffect(() => {
    const apply = (): void => {
      const { scrollProgress, peek } = useCinematicStore.getState();
      const root = rootRef.current;
      if (root !== null) {
        root.style.setProperty("--sp", scrollProgress.toFixed(4));
        root.style.setProperty("--peek", peek.toFixed(4));
      }
      const cta = ctaRef.current;
      if (cta !== null) {
        cta.style.pointerEvents = scrollProgress >= CTA_ACTIVE_FROM ? "auto" : "none";
      }
    };
    apply();
    return useCinematicStore.subscribe(apply);
  }, []);

  return (
    <div className={styles.root} ref={rootRef}>
      <div className={styles.chrome}>
        <span className={styles.logo}>AI 视觉对话助手</span>
        <div className={styles.actions}>
          <SoundToggle />
          <button type="button" className={styles.skip} onClick={onEnter}>
            跳过
          </button>
        </div>
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
