import * as THREE from 'three';

// The rig answering the wind: both sails swing about their luffs (the mainsail on the mast, the jib
// on the forestay) to the sheet angle and fill with a belly that grows with the apparent wind; the
// boom swings with the mainsail on its gooseneck and the mainsheet follows its end; a pennant
// streams from the masthead. The boat model (tools/blender/boat.py) gives each sail as a flat,
// gridded sheet with UVs (u = 0 on the luff, 1 on the leech; glTF flips v, so heights are read from
// the positions instead), the boom with its origin on the gooseneck, and model coordinates with the
// bow +X and up +Y.

// A little masthead pennant, hoist at its origin, streaming aft (-X) at rest.
const pennantGeometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,.065,0,-.55,0,0,0,-.065,0],3));
pennantGeometry.computeVertexNormals();
const pennantMaterial=new THREE.MeshStandardMaterial({color:0xbf5f43,roughness:.8,side:THREE.DoubleSide});
const sheetGeometry=new THREE.CylinderGeometry(.007,.007,1,4,1,true).translate(0,.5,0);
const sheetMaterial=new THREE.MeshStandardMaterial({color:0xd9cfb4,roughness:.9});
const JIB_SHARE=.8;                                   // the jib is sheeted a little closer than the main
const TRAVELLER=new THREE.Vector3(-1.42,.64,0), BOOM_SHEET_AT=1.55;

/** Smooth vertex normals of a bent sail, every frame for each boat close by: three's
 *  computeVertexNormals on the raw arrays (the same sums), without its per-vertex vector calls. */
const plain=a=>a&&!a.isInterleavedBufferAttribute&&a.array instanceof Float32Array;
function sailNormals(geometry){
  const position=geometry.attributes.position,normal=geometry.attributes.normal,index=geometry.index;
  if(!index||!plain(position)||!plain(normal)){geometry.computeVertexNormals();return;}
  const p=position.array,n=normal.array,f=index.array;
  n.fill(0);
  for(let i=0;i<f.length;i+=3){
    const a=f[i]*3,b=f[i+1]*3,c=f[i+2]*3;
    const ux=p[c]-p[b],uy=p[c+1]-p[b+1],uz=p[c+2]-p[b+2],vx=p[a]-p[b],vy=p[a+1]-p[b+1],vz=p[a+2]-p[b+2];
    const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx;   // (c - b) x (a - b)
    n[a]+=x;n[a+1]+=y;n[a+2]+=z;n[b]+=x;n[b+1]+=y;n[b+2]+=z;n[c]+=x;n[c+1]+=y;n[c+2]+=z;
  }
  for(let i=0;i<n.length;i+=3){const l=Math.sqrt(n[i]*n[i]+n[i+1]*n[i+1]+n[i+2]*n[i+2])||1;n[i]/=l;n[i+1]/=l;n[i+2]/=l;}
  normal.needsUpdate=true;
}

/** Per-vertex hinge data for one sail: its luff line, and for each vertex where it hangs from it. */
function hinge(mesh){
  const geometry=mesh.geometry, uv=geometry.attributes.uv;
  // Rest shape: kept on the geometry, so a clone (a remote boat) bends from the same flat sheet.
  if(!geometry.userData.rest)geometry.userData.rest=geometry.attributes.position.array.slice();
  const rest=geometry.userData.rest,count=rest.length/3;
  // The luff's two ends (the smallest u, normally 0), lowest to highest: the hinge points up the luff.
  let luffU=Infinity;
  for(let i=0;i<count;i++)luffU=Math.min(luffU,uv.getX(i));
  let lo=null,hi=null;
  for(let i=0;i<count;i++){
    if(uv.getX(i)>luffU+.001)continue;
    const y=rest[i*3+1];
    if(!lo||y<lo.y)lo={y,i};
    if(!hi||y>hi.y)hi={y,i};
  }
  const a=new THREE.Vector3(rest[lo.i*3],rest[lo.i*3+1],0),b=new THREE.Vector3(rest[hi.i*3],rest[hi.i*3+1],0);
  const axis=b.clone().sub(a).normalize(),length=b.distanceTo(a),p=new THREE.Vector3(),r=new THREE.Vector3();
  const foot=new Float32Array(count*3),arm=new Float32Array(count*3),shape=new Float32Array(count*2);
  for(let i=0;i<count;i++){
    p.set(rest[i*3],rest[i*3+1],0);
    const t=p.clone().sub(a).dot(axis);
    const f=a.clone().addScaledVector(axis,t);
    r.subVectors(p,f);
    foot.set([f.x,f.y,f.z],i*3);arm.set([r.x,r.y,r.z],i*3);
    const u=uv.getX(i),v=Math.max(0,Math.min(1,t/length));   // v: up the luff, 0 at the foot
    // Belly: deepest a third of the way back and mid-height, ~1/8 of the chord at that height.
    const chord=u>.02?r.length()/u:0;
    shape.set([Math.sin(Math.min(1,u)*Math.PI)**1.2*Math.sin(v*Math.PI*.92+.12)*chord*.13,u],i*2);
  }
  return {mesh,axis,foot,arm,shape,count};
}

export function createWindRig(model){
  const sails=[];
  model.traverse(mesh=>{
    if(!mesh.isMesh||!/sail|jib/i.test(mesh.name)||!mesh.geometry.attributes.uv)return;
    mesh.geometry=mesh.geometry.clone();                 // each boat bends its own sails
    sails.push({...hinge(mesh),jib:/jib/i.test(mesh.name)});
    mesh.userData.dynamicSail=true;
  });
  const boom=model.getObjectByName('boom');
  // Remote boats find the pennant and mainsheet cloned from the player's model.
  let pennant=model.getObjectByName('pennant'),flap=0;
  if(!pennant){pennant=new THREE.Mesh(pennantGeometry,pennantMaterial);pennant.name='pennant';pennant.userData.tag='boat-detail';pennant.position.set(.1,5.68,0);model.add(pennant);}
  let sheet=model.getObjectByName('mainsheet');
  if(!sheet&&boom){sheet=new THREE.Mesh(sheetGeometry,sheetMaterial);sheet.name='mainsheet';sheet.userData.tag='boat-detail';model.add(sheet);}
  let angle=0;
  const up=new THREE.Vector3(0,1,0),cross=new THREE.Vector3(),n=new THREE.Vector3(),arm=new THREE.Vector3(),end=new THREE.Vector3(),span=new THREE.Vector3();
  return {
    reset(){angle=0;},
    update(dt,air,time){
      angle+=(air.sheetAngle-angle)*(1-Math.exp(-dt*4));
      const side=Math.sign(angle)||1,pressure=Math.min(1,air.apparentSpeed/6),luffing=1-air.efficiency;
      for(const s of sails){
        const a=s.jib?angle*JIB_SHARE:angle,c=Math.cos(a),sn=Math.sin(a),d=s.axis;
        // The sail's normal, turned with it: z·cos + (d × z)·sin, and d × z = (d.y, -d.x, 0).
        n.set(d.y*sn,-d.x*sn,c);
        const positions=s.mesh.geometry.attributes.position;
        for(let i=0;i<s.count;i++){
          const k=i*3;
          arm.set(s.arm[k],s.arm[k+1],s.arm[k+2]);
          // Rodrigues about the luff (the arm is perpendicular to it): arm·cos + (d × arm)·sin.
          cross.crossVectors(d,arm);
          const bx=arm.x*c+cross.x*sn,by=arm.y*c+cross.y*sn,bz=arm.z*c+cross.z*sn;
          const u=s.shape[i*2+1],y=s.foot[k+1]+by;
          const fill=side*(s.shape[i*2]*(.35+.65*pressure)+Math.sin(time*9+y*2)*.025*luffing*u);
          positions.setXYZ(i,s.foot[k]+bx+n.x*fill,y+n.y*fill,s.foot[k+2]+bz+n.z*fill);
        }
        positions.needsUpdate=true;sailNormals(s.mesh.geometry);s.mesh.geometry.computeBoundingSphere();
      }
      if(boom){
        boom.rotation.y=angle;
        if(sheet){
          // From near the boom's end down to the traveller, whose car slides toward the boom's side.
          end.set(-Math.cos(angle)*BOOM_SHEET_AT,0,Math.sin(angle)*BOOM_SHEET_AT).add(boom.position);
          span.set(TRAVELLER.x,TRAVELLER.y,Math.max(-.32,Math.min(.32,Math.sin(angle)*.8)));
          sheet.position.copy(span);
          end.sub(span);
          sheet.scale.set(1,end.length(),1);
          sheet.quaternion.setFromUnitVectors(up,end.normalize());
        }
      }
      // Streams downwind (the apparent wind's angle is also its heading here) and flaps faster as it freshens.
      flap+=dt*(5+air.apparentSpeed);
      pennant.rotation.set(Math.sin(flap*1.3)*.5,air.relativeAngle+Math.sin(flap)*.12,0,'YXZ');
      return angle;
    }
  };
}
