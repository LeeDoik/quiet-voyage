import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// The model's sails are single quads; split each triangle into n² so the belly and luff below
// have vertices to bend. Shared vertices keep the shading smooth.
function subdivide(geometry, n) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry, src = flat.attributes.position.array, out = [];
  for (let t = 0; t < src.length; t += 9) {
    const at = (i, j) => { const k = n - i - j; return [0, 1, 2].map(d => (src[t + d] * k + src[t + 3 + d] * i + src[t + 6 + d] * j) / n); };
    for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
      out.push(...at(i, j), ...at(i + 1, j), ...at(i, j + 1));
      if (i + j < n - 1) out.push(...at(i + 1, j), ...at(i + 1, j + 1), ...at(i, j + 1));
    }
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return mergeVertices(result);
}

// GLB model coordinates: bow +X, up +Y. Keep each sail's luff attached.
export function createWindRig(model){
  const sails=[];
  model.traverse(mesh=>{
    if(!mesh.isMesh||!/sail|jib/i.test(mesh.name))return;
    // Remote boats clone an already split sail; split only the model's original quads.
    mesh.geometry=mesh.geometry.attributes.position.count<40?subdivide(mesh.geometry,10):mesh.geometry.clone();
    const base=mesh.geometry.attributes.position.array.slice();
    sails.push({mesh,base,jib:/jib/i.test(mesh.name)});
    mesh.userData.dynamicSail=true;
  });
  const boom=model.getObjectByName('boom');
  if(boom){boom.geometry=new THREE.CylinderGeometry(.045,.045,1.83,10);}
  let angle=0;
  const axis=new THREE.Vector3(0,1,0),direction=new THREE.Vector3();
  return {
    reset(){angle=0;},
    update(dt,air,time){
      angle+=(air.sheetAngle-angle)*(1-Math.exp(-dt*4));
      for(const {mesh,base,jib}of sails){
        const positions=mesh.geometry.attributes.position;
        const a=jib?-angle*.75:angle;
        for(let i=0;i<positions.count;i++){
          const x=base[i*3],y=base[i*3+1];
          const luff=jib?.25-(y-1.3)/3.7*.05:.04;
          const span=x-luff,weight=Math.min(1,Math.abs(span)/1.7);
          const belly=Math.sin(weight*Math.PI)*Math.sin(Math.max(0,Math.min(1,(y-1.3)/4.22))*Math.PI);
          const pressure=Math.min(1,air.apparentSpeed/6);
          const flutter=Math.sin(time*9+y*2)*.025*(1-air.efficiency)*weight;
          const side=Math.sign(angle)||1;
          positions.setXYZ(i,luff+span*Math.cos(a),y,-span*Math.sin(a)+side*(belly*.22*pressure+flutter));
        }
        positions.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingSphere();
      }
      if(boom){
        direction.set(-Math.cos(angle),0,Math.sin(angle));
        boom.position.set(.08,1.3,0).addScaledVector(direction,1.83/2);
        boom.quaternion.setFromUnitVectors(axis,direction);
      }
      return angle;
    }
  };
}
