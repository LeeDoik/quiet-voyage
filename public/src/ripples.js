import * as THREE from 'three';
import { env } from './sea.js';
import { waveGLSL } from './wave-field.js';

// Where an animal meets the surface the water answers. One small plane per mark, riding the shared
// wave field; a pool reuses them. Three kinds:
//   ring  — breaking in or out: a patch of white water that tears into flecks, and a few rings that run
//           outward, slow and flatten (light on their crests, shade in their troughs, so they read as
//           water moving rather than painted circles);
//   wash  — a back or fin moving along the waterline: a short-lived smear of white water stretched
//           behind it and small rings;
//   slick — where a big back sank: a smooth, oval print that mirrors the sky a little more evenly than
//           the rippled water round it, and lingers well after the whale has gone.
const CAP = 64;
const KINDS = {
  ring: { life: 3.2, weights: [1, 1, 0] },
  wash: { life: 1.8, weights: [.45, .75, 0] },
  slick: { life: 24, weights: [0, 0, 1] },
};

const material = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, fog: false,
  uniforms: { time: { value: 0 }, age: { value: 0 }, life: { value: 3.2 }, size: { value: 1 }, seed: { value: 0 }, kind: { value: new THREE.Vector3(1, 1, 0) }, night: env.night },
  vertexShader: `${waveGLSL}
    uniform float time; varying vec2 vLocal;
    void main(){ vLocal=position.xy; vec4 w=modelMatrix*vec4(position,1.); w.y=waveField(w.xz,time).x+.04; gl_Position=projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `uniform float time, age, life, size, seed, night; uniform vec3 kind; varying vec2 vLocal;
    float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
    void main(){
      float t=age*life;
      vec2 dir=vLocal/max(length(vLocal),1e-4);    // noise read on the unit circle has no seam, unlike atan()
      // Real rings are never quite round: the swell and the splash bend them a little.
      float r=length(vLocal)/size*(1.+(n(dir*1.4+seed)-.5)*.22+(n(dir*3.5-seed+t*.3)-.5)*.08);
      // Two or three soft rings behind a front that runs out and slows, broad and low, fading as they go.
      float front=.3+1.7*sqrt(t), d=r-front;
      float train=exp(-d*d*2.4)*smoothstep(.0,.3,front-r+.5);
      float wave=sin(d*6.5-t*1.5)*train*(1.-age)*(1.-age)*exp(-r*.3)*kind.x;
      // White water: dense at once, then torn into flecks by noise and gone in about 1.5 s. The wash's
      // patch is stretched along the plane's local y (the way the animal came from).
      vec2 q=vLocal/size; q.y*=mix(1.,.55,step(.5,kind.y)*step(kind.x,.5));
      float rq=length(q);
      float churn=n(vLocal*3.2/size+seed+t*.2)*.6+n(vLocal*9./size-seed)*.4;
      float foam=smoothstep(1.15+t*.5,.0,rq)*smoothstep(.35+t*.45,.75+t*.3,churn)*exp(-t*1.6)*kind.y;
      // The slick: smooth water mirrors the sky more evenly, so it reads lighter and glassier.
      float rim=1.6*(1.+(n(dir*2.+seed)-.5)*.35);
      float slick=smoothstep(rim,rim*.55,r)*smoothstep(0.,2.,t)*(1.-age)*kind.z;
      vec3 crest=mix(vec3(.86,.94,.95),vec3(.45,.8,.95),night), trough=vec3(.0,.06,.08);
      vec3 glass=mix(vec3(.72,.84,.86),vec3(.1,.14,.2),night);
      float a=max(wave,0.)*.2+foam*.8, shade=max(-wave,0.)*.16, g=slick*.16;
      vec3 col=(crest*a+glass*g)/max(a+g,1e-3);
      col=mix(trough,col,(a+g)/max(a+g+shade,1e-3));
      gl_FragColor=vec4(col,min(1.,a+shade+g)*(1.-smoothstep(3.6,4.,r)));
    }`,
});

export function createRipples(scene) {
  const geometry = new THREE.PlaneGeometry(2, 2, 24, 24), pool = [];
  let next = 0;
  for (let i = 0; i < CAP; i++) {
    const mesh = new THREE.Mesh(geometry, material());
    mesh.rotation.order = 'YXZ'; mesh.rotation.x = -Math.PI / 2; mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 1;
    mesh.userData.tag = 'ripple'; mesh.userData.age = 1; mesh.userData.life = 3.2;
    scene.add(mesh); pool.push(mesh);
  }
  return {
    /** A mark at (x, z) for a body `size` metres across; `seed` varies it; `kind` ring | wash | slick. `yaw`: heading (wash). */
    add(x, z, size, seed, kind = 'ring', yaw = 0) {
      // A slick holds its plane for half a minute: take a free plane for it rather than the next in turn.
      let mesh = pool[next++ % CAP];
      if (mesh.visible && mesh.userData.kind === 'slick') mesh = pool.find(m => !m.visible) ?? mesh;
      const u = mesh.material.uniforms, k = KINDS[kind];
      // The plane covers four body sizes either way: as far as the rings run before they fade.
      mesh.position.set(x, 0, z); mesh.scale.setScalar(size * 4); mesh.rotation.y = yaw;
      u.size.value = .25; u.seed.value = seed % 97; u.life.value = k.life; u.kind.value.fromArray(k.weights);
      mesh.userData.age = 0; mesh.userData.life = k.life; mesh.userData.kind = kind; mesh.visible = true;
    },
    update(dt, time) {
      for (const mesh of pool) {
        if (!mesh.visible) continue;
        mesh.userData.age += dt / mesh.userData.life;
        if (mesh.userData.age >= 1) { mesh.visible = false; continue; }
        mesh.material.uniforms.age.value = mesh.userData.age; mesh.material.uniforms.time.value = time;
      }
    },
    clear() { for (const mesh of pool) { mesh.visible = false; mesh.userData.age = 1; } },
  };
}
