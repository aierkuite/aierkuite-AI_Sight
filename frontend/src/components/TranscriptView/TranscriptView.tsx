import styles from "./TranscriptView.module.css";

interface TranscriptViewProps {
  value: string;
  listening: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
}

/**
 * 作用：展示和编辑实时语音转写文本
 * 参数：value 当前问题文本，listening 是否正在识别，disabled 是否禁用编辑，onChange 文本变化回调
 * 返回：转写文本区域组件
 */
export function TranscriptView({ value, listening, disabled, onChange }: TranscriptViewProps) {
  return (
    <section className={styles.panel} aria-labelledby="transcript-title">
      <div className={styles.header}>
        <h2 id="transcript-title">当前问题</h2>
        <span className={listening ? styles.badgeLive : styles.badgeIdle}>
          {listening ? "识别中" : "可编辑"}
        </span>
      </div>
      <textarea
        className={styles.textarea}
        value={value}
        disabled={disabled}
        rows={5}
        placeholder="按住说话，或在这里输入问题"
        onChange={(event) => onChange(event.target.value)}
      />
      <p className={styles.liveText} aria-live="polite">
        {value || "等待中文语音输入"}
      </p>
    </section>
  );
}
