import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";

import { FluidParticles } from "./FluidParticles";
import { HeroFigure } from "./HeroFigure";
import { useCinematicStore } from "../store/cinematic";

interface Palette {
  bg: THREE.Color;
  accent: THREE.Color;
  accentStrong: THREE.Color;
  accentDeep: THREE.Color;
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
 * 作用：Canvas 内根——灯光、Hero、粒子、Bloom，并按帧驱动鼠标视差与工作台降强度
 * 参数：palette CSS 令牌派生调色板
 * 返回：场景子树
 */
function SceneContents({ palette }: { palette: Palette }) {
  const keyLightRef = useRef<THREE.DirectionalLight>(null);
  const pointer = useRef({ x: 0, y: 0 });

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
    const workspace = useCinematicStore.getState().stage === "workspace";

    // 鼠标视差（轻微），相机始终看向原点
    const targetX = pointer.current.x * 0.9;
    const targetY = -pointer.current.y * 0.6;
    state.camera.position.x = THREE.MathUtils.damp(state.camera.position.x, targetX, 3, delta);
    state.camera.position.y = THREE.MathUtils.damp(state.camera.position.y, targetY, 3, delta);
    state.camera.lookAt(0, 0, 0);

    // 进工作台后压暗主光（低强度 ambient），泛光随之自然减弱
    const keyLight = keyLightRef.current;
    if (keyLight !== null) {
      keyLight.intensity = THREE.MathUtils.damp(keyLight.intensity, workspace ? 1 : 3.2, 2.4, delta);
    }
  });

  return (
    <>
      <color attach="background" args={[palette.bg]} />
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
      <FluidParticles colorA={palette.accent} colorB={palette.accentStrong} />

      <EffectComposer>
        <Bloom
          mipmapBlur
          intensity={1.5}
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

  return (
    <Canvas
      dpr={[1, 2]}
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
      <SceneContents palette={palette} />
    </Canvas>
  );
}
