import { type FormEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

import { AnswerView } from "./components/AnswerView/AnswerView";
import { AppHeader } from "./components/AppHeader/AppHeader";
import { CameraPreview } from "./components/CameraPreview/CameraPreview";
import { ConversationList } from "./components/ConversationList/ConversationList";
import { ErrorBanner } from "./components/ErrorBanner/ErrorBanner";
import { TalkButton } from "./components/TalkButton/TalkButton";
import { TranscriptView } from "./components/TranscriptView/TranscriptView";
import { CinematicLanding } from "./cinematic/CinematicLanding";
import { LiveBackdrop } from "./effects/LiveBackdrop";
import { appendRound, trimHistory } from "./lib/constants";
import { useCinematicStore } from "./store/cinematic";
import type { HistoryTurn } from "./types/chat";
import { useCamera } from "./hooks/useCamera";
import { useChatStream } from "./hooks/useChatStream";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { useSpeechSynthesis } from "./hooks/useSpeechSynthesis";
import styles from "./App.module.css";

/** 懒加载 3D 电影场景：three 栈较大，仅在 WebGL 可用时按需加载（plan §10） */
const Scene = lazy(() => import("./cinematic/Scene"));

/**
 * 作用：过滤并去重错误提示
 * 参数：messages 候选错误提示列表
 * 返回：可展示的唯一错误提示列表
 */
function uniqueMessages(messages: Array<string | null | false>): string[] {
  return Array.from(new Set(messages.filter((message): message is string => Boolean(message))));
}

/**
 * 作用：探测是否启用 3D 场景——需 WebGL 可用且系统未开启「减少动态效果」
 * 参数：无
 * 返回：true 则常驻 <Scene/>，否则回退 2D <LiveBackdrop/>
 */
function detectSceneEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return false;
  }
  try {
    return document.createElement("canvas").getContext("webgl") !== null;
  } catch {
    return false;
  }
}

/**
 * 作用：渲染 AI 视觉对话助手单屏应用
 * 参数：无
 * 返回：React 应用节点
 */
export function App() {
  const camera = useCamera();
  const speech = useSpeechRecognition();
  const speaker = useSpeechSynthesis();
  const chat = useChatStream();
  const [history, setHistory] = useState<HistoryTurn[]>([]);
  const [draftText, setDraftText] = useState("");
  const [appError, setAppError] = useState<string | null>(null);

  const stage = useCinematicStore((state) => state.stage);
  const setStage = useCinematicStore((state) => state.setStage);
  const [sceneEnabled] = useState(detectSceneEnabled);
  const shellRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (speech.transcript) {
      setDraftText(speech.transcript);
    }
  }, [speech.transcript]);

  // 开场阶段把工作台标记为 inert：保持挂载（摄像头/语音 hook 绑定不变），但移出焦点与无障碍树
  useEffect(() => {
    shellRef.current?.toggleAttribute("inert", stage === "intro");
  }, [stage]);

  const errors = useMemo(
    () =>
      uniqueMessages([
        appError,
        camera.error,
        speech.error,
        chat.error,
        !camera.supported && "当前浏览器不支持摄像头访问，请使用最新版 Chrome 或 Edge",
        !speech.supported && "当前浏览器不支持语音识别，请使用最新版 Chrome 或 Edge",
        !speaker.supported && "当前浏览器不支持语音播报，仍可查看文字回答",
      ]),
    [
      appError,
      camera.error,
      camera.supported,
      chat.error,
      speaker.supported,
      speech.error,
      speech.supported,
    ],
  );

  const canSend = draftText.trim().length > 0 && camera.ready && !chat.isStreaming;

  /**
   * 作用：进入双栏工作台（CTA 与「跳过」共用）
   * 参数：无
   * 返回：无
   */
  function handleEnterWorkspace(): void {
    setStage("workspace");
  }

  /**
   * 作用：开始一次按住说话识别
   * 参数：无
   * 返回：无
   */
  function handleStartTalking(): void {
    if (chat.isStreaming) {
      return;
    }
    setAppError(null);
    speaker.cancel();
    speech.start();
  }

  /**
   * 作用：结束当前语音识别
   * 参数：无
   * 返回：无
   */
  function handleStopTalking(): void {
    speech.stop();
  }

  /**
   * 作用：提交当前问题、截图和历史并处理流式回答
   * 参数：event 表单提交事件
   * 返回：异步完成提交流程
   */
  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const text = draftText.trim();
    if (!text) {
      setAppError("请先说出或输入问题");
      return;
    }
    if (!camera.ready) {
      setAppError("摄像头画面尚未准备好，请授权后稍等片刻");
      return;
    }

    const image = camera.captureFrame();
    if (image === null) {
      setAppError("当前画面无法截图，请确认摄像头预览已显示");
      return;
    }

    setAppError(null);
    speaker.cancel();

    try {
      const answer = await chat.send(
        {
          text,
          image,
          history: trimHistory(history),
        },
        {
          onDelta: speaker.speak,
          onDone: speaker.flush,
        },
      );
      setHistory((current) => appendRound(current, text, answer));
      setDraftText("");
      speech.reset();
    } catch (error) {
      if (error instanceof Error) {
        setAppError(error.message);
      } else {
        setAppError("请求失败，请稍后再试");
      }
    }
  }

  return (
    <>
      {sceneEnabled ? (
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      ) : (
        <LiveBackdrop />
      )}

      <main
        ref={shellRef}
        className={stage === "intro" ? `${styles.shell} ${styles.shellHidden}` : styles.shell}
      >
        <AppHeader />
        <section className={styles.workspace} aria-label="AI 视觉对话助手">
          <div className={styles.leftPane}>
            <CameraPreview
              videoRef={camera.videoRef}
              ready={camera.ready}
              supported={camera.supported}
            />
            <ErrorBanner messages={errors} />
            <form className={styles.controls} onSubmit={(event) => void handleSubmit(event)}>
              <TalkButton
                listening={speech.listening}
                disabled={chat.isStreaming || !speech.supported}
                onStart={handleStartTalking}
                onStop={handleStopTalking}
              />
              <button className={styles.sendButton} type="submit" disabled={!canSend}>
                发送问题
              </button>
              {chat.isStreaming ? (
                <button className={styles.secondaryButton} type="button" onClick={chat.abort}>
                  停止回答
                </button>
              ) : null}
            </form>
            <TranscriptView
              value={draftText}
              listening={speech.listening}
              disabled={chat.isStreaming}
              onChange={setDraftText}
            />
          </div>
          <div className={styles.rightPane}>
            <AnswerView answer={chat.answer} streaming={chat.isStreaming} speaking={speaker.speaking} />
            <ConversationList history={history} />
          </div>
        </section>
      </main>

      {stage === "intro" ? <CinematicLanding onEnter={handleEnterWorkspace} /> : null}
    </>
  );
}
