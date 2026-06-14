import styles from "./LiveBackdrop.module.css";

/**
 * 作用：渲染与业务状态解耦的页面背景纹理
 * 参数：无
 * 返回：装饰性背景层
 */
export function LiveBackdrop() {
  return <div className={styles.backdrop} aria-hidden="true" />;
}
