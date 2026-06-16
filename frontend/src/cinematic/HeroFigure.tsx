import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

import { useCinematicStore } from "../store/cinematic";

const MODEL_URL = "/cinematic/models/human.glb";

/** Hero 主体的目标视觉高度（世界单位），与相机/粒子球壳协调 */
const TARGET_HEIGHT = 4.2;
const INTRO_EMISSIVE = 0.55;
const WORKSPACE_EMISSIVE = 0.16;

interface HeroFigureProps {
  /** 暗冷金属底色（CSS --color-accent-deep 派生） */
  baseColor: THREE.Color;
  /** 自发光色（CSS --color-accent 派生），配合 Bloom 形成发光主体 */
  emissiveColor: THREE.Color;
}

/**
 * 作用：human.glb 抽象人形——缓慢漂浮 + 自转，暗冷金属/发光材质，进工作台后压暗自发光
 * 参数：baseColor/emissiveColor 来自 CSS 令牌
 * 返回：居中归一化后挂在动画 group 下的模型
 */
export function HeroFigure({ baseColor, emissiveColor }: HeroFigureProps) {
  const groupRef = useRef<THREE.Group>(null);
  const { scene } = useGLTF(MODEL_URL);

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: baseColor,
        emissive: emissiveColor,
        emissiveIntensity: INTRO_EMISSIVE,
        metalness: 0.94,
        roughness: 0.26,
        // 透明：进能力幕时淡出（不挡眼/声波/数据流形态），CTA 幕小而远地弱回归成「柔光核」
        transparent: true,
        opacity: 1,
      }),
    [baseColor, emissiveColor],
  );

  // 克隆 + 归一化（居中、缩放到目标高度）+ 统一材质；对原始 glTF 尺度/朝向不敏感
  const model = useMemo(() => {
    const root = scene.clone(true);
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.material = material;
      }
    });
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    root.position.sub(center);

    const holder = new THREE.Group();
    holder.add(root);
    holder.scale.setScalar(size.y > 0 ? TARGET_HEIGHT / size.y : 1);
    return holder;
  }, [scene, material]);

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (group === null) {
      return;
    }
    const t = state.clock.elapsedTime;
    const { stage, scrollProgress } = useCinematicStore.getState();
    const workspace = stage === "workspace";
    // 工作台回到 Hero-calm（满身居中漂浮）；开场按真实滚动进度做可见度编排
    const p = workspace ? 0 : scrollProgress;
    const spin = workspace ? 0.06 : 0.16;

    // 可见度：Hero 满；进能力幕(0.10→0.20)淡出让位给眼/声波/数据流；CTA(0.84→0.95)弱回归
    const heroVis = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(p, 0.1, 0.2, 1, 0), 0, 1);
    const ctaVis = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(p, 0.84, 0.95, 0, 1), 0, 1);
    const vis = Math.max(heroVis, ctaVis * 0.55); // CTA 仅半强度回归 -> 远处柔光核，不抢戏

    material.opacity = THREE.MathUtils.damp(material.opacity, vis, 3, delta);
    group.visible = material.opacity > 0.01;

    // CTA：缩小并后退成远处小核；Hero：原尺寸居中、缓慢漂浮（漂浮幅度随 CTA 收敛）
    const scaleK = THREE.MathUtils.lerp(1, 0.5, ctaVis);
    group.scale.setScalar(scaleK);
    group.position.y = Math.sin(t * 0.6) * 0.28 * (1 - ctaVis);
    group.position.z = THREE.MathUtils.lerp(0, -2.5, ctaVis);
    group.rotation.y += delta * spin;
    group.rotation.z = Math.sin(t * 0.4) * 0.04;

    // 自发光：工作台压暗；CTA 略提亮 -> 远处「柔光核」的辉光感
    const emTarget = workspace
      ? WORKSPACE_EMISSIVE
      : THREE.MathUtils.lerp(INTRO_EMISSIVE, 0.8, ctaVis);
    material.emissiveIntensity = THREE.MathUtils.damp(
      material.emissiveIntensity,
      emTarget,
      2.4,
      delta,
    );
  });

  return (
    <group ref={groupRef}>
      <primitive object={model} />
    </group>
  );
}

useGLTF.preload(MODEL_URL);
