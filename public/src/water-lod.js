import * as THREE from 'three';
import { WAVE_HEIGHT_LIMIT } from './wave-field.js';

const SIZE = 200, HALF = 4;
function tileGeometry(segments) {
  const geometry = new THREE.PlaneGeometry(SIZE, SIZE, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const source = geometry.attributes.position.array;
  const positions = Array.from(source), indices = Array.from(geometry.index.array);
  const edge = [];
  for (let i = 0; i <= segments; i++) edge.push(i);
  for (let i = 1; i <= segments; i++) edge.push(i * (segments + 1) + segments);
  for (let i = segments - 1; i >= 0; i--) edge.push(segments * (segments + 1) + i);
  for (let i = segments - 1; i > 0; i--) edge.push(i * (segments + 1));
  const bottom = positions.length / 3;
  for (const i of edge) positions.push(source[i * 3], -3, source[i * 3 + 2]);
  for (let i = 0; i < edge.length; i++) {
    const j = (i + 1) % edge.length;
    indices.push(edge[i], edge[j], bottom + i, edge[j], bottom + j, bottom + i);
  }
  geometry.dispose();
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setIndex(indices);
  // Bounds include the shared wave amplitude; skirts cover mismatched edge samples.
  result.boundingBox = new THREE.Box3(new THREE.Vector3(-100,-3-WAVE_HEIGHT_LIMIT,-100),new THREE.Vector3(100,WAVE_HEIGHT_LIMIT,100));
  result.boundingSphere = new THREE.Sphere(new THREE.Vector3(0,-1.5,0),142);
  return result;
}

export function createWaterLOD(scene, material) {
  const geometries = [40,20,8].map(tileGeometry);
  const tiles = [];
  for (let z = -HALF; z <= HALF; z++) for (let x = -HALF; x <= HALF; x++) {
    const mesh = new THREE.Mesh(geometries[0], material);
    mesh.userData.tag = 'water'; scene.add(mesh);
    tiles.push({mesh,x,z,level:0});
  }
  const baseline = new THREE.Mesh(new THREE.PlaneGeometry(1800,1800,360,360), material);
  baseline.rotation.x = -Math.PI / 2; baseline.userData.tag = 'water-baseline';
  scene.add(baseline);
  const sphere = new THREE.Sphere();
  const stats = {total:tiles.length, visible:0, culled:0, levels:[0,0,0]};
  return {
    prepare(camera, frustum, boat, optimized) {
      baseline.visible = !optimized;
      baseline.position.set(boat.x,0,boat.z);
      stats.visible=0; stats.culled=0; stats.levels.fill(0);
      const cx=Math.round(boat.x/SIZE)*SIZE, cz=Math.round(boat.z/SIZE)*SIZE;
      for (const tile of tiles) {
        const {mesh}=tile;
        mesh.position.set(cx+tile.x*SIZE,0,cz+tile.z*SIZE);
        sphere.center.set(mesh.position.x,-1.5,mesh.position.z); sphere.radius=142;
        mesh.visible = optimized && frustum.intersectsSphere(sphere);
        if (!optimized) continue;
        if (!mesh.visible) { stats.culled++; continue; }
        const distance=Math.hypot(camera.position.x-mesh.position.x,camera.position.z-mesh.position.z);
        // Hysteresis keeps a tile from switching repeatedly at a distance boundary.
        const thresholds=[240,520];
        let level=tile.level;
        while(level<2 && distance>thresholds[level]*1.08) level++;
        while(level>0 && distance<thresholds[level-1]*.92) level--;
        tile.level=level; mesh.geometry=geometries[level];
        stats.visible++; stats.levels[level]++;
      }
    },
    reset(){for(const tile of tiles) tile.level=0;},
    state(){return {...stats,levels:[...stats.levels]};}
  };
}
