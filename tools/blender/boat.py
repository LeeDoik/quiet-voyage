"""The player's sailing boat for quiet-voyage, built in Blender from code.

Run:  blender -b -P tools/blender/boat.py -- [--render]
Out:  public/assets/blender/boat/boat.glb
      tools/blender/renders/boat-*.png with --render (previews stay out of the deployed public/)

A 5 m open daysailer (sloop): lofted round-bilge hull with sheer and flare, a recessed cockpit with
benches, a tapered mast with spreaders, standing rigging, a boom on a gooseneck, a rudder and tiller,
and two sails. Textures (hull paint with boot stripe and antifouling, teak planks, varnished wood,
sail canvas with panel seams) are painted here with numpy and packed into the GLB.

Contract with the game (public/src/sailing.js, wind-rig.js, vessel-lod.js, lantern.js, the ocean
shader's hull outline and boat-float.js), all in Blender coordinates (Z up; the glTF exporter makes
Z the game's +Y and Blender +Y the model's -Z, which sailing.js turns into the boat's port side):
  - bow +X; hull from x = -2.35 (transom) to 2.65 (stem), half beam 0.94, deck edge ~0.74 m up.
  - one mesh per material, so a boat is ~8 draw calls. Names matter:
      "hull", "deck", "mast and trim"   -> kept in the far (merged) LOD (name has hull/deck/mast)
      "mainsail", "jib"                 -> bent by wind-rig.js; flat in the XZ plane, gridded, with UVs
      "boom"                            -> origin at the gooseneck (0.1, 0, 1.33); turns about Z
      "rudder"                          -> blade and tiller, origin on the rudder stock; turns about Z
      "rigging"                         -> stays, shrouds and deck hardware (dropped far away)
  - the lantern post (lantern.js) stands on the port quarter at x = -2.12, y = +0.28.
"""
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'blender', 'boat')
RENDERS = os.path.join(ROOT, 'tools', 'blender', 'renders')
RENDER = '--render' in sys.argv
TMP = os.path.join(ROOT, 'tools', 'blender', '.boat-textures')   # painted textures before packing

# ── shape ────────────────────────────────────────────────────────────────────────────────────

STERN, STEM, WIDEST, HALF_BEAM, TRANSOM_HALF = -2.35, 2.65, -0.15, 0.94, 0.66
KEEL_Z = -0.25

def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

def sheer(x):
    """Height of the deck edge: a gentle sweep, highest at the bow."""
    t = (x - STERN) / (STEM - STERN)
    return 0.715 + 0.09 * t * t - 0.02 * math.sin(t * math.pi)

def half_beam(x):
    if x >= WIDEST:
        t = (x - WIDEST) / (STEM - WIDEST)
        return HALF_BEAM * max(0.0, 1 - t ** 2.1) ** 0.62
    t = (WIDEST - x) / (WIDEST - STERN)
    return HALF_BEAM + (TRANSOM_HALF - HALF_BEAM) * t ** 1.8

def keel(x):
    """Bottom of the canoe body; the forefoot sweeps up into a raked stem."""
    if x > 1.35:
        t = (x - 1.35) / (STEM - 1.35)
        return KEEL_Z + (sheer(STEM) - 0.02 - KEEL_Z) * t ** 1.9
    if x < -1.7:   # the run lifts toward the transom
        t = (-1.7 - x) / (-1.7 - STERN)
        return KEEL_Z + 0.2 * t ** 1.5
    return KEEL_Z

def section(x, s, n=2.4):
    """(y, z) on the +Y half section at x, s from 0 (keel) to 1 (sheer): a superellipse quarter."""
    hb, kz, sz = half_beam(x), keel(x), sheer(x)
    th = s * math.pi / 2
    c, si = math.cos(th), math.sin(th)
    y = hb * (abs(si) ** (2 / n))
    z = sz - (sz - kz) * (abs(c) ** (2 / n))
    flare = 0.04 * s * s * min(1.0, hb / 0.5)   # topsides lean out a little
    return y + flare * s, z

# ── mesh helpers ─────────────────────────────────────────────────────────────────────────────

def new_object(name, verts, faces, uvs=None, smooth_shade=True, origin=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    if uvs is not None:
        layer = me.uv_layers.new(name='UVMap')
        for poly in me.polygons:
            for li in poly.loop_indices:
                layer.data[li].uv = uvs[me.loops[li].vertex_index]
    for p in me.polygons:
        p.use_smooth = smooth_shade
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if origin != (0, 0, 0):
        me.transform(Matrix.Translation(-Vector(origin)))
        ob.location = origin
    return ob

def orient(ob, inside):
    """Turn every face outward: away from inside(centre), a point known to be inside the part. The
    game draws all but the sails one-sided, so a face pointing in would be a hole."""
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bm.normal_update()
    for f in bm.faces:
        c = f.calc_center_median()
        if f.normal.dot(c - inside(c)) < 0:
            f.normal_flip()
    bm.to_mesh(ob.data); bm.free()
    return ob

def box_uv(bm, scale=1.0):
    """Planar projection by the dominant normal axis: good enough for planks and trim."""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for loop in f.loops:
            co = loop.vert.co
            u, v = [(co.y, co.z), (co.x, co.z), (co.x, co.y)][ax]
            loop[uv].uv = (u * scale, v * scale)

def bm_object(name, bm, smooth_shade=False, uv_scale=None, origin=(0, 0, 0)):
    if uv_scale is not None:
        box_uv(bm, uv_scale)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    if me.uv_layers:
        me.uv_layers[0].name = 'UVMap'   # same name as new_object's, or joining parts drops these UVs
    for p in me.polygons:
        p.use_smooth = smooth_shade
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if origin != (0, 0, 0):
        me.transform(Matrix.Translation(-Vector(origin)))
        ob.location = origin
    return ob

def add_box(bm, center, size, rot_z=0.0):
    m = Matrix.Translation(Vector(center)) @ Matrix.Rotation(rot_z, 4, 'Z') @ Matrix.Diagonal((*size, 1))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)

def add_tube(bm, a, b, r0, r1=None, sides=8, caps=True):
    """A tapered cylinder from point a to point b."""
    r1 = r0 if r1 is None else r1
    a, b = Vector(a), Vector(b)
    d = b - a
    length = d.length
    rot = d.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
    m = Matrix.Translation(a) @ rot
    ring = []
    for k, (z, r) in enumerate(((0.0, r0), (length, r1))):
        ring.append([bm.verts.new(m @ Vector((r * math.cos(i / sides * 2 * math.pi), r * math.sin(i / sides * 2 * math.pi), z))) for i in range(sides)])
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((ring[0][i], ring[0][j], ring[1][j], ring[1][i]))
    if caps:
        bm.faces.new(list(reversed(ring[0])))
        bm.faces.new(ring[1])

# ── hull ─────────────────────────────────────────────────────────────────────────────────────

def build_hull():
    NX, NS = 34, 12
    xs = [STERN + (STEM - STERN) * (1 - math.cos(i / (NX - 1) * math.pi)) / 2 for i in range(NX)]   # denser at the ends
    verts, uvs, faces = [], [], []
    idx = {}
    for i, x in enumerate(xs):
        for side in (1, -1):
            for j in range(NS + 1):
                s = j / NS
                y, z = section(x, s)
                if j == 0:
                    y = 0.0
                key = (i, side, j)
                if j == 0 and side == -1:
                    idx[key] = idx[(i, 1, 0)]
                    continue
                idx[key] = len(verts)
                verts.append((x, side * y, z))
                uvs.append(((x - STERN) / (STEM - STERN), (z + 0.5) / 1.5))
    for i in range(NX - 1):
        for side in (1, -1):
            for j in range(NS):
                a, b = idx[(i, side, j)], idx[(i + 1, side, j)]
                c, d = idx[(i + 1, side, j + 1)], idx[(i, side, j + 1)]
                faces.append((a, b, c, d) if side == 1 else (a, d, c, b))
    hull = orient(new_object('hull', verts, faces, uvs), lambda c: Vector((c.x, 0.0, 0.5)))
    # The transom: its own flat panel (separate vertices, so its edge stays crisp), built as rungs
    # between port and starboard at equal heights so the paint bands stay level.
    tv, tf, tu = [], [], []
    for j in range(NS + 1):
        y, z = section(STERN, j / NS)
        y = 0.0 if j == 0 else y
        for side in (1, -1):
            tv.append((STERN, side * y, z)); tu.append((0.5 + side * y, (z + .5) / 1.5))
    for j in range(NS):
        a, b, c, d = j * 2, j * 2 + 1, j * 2 + 3, j * 2 + 2
        tf.append((a, d, c, b))
    transom = orient(new_object('hull-transom', tv, tf, tu, smooth_shade=False), lambda c: Vector((c.x + 1.0, 0.0, 0.4)))
    # A slim keel fin and skeg under the canoe body (seen when she heels).
    bm = bmesh.new()
    fin = [(-0.45, KEEL_Z + .02), (0.55, KEEL_Z + .02), (0.35, -0.55), (-0.25, -0.55)]
    vs = [bm.verts.new((x, y, z)) for (x, z) in fin for y in (0.03, -0.03)]
    for a, b in ((0, 1), (1, 2), (2, 3), (3, 0)):
        bm.faces.new((vs[a * 2], vs[b * 2], vs[b * 2 + 1], vs[a * 2 + 1]))
    bm.faces.new([vs[i * 2] for i in range(4)][::-1]); bm.faces.new([vs[i * 2 + 1] for i in range(4)])
    finob = orient(bm_object('hull-fin', bm, uv_scale=0.6), lambda c: Vector((0.05, 0.0, c.z)))
    return join('hull', [hull, transom, finob])

def join(name, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name; ob.data.name = name
    return ob

# ── deck and cockpit ─────────────────────────────────────────────────────────────────────────

COCKPIT = (-1.62, 0.18, 0.5)   # aft x, fore x, half width
FLOOR_Z, SEAT_Z = 0.36, 0.56

def deck_z(x, y):
    hb = max(1e-3, half_beam(x))
    return sheer(x) + 0.035 * (1 - min(1.0, (y / hb) ** 2)) - 0.005

def build_deck():
    NX, NY = 40, 10
    verts, faces, uvs, idx = [], [], [], {}
    xs = [STERN + 0.005 + (STEM - 0.01 - STERN) * i / (NX - 1) for i in range(NX)]
    for i, x in enumerate(xs):
        hb = half_beam(x) * 0.985
        for j in range(-NY, NY + 1):
            y = hb * j / NY
            idx[(i, j)] = len(verts)
            verts.append((x, y, deck_z(x, y)))
            uvs.append((x / 1.6, y / 1.6))
    ax, fx, hw = COCKPIT
    for i in range(NX - 1):
        for j in range(-NY, NY):
            cx = (xs[i] + xs[i + 1]) / 2
            cy = (half_beam(cx) * (j + 0.5) / NY)
            if ax < cx < fx and abs(cy) < hw:
                continue   # the cockpit well
            faces.append((idx[(i, j)], idx[(i + 1, j)], idx[(i + 1, j + 1)], idx[(i, j + 1)]))
    deck = orient(new_object('deck-top', verts, faces, uvs), lambda c: c - Vector((0, 0, 1)))
    # The well: floor, benches each side and the stern seat, all teak.
    bm = bmesh.new()
    length, mid = fx - ax, (fx + ax) / 2
    add_box(bm, (mid, 0, FLOOR_Z), (length, hw * 2, 0.04))
    for side in (1, -1):
        add_box(bm, (mid, side * (hw - 0.17), SEAT_Z), (length - 0.02, 0.32, 0.05))          # bench top
        add_box(bm, (mid, side * (hw - 0.33), (SEAT_Z + FLOOR_Z) / 2), (length - 0.02, 0.025, SEAT_Z - FLOOR_Z))   # bench front
    add_box(bm, (ax + 0.2, 0, SEAT_Z), (0.36, hw * 2 - 0.02, 0.05))                          # stern seat
    # Inner walls of the well, from floor to deck.
    top = deck_z(mid, hw)
    for side in (1, -1):
        add_box(bm, (mid, side * hw, (top + FLOOR_Z) / 2), (length, 0.02, top - FLOOR_Z))
    for x in (ax, fx):
        add_box(bm, (x, 0, (top + FLOOR_Z) / 2), (0.02, hw * 2, top - FLOOR_Z))
    well = bm_object('deck-well', bm, uv_scale=1 / 1.6)
    return join('deck', [deck, well])

# ── spars, trim and rigging ──────────────────────────────────────────────────────────────────

MAST_X, MAST_TOP, GOOSENECK_Z, HOUNDS_Z, SPREADER_Z = 0.1, 5.7, 1.33, 4.72, 3.55
TACK = (2.5, 0.0, 0.86)

def build_trim():
    bm = bmesh.new()
    deck_at_mast = deck_z(MAST_X, 0)
    add_tube(bm, (MAST_X, 0, deck_at_mast - 0.02), (MAST_X, 0, MAST_TOP), 0.062, 0.038, sides=12)      # mast, tapered
    for side in (1, -1):
        add_tube(bm, (MAST_X, side * 0.05, SPREADER_Z), (MAST_X - 0.03, side * 0.46, SPREADER_Z + 0.06), 0.016, 0.012, sides=6)
    add_box(bm, (MAST_X, 0, deck_at_mast + 0.02), (0.22, 0.2, 0.05))                                  # mast step
    # Rub rails along the sheer, and coamings round the cockpit.
    for side in (1, -1):
        prev = None
        for i in range(29):
            x = STERN + 0.02 + (STEM - 0.06 - STERN) * i / 28
            p = (x, side * (half_beam(x) + 0.012), sheer(x) - 0.03)
            if prev:
                add_tube(bm, prev, p, 0.028, sides=6, caps=False)
            prev = p
    ax, fx, hw = COCKPIT
    for side in (1, -1):
        add_box(bm, ((ax + fx) / 2, side * (hw + 0.02), deck_z((ax + fx) / 2, hw) + 0.06), (fx - ax + 0.06, 0.035, 0.14))
    add_box(bm, (fx + 0.02, 0, deck_z(fx, 0) + 0.07), (0.035, hw * 2 + 0.06, 0.15))
    # A small foredeck hatch and the traveller bar across the stern seat.
    add_box(bm, (1.25, 0, deck_z(1.25, 0) + 0.04), (0.5, 0.46, 0.08))
    add_box(bm, (ax + 0.2, 0, SEAT_Z + 0.06), (0.06, hw * 1.6, 0.06))
    return bm_object('mast and trim', bm, smooth_shade=True, uv_scale=2.5)

def build_rigging():
    bm = bmesh.new()
    r = 0.0055
    add_tube(bm, TACK, (MAST_X + 0.02, 0, HOUNDS_Z), r, sides=5)                                       # forestay
    add_tube(bm, (STERN + 0.05, 0, sheer(STERN) + 0.02), (MAST_X, 0, MAST_TOP - 0.03), r, sides=5)       # backstay
    for side in (1, -1):
        plate = (MAST_X - 0.12, side * (half_beam(MAST_X - 0.12) - 0.02), sheer(MAST_X) + 0.01)
        tip = (MAST_X - 0.03, side * 0.46, SPREADER_Z + 0.06)
        add_tube(bm, plate, tip, r, sides=5)                                                            # cap shroud, lower part
        add_tube(bm, tip, (MAST_X, side * 0.03, HOUNDS_Z), r, sides=5)                                  # over the spreader
        add_tube(bm, (MAST_X - 0.35, side * (half_beam(MAST_X - .35) - .03), sheer(MAST_X)), (MAST_X, side * .04, SPREADER_Z - .05), r, sides=5)   # lower shroud
        add_box(bm, plate, (0.04, 0.012, 0.09))                                                         # chainplate
        for cx in (-1.1, -0.2):                                                                         # cleats on the coaming
            add_box(bm, (cx, side * (COCKPIT[2] + 0.02), deck_z(cx, COCKPIT[2]) + 0.15), (0.12, 0.025, 0.025))
    add_box(bm, (STEM - 0.12, 0, deck_z(STEM - .12, 0) + 0.02), (0.18, 0.05, 0.04))                    # stemhead fitting
    add_box(bm, (MAST_X - 0.07, 0, GOOSENECK_Z), (0.05, 0.06, 0.08))                                   # gooseneck bracket
    return bm_object('rigging', bm, smooth_shade=True, uv_scale=1.0)

BOOM_LENGTH = 1.86

def build_boom():
    bm = bmesh.new()
    add_tube(bm, (MAST_X - 0.02, 0, GOOSENECK_Z), (MAST_X - BOOM_LENGTH, 0, GOOSENECK_Z), 0.05, 0.04, sides=10)
    add_box(bm, (MAST_X - BOOM_LENGTH + 0.04, 0, GOOSENECK_Z - 0.04), (0.08, 0.05, 0.05))             # end fitting
    return bm_object('boom', bm, smooth_shade=True, uv_scale=2.5, origin=(MAST_X, 0, GOOSENECK_Z))

RUDDER_STOCK = (STERN - 0.06, 0.0, 0.62)

def build_rudder():
    bm = bmesh.new()
    sx, _, sz = RUDDER_STOCK
    blade = [(sx + 0.02, 0.62), (sx - 0.07, 0.62), (sx - 0.3, 0.1), (sx - 0.28, -0.36), (sx - 0.06, -0.4), (sx + 0.03, -0.05)]
    vs = [bm.verts.new((x, y, z)) for (x, z) in blade for y in (0.018, -0.018)]
    n = len(blade)
    for a in range(n):
        b = (a + 1) % n
        bm.faces.new((vs[a * 2], vs[b * 2], vs[b * 2 + 1], vs[a * 2 + 1]))
    bm.faces.new([vs[i * 2] for i in range(n)][::-1]); bm.faces.new([vs[i * 2 + 1] for i in range(n)])
    add_tube(bm, (sx, 0, 0.66), (sx + 1.0, 0, 0.82), 0.022, 0.016, sides=8)                          # tiller, over the stern seat
    add_box(bm, (sx, 0, 0.66), (0.08, 0.06, 0.08))                                                     # rudder head
    ob = bm_object('rudder', bm, smooth_shade=False, uv_scale=2.5)
    orient(ob, lambda c: Vector((c.x, 0.0, c.z)) if c.z < 0.63 else c - Vector((0, 0, 0)) )
    ob.data.transform(Matrix.Translation(-Vector(RUDDER_STOCK))); ob.location = RUDDER_STOCK
    return ob

# ── sails ────────────────────────────────────────────────────────────────────────────────────

def sail_grid(name, luff_a, luff_b, leech, rows=16, cols=10, roach=0.0):
    """A sail in the XZ plane: points from the luff (a -> b) toward leech(t), with a curved leech."""
    verts, uvs, faces = [], [], []
    for r in range(rows + 1):
        t = r / rows
        lx, lz = luff_a[0] + (luff_b[0] - luff_a[0]) * t, luff_a[1] + (luff_b[1] - luff_a[1]) * t
        ex, ez = leech(t)
        ex += roach * math.sin(t * math.pi) * (ex - lx) / max(1e-3, abs(ex - lx)) * abs(ex - lx) / 1.7
        for c in range(cols + 1):
            u = c / cols
            verts.append((lx + (ex - lx) * u, 0.0, lz + (ez - lz) * u))
            uvs.append((u, t))
    for r in range(rows):
        for c in range(cols):
            a = r * (cols + 1) + c
            faces.append((a, a + 1, a + cols + 2, a + cols + 1))
    return new_object(name, verts, faces, uvs)

def build_sails():
    # Mainsail: luff up the aft face of the mast, foot along the boom, a little roach on the leech.
    luff_x, foot_z, head_z = MAST_X - 0.06, GOOSENECK_Z + 0.05, MAST_TOP - 0.18
    clew = (MAST_X - BOOM_LENGTH + 0.1, foot_z)
    head = (luff_x - 0.1, head_z)
    main = sail_grid('mainsail', (luff_x, foot_z), (luff_x, head_z),
                     lambda t: (clew[0] + (head[0] - clew[0]) * t, clew[1] + (head[1] - clew[1]) * t), rows=18, cols=11, roach=0.18)
    # Jib: luff on the forestay, clew short of the mast.
    head_j = (MAST_X + 0.12, HOUNDS_Z - 0.12)
    tack_j = (TACK[0] - 0.08, TACK[2] + 0.08)
    clew_j = (MAST_X + 0.55, 1.02)
    jib = sail_grid('jib', tack_j, head_j,
                    lambda t: (clew_j[0] + (head_j[0] - clew_j[0]) * t, clew_j[1] + (head_j[1] - clew_j[1]) * t), rows=16, cols=8, roach=-0.05)
    return main, jib

# ── textures ─────────────────────────────────────────────────────────────────────────────────

rng = np.random.default_rng(20261108)

def value_noise(h, w, cells_y, cells_x, seed):
    g = np.random.default_rng(seed).random((cells_y + 1, cells_x + 1))
    g[-1, :], g[:, -1] = g[0, :], g[:, 0]          # tileable
    ys, xs = np.linspace(0, cells_y, h, endpoint=False), np.linspace(0, cells_x, w, endpoint=False)
    iy, ix = ys.astype(int), xs.astype(int)
    fy, fx = ys - iy, xs - ix
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a, b = g[iy][:, ix], g[iy][:, ix + 1]
    c, d = g[iy + 1][:, ix], g[iy + 1][:, ix + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy)[:, None] + (c * (1 - fx) + d * fx) * fy[:, None]

def fbm(h, w, base, seed, octaves=4):
    out, amp, total = np.zeros((h, w)), 1.0, 0.0
    for o in range(octaves):
        out += amp * value_noise(h, w, base[0] * 2 ** o, base[1] * 2 ** o, seed + o)
        total += amp; amp *= 0.5
    return out / total

def srgb(c):
    return np.array(c, dtype=np.float64) / 255.0

def save(name, rgb):
    os.makedirs(TMP, exist_ok=True)
    h, w, _ = rgb.shape
    img = bpy.data.images.new(name, w, h, alpha=False)
    px = np.ones((h, w, 4)); px[:, :, :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(px[::-1].ravel().astype(np.float32))   # Blender images start at the bottom row
    path = os.path.join(TMP, name + '.png')
    img.filepath_raw = path; img.file_format = 'PNG'; img.save()
    return img

def tex_hull():
    """u along the hull, v = (z + 0.5) / 1.5: antifouling below the waterline, a white boot stripe,
    deep teal topsides, a pale sheer stripe; faint plank seams and paint wear."""
    h, w = 512, 512
    v = (np.arange(h)[::-1] + 0.5) / h
    z = v[:, None] * 1.5 - 0.5
    col = np.zeros((h, w, 3))
    teal, red, white, cream = srgb((24, 74, 80)), srgb((122, 44, 36)), srgb((236, 233, 222)), srgb((214, 200, 168))
    col[:] = teal
    col[(z < 0.06)[:, 0]] = red
    stripe = ((z >= 0.06) & (z < 0.12))[:, 0]
    col[stripe] = white
    sheer_band = ((z >= 0.6) & (z < 0.64))[:, 0]
    col[sheer_band] = cream
    n = fbm(h, w, (6, 6), 11)
    col *= (0.92 + 0.12 * n)[:, :, None]
    seams = (np.abs(((z[:, 0] - 0.12) / 0.11) % 1 - 0.5) > 0.485) & (z[:, 0] > 0.12) & (z[:, 0] < 0.6)
    col[seams] *= 0.86
    return save('hull-paint', col)

def tex_teak():
    """Teak planks along u with black caulking seams and grain."""
    h, w = 512, 512
    col = np.zeros((h, w, 3))
    planks = 8
    y = np.arange(h)[:, None] / h * planks
    plank_id = np.floor(y).astype(int)
    tone = np.random.default_rng(5).random(planks + 1)[plank_id] * 0.18
    grain = fbm(h, w, (64, 3), 21, 3)
    streak = np.sin((np.arange(w)[None, :] / w * 9 + grain * 6) * math.pi) * 0.5 + 0.5
    base = srgb((150, 102, 58)) * (0.82 + tone)[..., None]
    col = base * (0.85 + 0.2 * streak[..., None] * (0.6 + 0.4 * grain[..., None]))
    seam = (np.abs((y % 1) - 0.5) > 0.47)[:, 0]
    col[seam] = srgb((28, 22, 16))
    butt = (np.abs(((np.arange(w)[None, :] / w * 2 + plank_id * 0.37) % 1) - 0.5) > 0.495)
    col[np.broadcast_to(butt, (h, w))] *= 0.5
    return save('teak-deck', col)

def tex_varnish():
    h, w = 256, 256
    grain = fbm(h, w, (4, 48), 31, 3)
    streak = np.sin((np.arange(h)[:, None] / h * 26 + grain * 7) * math.pi) * 0.5 + 0.5
    col = srgb((92, 52, 26)) * (0.84 + 0.22 * streak[..., None]) * (0.92 + 0.12 * grain[..., None])
    return save('varnished-wood', col)

def tex_canvas():
    """Sail cloth: warm off-white, horizontal panel seams (u across, v up), a faint weave and soiling."""
    h, w = 512, 512
    v = (np.arange(h)[::-1] + 0.5) / h
    col = np.ones((h, w, 3)) * srgb((238, 232, 214))
    weave = (np.sin(np.arange(w)[None, :] * 1.7) * np.sin(np.arange(h)[:, None] * 1.7)) * 0.012
    col += weave[..., None]
    soil = fbm(h, w, (4, 4), 41)
    col *= (0.95 + 0.06 * soil)[..., None]
    panels = 7
    seam = np.abs((v * panels) % 1 - 0.5) > 0.488
    col[seam] *= 0.88
    edge = (np.arange(w) < 6) | (np.arange(w) > w - 7)     # luff and leech tapes
    col[:, edge] *= 0.9
    return save('sail-canvas', col)

def material(name, image=None, color=(1, 1, 1), roughness=0.6, metallic=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    if image is not None:
        node = m.node_tree.nodes.new('ShaderNodeTexImage')
        node.image = image
        m.node_tree.links.new(node.outputs['Color'], bsdf.inputs['Base Color'])
    return m

# ── build ────────────────────────────────────────────────────────────────────────────────────

def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    hull = build_hull(); deck = build_deck(); trim = build_trim(); rig = build_rigging()
    boom = build_boom(); rudder = build_rudder(); main, jib = build_sails()
    mats = {
        'hull': material('painted hull', tex_hull(), roughness=0.42),
        'deck': material('teak deck', tex_teak(), roughness=0.72),
        'wood': material('varnished wood', tex_varnish(), roughness=0.38),
        'canvas': material('sail canvas', tex_canvas(), roughness=0.88),
        'metal': material('stainless rigging', None, (0.62, 0.64, 0.66), roughness=0.32, metallic=0.85),
    }
    for ob, key in ((hull, 'hull'), (deck, 'deck'), (trim, 'wood'), (boom, 'wood'), (rudder, 'wood'), (rig, 'metal'), (main, 'canvas'), (jib, 'canvas')):
        ob.data.materials.clear(); ob.data.materials.append(mats[key])
    return [hull, deck, trim, rig, boom, rudder, main, jib]

def report(objects):
    total = 0
    for ob in objects:
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        total += tris
        print(f'  {ob.name:14s} {tris:5d} tris  {len(ob.data.vertices):5d} verts')
    print(f'  total {total} tris in {len(objects)} meshes')

def export(objects):
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:
        ob.select_set(True)
    path = os.path.join(OUT, 'boat.glb')
    kwargs = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_normals=True,
                  export_texcoords=True, export_materials='EXPORT', export_yup=True)
    try:
        bpy.ops.export_scene.gltf(**kwargs, export_image_format='JPEG', export_image_quality=86)
    except TypeError:
        bpy.ops.export_scene.gltf(**kwargs, export_image_format='JPEG')
    print('wrote', path, os.path.getsize(path), 'bytes')

def render(objects):
    os.makedirs(RENDERS, exist_ok=True)
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x, scene.render.resolution_y = 1100, 800
    world = bpy.data.worlds.new('sky'); scene.world = world; world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.68, 0.8, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); scene.collection.objects.link(sun)
    sun.data.energy = 3.2; sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
    cam.data.lens = 40
    # Preview the poses the game gives her: boom out to starboard (sheeted at ~35°), helm a little over.
    for ob in objects:
        if ob.name == 'boom': ob.rotation_euler.z = math.radians(-35)
        if ob.name == 'rudder': ob.rotation_euler.z = math.radians(12)
    for name, loc, look in (('quarter', (-7.5, -6.5, 4.2), (0.2, 0, 1.6)), ('side', (0.2, -11, 2.2), (0.2, 0, 2.2)), ('cockpit', (-5.2, -1.8, 3.6), (-0.4, 0, 0.6))):
        cam.location = loc
        cam.rotation_euler = (Vector(look) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(RENDERS, f'boat-{name}.png')
        bpy.ops.render.render(write_still=True)
    for ob in objects:
        if ob.name in ('boom', 'rudder'): ob.rotation_euler.z = 0

if __name__ == '__main__':
    objs = build()
    report(objs)
    export(objs)
    if RENDER:
        render(objs)
