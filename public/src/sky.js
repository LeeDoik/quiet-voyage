import * as THREE from 'three';
import { env } from './sea.js';
import { quality } from './quality.js';

// Value noise as a texture: a 256² lattice of fixed values, linearly filtered, so an octave is one
// fetch instead of four sine hashes (the sky and the water's reflection run it on every pixel).
const LATTICE = 256, cells = new Uint8Array(LATTICE * LATTICE);
for (let i = 0; i < cells.length; i++) { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; cells[i] = Math.floor((s - Math.floor(s)) * 256); }
const lattice = new THREE.DataTexture(cells, LATTICE, LATTICE, THREE.RedFormat, THREE.UnsignedByteType);
lattice.wrapS = lattice.wrapT = THREE.RepeatWrapping; lattice.magFilter = lattice.minFilter = THREE.LinearFilter; lattice.needsUpdate = true;

/** Uniforms the sky dome and the ocean's reflection share: cloud cover (weather), tonight's aurora, the noise lattice. */
export const skyShared = { cover: { value: .6 }, aurora: { value: 0 }, skyLattice: { value: lattice } };

/**
 * The sky's colour in display space, used by the dome and by the water's reflection so the sea mirrors
 * the same clouds and glow. The including shader declares: float warm, night, rain, time, cover; vec3 sunDir, moonDir;
 * and passes skyShared.skyLattice as the uniform `skyLattice`.
 */
export const skyGLSL = /* glsl */`
  uniform sampler2D skyLattice;
  float skyHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  // Smooth value noise: the filter blends neighbouring cells, the smoothstepped offset makes the blend smooth.
  float skyNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return texture2D(skyLattice,(i+f+.5)/256.).r;}
  float skyFbm(vec2 p,int octaves){float s=0.,a=.5;for(int i=0;i<5;i++){if(i>=octaves)break;s+=a*skyNoise(p);p=p*2.07+vec2(17.3,9.1);a*=.5;}return s;}
  vec3 skySun(){return mix(vec3(1.,.93,.78),vec3(1.,.55,.28),warm);}
  // Deep blue overhead; at golden hour gold toward the sun and rose away from it.
  vec3 skyBase(vec3 d){
    float sunSide=dot(normalize(d.xz+1e-4),normalize(sunDir.xz+1e-4))*.5+.5;
    vec3 top=mix(mix(vec3(.24,.52,.80),vec3(.30,.36,.62),warm),vec3(.018,.03,.085),night);
    vec3 horizon=mix(mix(vec3(.80,.88,.89),mix(vec3(.80,.58,.68),vec3(1.,.66,.40),sunSide*sunSide),warm),vec3(.075,.11,.21),night);
    vec3 overcast=vec3(.58,.62,.65)*(1.-night*.82);
    top=mix(top,overcast*.9,rain*.65);horizon=mix(horizon,overcast,rain*.6);
    vec3 c=mix(horizon,top,pow(smoothstep(-.02,.9,d.y),.6));
    float toSun=max(0.,dot(d,sunDir));
    c+=skySun()*(pow(toSun,5.)*.18+pow(toSun,40.)*.35+pow(toSun,600.)*.6)*(1.-night)*(1.-rain*.75);
    float belt=(d.y-.07)/.07;
    c+=vec3(.22,.07,.12)*(1.-sunSide)*exp(-belt*belt)*warm*(1.-night);   // the Belt of Venus
    c+=vec3(1.,.5,.3)*.35*pow(sunSide,4.)*exp(-max(d.y,0.)*10.)*night*(1.-night)*4.*(1.-rain);   // afterglow where the sun went down
    return c;
  }
  // A cloud layer over the sea: edges lit toward the sun (the moon at night), gold at dusk, silver at night.
  vec4 skyClouds(vec3 d,vec3 base,int octaves,bool shaded){
    if(d.y<=0.)return vec4(0.);
    vec2 uv=d.xz/(d.y+.1)*1.3+vec2(time*.006,time*.0025);
    float n=skyFbm(uv,octaves), density=smoothstep(cover,cover+.25,n)*smoothstep(0.,.12,d.y);
    if(density<=0.)return vec4(0.);
    vec2 toward=normalize(mix(sunDir.xz,moonDir.xz,night)+1e-4);
    float light=shaded?clamp(.55+(n-skyFbm(uv+toward*.09,octaves-1))*6.,0.,1.):.6;
    vec3 lit=mix(mix(vec3(1.,.985,.96),vec3(1.,.74,.52),warm),vec3(.17,.19,.27),night);
    lit=mix(lit,vec3(.98,.62,.66),clamp(warm*night*1.6,0.,1.));   // after sunset, lit pink from below
    vec3 shade=mix(mix(vec3(.62,.70,.80),vec3(.55,.45,.60),warm),vec3(.03,.04,.075),night);
    vec3 grey=vec3(.62,.64,.66)*(1.-night*.85);
    lit=mix(lit,grey*1.1,rain*.75);shade=mix(shade,grey*.7,rain*.75);
    vec3 col=mix(shade,lit,light);
    col+=skySun()*pow(max(0.,dot(d,sunDir)),8.)*(1.-density)*1.1*(1.-night)*(1.-rain*.6);   // thin cloud glows by the sun
    col+=vec3(.55,.6,.72)*pow(max(0.,dot(d,moonDir)),10.)*(1.-density)*.8*night*(1.-rain*.6);   // silver by the moon
    col=mix(base,col,.35+.65*smoothstep(0.,.3,d.y));   // far clouds melt into the haze
    return vec4(col,density*.94);
  }
`;

/** The dome: sky, sun, clouds, and at night the Milky Way, stars, shooting stars, the moon's halo and sometimes an aurora. */
export function createSky(scene, { warm, time, sunDir, moonDir }) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { warm, time, sunDir, moonDir, night: env.night, rain: env.rain, spin: { value: 0 }, ...skyShared },
    vertexShader: `varying vec3 vDir; void main(){vDir=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec3 vDir; uniform float warm, night, rain, spin, time, cover, aurora; uniform vec3 sunDir, moonDir;
      ${skyGLSL}
      float h3(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
      void main(){
        vec3 d=normalize(vDir), base=skyBase(d), c=base;
        float toSun=max(0.,dot(d,sunDir)), day=(1.-night)*(1.-rain);
        float starry=night*(1.-rain)*smoothstep(0.,.18,d.y);
        if(starry>0.){
          float a=spin; vec3 r=vec3(d.x*cos(a)-d.z*sin(a),d.y,d.x*sin(a)+d.z*cos(a));
          // The Milky Way: a soft band with dark lanes of dust.
          float band=dot(r,normalize(vec3(.9,.25,-.35)));
          float mw=exp(-band*band/.045)*(.3+.7*skyFbm(r.xz*3.3+r.y*2.1,3))*(1.-.65*smoothstep(.48,.66,skyFbm(r.zy*7.+r.x*4.,2)));
          c+=mix(vec3(.42,.46,.78),vec3(.86,.74,.64),skyNoise(r.xz*2.4+4.))*mw*.5*starry;
          // Stars, denser in the band; a few bright tinted ones; all twinkle.
          vec3 q=r*190., cell=floor(q); float hs=h3(cell), bright=step(.9993,hs);
          float s=step(.993-.004*mw,hs)*(1.-smoothstep(0.,.42+.12*bright,length(fract(q)-.5)))*(.5+.8*bright+.3*h3(cell+1.))*(.75+.25*sin(time*(1.5+hs*4.)+hs*90.));
          c+=mix(vec3(.85,.9,1.),mix(vec3(1.,.82,.66),vec3(.72,.82,1.),fract(hs*97.)),bright)*s*starry;
          // Now and then a shooting star: once in each 19 s slot, for 0.8 s.
          float slot=floor(time/19.), k=(time-slot*19.-skyHash(vec2(slot,1.))*14.)/.8;
          if(k>0.&&k<1.){
            float az=skyHash(vec2(slot,2.))*6.2832, el=.35+.4*skyHash(vec2(slot,3.));
            vec3 start=vec3(cos(az)*cos(el),sin(el),sin(az)*cos(el)), down=normalize(vec3(skyHash(vec2(slot,4.))-.5,-.6,skyHash(vec2(slot,5.))-.5));
            vec3 dir=normalize(down-start*dot(down,start)), head=normalize(start+dir*k*.3), tail=normalize(start+dir*max(0.,k-.3)*.3), ab=head-tail;
            float u=clamp(dot(d-tail,ab)/max(dot(ab,ab),1e-6),0.,1.);
            c+=vec3(.9,.95,1.)*(1.-smoothstep(0.,.002,length(d-tail-ab*u)))*u*u*sin(k*3.1416)*starry;
          }
          // Some nights an aurora wavers low over the northern sea.
          if(aurora>0.){
            float az=atan(d.x,-d.z), wave=skyFbm(vec2(az*2.2+time*.012,time*.02),2), h=d.y-(.06+.16*wave);
            float rays=.4+.6*skyNoise(vec2(az*38.+wave*6.,time*.15));
            float curtain=smoothstep(-.012,.02,h)*exp(-max(h,0.)*8.)*rays*(1.-smoothstep(.6,1.5,abs(az+.25)));
            c+=mix(vec3(.25,1.,.62),vec3(.62,.34,.95),smoothstep(0.,.22,h))*curtain*aurora*starry*smoothstep(.55,.95,night)*.42;   // only once the sky is dark
          }
        }
        float toMoon=max(0.,dot(d,moonDir));
        c+=vec3(.55,.62,.82)*(pow(toMoon,400.)*.35+pow(toMoon,24.)*.07)*night*(1.-rain*.8);
        // Golden hour: faint beams fan out from the sun.
        if(warm>.05){
          vec3 su=normalize(cross(sunDir,vec3(0.,1.,0.))), sv=cross(su,sunDir);
          float ang=atan(dot(d,sv),dot(d,su)); vec2 ring=vec2(cos(ang),sin(ang));
          c+=skySun()*smoothstep(.3,.95,skyNoise(ring*5.+time*.03))*(.6+.4*skyNoise(ring*13.-time*.02))*pow(toSun,6.)*.16*warm*day;
        }
        c=mix(c,mix(vec3(1.,.97,.9),vec3(1.,.48,.2),warm)*1.5,smoothstep(.99962,.99972,toSun)*day);   // the sun's disc
        vec4 cloud=skyClouds(d,base,${quality.clouds},true);   // octaves by tier (quality.js)
        // Linear (as the sea mirrors it, ocean-material.js linearColor), then the renderer's tone
        // mapping and sRGB output, so the dome, the mirrored sky and the haze on islands agree.
        gl_FragColor=vec4(pow(mix(c,cloud.rgb,cloud.a),vec3(2.2)),1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(850, 32, 16), material); mesh.userData.tag = 'sky'; scene.add(mesh);
  return { mesh, material };
}
