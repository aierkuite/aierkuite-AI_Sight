import styles from "./CinematicLanding.module.css";

interface CinematicLandingProps {
  /** 进入工作台（CTA 与「跳过」共用） */
  onEnter: () => void;
}

/**
 * 作用：电影开场叠层——Hero 主/副标题、「开始对话」CTA、始终可见的「跳过」、角标 logo 与向下滚动提示。
 *   纯叠层：覆盖在 3D Canvas 之上、工作台之下；容器 pointer-events:none，仅交互元素 auto。
 *   颜色全部走 CSS 令牌；按钮外发光用 box-shadow（不被裁切）；hover 规则包在 (hover:hover) 内。
 * 参数：onEnter 进入工作台回调
 * 返回：固定铺满视口的叠层
 */
export function CinematicLanding({ onEnter }: CinematicLandingProps) {
  return (
    <div className={styles.overlay}>
      <div className={styles.chrome}>
        <span className={styles.logo}>AI 视觉对话助手</span>
        <button type="button" className={styles.skip} onClick={onEnter}>
          跳过
        </button>
      </div>

      <div className={styles.hero}>
        {/* 主标题两句间用全角空格(U+3000)拉开电影感间距；写成字符串字面量以规避 no-irregular-whitespace */}
        <h1 className={styles.title}>{"看见你所见　听懂你所说"}</h1>
        <p className={styles.subtitle}>按住说话，它便看着你的世界，回答你。</p>
        <button type="button" className={styles.cta} onClick={onEnter}>
          开始对话
        </button>
      </div>

      <div className={styles.scrollHint} aria-hidden="true">
        <span>向下滚动</span>
        <span className={styles.scrollChevron} />
      </div>
    </div>
  );
}
