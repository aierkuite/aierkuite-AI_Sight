import { GITHUB_REPO_URL, SHOWCASE_VIDEO_BVID } from "../../lib/showcase";
import styles from "./ShowcasePanel.module.css";

interface Feature {
  /** 亮点标题 */
  title: string;
  /** 一句话说明 */
  desc: string;
}

/** 功能亮点（摘自 README「功能特性」，压成一句话） */
const FEATURES: Feature[] = [
  { title: "视觉问答", desc: "每次提问截取当前摄像头帧一并发送，模型基于画面作答。" },
  { title: "语音输入", desc: "「按住说话」实时转写中文，也支持直接输入文字。" },
  { title: "流式生成", desc: "后端 SSE 逐 token 流式生成，语音就绪后整段呈现。" },
  { title: "日语克隆语音", desc: "回答经 GPT-SoVITS 合成克隆音色日语，字音同步播报。" },
  { title: "电影化开场", desc: "Three.js 5 页整屏翻页开场，末页两段式掭起进入工作台。" },
  { title: "优雅降级", desc: "无 WebGL 回退 2D 背景；设备能力不足时给出明确中文提示。" },
];

/**
 * 作用：开场结束后占据 shell 的静态展示内容——标题/B站录屏/功能亮点/GitHub 与本地部署提示。
 *   纯展示：不引入任何设备或后端能力，绝不触发摄像头授权或 /api 请求。
 * 参数：无
 * 返回：展示面板节点
 */
export function ShowcasePanel() {
  return (
    <div className={styles.panel}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>在线演示 · Online Demo</p>
        <h1 className={styles.title}>AI 视觉对话助手</h1>
        <p className={styles.lead}>
          对着摄像头提问，AI 看着画面用日语回答，并以克隆音色朗读出来。
        </p>
      </header>

      <section className={styles.videoSection} aria-label="演示录屏">
        {SHOWCASE_VIDEO_BVID ? (
          <div className={styles.videoFrame}>
            <iframe
              className={styles.video}
              src={`//player.bilibili.com/player.html?bvid=${SHOWCASE_VIDEO_BVID}&autoplay=0&high_quality=1`}
              title="演示录屏"
              loading="lazy"
              allow="fullscreen"
              allowFullScreen
            />
          </div>
        ) : (
          <div className={`${styles.videoFrame} ${styles.videoPlaceholder}`}>
            <span className={styles.playMark} aria-hidden="true" />
            <p className={styles.placeholderText}>演示视频即将上线</p>
            <p className={styles.placeholderHint}>完整的「看画面 → 日语语音回答」录屏正在准备中</p>
          </div>
        )}
      </section>

      <section className={styles.features} aria-label="功能亮点">
        {FEATURES.map((feature) => (
          <article key={feature.title} className={styles.feature}>
            <h2 className={styles.featureTitle}>{feature.title}</h2>
            <p className={styles.featureDesc}>{feature.desc}</p>
          </article>
        ))}
      </section>

      <footer className={styles.actions}>
        <a
          className={styles.githubButton}
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noreferrer noopener"
        >
          在 GitHub 查看源码
        </a>
        <p className={styles.localHint}>
          完整的实时摄像头对话与语音功能需在本地部署后体验，详见仓库 README。
        </p>
      </footer>
    </div>
  );
}
