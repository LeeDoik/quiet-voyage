"""Field-guide plates for quiet-voyage: each sea creature drawn as ink and watercolour on paper.

Run:  blender -b -P tools/blender/guide_art.py -- [--only dolphin,orca] [--keep]
In:   public/assets/blender/marine-life/marine-life.glb  (tools/blender/marine_life.py), so the plates
      show the very animals the player meets
Out:  public/assets/guide/<species>.webp  (800 x 400, transparent; the guide draws it on its paper card)

Each animal is rendered three times from an orthographic plate camera (Cycles): lit colour, camera-space
normals and depth. numpy then paints it like a naturalist's plate: the colour becomes transparent
washes that pool darker at their edges and settle into the paper's grain, the silhouette and the
creases (from normal and depth breaks) become a sepia ink line that thickens on the shadow side, and
the wash is laid a little loose of the line, as a brush would. Noise is seeded per species, so the
plates are reproducible. --keep leaves the raw passes in tools/blender/.guide-passes/.
"""
import bpy, math, os, sys
import numpy as np
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
GLB = os.path.join(ROOT, 'public', 'assets', 'blender', 'marine-life', 'marine-life.glb')
OUT = os.path.join(ROOT, 'public', 'assets', 'guide')
PASSES = os.path.join(ROOT, 'tools', 'blender', '.guide-passes')
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ONLY = ARGS[ARGS.index('--only') + 1].split(',') if '--only' in ARGS else None
KEEP = '--keep' in ARGS

W, H = 800, 400          # the plate; rendered at SS times and filtered down
SS = 2
# Per species: azimuth (degrees, 0 = from the animal's right side, + swings toward its head),
# elevation (degrees above), roll of the animal itself, and how much of the plate it may fill.
VIEWS = {
    'dolphin':    dict(az=14, el=10, fill=.9, seed=11),
    'humpback':   dict(az=18, el=12, fill=.94, seed=12),
    'orca':       dict(az=14, el=9, fill=.9, seed=13),
    # From above, as plates show rays, turtles and things with wings; `head` 90 = head to the right,
    # 0 = head up (wide animals then fill the wide plate), `tilt` tips the back toward the viewer.
    'turtle':     dict(az=0, el=90, head=90, tilt=26, fill=.92, seed=14, tint=(.93, .96, .86)),
    'manta':      dict(az=0, el=90, head=0, tilt=16, fill=.92, seed=15),
    'flyingfish': dict(az=0, el=90, head=90, tilt=35, fill=.9, seed=16),
    'gull':       dict(az=0, el=90, head=0, tilt=-22, fill=.94, seed=17),
}
INK = np.array([62, 46, 34]) / 255           # sepia, a shade warmer than interface.js INK
PAPER = np.array([241, 232, 212]) / 255      # interface.js PAPER
COOL = np.array([.8, .9, 1.16])              # shadow and light temperature of the washes
WARM = np.array([1.05, 1.0, .9])

# ── scene ────────────────────────────────────────────────────────────────────────────────────

def setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=GLB)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = W * SS, H * SS
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '16'
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    world = bpy.data.worlds.new('sky')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (.82, .86, .9, 1)
    bg.inputs['Strength'].default_value = .35
    scene.world = world
    cam = bpy.data.objects.new('plate', bpy.data.cameras.new('plate'))
    cam.data.type = 'ORTHO'
    scene.collection.objects.link(cam)
    scene.camera = cam
    sun = bpy.data.objects.new('key', bpy.data.lights.new('key', 'SUN'))
    sun.data.energy = 4.6
    sun.data.angle = math.radians(18)               # a soft sun: gentle shading, no hard terminator
    scene.collection.objects.link(sun)
    return scene, cam, sun

def materials():
    """Three overrides: lit vertex colour, camera-space normal, depth (both as emission)."""
    def tree(name):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        return m, nt
    lit, nt = tree('lit')
    col = nt.nodes.new('ShaderNodeVertexColor'); col.layer_name = 'Color'
    bsdf = nt.nodes.new('ShaderNodeBsdfDiffuse')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(col.outputs['Color'], bsdf.inputs['Color'])
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    normal, nt = tree('normal')
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    vt = nt.nodes.new('ShaderNodeVectorTransform'); vt.vector_type = 'NORMAL'; vt.convert_from = 'WORLD'; vt.convert_to = 'CAMERA'
    mul = nt.nodes.new('ShaderNodeVectorMath'); mul.operation = 'MULTIPLY_ADD'
    mul.inputs[1].default_value = (.5, .5, .5); mul.inputs[2].default_value = (.5, .5, .5)
    em = nt.nodes.new('ShaderNodeEmission')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(geo.outputs['Normal'], vt.inputs['Vector'])
    nt.links.new(vt.outputs['Vector'], mul.inputs[0])
    nt.links.new(mul.outputs['Vector'], em.inputs['Color'])
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    depth, nt = tree('depth')
    cd = nt.nodes.new('ShaderNodeCameraData')
    mr = nt.nodes.new('ShaderNodeMapRange')
    em = nt.nodes.new('ShaderNodeEmission')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(cd.outputs['View Z Depth'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], em.inputs['Color'])
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return lit, normal, depth, mr

def frame(cam, ob, view):
    """Aim the orthographic camera at the animal from (az, el) and fit it to the plate."""
    az, el = math.radians(view['az']), math.radians(view['el'])
    pts = [ob.matrix_world @ v.co for v in ob.data.vertices]
    centre = sum(pts, Vector()) / len(pts)
    if view['el'] >= 89:
        # From above, the head (+Y) turned to `head`, tipped toward the viewer by `tilt`.
        rot = Matrix.Rotation(math.radians(view.get('head', 90)), 4, 'Z') @ Matrix.Rotation(math.radians(view.get('tilt', 0)), 4, 'X')
        cam.rotation_euler = rot.to_euler()
        d = rot.to_3x3() @ Vector((0, 0, 1))
    else:
        # From the animal's right (+X), swung toward its head (+Y), raised by el.
        d = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
        cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    cam.location = centre + d * 200
    bpy.context.view_layer.update()
    inv = cam.matrix_world.inverted()
    xs, ys, zs = zip(*[(inv @ p)[:] for p in pts])
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    cam.data.ortho_scale = max(w, h * W / H) / view['fill']
    scale = cam.data.ortho_scale
    cam.data.shift_x = (max(xs) + min(xs)) / 2 / scale
    cam.data.shift_y = (max(ys) + min(ys)) / 2 / scale
    cam.data.clip_start, cam.data.clip_end = 1, 400
    return -max(zs), -min(zs)                        # nearest and farthest depth along the view

def render(scene, path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = 'Non-Color'      # the file's own values, not linearised
    px = np.array(img.pixels[:], dtype=np.float32).reshape(H * SS, W * SS, 4)[::-1]   # top row first
    bpy.data.images.remove(img)
    return px

# ── painting ─────────────────────────────────────────────────────────────────────────────────

def blur(a, r):
    """Box blur three times (close to a Gaussian of sigma ~ r): separable, via cumulative sums."""
    r = int(max(1, r))
    for _ in range(3):
        for axis in (0, 1):
            pad = [(0, 0)] * a.ndim
            pad[axis] = (r + 1, r)
            c = np.cumsum(np.pad(a, pad, mode='edge'), axis=axis)
            hi = np.take(c, range(2 * r + 1, c.shape[axis]), axis=axis)
            lo = np.take(c, range(0, c.shape[axis] - 2 * r - 1), axis=axis)
            a = (hi - lo) / (2 * r + 1)
    return a

def noise(shape, cells, rng):
    """Smooth value noise in [0, 1] with about `cells` cells across the width."""
    h, w = shape
    gw, gh = int(cells) + 2, int(cells * h / w) + 2
    g = rng.random((gh, gw))
    y = np.linspace(0, gh - 1.001, h)[:, None]; x = np.linspace(0, gw - 1.001, w)[None, :]
    y0, x0 = np.floor(y).astype(int), np.floor(x).astype(int)
    fy, fx = y - y0, x - x0
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a = g[y0, x0] * (1 - fx) + g[y0, x0 + 1] * fx
    b = g[y0 + 1, x0] * (1 - fx) + g[y0 + 1, x0 + 1] * fx
    return a * (1 - fy) + b * fy

def fractal(shape, cells, rng, octaves=4):
    n, amp, total = np.zeros(shape), 1.0, 0.0
    for i in range(octaves):
        n += noise(shape, cells * 2 ** i, rng) * amp
        total += amp; amp *= .5
    return n / total

def warp(a, dx, dy):
    """Sample `a` at (x + dx, y + dy), bilinear; dx, dy in pixels."""
    h, w = a.shape[:2]
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    x = np.clip(x + dx, 0, w - 1.001); y = np.clip(y + dy, 0, h - 1.001)
    x0, y0 = x.astype(int), y.astype(int)
    fx, fy = x - x0, y - y0
    if a.ndim == 3:
        fx, fy = fx[..., None], fy[..., None]
    top = a[y0, x0] * (1 - fx) + a[y0, x0 + 1] * fx
    bot = a[y0 + 1, x0] * (1 - fx) + a[y0 + 1, x0 + 1] * fx
    return top * (1 - fy) + bot * fy

def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)

def paint(colour, normal, depth, seed):
    """Ink and watercolour from the three passes (all at SS times the plate size)."""
    rng = np.random.default_rng(seed)
    shape = colour.shape[:2]
    S = SS
    alpha = colour[..., 3]
    rgb = np.where(alpha[..., None] > 1e-3, colour[..., :3] / np.maximum(alpha[..., None], 1e-4), 0)   # un-premultiply
    n = normal[..., :3] * 2 - 1

    def grad(a):
        gx = np.zeros_like(a); gy = np.zeros_like(a)
        gx[:, 1:-1] = a[:, 2:] - a[:, :-2]; gy[1:-1] = a[2:] - a[:-2]
        return np.sqrt(gx * gx + gy * gy) if a.ndim == 2 else np.sqrt((gx * gx + gy * gy).sum(-1))

    # The colour a painter would mix: values settled into a few soft layers (washes laid one over
    # another), the hue pushed out of grey, shadows cool and lights warm, all a little airy.
    lum = rgb @ np.array([.3, .59, .11])
    chroma = rgb - lum[..., None]
    soft = blur(lum, 1.5 * S)
    v = soft * 3.2
    levels = (np.floor(v) + smoothstep(.3, .7, v - np.floor(v))) / 3.2
    val = np.clip((soft * .35 + levels * .65 - .5) * 1.18 + .5, 0, 1)
    temp = smoothstep(.15, .8, val)[..., None]
    chroma = chroma * np.minimum(1.6, .22 / np.maximum(np.abs(chroma).max(-1, keepdims=True), 1e-4))   # vivid, never garish
    target = (val[..., None] + chroma) * (COOL * (1 - temp) + WARM * temp)
    target = np.clip(1 - (1 - target) * .9, 0, 1)
    # Pigment over paper: how much of it (density) and of which colour, so that the wash shows the
    # target where it lies thick; light passages are thin pigment, the paper showing through.
    dark = 1 - (target @ np.array([.3, .59, .11])) / (PAPER @ np.array([.3, .59, .11]))
    density = np.clip(dark * 1.35 + .16, .16, .95)
    pigment = np.clip((target - PAPER * (1 - density[..., None])) / density[..., None], 0, 1)
    # The brush: coverage laid a little loose of the drawing, spilling past the line here and
    # falling short of it there, and the colour carried with it.
    wob = (fractal(shape, 4, rng, 3) - .5) * 10 * S, (fractal(shape, 4, rng, 3) - .5) * 10 * S
    cover = smoothstep(.42, .56, warp(blur(alpha, 1.6 * S), *wob))
    density, pigment = warp(density, *wob), warp(pigment, *wob)
    # Pigment pools where a wash dried (its edge) and blooms unevenly; it settles into the paper.
    edge = np.clip(cover - blur(cover, 6 * S), 0, 1)
    bloom = fractal(shape, 6, rng, 3)
    grain = blur(fractal(shape, 90, rng, 2), .6 * S)
    wash = np.clip(density * (.8 + .4 * bloom) * (.93 + .14 * grain) + edge * .5, 0, 1) * cover
    # Wet-in-wet: the hue drifts a little warmer or cooler across a wash.
    drift = (fractal(shape, 3, rng, 2)[..., None] - .5) * np.array([.12, .02, -.1])
    pigment = np.clip(pigment + drift, 0, 1)
    # Ink: the silhouette and the strongest creases (fins over the body), heavier on the shadow side,
    # swelling and thinning along the stroke and breaking now and then.
    sil = grad(blur(alpha, .8 * S))
    crease = grad(blur(n * alpha[..., None], S)) * alpha
    step = grad(blur(depth[..., 0] * alpha, S)) * alpha
    shade = blur(1 - np.clip(.5 + .5 * (n[..., 1] * .75 - n[..., 0] * .35), 0, 1), 3 * S)
    weight = (.55 + .9 * shade) * (.65 + .7 * fractal(shape, 10, rng, 3))
    weight *= .5 + .5 * smoothstep(.15, .32, fractal(shape, 30, rng, 2))
    line = smoothstep(.12, .4, sil * weight * 1.6)
    inner = np.maximum(smoothstep(.3, .7, crease), smoothstep(.03, .09, step)) * weight
    ink_a = np.clip(np.maximum(line, smoothstep(.25, .6, inner) * .6), 0, 1) * .92
    a = ink_a + wash * (1 - ink_a)
    rgb_out = (INK * ink_a[..., None] + pigment * (wash * (1 - ink_a))[..., None]) / np.maximum(a[..., None], 1e-4)
    out = np.dstack([rgb_out, a])
    # Down to the plate size: average SS x SS blocks (a clean box filter).
    out = out.reshape(H, S, W, S, 4).mean(axis=(1, 3))
    return out

def save(px, path):
    """WebP with alpha (a few tens of kB a plate); the guide loads it the first time it opens."""
    img = bpy.data.images.new(os.path.basename(path), W, H, alpha=True)
    img.colorspace_settings.name = 'sRGB'
    img.pixels[:] = px[::-1].astype(np.float32).ravel()
    img.filepath_raw = path
    img.file_format = 'WEBP'
    img.save(filepath=path, quality=88)
    bpy.data.images.remove(img)

# ── main ─────────────────────────────────────────────────────────────────────────────────────

def main():
    scene, cam, sun = setup()
    lit, normal, depth, depth_map = materials()
    os.makedirs(OUT, exist_ok=True); os.makedirs(PASSES, exist_ok=True)
    animals = [ob for ob in scene.objects if ob.type == 'MESH']
    for ob in animals:
        name = ob.name
        if name not in VIEWS or (ONLY and name not in ONLY):
            continue
        for other in animals:
            other.hide_render = other is not ob
        view = VIEWS[name]
        near, far = frame(cam, ob, view)
        depth_map.inputs['From Min'].default_value, depth_map.inputs['From Max'].default_value = near, far
        # Light from the upper left and a little in front, as a plate is lit.
        # (from above, more raking, so white birds and flat rays still show their form)
        light = Vector((-.6, .65, .25)) if view['el'] >= 89 else Vector((-.55, .7, .45))
        sun.rotation_euler = (cam.matrix_world.to_quaternion() @ light).normalized().to_track_quat('Z', 'Y').to_euler()
        passes = {}
        for key, mat, samples in (('colour', lit, 48), ('normal', normal, 8), ('depth', depth, 8)):
            ob.data.materials.clear(); ob.data.materials.append(mat)
            scene.cycles.samples = samples
            scene.cycles.use_denoising = key == 'colour'
            scene.view_settings.view_transform = 'Standard' if key == 'colour' else 'Raw'
            passes[key] = render(scene, os.path.join(PASSES, f'{name}-{key}.png'))
        if 'tint' in view:                              # a species whose model colour reads wrong on paper
            passes['colour'][..., :3] *= np.array(view['tint'], dtype=np.float32)
        plate = paint(passes['colour'], passes['normal'], passes['depth'], view['seed'])
        save(plate, os.path.join(OUT, f'{name}.webp'))
        print('PLATE', name, os.path.getsize(os.path.join(OUT, f'{name}.webp')))
    if not KEEP:
        for f in os.listdir(PASSES):
            os.remove(os.path.join(PASSES, f))

main()
