import * as THREE from 'three';
import { env, surface } from './sea.js';
import { waveGLSL } from './wave-field.js';
import { PULSE_LIFE } from './quiet-sea.js';

// Light on the water: the ripple a pulse (E) sends out, and the motes that turn between two boats
// sailing together. Everything rides the shared wave field on the GPU and adds light (glows, never paints).
const REACH = 17, SPARKS = 36;

// A pulse: a soft flash at the boat, then three wavefronts of light that ease outward, slow and fade,
// with glints riding each front. One plane per pulse; the shape is all in the fragment shader.
const pulseMaterial = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  uniforms: { time: { value: 0 }, age: { value: 0 }, seed: { value: 0 }, night: env.night },
  vertexShader: `${waveGLSL}
    uniform float time; varying vec2 vLocal;
    void main(){ vLocal=position.xy*${REACH.toFixed(1)}; vec4 w=modelMatrix*vec4(position,1.); w.y=waveField(w.xz,time).x+.12; gl_Position=projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `uniform float time, age, seed, night; varying vec2 vLocal;
    float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
    void main(){
      float r=length(vLocal), a=atan(vLocal.y,vLocal.x);
      // The fronts wobble a little, as light on moving water would.
      float wobble=(n(vec2(a*3.+seed,time*.6))-.5)*.9+(n(vec2(a*9.-seed,time*1.3))-.5)*.35;
      float light=0., glints=0.;
      for(int i=0;i<3;i++){
        float delay=float(i)*.13, t=clamp((age-delay)/(1.-delay),0.,1.);
        float front=(1.-pow(1.-t,2.4))*(${REACH.toFixed(1)}-1.5)*(1.-float(i)*.16)+1.2;
        float width=.28+t*1.1, d=(r+wobble*t-front)/width;
        float fade=smoothstep(0.,.06,t)*pow(1.-t,1.6)*(1.-float(i)*.25);
        // A bright leading edge with a soft wash of light trailing inside it.
        float ring=exp(-d*d*2.2)+.35*exp(-max(-d,0.)*.9)*step(d,0.)*smoothstep(0.,1.5,front-r);
        light+=ring*fade;
        float cell=floor(a*(18.+float(i)*7.)/6.2832+seed+float(i)*3.1);
        float tw=pow(.5+.5*sin(time*7.+h(vec2(cell,float(i)))*40.),6.);
        glints+=exp(-d*d*6.)*fade*step(.55,h(vec2(cell,seed)))*tw;
      }
      float flash=exp(-r*r/(2.5+age*24.))*exp(-age*5.)*1.6;
      vec3 gold=vec3(1.,.82,.52), sea=vec3(.55,.95,.9), white=vec3(1.,.97,.9);
      vec3 col=mix(gold,sea,smoothstep(2.,${REACH.toFixed(1)},r)*.65)*light+white*(glints*1.4+flash);
      float edge=1.-smoothstep(${(REACH - 2).toFixed(1)},${REACH.toFixed(1)},r);
      gl_FragColor=vec4(col*edge*mix(.75,1.25,night),1.);
    }`,
});

// Sparks that lift off the flash and drift up in a slow spiral, golden and sea-green.
const sparkMaterial = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  uniforms: { time: { value: 0 }, age: { value: 0 }, seed: { value: 0 }, base: { value: new THREE.Vector3() }, night: env.night, scale: { value: 500 } },
  vertexShader: `uniform float time, age, seed, scale; uniform vec3 base; attribute vec4 spark; varying float vGlow; varying vec3 vTint;
    void main(){
      float t=clamp((age-spark.w*.25)/.75,0.,1.), out_=(1.-pow(1.-t,2.))*(1.5+spark.y*4.5), ang=spark.x*6.2832+t*(1.2+spark.z)*sign(spark.z-.5);
      vec3 p=base+vec3(cos(ang)*out_, .2+t*(1.4+spark.z*2.6)+sin(time*2.+spark.x*30.)*.08, sin(ang)*out_);
      vGlow=smoothstep(0.,.08,t)*(1.-t)*(1.-t)*step(.0001,t);
      vTint=spark.y>.7?vec3(.6,1.,.9):vec3(1.,.85,.55);
      vec4 mv=viewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv;
      gl_PointSize=(.22+spark.z*.2)*projectionMatrix[1][1]*scale/max(1.,-mv.z);
    }`,
  fragmentShader: `uniform float night; varying float vGlow; varying vec3 vTint;
    void main(){ float d=length(gl_PointCoord-.5)*2.; float g=exp(-d*d*4.)+exp(-d*d*28.)*.8; gl_FragColor=vec4(vTint*g*vGlow*mix(.8,1.3,night),1.); }`,
});

// Motes between two boats sailing together: a small ring of light on the water.
const ringGeometry = new THREE.RingGeometry(.95, 1, 64);
const ringMaterial = color => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  uniforms: { t: { value: 0 }, tint: { value: new THREE.Color(color) }, alpha: { value: 0 } },
  vertexShader: `${waveGLSL}
uniform float t; varying float radius; void main(){radius=length(position.xy);vec4 w=modelMatrix*vec4(position,1.);w.y=waveField(w.xz,t).x+.32;gl_Position=projectionMatrix*viewMatrix*w;}`,
  fragmentShader: `uniform vec3 tint;uniform float alpha;varying float radius;void main(){float edge=smoothstep(.95,.968,radius)*(1.-smoothstep(.985,1.,radius));gl_FragColor=vec4(tint,alpha*edge);}`,
});

const hash = n => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };

export function createQuietWater(scene){
  const root=new THREE.Group();root.userData.tag='quiet-water';scene.add(root);
  const planeGeometry=new THREE.PlaneGeometry(2,2,56,56),buffer=new THREE.Vector2();
  const sparkGeometry=new THREE.BufferGeometry(),spark=new Float32Array(SPARKS*4);
  for(let i=0;i<SPARKS;i++)spark.set([hash(i+1),hash(i+41),hash(i+81),hash(i+121)],i*4);
  sparkGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(SPARKS*3),3));
  sparkGeometry.setAttribute('spark',new THREE.BufferAttribute(spark,4));
  const pulses=[],rings=[];
  function pulseAt(index){
    let slot=pulses[index];
    if(!slot){
      const plane=new THREE.Mesh(planeGeometry,pulseMaterial());
      plane.rotation.x=-Math.PI/2;plane.frustumCulled=false;plane.renderOrder=3;plane.userData.tag='quiet-light';
      const sparks=new THREE.Points(sparkGeometry,sparkMaterial());sparks.frustumCulled=false;sparks.renderOrder=4;sparks.userData.tag='quiet-light';
      // Point size follows the drawing buffer, so a spark keeps its size in metres.
      sparks.onBeforeRender=renderer=>{sparks.material.uniforms.scale.value=renderer.getDrawingBufferSize(buffer).y/2;};
      root.add(plane,sparks);slot=pulses[index]={plane,sparks};
    }
    slot.plane.visible=slot.sparks.visible=true;
    return slot;
  }
  function ring(index,x,z,radius,opacity,color){
    let mesh=rings[index];
    if(!mesh){mesh=new THREE.Mesh(ringGeometry,ringMaterial(color));mesh.rotation.x=-Math.PI/2;mesh.userData.tag='quiet-light';rings.push(mesh);root.add(mesh);}
    mesh.visible=true;mesh.position.set(x,0,z);mesh.scale.setScalar(radius);mesh.material.uniforms.alpha.value=opacity;mesh.material.uniforms.tint.value.setHex(color);
    return mesh;
  }
  return {
    update(visual,boat,seaTime){
      let used=0,lit=0;
      for(const p of visual.pulses){
        if(Math.hypot(p.x-boat.x,p.z-boat.z)>180)continue;
        const age=Math.min(1,Math.max(0,1-(p.expires-visual.time)/PULSE_LIFE)),seed=hash(p.seq)*50;
        const {plane,sparks}=pulseAt(lit++);
        plane.position.set(p.x,0,p.z);plane.scale.setScalar(REACH);
        const pu=plane.material.uniforms;pu.time.value=seaTime;pu.age.value=age;pu.seed.value=seed;
        const su=sparks.material.uniforms;su.time.value=seaTime;su.age.value=age;su.seed.value=seed;su.base.value.set(p.x,surface(p.x,p.z,seaTime),p.z);
      }
      for(const p of visual.pairs){
        if(p.charge<.35)continue;
        for(let i=0;i<5;i++){
          const a=i*1.256+visual.time*.25;
          ring(used++,p.x+Math.cos(a)*3,p.z+Math.sin(a)*3,.35+p.charge*.5,p.charge*.65,0x9af1df).material.uniforms.t.value=seaTime;
        }
      }
      for(let i=lit;i<pulses.length;i++)pulses[i].plane.visible=pulses[i].sparks.visible=false;
      for(let i=used;i<rings.length;i++)rings[i].visible=false;
    },
    clear(){pulses.forEach(s=>s.plane.visible=s.sparks.visible=false);rings.forEach(m=>m.visible=false);}
  };
}
