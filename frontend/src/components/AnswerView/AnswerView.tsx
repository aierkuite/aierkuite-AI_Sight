import styles from "./AnswerView.module.css";

interface AnswerViewProps {
  answer: string;
  streaming: boolean;
  preparing: boolean;
  speaking: boolean;
}

/**
 * 作用：展示 AI 回答与整段语音生成状态
 * 参数：answer 当前可见回答，streaming 是否正在接收回答，preparing 是否正在生成整段语音，speaking 是否正在语音播报
 * 返回：回答展示组件
 */
export function AnswerView({ answer, streaming, preparing, speaking }: AnswerViewProps) {
  const busy = streaming || preparing;
  const statusText = streaming
    ? "回答生成中"
    : preparing
      ? "语音生成中"
      : speaking
        ? "语音播报中"
        : "等待提问";
  const placeholder = busy ? "正在生成完整回答和语音，请稍候" : "回答会在这里显示";

  return (
    <section className={styles.panel} aria-labelledby="answer-title">
      <div className={styles.header}>
        <h2 id="answer-title">AI 回答</h2>
        <span className={streaming ? styles.badgeLive : styles.badgeIdle}>{statusText}</span>
      </div>
      <div
        className={busy ? `${styles.answer} ${styles.streaming}` : styles.answer}
        aria-live="polite"
        aria-busy={busy}
      >
        {answer || placeholder}
      </div>
    </section>
  );
}
