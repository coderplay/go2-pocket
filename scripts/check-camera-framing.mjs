import assert from 'node:assert/strict';
import * as THREE from 'three';
import {lidarFrame} from '../src/ui/scene/camera-framing.ts';

for (const [w,h] of [[926,428],[852,393],[667,375],[844,390],[393,852]]) {
  for (const yaw of [0, Math.PI/2, -Math.PI/3]) {
    const robot = new THREE.Vector3(0,0,-0.3);
    const bounds = new THREE.Box3(new THREE.Vector3(-4,-3,-0.4),new THREE.Vector3(5,4,2));
    const fit = lidarFrame(bounds,robot,yaw,w,h,70);
    const camera = new THREE.PerspectiveCamera(70,w/h,0.1,fit.far);
    camera.up.set(0,0,1); camera.position.copy(fit.position); camera.lookAt(fit.target);
    camera.setViewOffset(w,h,0,fit.offsetY,w,h); camera.updateMatrixWorld();
    const top = Math.min(88,h*.22), bottom = Math.min(112,h*.28);
    const center = fit.target.clone().project(camera);
    assert.ok(Math.abs((1-center.y)*h/2 - (h+top-bottom)/2) < 1e-5, 'center must lie between the control rows');
    for (const x of [bounds.min.x,bounds.max.x]) for (const y of [bounds.min.y,bounds.max.y]) for (const z of [bounds.min.z,bounds.max.z]) {
      const p = new THREE.Vector3(x,y,z).project(camera), px=(p.x+1)*w/2, py=(1-p.y)*h/2;
      assert.ok(px>=0 && px<=w && py>=top && py<=h-bottom && p.z<1, `${w}x${h}: cloud must fit without clipping`);
    }
    const larger = lidarFrame(bounds.clone().expandByScalar(4),robot,yaw,w,h,70);
    assert.ok(larger.position.distanceTo(larger.target)>fit.position.distanceTo(fit.target),'larger cloud must zoom out');
  }
}
console.log('PASS: lidar bounds fit 5 phone sizes and 3 headings; target stays between controls, no clipping, larger areas zoom out.');
