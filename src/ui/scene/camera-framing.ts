import * as THREE from 'three';

/** Fit a lidar volume into the unobstructed part of the phone's viewport. */
export function lidarFrame(bounds: THREE.Box3 | null, robot: THREE.Vector3, yaw: number, width: number, height: number, fov: number) {
  const w = Math.max(1, width), h = Math.max(1, height);
  const top = Math.min(88, h * 0.22);
  const bottom = Math.min(112, h * 0.28);
  const usableHeight = h - top - bottom;
  const box = bounds?.clone() ?? new THREE.Box3();
  box.expandByPoint(robot);
  const target = box.getCenter(new THREE.Vector3());
  const radius = Math.max(2.5, box.getSize(new THREE.Vector3()).length() / 2);
  const halfVertical = THREE.MathUtils.degToRad(fov / 2);
  const usableVertical = Math.atan(Math.tan(halfVertical) * usableHeight / h * 0.9);
  const usableHorizontal = Math.atan(Math.tan(halfVertical) * w / h * 0.85);
  const distance = radius / Math.sin(Math.min(usableVertical, usableHorizontal));
  const direction = new THREE.Vector3(-1, -0.55, 0.9).normalize();
  direction.applyAxisAngle(new THREE.Vector3(0, 0, 1), yaw);
  return {
    position: target.clone().addScaledVector(direction, distance), target,
    // Positive view-offset Y moves the target upward, between the UI controls.
    offsetY: (bottom - top) / 2,
    far: Math.max(500, distance + radius * 3),
  };
}
