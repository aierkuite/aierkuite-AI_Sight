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
    const workspace = useCinematicStore.getState().stage === "workspace";
    const spin = workspace ? 0.06 : 0.16;

    group.position.y = Math.sin(t * 0.6) * 0.28;
    group.rotation.y += delta * spin;
    group.rotation.z = Math.sin(t * 0.4) * 0.04;

    material.emissiveIntensity = THREE.MathUtils.damp(
      material.emissiveIntensity,
      workspace ? WORKSPACE_EMISSIVE : INTRO_EMISSIVE,
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
