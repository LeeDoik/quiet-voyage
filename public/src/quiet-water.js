import * as THREE from 'three';
import { surface } from './sea.js';
import { waveGLSL } from './wave-field.js';

export function createQuietWater(scene){
  const root=new THREE.Group();root.userData.tag='quiet-water';scene.add(root);
  const geometry=new THREE.RingGeometry(.95,1,64),pool=[];
  function ring(index,x,z,y,radius,opacity,color){
    let mesh=pool[index];
    if(!mesh){mesh=new THREE.Mesh(geometry,new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,
      uniforms:{t:{value:0},tint:{value:new THREE.Color(color)},alpha:{value:0}},
      vertexShader:`${waveGLSL}
uniform float t; varying float radius; void main(){radius=length(position.xy);vec4 w=modelMatrix*vec4(position,1.);w.y=waveField(w.xz,t).x+.32;gl_Position=projectionMatrix*viewMatrix*w;}`,
      fragmentShader:`uniform vec3 tint;uniform float alpha;varying float radius;void main(){float edge=smoothstep(.95,.968,radius)*(1.-smoothstep(.985,1.,radius));gl_FragColor=vec4(tint,alpha*edge);}`}));mesh.rotation.x=-Math.PI/2;mesh.userData.tag='quiet-light';pool.push(mesh);root.add(mesh);}
    mesh.visible=true;mesh.position.set(x,y,z);mesh.scale.setScalar(radius);mesh.material.uniforms.alpha.value=opacity;mesh.material.uniforms.tint.value.setHex(color);
  }
  return {
    update(visual,boat,seaTime){
      let used=0;const y=(x,z)=>surface(x,z,seaTime)+.16;
      const near=visual.traces.filter(t=>Math.hypot(t.x-boat.x,t.z-boat.z)<160).sort((a,b)=>(a.x-boat.x)**2+(a.z-boat.z)**2-((b.x-boat.x)**2+(b.z-boat.z)**2)).slice(0,24);
      for(const t of near){
        const fade=Math.min(1,(t.expires-visual.time)/8),bloom=t.bloom/4;
        ring(used++,t.x,t.z,y(t.x,t.z),1.2+bloom*2,fade*.65,0xffd99a);
        if(bloom>0)for(let i=0;i<5;i++){
          const a=i*Math.PI*2/5,r=1.2+(1-bloom)*3,x=t.x+Math.cos(a)*r,z=t.z+Math.sin(a)*r;
          ring(used++,x,z,y(x,z),.5+bloom*.6,bloom*.7,0xb8f5e2);
        }
      }
      for(const p of visual.pulses){
        if(Math.hypot(p.x-boat.x,p.z-boat.z)>180)continue;
        const life=(p.expires-visual.time)/4;
        for(let i=0;i<2;i++)ring(used++,p.x,p.z,y(p.x,p.z)+i*.02,1+(1-life)*12+i*1.5,life*.55,0xffe2ad);
      }
      for(const p of visual.pairs){
        if(p.charge<.35)continue;
        for(let i=0;i<5;i++){
          const a=i*1.256+visual.time*.25,x=p.x+Math.cos(a)*3,z=p.z+Math.sin(a)*3;
          ring(used++,x,z,y(x,z),.35+p.charge*.5,p.charge*.65,0x9af1df);
        }
      }
      for(let i=0;i<used;i++)pool[i].material.uniforms.t.value=seaTime;
      for(let i=used;i<pool.length;i++)pool[i].visible=false;
    },
    clear(){pool.forEach(mesh=>mesh.visible=false);}
  };
}
