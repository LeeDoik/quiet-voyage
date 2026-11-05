import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function createVisibility(scene, camera) {
  const frustum=new THREE.Frustum(), matrix=new THREE.Matrix4(), sphere=new THREE.Sphere();
  const trees=[];
  scene.updateMatrixWorld(true);
  scene.traverse(root=>{
    if(root.userData.tag!=='tree') return;
    const box=new THREE.Box3().setFromObject(root), bounds=box.getBoundingSphere(new THREE.Sphere());
    const leaves=[]; root.traverse(node=>{if(node.userData.tag==='foliage') leaves.push(node);});
    const inverse=root.matrixWorld.clone().invert();
    const levels=[null];
    for(const stride of [2,4]){
      const groups=new Map(),group=new THREE.Group();group.userData.tag='tree-lod';
      leaves.forEach((leaf,i)=>{
        if(i%stride)return;
        const geometry=leaf.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,leaf.matrixWorld));
        const list=groups.get(leaf.material)||[];list.push(geometry);groups.set(leaf.material,list);
      });
      for(const [material,geometries]of groups){
        const geometry=mergeGeometries(geometries,false);
        const mesh=new THREE.Mesh(geometry,material);mesh.userData.tag='foliage-lod';group.add(mesh);
        geometries.forEach(g=>g.dispose());
      }
      group.visible=false;root.add(group);levels.push(group);
    }
    trees.push({root,bounds,leaves,levels,level:0});
  });
  const stats={trees:trees.length,visibleTrees:0,culledTrees:0,treeLevels:[0,0,0]};
  return {
    prepare(optimized){
      camera.updateMatrixWorld(true);
      matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(matrix);
      stats.visibleTrees=0;stats.culledTrees=0;stats.treeLevels.fill(0);
      for(const item of trees){
        sphere.copy(item.bounds);
        item.root.visible=!optimized||frustum.intersectsSphere(sphere);
        if(!item.root.visible){stats.culledTrees++;continue;}
        const distance=camera.position.distanceTo(sphere.center);
        let level=optimized?item.level:0;
        if(optimized){
          const thresholds=[220,450];
          while(level<2&&distance>thresholds[level]*1.1)level++;
          while(level>0&&distance<thresholds[level-1]*.9)level--;
        }
        if(level!==item.level){item.leaves.forEach(leaf=>leaf.visible=level===0);item.levels.forEach((group,i)=>{if(group)group.visible=i===level;});item.level=level;}
        stats.visibleTrees++;stats.treeLevels[level]++;
      }
      return frustum;
    },
    state(){return {...stats,treeLevels:[...stats.treeLevels]};}
  };
}
