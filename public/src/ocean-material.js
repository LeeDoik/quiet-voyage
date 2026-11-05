import * as THREE from 'three';
import { coveSpec, env } from './sea.js';

// The nearest islands' coast shapes (world-gen.js), refreshed by world.js as the boat moves.
export const SHORE_SLOTS = 6;
import { waveGLSL } from './wave-field.js';

export function createOceanMaterial() {
  return new THREE.ShaderMaterial({
    name: 'Ocean surface',
    uniforms: {
      time: {value: 0}, warm: {value: 0},
      wind: {value: new THREE.Vector2(.65, 1)},
      vessel: {value: new THREE.Vector4(0, 0, 0, 0)},
      mist: {value: .00115},
      night: env.night, rain: env.rain,
      sunDir: {value: new THREE.Vector3(-210, 95, -650).normalize()},
      shores: {value: Array.from({length: SHORE_SLOTS}, () => new THREE.Vector4(0, 0, 0, 0))},
      shoreShape: {value: Array.from({length: SHORE_SLOTS}, () => new THREE.Vector4(0, 0, 0, 0))},
      cove: {value: new THREE.Vector3(coveSpec.x, coveSpec.z, coveSpec.scale)},
    },
    vertexShader: `
      uniform float time;
      varying vec3 vWorld;
      ${waveGLSL}
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        world.y += waveField(world.xz, time).x;
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float time, warm, mist, night, rain;
      uniform vec2 wind;
      uniform vec3 sunDir;
      uniform vec4 vessel, shores[6], shoreShape[6];
      uniform vec3 cove;
      varying vec3 vWorld;
      const float PI = 3.14159265;
      ${waveGLSL}

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+1.0), f.x), f.y);
      }
      vec3 linearColor(vec3 color) { return pow(color, vec3(2.2)); }
      vec3 skyColor(vec3 direction) {
        vec3 horizon = mix(mix(vec3(.74,.85,.80), vec3(1.0,.68,.48), warm), vec3(.07,.10,.17), night);
        vec3 zenith = mix(mix(vec3(.31,.62,.72), vec3(.40,.43,.62), warm), vec3(.02,.03,.07), night);
        horizon = mix(horizon, vec3(.55,.6,.62)*(1.-night*.8), rain*.6);
        return linearColor(mix(horizon, zenith, smoothstep(-.03,.75,direction.y)));
      }
      float shoreDistance(vec2 p) {
        float d = 1000.0;
        for (int i=0; i<6; i++) {
          vec4 s = shores[i];
          if (s.z <= 0.0) continue;
          vec2 o = p-s.xy;
          float reach = max(s.z,s.w)*1.25;
          if (dot(o,o) > (reach+80.0)*(reach+80.0)) { d = min(d, length(o)-reach); continue; }   // far: skip the trig
          vec4 k = shoreShape[i];
          float c = cos(k.x), n = sin(k.x);
          vec2 q = vec2((o.x*c+o.y*n)/s.z, (-o.x*n+o.y*c)/s.w);
          float a = atan(q.y,q.x);
          float f = 1.0+k.y*sin(2.0*a)+k.z*sin(3.0*a+1.3)+k.w*sin(5.0*a+2.1);
          d = min(d, (length(q)-f)*min(s.z,s.w));
        }
        vec2 q = (p-cove.xy)/cove.z;
        q.y /= 1.15;
        float angle = atan(-q.y,q.x);
        if (angle < -.85) angle += 2.0*PI;
        float radius = length(q)/(1.0+.025*sin(angle*5.0)+.018*sin(angle*11.0));
        if (angle <= PI+.85) {
          d = min(d, max(54.0-radius, radius-118.0)*cove.z);
        } else {
          vec2 a = vec2(cos(-.85),-sin(-.85));
          vec2 b = vec2(cos(PI+.85),-sin(PI+.85));
          d = min(d, min(length(q-a*clamp(dot(q,a),54.0,118.0)), length(q-b*clamp(dot(q,b),54.0,118.0)))*cove.z);
        }
        return max(0.0,d);
      }
      void main() {
        vec2 p = vWorld.xz;
        vec3 viewDir = normalize(cameraPosition-vWorld);
        float distanceToEye = length(cameraPosition-vWorld);
        float footprint = max(length(dFdx(p)), length(dFdy(p)));
        vec3 field = waveField(p,time);
        vec2 along = vec2(-sin(wind.x),-cos(wind.x));
        vec2 across = vec2(-along.y,along.x);
        vec2 uv = vec2(dot(p,along),dot(p,across));
        float warp = sin(uv.y*.19-time*.23)*1.7 + sin(uv.x*.11+time*.18);
        float gust = .65+.7*noise(p*.085+along*time*.14);
        vec2 ripple = vec2(0.0);
        // Ripple octaves fan out by the golden angle around the wind so no two line up into
        // stripes; once an octave is finer than a pixel the rest are skipped.
        for (int i=0; i<6; i++) {
          float octave = float(i);
          float frequency = 1.7*pow(1.75,octave);
          float filtered = 1.0-smoothstep(.35,2.2,footprint*frequency);
          if (filtered <= 0.0) break;
          float spin = octave*2.39996+.4*sin(octave*1.7);
          vec2 direction = normalize(along*cos(spin)*1.25+across*sin(spin));
          float phase = dot(p,direction)*frequency - time*sqrt(9.8*frequency)*.55 + warp*(1.0-octave*.12) + octave*1.9;
          float amplitude = .06*pow(.74,octave)*filtered*gust*(1.0+rain*.4);
          ripple += amplitude*cos(phase)*direction;
        }
        vec3 normal = normalize(vec3(-field.y-ripple.x*wind.y,1.0,-field.z-ripple.y*wind.y));
        vec3 halfDir = normalize(viewDir+sunDir);
        float nv = max(.025,dot(normal,viewDir));
        float nl = max(.001,dot(normal,sunDir));
        float nh = max(.0,dot(normal,halfDir));
        float vh = max(.0,dot(viewDir,halfDir));
        float fresnel = .0204+.9796*pow(1.0-nv,5.0);
        vec3 reflection = reflect(-viewDir,normal);
        reflection.y = max(.0,reflection.y);
        float shore = shoreDistance(p);
        float shallows = exp(-shore*.07);
        vec3 deep = vec3(.008,.072,.10);
        vec3 shallow = vec3(.04,.245,.205);
        vec3 water = mix(deep,shallow,shallows*.82);
        float caustic = pow(.5+.5*sin(p.x*.65+sin(p.y*.51+time)*1.6-time*.8),8.0);
        water += vec3(.012,.025,.014)*caustic*shallows;
        water *= .88+.12*clamp(field.x+.5,0.0,1.0);
        // Light through the thin top of a swell: a green-blue glow on crests seen against the sun.
        water += vec3(.0,.05,.045)*smoothstep(.1,.6,field.x)*pow(max(0.0,dot(viewDir,-sunDir)*.5+.5),2.0)*(1.0-night);
        water *= 1.0-night*.7;
        vec3 color = mix(water,skyColor(reflection),fresnel);

        // Dielectric microfacet sun glints, widened when the footprint grows.
        float roughness = .22+.11*smoothstep(.2,4.0,footprint);
        float a2 = pow(roughness,4.0);
        float denominator = nh*nh*(a2-1.0)+1.0;
        float distribution = a2/(PI*denominator*denominator);
        float k = pow(roughness+1.0,2.0)*.125;
        float masking = nv/(nv*(1.0-k)+k) * nl/(nl*(1.0-k)+k);
        float sunFresnel = .0204+.9796*pow(1.0-vh,5.0);
        float specular = distribution*masking*sunFresnel/(4.0*nv);
        color += mix(vec3(1.0,.89,.64),vec3(1.0,.48,.21),warm)*specular*.6*(1.0-night)*(1.0-rain*.7)*step(0.0,sunDir.y);

        float foamNoise = noise(p*.8+vec2(time*.12,-time*.08));
        float beachWave = shore*.8+time*.78+noise(p*.13)*2.3;
        float beachFoam = smoothstep(.68,.98,cos(beachWave))*(1.0-smoothstep(1.0,13.0,shore));
        beachFoam *= smoothstep(.22,.66,foamNoise)*.58;
        float crestFoam = smoothstep(.68-.25*smoothstep(1.0,1.5,wind.y),.94,field.x)*smoothstep(.70,.89,foamNoise)*(.15+.25*smoothstep(1.0,1.5,wind.y));
        float foam = clamp(beachFoam+crestFoam,0.0,.8)*(1.0-night*.6);
        color = mix(color,linearColor(vec3(.83,.90,.84)),foam);
        float haze = 1.0-exp(-pow(distanceToEye*mist*.85,2.0));
        color = mix(color,skyColor(vec3(0,0,1)),haze);
        gl_FragColor = vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
