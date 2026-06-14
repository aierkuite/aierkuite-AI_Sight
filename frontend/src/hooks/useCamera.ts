import { useCallback, useEffect, useRef, useState } from "react";

interface UseCameraResult {
  videoRef: React.RefObject<HTMLVideoElement>;
  supported: boolean;
  ready: boolean;
  error: string | null;
  captureFrame: () => string | null;
}

/**
 * 作用：停止媒体流中的所有轨道
 * 参数：stream 需要释放的媒体流或空值
 * 返回：无
 */
function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => {
    track.stop();
  });
}

/**
 * 作用：封装摄像头授权、预览绑定和提交时截图
 * 参数：无
 * 返回：视频引用、可用状态、错误信息和截图方法
 */
export function useCamera(): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    if (!supported) {
      setError("当前浏览器不支持摄像头访问，请使用最新版 Chrome 或 Edge");
      return undefined;
    }

    let active = true;
    let localStream: MediaStream | null = null;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((mediaStream) => {
        if (!active) {
          stopStream(mediaStream);
          return;
        }
        localStream = mediaStream;
        setStream(mediaStream);
        setReady(true);
        setError(null);
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setReady(false);
        setError("摄像头权限被拒绝或设备不可用，请检查浏览器权限");
      });

    return () => {
      active = false;
      stopStream(localStream);
    };
  }, [supported]);

  useEffect(() => {
    if (videoRef.current !== null && stream !== null) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (video === null || video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }

    const canvas = document.createElement("canvas");
    const maxWidth = 960;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));

    const context = canvas.getContext("2d");
    if (context === null) {
      return null;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    const [, base64 = ""] = dataUrl.split(",");
    return base64 || null;
  }, []);

  return { videoRef, supported, ready, error, captureFrame };
}
