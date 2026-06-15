import styles from "./AppHeader.module.css";

interface AppHeaderProps {
  title?: string;
}

/**
 * 作用：渲染纤细顶部品牌栏（展示体应用名 + 装饰状态点 + 蓝紫渐变发丝分割线）
 * 参数：title 可选品牌名，默认「AI 视觉对话助手」
 * 返回：与业务状态解耦的装饰性页眉
 */
export function AppHeader({ title = "AI 视觉对话助手" }: AppHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <span className={styles.brand}>{title}</span>
        <span className={styles.status} aria-hidden="true">
          <span className={styles.dot} />
          实时
        </span>
      </div>
      <div className={styles.line} aria-hidden="true" />
    </header>
  );
}
