import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const cache=new WeakMap();
function templateFor(source) {
  if(cache.has(source)) return cache.get(source);
  // Avoid caching an empty vessel while the GLB is still loading.
  if(!source.children.length) return null;
  const high=source.clone(true); high.position.set(0,0,0); high.rotation.set(0,0,0);
  high.traverse(mesh=>{if(mesh.isMesh&&mesh.userData.dynamicSail)mesh.geometry=mesh.geometry.clone();});
  high.updateMatrixWorld(true);
  const groups=new Map();
  high.traverse(mesh=>{
    if(!mesh.isMesh || !/hull|sail|jib|deck|mast/i.test(mesh.name))return;
    if(Array.isArray(mesh.material))return;
    const geometry=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if(!geometry.index){geometry.dispose();return;}
    const attributes=Object.keys(geometry.attributes);
    for(const name of attributes)if(!['position','normal','uv'].includes(name))geometry.deleteAttribute(name);
    const list=groups.get(mesh.material)||[];list.push(geometry);groups.set(mesh.material,list);
  });
  const low=new THREE.Group(); low.userData.tag='vessel-low';
  for(const [material,geometries]of groups){
    const geometry=mergeGeometries(geometries,false);
    if(geometry){const mesh=new THREE.Mesh(geometry,material);mesh.userData.tag='vessel-low';low.add(mesh);}
    geometries.forEach(g=>g.dispose());
  }
  if(!low.children.length)return null;
  const entry={high,low};cache.set(source,entry);return entry;
}

export function createVesselLOD(source, tag='remote-boat') {
  const template=templateFor(source);if(!template)return null;
  const root=new THREE.Group();root.userData.tag=tag;
  const high=template.high.clone(true),low=template.low.clone(true);
  root.add(high,low);low.visible=false;
  root.vesselLOD={high,low,level:0};
  return root;
}

const sphere=new THREE.Sphere(new THREE.Vector3(),10);
export function prepareVessel(root,camera,frustum,optimized){
  sphere.center.copy(root.position);sphere.center.y+=3;
  const inView=frustum.intersectsSphere(sphere);
  root.visible=!optimized||inView;
  const data=root.vesselLOD;
  const distance=camera.position.distanceTo(root.position);
  const low=optimized&&(data.level?distance>125:distance>155);
  data.level=low?1:0;data.high.visible=!low;data.low.visible=low;
  return inView?(low?'low':'high'):'culled';
}
