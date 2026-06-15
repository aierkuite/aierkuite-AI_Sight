import { useEffect, useRef } from "react";

import styles from "./LiveBackdrop.module.css";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  a: number;
  color: Rgb;
}

interface Glow {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  a: number;
  color: Rgb;
}

/** 漂移实体的最小可移动接口（粒子与辉光共用 x/y/vx/vy） */
interface Movable {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const MAX_DPR = 2;
const PERIWINKLE: Rgb = { r: 155, g: 184, b: 225 };

/**
 * 作用：把十六进制颜色解析为 RGB 通道，便于在 canvas 中按不同透明度作画
 * 参数：hex 形如 #9bb8e1 的颜色串
 * 返回：r/g/b 三通道（解析失败回退到 periwinkle）
 */
function hexToRgb(hex: string): Rgb {
  const cleaned = hex.replace("#", "").trim();
  const full = cleaned.length === 3 ? cleaned.replace(/(.)/g, "$1$1") : cleaned;
  const int = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(int)) {
    return PERIWINKLE;
  }
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

/**
 * 作用：拼装 rgba 颜色串
 * 参数：color RGB 通道；alpha 透明度
 * 返回：canvas 可用的 rgba(...) 字符串
 */
function rgbaOf(color: Rgb, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

/**
 * 作用：环绕漂移——实体移出视口边界后从对侧重新进入
 * 参数：value 当前坐标；max 该轴可视尺寸；margin 边界缓冲
 * 返回：包裹后的坐标
 */
function wrap(value: number, max: number, margin: number): number {
  if (value < -margin) {
    return max + margin;
  }
  if (value > max + margin) {
    return -margin;
  }
  return value;
}

/**
 * 作用：按 delta-time 推进一个可移动实体，保证不同刷新率下漂移速度一致
 * 参数：entity 拥有 x/y/vx/vy 的实体；dt 帧间隔秒；bounds 视口尺寸；margin 边界缓冲
 * 返回：无（原地更新坐标）
 */
function advance(
  entity: Movable,
  dt: number,
  bounds: { width: number; height: number },
  margin: number,
): void {
  entity.x = wrap(entity.x + entity.vx * dt, bounds.width, margin);
  entity.y = wrap(entity.y + entity.vy * dt, bounds.height, margin);
}

/**
 * 作用：与业务状态解耦的电影感背景——加法混合的大辉光 + 明亮漂移粒子 + 暗角
 * 参数：无（仅读取 CSS 变量，绝不读取任何 chat/设备状态）
 * 返回：固定铺底、不拦截指针的 aria-hidden canvas 层
 */
export function LiveBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const cs = getComputedStyle(canvas);
    const readColor = (name: string, fallback: string): Rgb => {
      const value = cs.getPropertyValue(name).trim();
      return hexToRgb(value.length > 0 ? value : fallback);
    };
    const accent = readColor("--color-accent", "#9bb8e1");
    const accentStrong = readColor("--color-accent-strong", "#b8cdee");
    const accentDeep = readColor("--color-accent-deep", "#2c4e73");
    const bg = readColor("--color-bg", "#000209");
    const glowPalette = [accentStrong, accent, accentDeep];

    const bounds = { width: window.innerWidth, height: window.innerHeight };
    const particles: Particle[] = [];
    const glows: Glow[] = [];

    const seedScene = (): void => {
      particles.length = 0;
      glows.length = 0;
      const count = Math.min(170, Math.max(70, Math.round((bounds.width * bounds.height) / 13000)));
      for (let i = 0; i < count; i += 1) {
        particles.push({
          x: Math.random() * bounds.width,
          y: Math.random() * bounds.height,
          vx: (Math.random() - 0.5) * 22,
          vy: (Math.random() - 0.5) * 22,
          r: 0.8 + Math.random() * 1.9,
          a: 0.35 + Math.random() * 0.5,
          color: Math.random() < 0.5 ? accent : accentStrong,
        });
      }
      const span = Math.max(bounds.width, bounds.height);
      for (let i = 0; i < 3; i += 1) {
        glows.push({
          x: Math.random() * bounds.width,
          y: Math.random() * bounds.height,
          vx: (Math.random() - 0.5) * 14,
          vy: (Math.random() - 0.5) * 14,
          radius: span * (0.42 + Math.random() * 0.22),
          a: 0.4 + Math.random() * 0.18,
          color: glowPalette[i % glowPalette.length],
        });
      }
    };

    const resize = (): void => {
      bounds.width = window.innerWidth;
      bounds.height = window.innerHeight;
      canvas.width = Math.round(bounds.width * dpr);
      canvas.height = Math.round(bounds.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (): void => {
      const { width, height } = bounds;
      ctx.clearRect(0, 0, width, height);

      // 大辉光与粒子用加法混合，在近黑底上叠出明亮的蓝色光晕
      ctx.globalCompositeOperation = "lighter";
      for (const glow of glows) {
        const gradient = ctx.createRadialGradient(glow.x, glow.y, 0, glow.x, glow.y, glow.radius);
        gradient.addColorStop(0, rgbaOf(glow.color, glow.a));
        gradient.addColorStop(0.45, rgbaOf(glow.color, glow.a * 0.32));
        gradient.addColorStop(1, rgbaOf(glow.color, 0));
        ctx.fillStyle = gradient;
        ctx.fillRect(
          glow.x - glow.radius,
          glow.y - glow.radius,
          glow.radius * 2,
          glow.radius * 2,
        );
      }
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = rgbaOf(p.color, p.a);
        ctx.fill();
      }

      // 暗角：从中心透明到边缘加深，营造电影构图（不与上方光晕争抢混合模式）
      ctx.globalCompositeOperation = "source-over";
      const vignette = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.3,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.78,
      );
      vignette.addColorStop(0, rgbaOf(bg, 0));
      vignette.addColorStop(1, rgbaOf(bg, 0.6));
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);
    };

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let last = 0;

    const tick = (time: number): void => {
      const dt = last === 0 ? 0 : Math.min((time - last) / 1000, 0.05);
      last = time;
      for (const p of particles) {
        advance(p, dt, bounds, 24);
      }
      for (const glow of glows) {
        advance(glow, dt, bounds, glow.radius);
      }
      draw();
      frame = window.requestAnimationFrame(tick);
    };

    const start = (): void => {
      if (reduceMotion.matches) {
        draw();
        return;
      }
      last = 0;
      frame = window.requestAnimationFrame(tick);
    };

    const stop = (): void => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
    };

    const handleResize = (): void => {
      resize();
      seedScene();
      if (reduceMotion.matches) {
        draw();
      }
    };

    const handleMotionChange = (): void => {
      stop();
      start();
    };

    resize();
    seedScene();
    start();

    window.addEventListener("resize", handleResize);
    reduceMotion.addEventListener("change", handleMotionChange);

    return () => {
      stop();
      window.removeEventListener("resize", handleResize);
      reduceMotion.removeEventListener("change", handleMotionChange);
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.backdrop} aria-hidden="true" />;
}
