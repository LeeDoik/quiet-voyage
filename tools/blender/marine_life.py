"""Marine life models for quiet-voyage, built in Blender from code.

Run:  blender -b -P tools/blender/marine_life.py -- [--render] [--frames DIR]
Out:  public/assets/blender/marine-life/marine-life.glb  (one mesh per species, named after it)
      tools/blender/renders/render-<species>[-side|-top].png  with --render

Conventions (what public/src/marine-life.js expects): metres; head toward +Y in Blender, which the
glTF exporter turns into -Z (the game's "forward"); up +Z (glTF +Y); colours as a linear vertex
colour attribute "Col" (glTF COLOR_0); smooth normals; UVs for the shared skin texture. Bodies are
lofted from cross-sections and smoothed with a subdivision level; fins, flukes, flippers and wings
are lofted from symmetric NACA airfoil sections, so they are thick at the root, thin at the edge.
Sizes match the game's: dolphin 2.3 m, orca 7 m, humpback 13 m, turtle shell 1 m, manta 4.5 m span,
flying fish 0.34 m, gull 0.46 m body.
"""
import bpy, bmesh, json, math, os, struct, sys
import numpy as np
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'blender', 'marine-life')
RENDERS = os.path.join(ROOT, 'tools', 'blender', 'renders')   # previews stay out of the deployed public/
RENDER = '--render' in sys.argv
# --frames DIR renders each species' baked animation cycle as DIR/<species>/NNN.png instead of the stills.
CYCLE = sys.argv[sys.argv.index('--frames') + 1] if '--frames' in sys.argv else None
CYCLE_FRAMES = 48

# ── small maths ──────────────────────────────────────────────────────────────────────────────

def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a) if b != a else 0.0))
    return t * t * (3 - 2 * t)

def mix(a, b, t):
    return a + (b - a) * t

def mix3(a, b, t):
    return tuple(mix(a[i], b[i], t) for i in range(3))

def table(rows):
    """rows: [(t, *values)] sorted by t; smooth interpolation between rows."""
    def f(t):
        i = 1
        while i < len(rows) - 1 and rows[i][0] < t:
            i += 1
        a, b = rows[i - 1], rows[i]
        k = smooth(0, 1, (t - a[0]) / ((b[0] - a[0]) or 1))
        return [mix(a[j], b[j], k) for j in range(1, len(a))]
    return f

def hash01(*n):
    s = 0.0
    for v in n:
        s = math.sin(s * 12.9898 + v * 78.233 + 37.719) * 43758.5453
    return s - math.floor(s)

def noise2(x, y):
    """Smooth value noise in [0, 1]."""
    ix, iy = math.floor(x), math.floor(y)
    fx, fy = x - ix, y - iy
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = hash01(ix, iy), hash01(ix + 1, iy)
    c, d = hash01(ix, iy + 1), hash01(ix + 1, iy + 1)
    return mix(mix(a, b, fx), mix(c, d, fx), fy)

# ── builders ─────────────────────────────────────────────────────────────────────────────────

def new_object(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob

def loft(name, L, section, rings=40, M=24, y0=0.0, z0=0.0, x0=0.0, shape=None):
    """A body along Y, head at +L/2. section(t) -> (halfWidth, halfHeight, centreZ, underScale),
    t = 0 at the head. shape(t, angle, r) may change the radius (grooves, bumps)."""
    bm = bmesh.new()
    rows = []
    for r in range(rings + 1):
        t = r / rings
        hw, hh, zc, under = section(t)
        row = []
        for j in range(M):
            a = j / M * math.tau
            c, s = math.cos(a), math.sin(a)
            k = shape(t, a, 1.0) if shape else 1.0
            z = zc + hh * s * (under if s < 0 else 1.0) * k
            row.append(bm.verts.new((x0 + hw * c * k, y0 + L / 2 - t * L, z0 + z)))
        rows.append(row)
    head = bm.verts.new((x0, y0 + L / 2 + 0.002 * L, z0 + section(0)[2]))
    tail = bm.verts.new((x0, y0 - L / 2 - 0.002 * L, z0 + section(1)[2]))
    for r in range(rings):
        for j in range(M):
            a, b = rows[r][j], rows[r][(j + 1) % M]
            c, d = rows[r + 1][(j + 1) % M], rows[r + 1][j]
            bm.faces.new((a, d, c, b))
    for j in range(M):
        bm.faces.new((head, rows[0][j], rows[0][(j + 1) % M]))
        bm.faces.new((tail, rows[-1][(j + 1) % M], rows[-1][j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object(name, bm)

def airfoil(n):
    """Closed symmetric NACA-00xx outline (unit chord, unit max thickness): [(x, ±y)] around."""
    pts = []
    for i in range(n + 1):
        x = (1 - math.cos(math.pi * i / n)) / 2
        y = 5 * (0.2969 * math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4) / 0.6
        pts.append((x, y))
    top = pts
    bottom = [(x, -y) for x, y in reversed(pts[1:-1])]
    return top + bottom

def wing(name, stations, n=10, matrix=Matrix.Identity(4), levels=1):
    """A fin lofted along its span. stations: [(span, lead, trail, thick, lift)] where lead/trail
    are chord positions (lead > trail along the chord axis), thick the max thickness and lift an
    offset across the thickness axis (camber or droop). Local axes: span = X, chord = Y (lead at +Y),
    thickness = Z; `matrix` places it on the body."""
    bm = bmesh.new()
    foil = airfoil(n)
    rings = []
    for span, lead, trail, thick, lift in stations:
        chord = max(lead - trail, 1e-4)
        ring = [bm.verts.new(matrix @ Vector((span, lead - x * chord, lift + y * thick / 2))) for x, y in foil]
        rings.append(ring)
    m = len(foil)
    for r in range(len(rings) - 1):
        for j in range(m):
            a, b = rings[r][j], rings[r][(j + 1) % m]
            c, d = rings[r + 1][(j + 1) % m], rings[r + 1][j]
            bm.faces.new((a, b, c, d))
    for ring, flip in ((rings[0], True), (rings[-1], False)):
        centre = bm.verts.new(sum((v.co for v in ring), Vector()) / m)
        for j in range(m):
            f = (centre, ring[(j + 1) % m], ring[j]) if flip else (centre, ring[j], ring[(j + 1) % m])
            bm.faces.new(f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_object(name, bm)
    subdivide(ob, levels)                              # rounds the airfoil and the outline
    return ob

def place(rot=(0, 0, 0), at=(0, 0, 0)):
    """Euler XYZ in degrees, then translation."""
    rx, ry, rz = (math.radians(v) for v in rot)
    return Matrix.Translation(at) @ (Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rx, 4, 'X'))

def mirror_x(m):
    return Matrix.Scale(-1, 4, (1, 0, 0)) @ m

def subdivide(ob, levels):
    if levels <= 0:
        return
    mod = ob.modifiers.new('Subsurf', 'SUBSURF')
    mod.levels = levels
    mod.render_levels = levels
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    ob.select_set(False)

def join(name, parts):
    """Joins parts into one mesh. Each vertex keeps the index of the part it came from in the
    integer attribute 'part' (the animation moves fins and body differently)."""
    bpy.ops.object.select_all(action='DESELECT')
    for i, p in enumerate(parts):
        a = p.data.attributes.new('part', 'INT', 'POINT')
        a.data.foreach_set('value', [i] * len(p.data.vertices))
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    ob = parts[0]
    ob.name = ob.data.name = name
    for poly in ob.data.polygons:
        poly.use_smooth = True
    # Thin fins can come out inside-out; make every face point outward (the game culls back faces).
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    ob.select_set(False)
    return ob

def paint(ob, colour):
    """colour(co, normal) -> (r, g, b) linear; stored per corner so parts can keep hard seams."""
    me = ob.data
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = me.color_attributes.find('Col')
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index]
            r, g, b = colour(v.co, v.normal)
            attr.data[li].color = (r, g, b, 1.0)

def unwrap(ob):
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')
    ob.select_set(False)

def finish(ob, colour, decimate=None):
    if decimate:
        mod = ob.modifiers.new('Decimate', 'DECIMATE')
        mod.ratio = decimate
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        ob.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.shade_smooth()
    ob.select_set(False)
    ob.data.update()
    paint(ob, colour)
    unwrap(ob)
    return ob

# Countershading by height on the body: dark back, lighter flank, pale belly.
def counter(back, flank, belly, low=-0.55, mid=-0.05, high=0.45):
    def f(s):
        return mix3(mix3(belly, flank, smooth(low, mid, s)), back, smooth(mid, high, s))
    return f

# ── animation ────────────────────────────────────────────────────────────────────────────────
# Each species registers anim(co, part, phi) -> Vector: where rest-pose vertex `co` of joined part
# `part` is at phase phi of one swim or wing-beat cycle. A backbone bends the body as a travelling
# wave and carries the cross-sections with it; fins, flippers and wings turn about their roots like
# joints. bake() samples the cycle and stores it as Fourier harmonics the game's shader replays.

ANIMS = {}
MIRROR = Matrix.Scale(-1, 4, (1, 0, 0))

def rot(axis, angle, at):
    at = Vector(at)
    return Matrix.Translation(at) @ Matrix.Rotation(angle, 4, axis) @ Matrix.Translation(-at)

def backbone(wave, lateral=False):
    """wave(y, phi) -> offset of the spine at y (up-down for whales, side to side for fish).
    Returns xf(y, phi): the matrix carrying the cross-section at y along the bent spine."""
    def xf(y, phi):
        h = .004
        d = wave(y, phi)
        a = math.atan((wave(y + h, phi) - wave(y - h, phi)) / (2 * h))
        if lateral:
            return Matrix.Translation((d, 0, 0)) @ rot('Z', -a, (0, y, 0))
        return Matrix.Translation((0, 0, d)) @ rot('X', a, (0, y, 0))
    return xf

def body_wave(L, tail, head=.006, lag=1.7, start=.3, end=1.15):
    """A travelling wave whose height grows from a small head heave to `tail` (in body lengths)."""
    def wave(y, phi):
        u = (L / 2 - y) / L
        env = L * (head * (1 - smooth(0, .4, u)) + tail * smooth(start, end, u) ** 2)
        return env * math.sin(phi - lag * u)
    return wave

def sided(part, left_parts, co, fn):
    """Runs fn on the right-hand copy of a mirrored part and mirrors the result back."""
    if part in left_parts:
        return MIRROR @ fn(MIRROR @ co)
    return fn(co)

def bake(ob, anim, frames=24):
    """Samples the cycle, fits harmonics up to the 2nd for positions and the 1st for normals, leaves
    the mean pose as the mesh and the harmonics as _A1 _B1 _A2 _B2 (positions) _N1 _M1 (normals):
    p(phi) = mean + A1 cos phi + B1 sin phi + A2 cos 2phi + B2 sin 2phi. Returns the worst fit error (m)."""
    me = ob.data
    n = len(me.vertices)
    rest = np.empty(n * 3); me.vertices.foreach_get('co', rest); rest = rest.reshape(n, 3)
    parts = np.zeros(n, dtype=np.int32); me.attributes['part'].data.foreach_get('value', parts)
    P, N = np.empty((frames, n, 3)), np.empty((frames, n, 3))
    buf = np.empty(n * 3)
    for k in range(frames):
        phi = k / frames * math.tau
        for i in range(n):
            P[k, i] = anim(Vector(rest[i]), int(parts[i]), phi)
        me.vertices.foreach_set('co', P[k].ravel()); me.update()
        me.vertex_normals.foreach_get('vector', buf); N[k] = buf.reshape(n, 3)
    ph = np.arange(frames) / frames * math.tau
    c1, s1, c2, s2 = np.cos(ph), np.sin(ph), np.cos(2 * ph), np.sin(2 * ph)
    fit = lambda w, X: 2 / frames * np.tensordot(w, X, 1)
    mean, A1, B1, A2, B2 = P.mean(0), fit(c1, P), fit(s1, P), fit(c2, P), fit(s2, P)
    back = mean + c1[:, None, None] * A1 + s1[:, None, None] * B1 + c2[:, None, None] * A2 + s2[:, None, None] * B2
    error = float(np.abs(back - P).max())
    me.vertices.foreach_set('co', mean.ravel()); me.update()
    for name, v in (('_A1', A1), ('_B1', B1), ('_A2', A2), ('_B2', B2), ('_N1', fit(c1, N)), ('_M1', fit(s1, N))):
        a = me.attributes.new(name, 'FLOAT_VECTOR', 'POINT')
        a.data.foreach_set('vector', v.astype(np.float32).ravel())
    me.attributes.remove(me.attributes['part'])
    return error

def pose(ob, phi):
    """The baked pose at phase phi (as the game will draw it at full strength), for previews."""
    me = ob.data
    n = len(me.vertices)
    get = lambda name: (lambda b: (me.attributes[name].data.foreach_get('vector', b), b.reshape(n, 3))[1])(np.empty(n * 3, dtype=np.float32))
    if 'mean' not in ob:
        b = np.empty(n * 3); me.vertices.foreach_get('co', b); ob['mean'] = b.tolist()
    mean = np.array(ob['mean']).reshape(n, 3)
    p = mean + math.cos(phi) * get('_A1') + math.sin(phi) * get('_B1') + math.cos(2 * phi) * get('_A2') + math.sin(2 * phi) * get('_B2')
    me.vertices.foreach_set('co', p.ravel()); me.update()

# ── species ──────────────────────────────────────────────────────────────────────────────────

def body_coords(L, section, y0=0.0, z0=0.0):
    """For colouring: (t along the body, s up the section -1..1, c across -1..1, inside)."""
    def f(co):
        t = max(0.0, min(1.0, (y0 + L / 2 - co.y) / L))
        hw, hh, zc, under = section(t)
        z = co.z - z0
        s = (z - zc) / (hh * (under if z < zc else 1.0) or 1e-6)
        c = co.x / (hw or 1e-6)
        return t, s, c, (s * s + c * c) < 1.35
    return f

def surface(L, section, t, a, y0=0.0, z0=0.0):
    """The right-hand point of a lofted body at (t, angle a) and its outward normal."""
    hw, hh, zc, under = section(t)
    c, s = math.cos(a), math.sin(a)
    k = under if s < 0 else 1.0
    point = Vector((hw * c, y0 + L / 2 - t * L, z0 + zc + hh * s * k))
    return point, Vector((c / max(hw, 1e-4), 0, s / max(hh * k, 1e-4))).normalized()

EYE = 99   # the 'part' of eyes: they ride with the body (or the head) they sit in

def add_eyes(ob, at, normal, r, glance=.35):
    """A pair of round, glossy eyes (bigger than life: they are what makes a face read), each a dark
    dome bulging from the skin at `at` (right side, mirrored to the left) with a big catchlight up and
    forward and a small second sparkle below. Joined into `ob` as part EYE, after it is painted."""
    bm = bmesh.new()
    for side in (1, -1):
        centre = Vector((at.x * side, at.y, at.z)) - Vector((normal.x * side, normal.y, normal.z)) * r * .38
        bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, radius=r, matrix=Matrix.Translation(centre))
    eyes = new_object(ob.name + '-eyes', bm)
    for poly in eyes.data.polygons:
        poly.use_smooth = True
    eyes.data.attributes.new('part', 'INT', 'POINT').data.foreach_set('value', [EYE] * len(eyes.data.vertices))
    def colour(co, n):
        side = 1 if co.x > 0 else -1
        out = Vector((normal.x * side, normal.y, normal.z))
        key = (out * .5 + Vector((0, glance, .8))).normalized()
        spark = (out * .8 + Vector((0, -.25, -.45))).normalized()
        if n.dot(key) > .9:
            return (.98, .98, .96)
        if n.dot(spark) > .975:
            return (.75, .78, .82)
        return mix3((.012, .012, .016), (.1, .085, .07), .6 * smooth(.75, .3, n.dot(out)))   # a warm dark rim
    paint(eyes, colour)
    bpy.ops.object.select_all(action='DESELECT')
    eyes.select_set(True); ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.join()
    ob.select_set(False)
    return ob

BLUSH = (.93, .58, .58)

def dolphin():
    L = 2.3
    rows = table([
        (0.00, .018, .018, -.030, 1), (0.025, .036, .032, -.033, 1), (0.05, .058, .052, -.030, 1),
        (0.07, .110, .130, .005, 1), (0.12, .180, .205, .030, .92), (0.22, .245, .270, .020, .92),
        (0.38, .285, .305, .010, .95), (0.55, .235, .265, .020, 1), (0.70, .140, .200, .030, 1),
        (0.82, .070, .140, .030, 1), (0.92, .038, .072, .020, 1), (1.00, .020, .026, .020, 1)])   # round melon, short beak, plump
    section = lambda t: rows(t)
    body = loft('dolphin', L, section, rings=34, M=20)
    subdivide(body, 1)
    up = place((0, -90, 0), (0, .12, .255))
    dorsal = wing('d-fin', [(0, .22, -.22, .075, 0), (.1, .15, -.17, .06, 0), (.2, .06, -.14, .045, 0), (.29, -.05, -.17, .03, 0), (.35, -.16, -.22, .016, 0), (.375, -.21, -.24, .006, 0)], matrix=up)
    pec_m = place((0, 32, -24), (.16, .56, -.13))
    pec = [(0, .12, -.10, .05, 0), (.12, .09, -.12, .04, 0), (.24, .03, -.12, .028, 0), (.32, -.04, -.10, .016, 0), (.365, -.08, -.10, .006, 0)]
    flipper_r = wing('d-pec-r', pec, matrix=pec_m)
    flipper_l = wing('d-pec-l', pec, matrix=mirror_x(pec_m))
    fluke = [(0, .06, -.12, .04, 0), (.06, .05, -.17, .036, 0), (.14, .02, -.18, .03, 0), (.25, -.05, -.21, .02, 0), (.34, -.14, -.24, .012, 0), (.385, -.23, -.27, .005, 0)]
    fluke_m = place((0, 0, 0), (0, -1.06, .02))
    fluke_r = wing('d-fluke-r', fluke, matrix=fluke_m)
    fluke_l = wing('d-fluke-l', fluke, matrix=mirror_x(fluke_m))
    ob = join('dolphin', [body, dorsal, flipper_r, flipper_l, fluke_r, fluke_l])
    where = body_coords(L, section)
    back, flank, belly = (.2, .26, .33), (.5, .57, .64), (.9, .9, .89)
    skin = counter(back, flank, belly, -.6, -.15, .35)
    def colour(co, n):
        t, s, c, inside = where(co)
        if not inside:                                   # fins: dark above, a touch lighter below
            return mix3(flank, back, smooth(-.4, .3, n.z)) if co.z < .2 else back
        col = skin(s + .12 * math.sin(t * 9 + 1.3) * smooth(.3, .6, t))   # a wavy cape line
        if .4 < t < .72 and -.15 < s < .3:               # pale spinal blaze sweeping up behind the fin
            col = mix3(col, (.62, .65, .68), .45 * smooth(.4, .5, t) * smooth(.72, .62, t) * smooth(.3, .05, abs(s - .08 - (t - .4))))
        if t < .055:                                     # the beak: darker on top
            col = mix3(col, back, .6 * smooth(-.2, .5, s))
        cheek = math.hypot((t - .155) / .03, (s + .14) / .2)
        if cheek < 1 and abs(c) > .4:                    # a faint blush under the eye
            col = mix3(col, BLUSH, .35 * smooth(1, .2, cheek))
        if .03 < t < .1 and abs(s - (-.3 + 3.2 * max(0.0, t - .07))) < .045:   # the smile, turning up at the corner
            col = mix3(col, (.12, .13, .16), .75)
        return col
    # Up-and-down fluke strokes passing back along the body; the flippers trim a little.
    spine = backbone(body_wave(L, .085))
    pec_root = Vector((.16, .56, -.13))
    def anim(co, part, phi):
        if part in (2, 3):
            fin = sided(part, (3,), co, lambda p: rot('Y', .1 * math.sin(phi + .8), pec_root) @ p)
            return spine(pec_root.y, phi) @ fin
        return spine(co.y, phi) @ co
    ANIMS['dolphin'] = anim
    finish(ob, colour, decimate=.6)
    return add_eyes(ob, *surface(L, section, .125, .1), .042)


def orca():
    L = 7.0
    rows = table([
        (0.00, .06, .06, -.08, 1), (0.03, .3, .28, -.06, 1), (0.08, .48, .47, -.02, .95),
        (0.18, .62, .66, .02, .92), (0.35, .74, .82, .05, .92), (0.55, .62, .72, .06, .95),
        (0.72, .36, .50, .08, 1), (0.85, .17, .30, .07, 1), (0.94, .09, .14, .05, 1), (1.00, .05, .06, .04, 1)])
    section = lambda t: rows(t)
    body = loft('orca', L, section, rings=36, M=22)
    subdivide(body, 1)
    dorsal = wing('o-fin', [(0, .5, -.45, .17, 0), (.45, .3, -.36, .13, 0), (.9, .12, -.28, .085, 0), (1.25, -.02, -.25, .05, 0), (1.42, -.12, -.26, .02, 0)], matrix=place((0, -90, 0), (0, .9, .78)))   # shorter, round-tipped
    pec = [(0, .35, -.22, .13, 0), (.3, .42, -.34, .11, 0), (.65, .38, -.4, .09, 0), (.92, .24, -.32, .06, 0), (1.05, .06, -.12, .02, 0)]
    pm = place((0, 34, -26), (.4, 2.2, -.3))            # root sunk into the flank, under the eye patch
    pec_r, pec_l = wing('o-pec-r', pec, matrix=pm), wing('o-pec-l', pec, matrix=mirror_x(pm))
    fluke = [(0, .25, -.33, .13, 0), (.2, .22, -.5, .12, 0), (.45, .12, -.56, .1, 0), (.8, -.06, -.66, .07, 0), (1.05, -.32, -.72, .04, 0), (1.16, -.52, -.75, .014, 0)]
    fm = place((0, 0, 0), (0, -3.28, .04))
    ob = join('orca', [body, dorsal, pec_r, pec_l, wing('o-fluke-r', fluke, matrix=fm), wing('o-fluke-l', fluke, matrix=mirror_x(fm))])
    where = body_coords(L, section)
    black, white, grey = (.05, .056, .068), (.93, .93, .91), (.5, .53, .57)
    def colour(co, n):
        t, s, c, inside = where(co)
        if not inside:
            if co.y < -3.0 and n.z < -.2:             # flukes: white below
                return mix3(black, white, .85)
            return black
        col = mix3(white, black, smooth(-.62, -.42, s + .18 * smooth(.45, .7, t) - .25 * smooth(.25, .05, t)))
        if .55 < t < .8 and -.55 < s < .05 and abs(c) > .45:          # the white flank flare, sweeping up
            k = smooth(.55, .62, t) * smooth(.8, .7, t) * smooth(.05, -.15, s - (t - .6) * 1.2)
            col = mix3(col, white, k)
        eye = math.hypot((t - .2) / .056, (s - .3) / .2)
        if eye < 1 and abs(c) > .35:                   # the eye patch, round
            col = mix3(col, white, smooth(1, .75, eye))
        saddle = math.hypot((t - .5) / .07, (s - .95) / .25)
        if saddle < 1:                                 # the grey saddle behind the fin
            col = mix3(col, grey, .8 * smooth(1, .6, saddle))
        return col
    # Slow, heavy strokes; the tall dorsal fin sways a touch.
    spine = backbone(body_wave(L, .075, lag=1.6))
    pec_root, fin_root = Vector((.4, 2.2, -.3)), Vector((0, .9, .78))
    def anim(co, part, phi):
        if part == 1:
            return spine(co.y, phi) @ rot('Y', .035 * math.sin(phi + 1.2), fin_root) @ co
        if part in (2, 3):
            fin = sided(part, (3,), co, lambda p: rot('Y', .09 * math.sin(phi + .8), pec_root) @ p)
            return spine(pec_root.y, phi) @ fin
        return spine(co.y, phi) @ co
    ANIMS['orca'] = anim
    finish(ob, colour)
    return add_eyes(ob, *surface(L, section, .15, .1), .1)

def humpback():
    L = 13.0
    rows = table([
        (0.00, .3, .16, -.1, 1), (0.04, .7, .4, -.08, 1), (0.10, 1.1, .7, -.05, 1.0),   # a rounder head
        (0.20, 1.40, 1.00, -.15, 1.08), (0.32, 1.65, 1.45, -.10, 1.0), (0.50, 1.50, 1.38, .00, .95),
        (0.68, .95, .95, .08, 1), (0.82, .48, .55, .08, 1), (0.92, .22, .28, .06, 1), (1.00, .12, .13, .05, 1)])
    section = lambda t: rows(t)
    def shape(t, a, r):
        s = math.sin(a)
        k = 1.0
        if s < -.25 and t < .56:                       # ventral pleats: long grooves from chin to navel
            k -= .012 * (.5 + .5 * math.cos(a * 24)) * smooth(-.25, -.5, s) * smooth(.56, .45, t) * smooth(.03, .1, t)
        if s > .2 and t < .16:                         # tubercles: knobs on the head
            bump = max(0.0, math.sin(t * 160) * math.sin(a * 13)) ** 6
            k += .05 * bump * smooth(.16, .1, t)
        return k
    body = loft('humpback', L, section, rings=64, M=48, shape=shape)
    subdivide(body, 1)
    dorsal = wing('h-fin', [(0, .7, -.6, .32, 0), (.22, .32, -.48, .22, 0), (.42, .02, -.38, .12, 0), (.52, -.2, -.36, .05, 0)], matrix=place((0, -90, 0), (0, -1.6, 1.05)))
    pec = []
    for i in range(15):
        sp = i / 14 * 4.1
        lead = .5 - sp * .05 + .07 * max(0, math.sin(sp * 6.5)) ** 2   # knobbly leading edge
        chord = mix(1.0, .45, sp / 4.1) * (1 - smooth(3.6, 4.1, sp) * .8)
        pec.append((sp, lead, lead - chord, mix(.28, .05, sp / 4.1), -sp * sp * .02))
    pm = place((0, 20, -38), (1.25, 3.7, -.65))
    pec_r, pec_l = wing('h-pec-r', pec, matrix=pm), wing('h-pec-l', pec, matrix=mirror_x(pm))
    fluke = []
    for i in range(13):
        sp = i / 12 * 2.2
        lead = .3 - .45 * (sp / 2.2) ** 2
        trail = -.55 - .5 * (sp / 2.2) ** 1.5 + .06 * math.sin(sp * 11) * smooth(.2, .6, sp)  # serrated trailing edge
        if sp > 1.9:
            trail = mix(trail, lead - .08, smooth(1.9, 2.2, sp))
        fluke.append((sp, lead, trail, mix(.22, .03, sp / 2.2), 0))
    fm = place((0, 0, 0), (0, -6.1, .05))
    ob = join('humpback', [body, dorsal, pec_r, pec_l, wing('h-fluke-r', fluke, matrix=fm), wing('h-fluke-l', fluke, matrix=mirror_x(fm))])
    where = body_coords(L, section)
    back, belly = (.14, .16, .2), (.84, .84, .82)
    def colour(co, n):
        t, s, c, inside = where(co)
        if not inside:
            if abs(co.x) > 1.6 and co.y > 1.0:        # the long white flippers, a little dark at the root on top
                return mix3(belly, back, .6 * smooth(2.6, 1.6, abs(co.x)) * smooth(-.2, .4, n.z))
            if co.y < -5.8:                            # flukes: white and mottled below, dark above
                mottle = noise2(co.x * 2.2, co.y * 2.2)
                return mix3(back, belly, smooth(.1, -.4, n.z) * (.55 + .45 * smooth(.35, .6, mottle)))
            return back
        col = mix3(belly, back, smooth(-.5, -.1, s + .3 * smooth(.45, .7, t)))
        if s < -.25 and t < .56:                       # the pleats read as fine dark lines
            col = mix3(col, back, .35 * smooth(.92, 1, math.cos(math.atan2(s, c) * 24)) * smooth(-.3, -.5, s))
        if s > .15 and t < .16:                        # knobs and the head: darker, a little blotchy
            col = mix3(col, (.16, .16, .17), .5 * noise2(co.x * 4, co.y * 4))
        return col
    # A long, slow fluke stroke; the 4 m flippers row gently, out of step with it.
    spine = backbone(body_wave(L, .07, lag=1.4))
    pec_root = Vector((1.25, 3.7, -.65))
    def anim(co, part, phi):
        if part in (2, 3):
            fin = sided(part, (3,), co, lambda p: rot('Y', -.14 * math.sin(phi + .5), pec_root) @ rot('Z', .1 * math.sin(phi - .6), pec_root) @ p)
            return spine(pec_root.y, phi) @ fin
        return spine(co.y, phi) @ co
    ANIMS['humpback'] = anim
    finish(ob, colour, decimate=.5)
    return add_eyes(ob, *surface(L, section, .2, -.12), .17)

def turtle():
    L = 1.0
    shell_rows = table([(0.0, .08, .03, .0, .4), (0.1, .30, .15, .02, .4), (0.32, .43, .24, .04, .35), (0.6, .41, .23, .04, .35), (0.85, .27, .14, .03, .35), (1.0, .05, .02, .0, .4)])   # a higher dome
    shell_section = lambda t: shell_rows(t)
    def plates(t, s, c):
        """The carapace's plates: 5 down the spine, 4 a side beside them, a ring of 11 a side at the
        rim. Returns (plate id, closeness to a seam 0..1)."""
        th = math.atan2(max(s, 0.0), abs(c))           # 0 at the rim .. pi/2 on the spine
        if th > 1.15:   ring, n, t0, t1 = 0, 5, .07, .95
        elif th > .42:  ring, n, t0, t1 = 1, 4, .1, .92
        else:           ring, n, t0, t1 = 2, 11, .02, .98
        u = (t - t0) / (t1 - t0) * n
        k = math.floor(u)
        along = min(u - k, k + 1 - u) * (t1 - t0) / n * 8          # metres-ish to the nearest seam along
        bands = (1.15, .42)
        across = min(abs(th - b) for b in bands) * 1.4
        seam = max(smooth(.09, 0, along), smooth(.07, 0, across))
        return (ring, k, c > 0 if ring else 0), seam
    def scutes(t, a, r):                               # seams between the plates, pressed in
        s, c = math.sin(a), math.cos(a)
        if s < 0:
            return 1.0
        return 1 - .03 * plates(t, s, c)[1] * smooth(.0, .25, s)
    shell = loft('turtle', L, shell_section, rings=40, M=32, shape=scutes)
    subdivide(shell, 1)
    # Head on a neck that runs back under the front of the carapace.
    head_rows = table([(0, .03, .025, -.01, 1), (.1, .075, .065, 0, 1), (.3, .1, .085, .005, 1), (.52, .085, .07, -.005, 1), (.75, .065, .055, -.01, 1), (1, .075, .055, -.01, 1)])   # a big round head
    head_section = lambda t: head_rows(t)
    head = loft('t-head', .46, head_section, rings=18, M=16, y0=.56, z0=.03)
    subdivide(head, 1)
    tail_rows = table([(0, .05, .03, 0, 1), (1, .008, .008, 0, 1)])
    tail = loft('t-tail', .16, lambda t: tail_rows(t), rings=6, M=8, y0=-.52, z0=-.02)
    front = [(0, .09, -.06, .045, 0), (.12, .1, -.08, .04, -.01), (.26, .07, -.1, .03, -.02), (.38, .02, -.1, .02, -.03), (.47, -.04, -.09, .008, -.04)]
    fm = place((0, 12, -24), (.2, .3, .0))             # roots tucked under the carapace's front edge
    rear = [(0, .07, -.06, .03, 0), (.1, .06, -.08, .025, 0), (.18, .03, -.08, .016, 0), (.23, -.01, -.06, .006, 0)]
    rm = place((0, 8, -52), (.13, -.34, -.005))
    ob = join('turtle', [shell, head, tail, wing('t-fl-r', front, matrix=fm), wing('t-fl-l', front, matrix=mirror_x(fm)), wing('t-rl-r', rear, matrix=rm), wing('t-rl-l', rear, matrix=mirror_x(rm))])
    where, face = body_coords(L, shell_section), body_coords(.46, head_section, .56, .03)
    skin, pale = (.46, .46, .28), (.8, .76, .52)
    def colour(co, n):
        t, s, c, inside = where(co)
        if co.y > .5 or co.y < -.5 or not inside:      # head, tail and flippers: olive scales with pale edges
            cell = noise2(co.x * 38, co.y * 38 + co.z * 20)
            col = mix3(skin, pale, .55 * smooth(.62, .8, cell) + .25 * smooth(-.2, -.8, n.z))
            if co.y > .52:
                ht, hs, hc, hin = face(co)
                if hin and .02 < ht < .2 and abs(hs - (-.28 + 2.4 * max(0.0, ht - .1))) < .07:   # the smile
                    col = mix3(col, (.16, .14, .08), .75)
                cheek = math.hypot((ht - .26) / .05, (hs + .12) / .25)
                if hin and cheek < 1 and abs(hc) > .4:   # a faint blush
                    col = mix3(col, BLUSH, .35 * smooth(1, .2, cheek))
            return col
        if s < 0:                                      # plastron
            return (.78, .7, .48)
        plate, seam = plates(t, s, c)
        base = mix3((.28, .2, .09), (.46, .35, .16), hash01(plate[0] * 17 + plate[1], plate[2] * 3 + 1))
        rays = .5 + .5 * math.sin(math.atan2(co.z - .1, co.x) * 11 + t * 37)   # sunburst streaks in each plate
        col = mix3(base, (.6, .47, .2), .4 * rays * (1 - seam))
        return mix3(col, (.12, .09, .05), seam)
    # Underwater flight: the front flippers beat like wings — up and forward, then down and back with
    # the leading edge turned down — the rear flippers steer, the head nods, the shell heaves.
    front_root, rear_root, neck = Vector((.2, .3, 0)), Vector((.13, -.34, -.005)), Vector((0, .42, .02))
    span = (fm.to_3x3() @ Vector((1, 0, 0))).normalized()
    def stroke(p, phi):
        p = rot(span, .45 * math.cos(phi), front_root) @ p          # feathering about the flipper's own axis
        p = rot('Z', .28 * math.sin(phi + .6), front_root) @ p      # forward at the top, back at the bottom
        return rot('Y', -.6 * math.sin(phi), front_root) @ p        # up and down
    def steer(p, phi):
        return rot('Y', -.15 * math.sin(phi + 2), rear_root) @ rot('Z', .18 * math.sin(phi + math.pi), rear_root) @ p
    def anim(co, part, phi):
        heave = Matrix.Translation((0, 0, -.012 * math.cos(phi)))
        if part in (3, 4):
            return heave @ sided(part, (4,), co, lambda p: stroke(p, phi))
        if part in (5, 6):
            return heave @ sided(part, (6,), co, lambda p: steer(p, phi))
        if part in (1, EYE):
            return heave @ rot('X', .06 * math.sin(phi + 1.5), neck) @ co
        return heave @ co
    ANIMS['turtle'] = anim
    finish(ob, colour, decimate=.6)
    return add_eyes(ob, *surface(.46, head_section, .2, .32, .56, .03), .027)

def manta():
    half = [(0, .95, -.8, .32, 0), (.4, .9, -.72, .27, 0), (.9, .64, -.52, .19, 0), (1.4, .32, -.34, .11, -.01), (1.8, .02, -.24, .055, -.03), (2.1, -.22, -.36, .026, -.05), (2.22, -.36, -.48, .012, -.07), (2.26, -.44, -.52, .006, -.08)]   # round wingtips
    body_r = wing('m-r', half, n=12, matrix=place((0, 0, 0), (0, 0, 0)))
    body_l = wing('m-l', half, n=12, matrix=mirror_x(Matrix.Identity(4)))
    lobe = [(0, .06, -.07, .035, 0), (.18, .05, -.06, .03, -.01), (.34, .03, -.04, .02, -.03), (.42, .01, -.02, .008, -.05)]
    lm = place((0, -20, 90), (.3, .9, -.02))           # cephalic lobes point forward and curl in
    tail_rows = table([(0, .035, .03, 0, 1), (1, .006, .006, 0, 1)])
    tail = loft('m-tail', 1.6, lambda t: tail_rows(t), rings=10, M=8, y0=-1.55, z0=0)
    core_rows = table([(0, .2, .05, -.01, 1), (.12, .36, .11, 0, .8), (.45, .42, .15, .01, .7), (.8, .26, .1, .01, .8), (1, .05, .03, 0, 1)])
    core_section = lambda t: core_rows(t)
    core = loft('m-core', 1.85, core_section, rings=20, M=16, y0=.06)   # the head and body over the wings' seam
    subdivide(core, 1)
    ob = join('manta', [core, body_r, body_l, wing('m-lobe-r', lobe, matrix=lm), wing('m-lobe-l', lobe, matrix=mirror_x(lm)), tail])
    black, white, grey = (.06, .07, .09), (.93, .93, .91), (.36, .38, .42)
    def colour(co, n):
        if abs(co.x) < .3 and abs(co.y - (.9 + .45 * co.x * co.x)) < .03 and n.z < .3:   # the wide smile at the front
            return (.1, .1, .12)
        if n.z > 0:                                    # back: black, with pale shoulder chevrons
            ax = abs(co.x)
            chevron = smooth(.24, .04, abs(co.y - (.6 - ax * .5))) * smooth(.3, .5, ax) * smooth(1.4, 1.05, ax)
            return mix3(black, (.62, .62, .6), .85 * chevron)
        col = white                                    # belly: white with dark spots and gill slits
        if noise2(co.x * 5, co.y * 5) > .78:
            col = mix3(col, grey, .8)
        ax = abs(co.x)
        if .18 < ax < .46 and .1 < co.y < .55 and abs(math.sin((co.y - .1) / .45 * math.pi * 5)) < .2 and abs(ax - .3) < .12:
            col = mix3(col, black, .7)
        if ax > 1.6:
            col = mix3(col, black, smooth(1.6, 2.2, ax) * .7)   # dark wing edges
        return col
    # The wings flex in a wave that runs from the leading edge back and out to the tips; the body
    # bobs against them and the whip tail trails side to side.
    def anim(co, part, phi):
        ax = abs(co.x)
        u = smooth(.3, 2.3, ax)
        d = .8 * u ** 1.4 * math.sin(phi - .8 * (.95 - co.y) * smooth(.3, 1.4, ax) - .5 * u)
        r = max(ax - .2, .15)
        x = co.x - math.copysign(min(d * d / (2 * r), .4 * r), co.x)   # the wing bends rather than stretches
        p = Vector((x, co.y, co.z + d - .035 * math.sin(phi)))
        if part == 5:
            k = smooth(-.75, -3.1, co.y)
            p.x += .12 * k * math.sin(phi - 2.2 * k)
        return p
    ANIMS['manta'] = anim
    finish(ob, colour)
    # Eyes on the sides of the head, just behind the lobes, where the wings' leading edges are thin.
    return add_eyes(ob, Vector((.34, .84, .035)), Vector((.6, .62, .5)).normalized(), .06, glance=.1)

def flyingfish():
    L = .34
    rows = table([(0, .01, .01, 0, 1), (.08, .027, .031, .002, 1), (.3, .031, .035, 0, 1), (.65, .024, .028, 0, 1), (.88, .012, .016, 0, 1), (1, .004, .005, 0, 1)])   # a rounder head
    section = lambda t: rows(t)
    body = loft('flyingfish', L, section, rings=16, M=10)
    subdivide(body, 1)
    wingst = [(0, .035, -.04, .006, 0), (.08, .045, -.07, .005, .004), (.18, .02, -.09, .004, .008), (.26, -.04, -.1, .003, .01), (.29, -.08, -.1, .0015, .01)]
    wm = place((0, -6, -12), (.022, .06, .008))
    pelvic = [(0, .02, -.02, .004, 0), (.06, .015, -.035, .003, 0), (.1, -.01, -.04, .002, 0)]
    pm = place((0, 10, -20), (.015, -.05, -.015))
    caudal_up = [(0, .02, -.02, .005, 0), (.04, .0, -.03, .004, 0), (.07, -.03, -.04, .002, 0)]
    caudal_dn = [(0, .02, -.02, .005, 0), (.05, .0, -.035, .004, 0), (.1, -.04, -.05, .002, 0)]
    cu = place((0, -90, 0), (0, -.17, .005))
    cd = place((0, 90, 0), (0, -.17, -.005))
    ob = join('flyingfish', [body, wing('f-w-r', wingst, matrix=wm), wing('f-w-l', wingst, matrix=mirror_x(wm)), wing('f-p-r', pelvic, matrix=pm, levels=0), wing('f-p-l', pelvic, matrix=mirror_x(pm), levels=0), wing('f-cu', caudal_up, matrix=cu, levels=0), wing('f-cd', caudal_dn, matrix=cd, levels=0)])
    where = body_coords(L, section)
    skin = counter((.06, .16, .36), (.35, .48, .6), (.85, .88, .9), -.5, .0, .5)
    def colour(co, n):
        t, s, c, inside = where(co)
        if inside and abs(co.x) < .04:
            return skin(s)
        ray = smooth(.85, 1, abs(math.sin(math.atan2(co.y - .06, abs(co.x)) * 14)))   # fin rays
        return mix3((.5, .62, .72), (.12, .2, .32), .55 * ray)
    # Side-to-side tail beats (the lower lobe sculls the water before take-off); the wings quiver.
    spine = backbone(body_wave(L, .13, head=.015, lag=3.5, end=1.25), lateral=True)
    wing_root, pelvic_root = Vector((.022, .06, .008)), Vector((.015, -.05, -.015))
    def anim(co, part, phi):
        if part in (1, 2):
            return spine(wing_root.y, phi) @ sided(part, (2,), co, lambda p: rot('Y', .05 * math.sin(2 * phi), wing_root) @ p)
        if part in (3, 4):
            return spine(pelvic_root.y, phi) @ co
        return spine(co.y, phi) @ co
    ANIMS['flyingfish'] = anim
    finish(ob, colour, decimate=.5)
    return add_eyes(ob, *surface(L, section, .1, .2), .012)

def gull():
    L = .46
    rows = table([(0, .012, .012, .015, 1), (.06, .035, .037, .022, 1), (.13, .046, .048, .022, 1), (.2, .043, .046, .018, 1), (.32, .066, .072, .0, 1), (.55, .074, .078, -.005, 1), (.8, .046, .046, .0, 1), (1, .012, .008, .005, 1)])   # a round head, a plump body
    section = lambda t: rows(t)
    body = loft('gull', L, section, rings=18, M=12)
    subdivide(body, 1)
    beak_rows = table([(0, .002, .003, -.002, 1), (.3, .007, .01, -.002, 1), (1, .012, .014, 0, 1)])
    beak = loft('g-beak', .055, lambda t: beak_rows(t), rings=6, M=8, y0=.25, z0=.035)   # short
    wst = [(0, .07, -.08, .02, 0), (.15, .07, -.09, .016, .012), (.3, .05, -.08, .012, .02), (.42, .0, -.07, .008, .018), (.55, -.06, -.1, .005, .01), (.64, -.12, -.14, .002, 0)]
    wm = place((0, -8, 0), (.04, .03, .025))
    tail = [(0, .04, -.06, .008, 0), (.06, .02, -.08, .006, 0), (.1, -.02, -.08, .004, 0)]
    tm = place((0, 0, 0), (0, -.2, .0))
    ob = join('gull', [body, beak, wing('g-w-r', wst, matrix=wm), wing('g-w-l', wst, matrix=mirror_x(wm)), wing('g-t-r', tail, matrix=tm, levels=0), wing('g-t-l', tail, matrix=mirror_x(tm), levels=0)])
    where = body_coords(L, section)
    white, grey, black = (.93, .93, .91), (.55, .59, .63), (.05, .05, .06)
    def colour(co, n):
        if co.y > .236:                                # the yellow beak with a red spot
            return (.86, .2, .1) if co.y < .265 and co.z < .03 else (.95, .78, .2)
        t, s, c, inside = where(co)
        ax = abs(co.x)
        if ax > .06:                                   # wings: grey above, black tips with white spots
            if ax > .5:
                return white if (.56 < ax < .6 and co.y < -.06) else black
            return grey if n.z > -.1 else (.82, .83, .84)
        return mix3(white, grey, .7 * smooth(.3, .6, s) * smooth(.25, .4, t) * smooth(.75, .6, t))
    # Wing beats from the shoulder; on the upstroke the hand folds down and back at the wrist, on the
    # downstroke it spreads. The body rises a little as the wings push down; the tail trims.
    shoulder, inv = Vector((.04, .03, .025)), wm.inverted()
    wrist = wm @ Vector((.3, 0, 0))
    def beat(p, phi):
        up = .5 + .5 * math.cos(phi)                               # 1 at the middle of the upstroke
        hand = rot('Y', .5 * up, wrist) @ rot('Z', -.35 * up, wrist) @ p
        w = smooth(.22, .36, (inv @ p).x)
        p = p.lerp(hand, w)
        return rot('Y', -.62 * math.sin(phi), shoulder) @ p
    def anim(co, part, phi):
        bob = Matrix.Translation((0, 0, -.006 * math.sin(phi)))
        if part in (2, 3):
            return bob @ sided(part, (3,), co, lambda p: beat(p, phi))
        if part in (4, 5):
            return bob @ rot('X', .06 * math.sin(phi + 1), (0, -.2, 0)) @ co
        return bob @ co
    ANIMS['gull'] = anim
    finish(ob, colour, decimate=.5)
    return add_eyes(ob, *surface(L, section, .085, .3), .0115)

SPECIES = {'dolphin': dolphin, 'orca': orca, 'humpback': humpback, 'turtle': turtle, 'manta': manta, 'flyingfish': flyingfish, 'gull': gull}

# ── export and preview ───────────────────────────────────────────────────────────────────────

def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def export(objects):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:
        ob.select_set(True)
    path = os.path.join(OUT, 'marine-life.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_normals=True, export_texcoords=True, export_materials='NONE',
                              export_vertex_color='ACTIVE', export_active_vertex_color_when_no_material=True,
                              export_yup=True, export_attributes=True)
    return path

HARMONICS = ('_A1', '_B1', '_A2', '_B2', '_N1', '_M1')

def pack_harmonics(path):
    """Rewrites the exported GLB's harmonic attributes: Blender axes -> glTF axes (the exporter leaves
    custom attributes as they are) and float -> normalized signed bytes. Position harmonics share one
    scale per mesh, stored as mesh.extras.swim (metres per unit); normal harmonics need none."""
    raw = open(path, 'rb').read()
    jlen = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20 + jlen])
    old = raw[20 + jlen + 8:]
    views, accessors = doc['bufferViews'], doc['accessors']
    extra = []                                          # (accessor index, int8 bytes)
    for mesh in doc['meshes']:
        attrs = mesh['primitives'][0]['attributes']
        def read(name):
            a = accessors[attrs[name]]
            bv = views[a['bufferView']]
            v = np.frombuffer(old, np.float32, a['count'] * 3, bv.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(-1, 3)
            return np.stack([v[:, 0], v[:, 2], -v[:, 1]], 1)   # (x, y, z) Blender -> (x, z, -y) glTF
        data = {name: read(name) for name in HARMONICS}
        scale = max(float(np.abs(data[n]).max()) for n in HARMONICS[:4]) or 1.0
        mesh.setdefault('extras', {})['swim'] = scale
        for name in HARMONICS:
            v = data[name] / (scale if name in HARMONICS[:4] else 1.0)
            q = np.zeros((len(v), 4), np.int8)
            q[:, :3] = np.clip(np.round(v * 127), -127, 127)
            extra.append((attrs[name], q.tobytes()))
    # Rebuild the binary chunk: the views still in use, then one strided view per packed attribute.
    packed = {i for i, _ in extra}
    used = sorted({a['bufferView'] for i, a in enumerate(accessors) if i not in packed})
    blob, new_views, remap = bytearray(), [], {}
    def put(data, view):
        while len(blob) % 4:
            blob.append(0)
        view = dict(view, byteOffset=len(blob), byteLength=len(data), buffer=0)
        blob.extend(data)
        new_views.append(view)
        return len(new_views) - 1
    for i in used:
        bv = views[i]
        o = bv.get('byteOffset', 0)
        remap[i] = put(old[o:o + bv['byteLength']], {k: v for k, v in bv.items() if k not in ('byteOffset', 'byteLength')})
    for i, a in enumerate(accessors):
        if i not in packed:
            a['bufferView'] = remap[a['bufferView']]
    for i, data in extra:
        accessors[i] = {'bufferView': put(data, {'byteStride': 4, 'target': 34962}), 'componentType': 5120,
                        'normalized': True, 'count': accessors[i]['count'], 'type': 'VEC3'}
    while len(blob) % 4:
        blob.append(0)
    doc['bufferViews'] = new_views
    doc['buffers'] = [{'byteLength': len(blob)}]
    js = json.dumps(doc, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(blob), 0x004E4942) + bytes(blob)
    open(path, 'wb').write(out)

def render(ob, name):
    scene = bpy.context.scene
    for other in scene.objects:
        other.hide_render = other is not ob and other.type == 'MESH'
    size = max(ob.dimensions)
    centre = sum((ob.matrix_world @ Vector(c) for c in ob.bound_box), Vector()) / 8
    cam_data = bpy.data.cameras.get('cam') or bpy.data.cameras.new('cam')
    cam = bpy.data.objects.get('cam') or bpy.data.objects.new('cam', cam_data)
    if cam.name not in scene.collection.objects:
        scene.collection.objects.link(cam)
    cam_data.lens = 50
    d = size * 1.9
    scene.camera = cam
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'VERTEX'
    scene.display.shading.show_cavity = True
    scene.display.shading.show_shadows = False
    scene.render.resolution_x, scene.render.resolution_y = 900, 600
    scene.render.film_transparent = False
    scene.world = scene.world or bpy.data.worlds.new('w')
    views = {'': Vector((d * .78, d * .52, d * .42)), '-side': Vector((d * .95, -d * .15, -d * .28)), '-top': Vector((0, -.01, d * 1.1)), '-face': Vector((d * .3, d * .55, d * .12))}
    def shoot(view, path):
        aim = centre + (Vector((0, ob.dimensions.y * .32, 0)) if view == '-face' else Vector())
        cam.location = aim + views[view] * (.45 if view == '-face' else 1)
        cam.rotation_euler = (aim - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
    if CYCLE:                                          # one swim / wing-beat cycle, frame by frame
        folder = os.path.join(CYCLE, name)
        os.makedirs(folder, exist_ok=True)
        for k in range(CYCLE_FRAMES):
            pose(ob, k / CYCLE_FRAMES * math.tau)
            shoot('', os.path.join(folder, f'{k:03d}.png'))
        pose(ob, 0)
        return
    for view in views:
        shoot(view, os.path.join(RENDERS, f'render-{name}{view}.png'))

def main():
    clear()
    os.makedirs(OUT, exist_ok=True)
    objects = []
    for name, build in SPECIES.items():
        ob = build()
        error = bake(ob, ANIMS[name])
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        print(f'MODEL {name}: {len(ob.data.vertices)} verts, {tris} tris, {tuple(round(v, 2) for v in ob.dimensions)} m, cycle fit error {error * 1000:.1f} mm')
        objects.append(ob)
    path = export(objects)
    pack_harmonics(path)
    print('EXPORTED', path, os.path.getsize(path))
    if RENDER or CYCLE:
        for ob in objects:
            render(ob, ob.name)

main()
