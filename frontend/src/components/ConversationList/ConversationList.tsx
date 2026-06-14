import type { HistoryTurn } from "../../types/chat";
import styles from "./ConversationList.module.css";

interface ConversationListProps {
  history: HistoryTurn[];
}

interface ConversationRound {
  key: string;
  user: string;
  assistant: string;
}

/**
 * 作用：把扁平历史消息转换为对话轮次
 * 参数：history 最近历史消息列表
 * 返回：按最新优先排列的对话轮次
 */
function toRounds(history: HistoryTurn[]): ConversationRound[] {
  const rounds: ConversationRound[] = [];
  for (let index = 0; index < history.length; index += 2) {
    const user = history[index];
    const assistant = history[index + 1];
    if (user?.role === "user" && assistant?.role === "assistant") {
      rounds.push({
        key: `${index}-${user.content.length}-${assistant.content.length}`,
        user: user.content,
        assistant: assistant.content,
      });
    }
  }
  return rounds.reverse();
}

/**
 * 作用：展示最近 6 轮纯文本对话历史
 * 参数：history 内存中的纯文本历史
 * 返回：最近对话列表组件
 */
export function ConversationList({ history }: ConversationListProps) {
  const rounds = toRounds(history);

  return (
    <section className={styles.panel} aria-labelledby="conversation-title">
      <div className={styles.header}>
        <h2 id="conversation-title">最近对话</h2>
        <span>{rounds.length} 轮</span>
      </div>
      {rounds.length === 0 ? (
        <p className={styles.empty}>暂无历史，刷新页面也会清空这里</p>
      ) : (
        <ol className={styles.list}>
          {rounds.map((round) => (
            <li className={styles.item} key={round.key}>
              <p className={styles.user}>
                <strong>你：</strong>
                {round.user}
              </p>
              <p className={styles.assistant}>
                <strong>AI：</strong>
                {round.assistant}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
