import type { KeyboardEvent, PointerEvent } from "react";

import styles from "./TalkButton.module.css";

interface TalkButtonProps {
  listening: boolean;
  disabled?: boolean;
  onStart: () => void;
  onStop: () => void;
}

/**
 * 作用：判断键盘事件是否应触发按住说话
 * 参数：key 键盘按键名称
 * 返回：Space 或 Enter 时返回 true
 */
function isTalkKey(key: string): boolean {
  return key === " " || key === "Enter";
}

/**
 * 作用：展示可按住的语音输入按钮
 * 参数：listening 是否正在识别，disabled 是否禁用，onStart 开始识别回调，onStop 停止识别回调
 * 返回：语音输入按钮组件
 */
export function TalkButton({ listening, disabled = false, onStart, onStop }: TalkButtonProps) {
  /**
   * 作用：处理指针按下开始说话
   * 参数：event 指针事件
   * 返回：无
   */
  function handlePointerDown(event: PointerEvent<HTMLButtonElement>): void {
    if (disabled) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    onStart();
  }

  /**
   * 作用：处理指针释放结束说话
   * 参数：event 指针事件
   * 返回：无
   */
  function handlePointerUp(event: PointerEvent<HTMLButtonElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onStop();
  }

  /**
   * 作用：处理键盘按下开始说话
   * 参数：event 键盘事件
   * 返回：无
   */
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (!disabled && !event.repeat && isTalkKey(event.key)) {
      event.preventDefault();
      onStart();
    }
  }

  /**
   * 作用：处理键盘释放结束说话
   * 参数：event 键盘事件
   * 返回：无
   */
  function handleKeyUp(event: KeyboardEvent<HTMLButtonElement>): void {
    if (isTalkKey(event.key)) {
      event.preventDefault();
      onStop();
    }
  }

  return (
    <button
      className={listening ? styles.talkActive : styles.talk}
      type="button"
      aria-pressed={listening}
      aria-label={listening ? "停止说话" : "按住说话"}
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      {listening ? "松开结束" : "按住说话"}
    </button>
  );
}
