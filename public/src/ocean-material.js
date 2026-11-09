import * as THREE from 'three';
import { coveSpec, env } from './sea.js';

// The nearest islands' coast shapes (world-gen.js), refreshed by world.js as the boat moves.
export const SHORE_SLOTS = 6;
/** Hulls the water reacts to: the player's boat first, then the nearest others. w = speed, -1 = empty. */
export const VESSEL_SLOTS = 4;
import { waveGLSL } from './wave-field.js';
import { skyGLSL, skyShared } from './sky.js';

export function createOceanMaterial() {
  return new THREE.ShaderMaterial({
    name: 'Ocean surface',
    uniforms: {
      time: {value: 0}, warm: {value: 0}, cover: skyShared.cover, skyLattice: skyShared.skyLattice,
      wind: {value: new THREE.Vector2(.65, 1)},
      vessels: {value: Array.from({length: VESSEL_SLOTS}, () => new THREE.Vector4(0, 0, 0, -1))},
      mist: {value: .00115},
      night: env.night, rain: env.rain,
      sunDir: {value: new THREE.Vector3(-210, 95, -650).normalize()},
      moonDir: {value: new THREE.Vector3(230, 300, -620).normalize()},
      shores: {value: Array.from({length: SHORE_SLOTS}, () => new THREE.Vector4(0, 0, 0, 0))},
      shoreShape: {value: Array.from({length: SHORE_SLOTS}, () => new THREE.Vector4(0, 0, 0, 0))},
      cove: {value: new THREE.Vector3(coveSpec.x, coveSpec.z, coveSpec.scale)},
      // Animals under the surface (undersea.js): closeness to the surface, and where the map lies (x, z, size, on).
      lifeMap: {value: null}, lifeFrame: {value: new THREE.Vector4(0, 0, 128, 0)},
      // Islands and boats mirrored in the sea (reflection.js, high tier).
      reflectionMap: {value: null}, reflectionMatrix: {value: new THREE.Matrix4()}, reflectionOn: {value: 0},
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
      uniform float time, warm, mist, night, rain, cover;
      uniform vec2 wind;
      uniform vec3 sunDir, moonDir;
      uniform vec4 vessels[4], shores[6], shoreShape[6];
      uniform vec3 cove;
      uniform sampler2D lifeMap;
      uniform vec4 lifeFrame;
      uniform sampler2D reflectionMap;
      uniform mat4 reflectionMatrix;
      uniform float reflectionOn;
      varying vec3 vWorld;
      const float PI = 3.14159265;
      ${waveGLSL}
      ${skyGLSL}

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+1.0), f.x), f.y);
      }
      vec3 linearColor(vec3 color) { return pow(color, vec3(2.2)); }
      // The sky the water mirrors (sky.js). Ripples blur the clouds, so two octaves do; and where the
      // water mirrors little (looking down, close by) the clouds are skipped.
      vec3 skyColor(vec3 direction, float fresnel) {
        vec3 base = skyBase(direction);
        vec4 cloud = fresnel > .04 ? skyClouds(direction, base, 2, false) : vec4(0.0);
        return linearColor(mix(base, cloud.rgb, cloud.a*smoothstep(.04, .1, fresnel)));
      }
      // Rain: each ~0.9 m cell rings once per cycle, two offset layers so the drops never sync.
      vec2 rainRipple(vec2 p, float t) {
        vec2 slope = vec2(0.0);
        for (int l=0; l<2; l++) {
          vec2 q = p*1.1+float(l)*13.7;
          vec2 cell = floor(q);
          float h = hash(cell+float(l)*5.1);
          float age = fract(t*1.3+h);
          vec2 d = fract(q)-(.25+.5*vec2(hash(cell+1.3), hash(cell+7.9)));
          float r = length(d)+1e-4, front = age*.42;
          float envelope = exp(-pow((r-front)*11.0,2.0))*(1.0-age)*(1.0-age);
          slope += d/r*sin((r-front)*32.0)*envelope;
        }
        return slope;
      }
      // A hull in the boat's frame (x to starboard, y to the bow): distance to its waterline.
      float hullDistance(vec2 q) {
        float len = q.y > 0.0 ? 2.55 : 2.15, t = clamp(q.y/len, -1.0, 1.0);
        float beam = .88*sqrt(max(0.0, 1.0-(q.y > 0.0 ? t*t : t*t*t*t)));
        vec2 e = vec2(abs(q.x)-beam, abs(q.y)-len);
        return length(max(e, 0.0))+min(max(e.x, e.y), 0.0);
      }
      // The bow pushes up a cushion of water and two crests that run back along the sides.
      float hullWave(vec2 q, float sp) {
        float cushion = exp(-pow((q.y-2.45)/.75, 2.0)-pow(q.x/1.05, 2.0));
        float arm = exp(-pow((abs(q.x)-(.95+.36*max(0.0, 2.45-q.y)))/.33, 2.0))*smoothstep(-2.8, 1.2, q.y)*smoothstep(3.1, 2.1, q.y);
        return sp*sp*(.1*cushion+.08*arm);
      }
      // x: shade (the hull, not the sky, is what the water beside it reflects), yz: slope.
      // No foam here: half-transparent foam over the dark water read as a grey stain round the hull.
      vec3 hullWater(vec2 p) {
        vec3 acc = vec3(1.0, 0.0, 0.0);
        for (int i=0; i<4; i++) {
          vec4 v = vessels[i];
          vec2 d = p-v.xy;
          if (v.w < 0.0 || dot(d,d) > 196.0) continue;
          float c = cos(v.z), s = sin(v.z), sp = clamp(v.w/6.0, 0.0, 1.0);
          vec2 right = vec2(c,-s), ahead = vec2(-s,-c), q = vec2(dot(d,right), dot(d,ahead));
          float dist = hullDistance(q);
          if (dist < -.08) continue;                       // under the hull itself
          float wave = hullWave(q, sp);
          vec2 grad = vec2(hullWave(q+vec2(.05,0.0), sp)-wave, hullWave(q+vec2(0.0,.05), sp)-wave)/.05;
          acc.yz += right*grad.x+ahead*grad.y;
          acc.x = min(acc.x, 1.0-.5*exp(-max(dist, 0.0)*2.2));
        }
        return acc;
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
        float warp = (noise(p*.045+along*time*.02)-.5)*9.0 + (noise(uv*vec2(.06,.16)-time*.05)-.5)*3.5;
        float gust = .65+.7*noise(p*.085+along*time*.14);
        float patchA = noise(p*.031-along*time*.03), patchB = noise(p*.067+across*time*.04+5.3);
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
          // Bend each crest with noise at its own wavelength so it never runs straight for long.
          float bend = noise(p*frequency*.32+octave*7.7+direction*time*.15)*4.2;
          float phase = dot(p,direction)*frequency - time*sqrt(9.8*frequency)*.55 + warp*(1.0-octave*.12) + bend + octave*1.9;
          float patchiness = .35+1.3*mix(patchA,patchB,fract(octave*.618));
          float amplitude = .06*pow(.74,octave)*filtered*gust*patchiness*(1.0+rain*.4);
          ripple += amplitude*cos(phase)*direction;
        }
        // Ring crests are ~18 cm apart: drawn only where a pixel is finer than that.
        if (rain > .01 && footprint < .06) ripple += rainRipple(p,time)*.4*rain*(1.0-smoothstep(.02,.06,footprint));
        vec3 hull = hullWater(p);
        vec3 normal = normalize(vec3(-field.y-hull.y-ripple.x*wind.y,1.0,-field.z-hull.z-ripple.y*wind.y));
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
        // An animal under the surface blocks the light coming up from below: a dark shape, softer and
        // fainter the deeper it swims, bent by the ripples above it. Only the light from below is
        // dimmed, so at a glancing look the mirrored sky hides it, as it does at sea.
        if (lifeFrame.w > 0.0) {
          vec2 luv = vec2(.5+(p.x-lifeFrame.x)/lifeFrame.z, .5-(p.y-lifeFrame.y)/lifeFrame.z)+normal.xz*.006;
          float edge = smoothstep(.5,.4,max(abs(luv.x-.5),abs(luv.y-.5)));
          if (edge > 0.0) {
            float near = texture2D(lifeMap,luv).r, spread = (1.0-near)*.006+.002;
            float soft = (texture2D(lifeMap,luv+vec2(spread,0.0)).r+texture2D(lifeMap,luv-vec2(spread,0.0)).r
                         +texture2D(lifeMap,luv+vec2(0.0,spread)).r+texture2D(lifeMap,luv-vec2(0.0,spread)).r)*.25;
            float body = mix(soft,near,.4);
            water = mix(water,water*vec3(.34,.5,.56),.62*pow(body,2.5)*edge);
          }
        }
        water *= 1.0-night*.7;
        vec3 mirrored = skyColor(reflection,fresnel)*hull.x;
        // What stands above the water (islands, boats) mirrored over the sky, bent by the ripples and
        // the swell; the bend shrinks with distance, where a pixel already averages many ripples.
        if (reflectionOn > .5) {
          vec4 rc = reflectionMatrix*vec4(vWorld.x, 0.0, vWorld.z, 1.0);
          // Waves stretch a reflection into vertical streaks: three taps along the screen's vertical,
          // spread wider the rougher the water and the farther the eye.
          vec2 ruv = rc.xy/rc.w+normal.xz*(.11/(1.0+distanceToEye*.01));
          float streak = .004+.01*gust+.006*smoothstep(1.0,1.6,wind.y);
          vec4 seen = texture2D(reflectionMap, ruv)*.5+texture2D(reflectionMap, ruv+vec2(0.0,streak))*.25+texture2D(reflectionMap, ruv-vec2(0.0,streak))*.25;
          mirrored = mix(mirrored, seen.rgb*hull.x, seen.a*.85);
        }
        vec3 color = mix(water,mirrored,fresnel);

        // Dielectric microfacet sun glints, widened when the footprint grows.
        float roughness = .22+.11*smoothstep(.2,4.0,footprint);
        float a2 = pow(roughness,4.0);
        float denominator = nh*nh*(a2-1.0)+1.0;
        float distribution = a2/(PI*denominator*denominator);
        float k = pow(roughness+1.0,2.0)*.125;
        float masking = nv/(nv*(1.0-k)+k) * nl/(nl*(1.0-k)+k);
        float sunFresnel = .0204+.9796*pow(1.0-vh,5.0);
        float specular = distribution*masking*sunFresnel/(4.0*nv);
        // Under rain clouds the sun is hidden: its glints all but go (filmic tone mapping kept a 30% remnant bright).
        color += mix(vec3(1.0,.89,.64),vec3(1.0,.48,.21),warm)*specular*.6*(1.0-night)*(1.0-rain*.95)*step(0.0,sunDir.y);
        vec3 moonHalf = normalize(viewDir+moonDir);
        float mh = max(0.0,dot(normal,moonHalf));
        float moonA2 = pow(roughness*1.25,4.0), moonD = mh*mh*(moonA2-1.0)+1.0;
        float moonGlint = moonA2/(PI*moonD*moonD)*sunFresnel/(4.0*nv);
        color += vec3(.62,.72,.9)*min(moonGlint,40.0)*.05*night*(1.0-rain*.85)*step(0.0,moonDir.y);
        // The lanterns of the nearby hulls (lantern.js: port quarter, 1.7 m up) lay a warm pool on the
        // water and a streak that shimmers toward the eye. Lit as lantern.js lights them.
        float lamp = smoothstep(0.0,.35,night)*(1.0-.3*rain);
        if (lamp > 0.0) {
          for (int i=0; i<4; i++) {
            vec4 v = vessels[i];
            if (v.w < 0.0 || dot(p-v.xy,p-v.xy) > 3600.0) continue;
            float c = cos(v.z), s = sin(v.z);
            vec3 toLamp = vec3(v.x-.28*c+2.12*s, 1.7, v.y+.28*s+2.12*c)-vWorld;
            float d2 = dot(toLamp,toLamp);
            float glint = pow(max(dot(normal,normalize(viewDir+toLamp*inversesqrt(d2))),0.0),220.0);
            color += linearColor(vec3(1.0,.72,.42))*lamp*(glint*1.1+.22/(1.0+d2*.9))*max(0.0,1.0-d2/3600.0);
          }
        }

        float foamNoise = noise(p*.8+vec2(time*.12,-time*.08));
        float beachWave = shore*.8+time*.78+noise(p*.13)*2.3;
        float beachFoam = smoothstep(.68,.98,cos(beachWave))*(1.0-smoothstep(1.0,13.0,shore));
        beachFoam *= smoothstep(.22,.66,foamNoise)*.58;
        vec2 streakUV = vec2(dot(p,along)*.28, dot(p,across)*1.15);
        float streak = noise(streakUV+vec2(time*.35,0.0))*.6+noise(streakUV*2.7-vec2(time*.2,0.0))*.4;
        float windy = smoothstep(1.0,1.5,wind.y);
        // Whitecaps only in a real wind. A crest runs at 6-9 m/s, so foam tied to the crest itself slid
        // across the water as fast white smudges; instead a crest leaves foam where it broke, which stays
        // on the water (drifting with the streaks) and fades over about two seconds.
        float crestFoam = 0.0;
        if (windy > .01) {
          for (int k=0; k<4; k++) {
            float age = float(k)*.5;
            float crest = smoothstep(.62-.25*windy,.95,waveField(p,time-age).x+(streak-.5)*.35);
            crestFoam = max(crestFoam, crest*(1.0-age/2.0));
          }
          crestFoam *= smoothstep(.48,.78,streak)*.3*windy;
        }
        crestFoam *= 1.0-.5*smoothstep(.4,3.0,footprint);
        float foam = clamp(beachFoam+crestFoam,0.0,.85);
        vec3 foamLight = linearColor(vec3(.86,.92,.89))*mix(1.0,.09,night)*(1.0-rain*.3);
        color = mix(color,foamLight,foam);
        color += linearColor(vec3(.3,.8,1.))*beachFoam*night*(1.0-rain*.5)*.9;   // at night the breakers glow blue (bioluminescence)
        float haze = 1.0-exp(-pow(distanceToEye*mist*.85,2.0));
        color = mix(color,linearColor(skyBase(normalize(vec3(-viewDir.x,.02,-viewDir.z)))),haze);   // the horizon behind
        gl_FragColor = vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
