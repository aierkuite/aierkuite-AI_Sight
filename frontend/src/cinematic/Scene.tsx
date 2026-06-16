import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";

import { FluidParticles } from "./FluidParticles";
import { HeroFigure } from "./HeroFigure";
import { RocksField } from "./RocksField";
import { useCinematicStore } from "../store/cinematic";

interface Palette {
  bg: THREE.Color;
  accent: THREE.Color;
  accentStrong: THREE.Color;
  accentDeep: THREE.Color;
}

/** 渲染档位：移动/弱机降画质（更少粒子、更低 DPR、更弱 Bloom），桌面满档 */
type Quality = "mobile" | "desktop";

/** 各档参数（移动端降画质，桌面满档） */
const QUALITY_PRESET: Record<Quality, { particles: number; bloom: number; dpr: [number, number] }> = {
  mobile: { particles: 9000, bloom: 0.8, dpr: [1, 1.5] },
  desktop: { particles: 28000, bloom: 1.5, dpr: [1, 2] },
};

/**
 * 作用：探测渲染档位——触屏/窄屏判为移动档（降粒子数、DPR、Bloom），其余为桌面满档。
 *   挂载时算一次即可（不随窗口尺寸热切换，避免重建粒子缓冲）。
 * 参数：无
 * 返回：'mobile' | 'desktop'
 */
function detectQuality(): Quality {
  if (typeof window === "undefined") {
    return "desktop";
  }
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const narrow = window.matchMedia("(max-width: 860px)").matches;
  return coarse || narrow ? "mobile" : "desktop";
}

/**
 * 作用：从 CSS 令牌读取调色板（与 LiveBackdrop 同款约定：effects 层只读 CSS 变量，不硬编码颜色）
 * 参数：无
 * 返回：四档 THREE.Color
 */
function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): THREE.Color => {
    const value = cs.getPropertyValue(name).trim();
    return new THREE.Color(value.length > 0 ? value : fallback);
  };
  return {
    bg: read("--color-bg", "#000209"),
    accent: read("--color-accent", "#9bb8e1"),
    accentStrong: read("--color-accent-strong", "#b8cdee"),
    accentDeep: read("--color-accent-deep", "#2c4e73"),
  };
}

/**
 * 作用：钟形幕权重——在 [a,b] 升起、在 [c,d] 落下，其余为 0（与 FluidParticles 的 GLSL bell() 同窗口，
 *   保证相机机位切换与粒子形态切换同步）。纯函数，走 MathUtils.smoothstep，不堆 if/else（§12-②）。
 * 参数：x 进度；a/b 升起区间；c/d 落下区间
 * 返回：0–1 权重
 */
function bell(x: number, a: number, b: number, c: number, d: number): number {
  return THREE.MathUtils.smoothstep(x, a, b) * (1 - THREE.MathUtils.smoothstep(x, c, d));
}

/**
 * 作用：Canvas 内根——灯光、Hero、粒子、Bloom，并按帧驱动鼠标视差与工作台降强度
 * 参数：palette CSS 令牌派生调色板；quality 渲染档位（决定粒子数与 Bloom 强度）
 * 返回：场景子树
 */
function SceneContents({ palette, quality }: { palette: Palette; quality: Quality }) {
  const preset = QUALITY_PRESET[quality];
  const keyLightRef = useRef<THREE.DirectionalLight>(null);
  const fogRef = useRef<THREE.FogExp2>(null);
  const pointer = useRef({ x: 0, y: 0 });
  // 阻尼后的 lookAt 目标（每幕不同朝向；逐帧 damp 后再 camera.lookAt，避免转向硬切）
  const lookAt = useRef(new THREE.Vector3(0, 0, 0));

  // §12-④：鼠标视差走 window mousemove（Canvas 全程 pointer-events:none、不挂 OrbitControls）
  useEffect(() => {
    const onMove = (event: MouseEvent): void => {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (event.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  useFrame((state, delta) => {
    const { stage, scrollProgress } = useCinematicStore.getState();
    const workspace = stage === "workspace";
    // 工作台回到 Hero-calm 构图（忽略残留滚动进度）；开场按真实滚动进度编排（§12-②：mapLinear/smoothstep + damp，不堆 if/else）
    const p = workspace ? 0 : scrollProgress;

    // 每幕权重（窗口与文字 crossfade、与粒子形态对齐）——相机/雾/光都按这组权重在「平静 Hero 基准」上偏移
    const wEye = bell(p, 0.17, 0.27, 0.38, 0.47); // Act2a 眼：正对平视、略拉远框住虹膜
    const wWave = bell(p, 0.42, 0.5, 0.58, 0.65); // Act2b 声波：相机降低、侧移、抬头看滚动波面
    const wFlow = bell(p, 0.59, 0.67, 0.77, 0.83); // Act2c 数据流：推近、沿 -z 穿行隧道
    const wCta = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(p, 0.82, 0.93, 0, 1), 0, 1); // Act3 收束

    const px = pointer.current.x;
    const py = pointer.current.y;
    const L = THREE.MathUtils.lerp;

    // —— 相机机位：从 Hero 基准 (px,py 视差, z=9, 看向中心) 依权重逐幕偏移到各自机位 ——
    let tx = px * 0.9;
    let ty = -py * 0.6;
    let tz = 9;
    const lx = 0; // 各幕 lookAt 横向始终居中（仅 ly/lz 随幕变）
    let ly = 0;
    let lz = 0;

    // 眼：正对相机平视、视差收敛、略拉远把整只「眼」框进画面
    tz = L(tz, 8.6, wEye);
    tx = L(tx, px * 0.35, wEye);
    ty = L(ty, -py * 0.3, wEye);

    // 声波：相机明显降低 + 右侧移，朝上看 -> 水平波面以掠射角呈现滚动波带
    ty = L(ty, -2.2 - py * 0.3, wWave);
    tx = L(tx, 1.6 + px * 0.4, wWave);
    tz = L(tz, 7.2, wWave);
    ly = L(ly, 0.7, wWave);
    lz = L(lz, -1.2, wWave);

    // 数据流：推近到隧道口、居中、直视 -z 沿流向穿行（速度感）
    tz = L(tz, 4.4, wFlow);
    tx = L(tx, px * 0.3, wFlow);
    ty = L(ty, py * 0.3, wFlow);
    lz = L(lz, -9, wFlow);

    // CTA：安静拉远、居中、略抬，看向中心收束核
    tz = L(tz, 8.2, wCta);
    ty = L(ty, 0.25 - py * 0.3, wCta);
    tx = L(tx, px * 0.4, wCta);

    state.camera.position.x = THREE.MathUtils.damp(state.camera.position.x, tx, 3, delta);
    state.camera.position.y = THREE.MathUtils.damp(state.camera.position.y, ty, 3, delta);
    state.camera.position.z = THREE.MathUtils.damp(state.camera.position.z, tz, 2.5, delta);

    lookAt.current.x = THREE.MathUtils.damp(lookAt.current.x, lx, 3, delta);
    lookAt.current.y = THREE.MathUtils.damp(lookAt.current.y, ly, 3, delta);
    lookAt.current.z = THREE.MathUtils.damp(lookAt.current.z, lz, 3, delta);
    state.camera.lookAt(lookAt.current);

    // 主光：整体随滚动略降；眼幕提亮成「聚焦光池」，CTA 幕压到最暗
    const keyLight = keyLightRef.current;
    if (keyLight !== null) {
      const base = THREE.MathUtils.lerp(3.4, 2.6, p) + wEye * 1.6 - wCta * 1.4;
      const target = workspace ? 1 : Math.max(base, 0.8);
      keyLight.intensity = THREE.MathUtils.damp(keyLight.intensity, target, 2.4, delta);
    }

    // 雾（雾色=底色，不会泛白）：眼幕清透聚焦、声波中等、数据流加浓制造隧道纵深、CTA 最浓最暗
    const fog = fogRef.current;
    if (fog !== null) {
      let target = THREE.MathUtils.lerp(0.012, 0.05, p);
      target = L(target, 0.022, wEye);
      target = L(target, 0.04, wWave);
      target = L(target, 0.06, wFlow);
      target = L(target, 0.085, wCta);
      fog.density = THREE.MathUtils.damp(fog.density, workspace ? 0.05 : target, 2, delta);
    }
  });

  return (
    <>
      <color attach="background" args={[palette.bg]} />
      <fogExp2 ref={fogRef} attach="fog" args={[palette.bg.getHex(), 0.012]} />
      <ambientLight intensity={0.35} color={palette.accentDeep} />
      <directionalLight
        ref={keyLightRef}
        position={[5, 6, 5]}
        intensity={3.2}
        color={palette.accentStrong}
      />
      <directionalLight position={[-6, -1, -5]} intensity={1.6} color={palette.accent} />

      <Suspense fallback={null}>
        <HeroFigure baseColor={palette.accentDeep} emissiveColor={palette.accent} />
      </Suspense>
      <Suspense fallback={null}>
        <RocksField baseColor={palette.accentDeep} emissiveColor={palette.accent} />
      </Suspense>
      <FluidParticles
        colorA={palette.accent}
        colorB={palette.accentStrong}
        colorDeep={palette.accentDeep}
        count={preset.particles}
      />

      <EffectComposer>
        {/* Bloom 强度保持静态：后幕「辉光递减」由粒子减量(uVisible/uOpacity)+渐浓雾自然实现
            ——亮源变少变暗 → Bloom 贡献随之收敛，无需逐帧改 effect 强度（避开该库 ref 的类型缺陷）。
            移动档进一步弱化 Bloom（preset.bloom）以省 GPU。 */}
        <Bloom
          mipmapBlur
          intensity={preset.bloom}
          luminanceThreshold={0.18}
          luminanceSmoothing={0.32}
          radius={0.85}
        />
      </EffectComposer>
    </>
  );
}

/**
 * 作用：常驻、纯装饰的 3D 电影背景（懒加载入口）。固定铺底、全程 pointer-events:none、DPR≤2、
 *   ACESFilmic tone mapping 避免 Bloom 劣质过曝。只读 store 的 stage 与 CSS 令牌，绝不碰 chat/设备状态。
 * 参数：无
 * 返回：固定铺底的 <Canvas>
 */
export default function Scene() {
  const palette = useMemo(() => readPalette(), []);
  const quality = useMemo(() => detectQuality(), []);

  return (
    <Canvas
      dpr={QUALITY_PRESET[quality].dpr}
      gl={{ antialias: true }}
      camera={{ position: [0, 0, 9], fov: 42 }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.15;
        // 防御兜底：canvas 基底显式设为暗色，确保任何一帧粒子稀疏时也不透出意外白底
        gl.setClearColor(palette.bg, 1);
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        background: "var(--color-bg)",
      }}
    >
      <SceneContents palette={palette} quality={quality} />
    </Canvas>
  );
}
