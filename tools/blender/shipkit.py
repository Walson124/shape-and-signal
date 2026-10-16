"""Hard-surface modelling helpers for the ship builder.

Coordinates are given the way the game sees them (x right, y up, -z forward)
and converted to Blender's (x, -z, y) so the exported glTF lines up.
Every part is tagged with one of four material slots the game recolours:
hull, dark, glass, neon.
"""
import math

import bmesh
import bpy
from mathutils import Vector


def P(x, y, z):
    return Vector((x, -z, y))


MATS = {}


def material(kind):
    if kind in MATS:
        return MATS[kind]
    m = bpy.data.materials.new(kind)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    col, metal, rough = {
        "hull": ((0.82, 0.84, 0.88, 1), 0.45, 0.4),
        "dark": ((0.12, 0.14, 0.17, 1), 0.65, 0.42),
        "glass": ((0.04, 0.09, 0.13, 1), 0.8, 0.08),
        "neon": ((0.4, 0.95, 1.0, 1), 0.0, 0.3),
        "light": ((1.0, 0.82, 0.55, 1), 0.0, 0.4),
    }[kind]
    b.inputs["Base Color"].default_value = col
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if kind in ("neon", "light"):
        b.inputs["Emission Color"].default_value = col
        b.inputs["Emission Strength"].default_value = 3.0
    MATS[kind] = m
    return m


def new_object(name, bm, kind, parent=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material(kind))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if parent:
        ob.parent = parent
    ob["kind"] = kind
    return ob


def modifiers(ob, *, subsurf=0, bevel=0.0, segments=2, angle=35, weighted=True):
    if subsurf:
        m = ob.modifiers.new("subsurf", "SUBSURF")
        m.levels = m.render_levels = subsurf
    if bevel:
        m = ob.modifiers.new("bevel", "BEVEL")
        m.width = bevel
        m.segments = segments
        m.limit_method = "ANGLE"
        m.angle_limit = math.radians(angle)
        m.harden_normals = True
    if weighted:
        ob.modifiers.new("wn", "WEIGHTED_NORMAL").keep_sharp = True
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def superellipse(w, h, n, e=2.5, yoff=0.0, flat_bottom=0.0):
    """Ring of n points of a superellipse (half-width w, half-height h)."""
    pts = []
    for i in range(n):
        a = i / n * 2 * math.pi
        c, s = math.cos(a), math.sin(a)
        x = w * math.copysign(abs(c) ** (2 / e), c)
        y = h * math.copysign(abs(s) ** (2 / e), s)
        if y < 0:
            y *= 1 - flat_bottom
        pts.append((x, y + yoff))
    return pts


def loft(name, sections, kind="hull", n=28, parent=None, cap_front=True, cap_back=True, subsurf=2, faceted=False):
    """A smooth body through cross-sections [(z, half_width, half_height, y_offset, exponent, flat_bottom)].
    The first and last sections may have zero size to make a point."""
    # close open ends with a shrunken ring and a centre point (an n-gon cap pinches under smoothing)
    sections = list(sections)
    if cap_front and sections[0][1] > 1e-4:
        z, w, h, yo, e, fb = sections[0]
        sections = [(z - 0.04, 0, 0, yo, e, fb), (z - 0.02, w * 0.6, h * 0.6, yo, e, fb)] + sections
    if cap_back and sections[-1][1] > 1e-4:
        z, w, h, yo, e, fb = sections[-1]
        sections = sections + [(z + 0.02, w * 0.6, h * 0.6, yo, e, fb), (z + 0.04, 0, 0, yo, e, fb)]
    bm = bmesh.new()
    rings = []
    for (z, w, h, yo, e, fb) in sections:
        if w < 1e-4 or h < 1e-4:
            rings.append([bm.verts.new(P(0, yo, z))])
        else:
            rings.append([bm.verts.new(P(x, y, z)) for x, y in superellipse(w, h, n, e, yo, fb)])
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1:
            for i in range(n):
                bm.faces.new((a[0], b[(i + 1) % n], b[i]))
        elif len(b) == 1:
            for i in range(n):
                bm.faces.new((a[i], a[(i + 1) % n], b[0]))
        else:
            for i in range(n):
                bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_object(name, bm, kind, parent)
    if faceted:
        # armoured plating: flat facets with chamfered edges
        return modifiers(ob, bevel=0.12, segments=2, angle=20)
    return modifiers(ob, subsurf=subsurf)


def slab(name, outline, thickness, *, y=0.0, kind="hull", taper=0.4, parent=None, bevel=0.06, up=False):
    """A wing or plate: outline [(x, z), ...] in the horizontal plane (or the vertical x=0 plane
    when up=True, with (z, y) pairs), thickness tapering towards the outline's far points."""
    bm = bmesh.new()
    top, bot = [], []
    cx = sum(p[0] for p in outline) / len(outline)
    span = max(abs(p[0] - cx) for p in outline) or 1
    for a, b in outline:
        t = thickness * (1 - taper * min(1, abs(a - cx) / span)) / 2
        if up:
            top.append(bm.verts.new(P(t, b, a)))
            bot.append(bm.verts.new(P(-t, b, a)))
        else:
            top.append(bm.verts.new(P(a, y + t, b)))
            bot.append(bm.verts.new(P(a, y - t, b)))
    k = len(outline)
    bm.faces.new(top)
    bm.faces.new(list(reversed(bot)))
    for i in range(k):
        j = (i + 1) % k
        bm.faces.new((top[j], top[i], bot[i], bot[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_object(name, bm, kind, parent)
    return modifiers(ob, bevel=bevel, segments=2, angle=25)


def box(name, w, h, d, x, y, z, kind="dark", parent=None, bevel=0.04, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        v.co = Vector((v.co.x * w, v.co.y * d, v.co.z * h))
    ob = new_object(name, bm, kind, parent)
    ob.location = P(x, y, z)
    ob.rotation_euler = (rot[0], rot[2], rot[1])
    return modifiers(ob, bevel=bevel, segments=2, angle=40)


def lathe(name, profile, x, y, z, kind="dark", n=24, parent=None, axis="z"):
    """Turn a profile [(r, along), ...] about an axis through (x, y, z); along runs towards +z (aft)."""
    bm = bmesh.new()
    rings = []
    for r, t in profile:
        ring = []
        for i in range(n):
            a = i / n * 2 * math.pi
            if axis == "z":
                ring.append(bm.verts.new(P(x + r * math.cos(a), y + r * math.sin(a), z + t)))
            else:
                ring.append(bm.verts.new(P(x + t, y + r * math.sin(a), z + r * math.cos(a))))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_object(name, bm, kind, parent)
    return modifiers(ob, bevel=0.02, segments=1, angle=50)


def engine(root, name, x, y, z, r, length, engines, *, intake=True):
    """A drive nacelle with a flared nozzle, an inner cone and a glowing ring; z is the front of the nacelle."""
    body = [(r * 0.75, 0), (r * 0.98, length * 0.12), (r, length * 0.5), (r * 0.96, length * 0.85), (r * 1.06, length * 0.92), (r * 1.08, length)]
    lathe(f"{name}_body", body, x, y, z, "dark", parent=root)
    # nozzle petals: a slightly narrower ring set inside the rim
    lathe(f"{name}_nozzle", [(r * 1.02, length - 0.02), (r * 0.8, length + 0.35), (r * 0.72, length + 0.4)], x, y, z, "hull", parent=root)
    lathe(f"{name}_core", [(r * 0.62, length + 0.1), (r * 0.3, length + 0.55), (0.02, length + 0.7)], x, y, z, "dark", parent=root)
    lathe(f"{name}_ring", [(r * 0.7, length + 0.32), (r * 0.66, length + 0.34), (r * 0.58, length + 0.36)], x, y, z, "neon", parent=root)
    if intake:
        lathe(f"{name}_intake", [(r * 0.55, -0.05), (r * 0.78, 0.0), (r * 0.6, 0.25)], x, y, z, "neon", parent=root)
    e = bpy.data.objects.new(f"{root.name}_engine_{len(engines)}", None)
    e.location = P(x, y, z + length + 0.8)
    e["radius"] = r
    e.parent = root
    bpy.context.scene.collection.objects.link(e)
    engines.append(e)


def surface(x, z, top=60.0):
    """Where a ray straight down at (x, z) meets the model so far: (point, normal) in game axes, or None."""
    dg = bpy.context.evaluated_depsgraph_get()
    hit, loc, nor, _i, _o, _m = bpy.context.scene.ray_cast(dg, P(x, top, z), Vector((0, 0, -1)))
    if not hit:
        return None
    return Vector((loc.x, loc.z, -loc.y)), Vector((nor.x, nor.z, -nor.y))


def seat(ob, x, z, lift=0.0):
    """Stand an object on the surface below (x, z), tilted to match it."""
    s = surface(x, z)
    if not s:
        return False
    p, n = s
    ob.location = P(p.x, p.y + lift, p.z)
    up = Vector((0, 0, 1))
    ob.rotation_euler = up.rotation_difference(Vector((n.x, -n.z, n.y))).to_euler()
    return True


def greebles(root, name, rnd, count, area, y=None, kind="dark"):
    """Vents in neat rows over an area [(x0, x1), (z0, z1)], each seated on the hull below and
    mirrored left/right."""
    (x0, x1), (z0, z1) = area
    rows = max(1, int(round(count ** 0.5)))
    cols = max(1, count // rows)
    k = 0
    for i in range(rows):
        for j in range(cols):
            x = x0 + (x1 - x0) * (i + 0.5) / rows
            z = z0 + (z1 - z0) * (j + 0.5) / cols
            w, d = 0.35 + rnd.random() * 0.25, 0.45 + rnd.random() * 0.5
            for sx in ((x,) if abs(x) < 0.05 else (x, -x)):
                ob = box(f"{name}_{k}", w, 0.1, d, sx, 0, z, kind, parent=root, bevel=0.015)
                if not seat(ob, sx, z, 0.03):
                    bpy.data.objects.remove(ob, do_unlink=True)
                k += 1


def windows(root, name, pts, size=(0.42, 0.16)):
    """Small warm-lit window panels on a hull side: each point (x, y, z) gives the side (sign of x),
    the height and the position along the ship; the panel sits on the hull surface found by a
    sideways ray."""
    dg = bpy.context.evaluated_depsgraph_get()
    for i, (x, y, z) in enumerate(pts):
        s = 1 if x > 0 else -1
        hit, loc, nor, *_ = bpy.context.scene.ray_cast(dg, P(s * 40, y, z), Vector((-s, 0, 0)))
        if not hit:
            continue
        ob = box(f"{name}_{i}", 0.05, size[1], size[0], loc.x + s * 0.01, y, z, "light", parent=root, bevel=0.0)



def strip(root, name, pts, kind="neon", width=0.07, height=0.05):
    """A thin glowing strip along points [(x, y, z), ...]."""
    for i, (a, b) in enumerate(zip(pts, pts[1:])):
        va, vb = Vector(a), Vector(b)
        mid = (va + vb) / 2
        d = vb - va
        ob = box(f"{name}_{i}", width, height, d.length, mid.x, mid.y, mid.z, kind, parent=root, bevel=0.0)
        # the box's long side is Blender's Y; pitch about X, then yaw about Z, onto the segment
        pitch = math.atan2(d.y, math.hypot(d.x, d.z))
        yaw = math.atan2(-d.x, -d.z)
        ob.rotation_euler = (pitch, 0, yaw)
