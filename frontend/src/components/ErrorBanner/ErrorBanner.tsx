import styles from "./ErrorBanner.module.css";

interface ErrorBannerProps {
  messages: string[];
}

/**
 * 作用：展示权限、不支持浏览器和请求错误
 * 参数：messages 需要展示的错误提示列表
 * 返回：有错误时返回告警组件，否则返回 null
 */
export function ErrorBanner({ messages }: ErrorBannerProps) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div className={styles.banner} role="alert">
      {messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </div>
  );
}
