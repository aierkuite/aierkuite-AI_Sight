import styles from "./AnswerView.module.css";

interface AnswerViewProps {
  answer: string;
  streaming: boolean;
  speaking: boolean;
}

/**
 * 作用：展示流式 AI 回答与播报状态
 * 参数：answer 当前流式回答，streaming 是否正在接收，speaking 是否正在语音播报
 * 返回：回答展示组件
 */
export function AnswerView({ answer, streaming, speaking }: AnswerViewProps) {
  const statusText = streaming ? "回答生成中" : speaking ? "语音播报中" : "等待提问";

  return (
    <section className={styles.panel} aria-labelledby="answer-title">
      <div className={styles.header}>
        <h2 id="answer-title">AI 回答</h2>
        <span className={streaming ? styles.badgeLive : styles.badgeIdle}>{statusText}</span>
      </div>
      <div className={styles.answer} aria-live="polite" aria-busy={streaming}>
        {answer || "回答会在这里逐字显示，并在形成句子后开始播报"}
      </div>
    </section>
  );
}
