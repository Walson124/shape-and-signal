"""The five World-Eaters, each a unique kit of rigid pieces the game strings along a path.

Run headless:
  blender -b --factory-startup --python tools/blender/make_worldeaters.py -- --out public/models/worldeaters --preview previews/ [--only leviathan]

Per creature (file <id>.glb): <id>_head (origin at the neck, facing -y), <id>_petal (one jaw /
mandible / shutter, origin at its hinge, laid along -y), <id>_seg (a body segment, length ~1.24
along y, radius ~0.45), <id>_tail, <id>_node (glowing weak point) and optionally <id>_wing
(origin at the root, reaching along +x). Materials hide/dark/horn/glow/eye/metal are tinted by
the game.
"""
import argparse
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import beastkit as K  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--preview", default="")
ap.add_argument("--only", default="")
args = ap.parse_args(argv)

TAU = math.tau


def metal_mat():
    if "metal" in K.MATS:
        return K.MATS["metal"]
    m = bpy.data.materials.new("metal")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.55, 0.52, 0.48, 1)
    b.inputs["Metallic"].default_value = 0.9
    b.inputs["Roughness"].default_value = 0.32
    K.MATS["metal"] = m
    return m


def organic(name, joints, bones, seed, *, detail=0.03, scales=0.016, ridge=0.8, subdiv=3, colour=None, extra=()):
    desc = {"joints": joints, "bones": bones, "extra": list(extra), "root_joint": bones[0][2]}
    ob = K.build_body(name, desc, subdiv=subdiv, detail=detail, seed=seed, ridge=ridge, scales=scales, scale_size=14)
    K.colour(ob, **(colour or dict(belly=0.65, back=0.2, mottle=0.22, seed=seed, stripes=0.12)))
    return ob


def clean(ob):
    for vg in list(ob.vertex_groups):
        ob.vertex_groups.remove(vg)
    return ob


def mesh_object(name, bm, kind):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(metal_mat() if kind == "metal" else K.material(kind))
    for p in me.polygons:
        p.use_smooth = True
    return ob


def join(objs, target):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()
    return target


def cyl(r0, r1, y0, y1, segs=24, x=0, z=0):
    """A tube along y (open-capped)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r0, radius2=r1, depth=abs(y1 - y0))
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "X"))
    bmesh.ops.translate(bm, verts=bm.verts, vec=(x, (y0 + y1) / 2, z))
    return bm


def ring(r, minor, y, segs=40):
    bm = bmesh.new()
    # torus about the y axis
    verts = []
    m = 10
    for i in range(segs):
        a = i / segs * TAU
        for j in range(m):
            b = j / m * TAU
            rr = r + math.cos(b) * minor
            verts.append(bm.verts.new((math.cos(a) * rr, y + math.sin(b) * minor, math.sin(a) * rr)))
    for i in range(segs):
        for j in range(m):
            a, b = i * m + j, i * m + (j + 1) % m
            c, d = ((i + 1) % segs) * m + (j + 1) % m, ((i + 1) % segs) * m + j
            bm.faces.new((verts[a], verts[b], verts[c], verts[d]))
    return bm


def shell_petal(name, length, width, curve, thick, kind="dark", teeth=None):
    """A curved shell hinged at the origin, reaching along -y, curving up (+z)."""
    bm = bmesh.new()
    rows, cols = 7, 8
    grid = []
    for i in range(rows + 1):
        t = i / rows
        row = []
        for j in range(cols + 1):
            u = (j / cols - 0.5) * 2
            w = (1 - t * 0.75) * width
            row.append(bm.verts.new((u * w, -t * length, 0.05 + math.sin(t * math.pi * 0.9) * curve - abs(u) * curve * 0.5 * (1 - t))))
        grid.append(row)
    for i in range(rows):
        for j in range(cols):
            bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))
    bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=thick)
    ob = mesh_object(name, bm, kind)
    if teeth:
        P = K.Parts(name, None)
        n, size, kind_t = teeth
        for j in range(n):
            u = (j / max(1, n - 1) - 0.5) * 2
            for t in (0.3, 0.55, 0.8):
                w = (1 - t * 0.75) * width
                P.cone((u * w * 0.9, -t * length, 0.02), (u * w * 0.75, -t * length - 0.02, -size * (1.2 - t * 0.6)), size * 0.18, kind_t, "p", segs=5)
        P.finish(ob)
    return clean(ob)


def stage(pieces, name):
    for i, ob in enumerate(pieces):
        ob.location = (0, 0, 0)
    return pieces


# =============================================================== DEVOURER --
def devourer():
    out = []
    J = {"a": ((0, 0.62, 0), (0.43, 0.41)), "m": ((0, 0, 0.02), (0.47, 0.45)), "b": ((0, -0.62, 0), (0.43, 0.41)),
         "rib_l": ((0.34, 0, -0.05), (0.18, 0.22)), "rib_r": ((-0.34, 0, -0.05), (0.18, 0.22))}
    seg = organic("devourer_seg", J, [("s1", None, "a", "m"), ("s2", "s1", "m", "b")], 5, extra=[("m", "rib_l"), ("m", "rib_r")])
    P = K.Parts("seg", seg)
    P.cone((0, 0.05, 0.42), (0, 0.32, 1.05), 0.12, "dark", "s1", segs=7, curve=0.25, side=(0, 1, 0), snap=True)
    for k in range(5):
        a = math.pi * (0.2 + k * 0.15)
        P.plate((math.cos(a) * 0.46, -0.1, math.sin(a) * 0.44), (0.14, 0.32, 0.04), (math.cos(a), 0, math.sin(a)), "dark", "s1")
    for sn in (-1, 1):
        for k in range(3):
            P.cone((sn * 0.45, -0.3 + k * 0.3, 0.05), (sn * 0.72, -0.2 + k * 0.3, 0.12), 0.05, "horn", "s1", segs=5, curve=0.2, side=(0, 1, 0), snap=True)
        for k in range(4):
            P.eye((sn * 0.44, -0.4 + k * 0.27, -0.12), 0.03, "s1")
    # writhing tendrils hanging from the belly
    for k in range(3):
        P.cone((0.12 * (k - 1), -0.2 + k * 0.2, -0.4), (0.3 * (k - 1), -0.1 + k * 0.25, -1.1), 0.06, "hide", "s1", segs=6, curve=0.4, side=(0, 1, 0))
    P.finish(seg)
    out.append(clean(seg))
    J = {"a": ((0, 0.62, 0), (0.4, 0.38)), "m": ((0, 0, 0), (0.32, 0.3)), "b": ((0, -0.62, 0), (0.06, 0.06))}
    tail = organic("devourer_tail", J, [("s1", None, "a", "m"), ("s2", "s1", "m", "b")], 6)
    P = K.Parts("tail", tail)
    for k in range(5):
        a = (k - 2) * 0.35
        P.plate((math.sin(a) * 0.35, -0.75, math.cos(a) * 0.35), (0.08, 0.6, 0.02), (math.sin(a), 0, math.cos(a)), "dark", "s2", snap=False)
        P.plate((math.sin(a) * 0.62, -1.15, math.cos(a) * 0.62), (0.02, 0.25, 0.012), (math.sin(a), 0, math.cos(a)), "glow", "s2", snap=False, bevel=False)
    P.finish(tail)
    out.append(clean(tail))
    J = {"neck": ((0, 0.75, 0), (0.48, 0.46)), "skull": ((0, 0.1, 0.06), (0.58, 0.56)), "rim": ((0, -0.45, 0.02), (0.6, 0.58)),
         "brow_l": ((0.3, -0.1, 0.4), (0.18, 0.12)), "brow_r": ((-0.3, -0.1, 0.4), (0.18, 0.12))}
    head = organic("devourer_head", J, [("h1", None, "neck", "skull"), ("h2", "h1", "skull", "rim")], 7, detail=0.04, extra=[("skull", "brow_l"), ("skull", "brow_r")])
    bm = bmesh.new(); bm.from_mesh(head.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().y < -0.62], context="FACES")
    bm.to_mesh(head.data); bm.free()
    P = K.Parts("head", head)
    for sn in (-1, 1):
        for k in range(4):
            P.eye((sn * (0.36 + k * 0.05), -0.3 + k * 0.12, 0.4 - k * 0.04), 0.06 - k * 0.008, "h1")
        P.cone((sn * 0.32, 0.0, 0.45), (sn * 0.95, 0.9, 1.0), 0.1, "dark", "h1", segs=7, curve=0.35, side=(0, 1, 0), snap=True)
        P.cone((sn * 0.45, 0.25, 0.2), (sn * 1.05, 0.95, 0.35), 0.07, "dark", "h1", segs=6, curve=0.3, side=(0, 1, 0), snap=True)
    for ring_i, (r, n, y) in enumerate(((0.5, 22, -0.55), (0.38, 16, -0.35), (0.25, 12, -0.15))):
        for k in range(n):
            a = k / n * TAU + ring_i * 0.13
            P.cone((math.cos(a) * r, y, math.sin(a) * r), (math.cos(a) * r * 0.55, y + 0.12, math.sin(a) * r * 0.55), 0.03, "horn", "h1", segs=5)
    P.eye((0, 0.1, 0.02), 0.2, "h1")
    P.finish(head)
    out.append(clean(head))
    out.append(shell_petal("devourer_petal", 1.1, 0.55, 0.18, 0.06, teeth=(9, 0.2, "horn")))
    out.append(node_piece("devourer_node", 9))
    return out


def node_piece(name, seed, kind="glow", crystal=False):
    J = {"a": ((0, 0, -0.1), (0.2, 0.2)), "b": ((0, 0, 0.25), (0.28, 0.28))}
    node = organic(name, J, [("n1", None, "a", "b")], seed, detail=0.05, scales=0.0)
    node.data.materials.clear()
    node.data.materials.append(K.material(kind))
    P = K.Parts(name, node)
    rnd = random.Random(seed)
    for k in range(9 if not crystal else 12):
        a = k / (9 if not crystal else 12) * TAU
        h = 0.4 + rnd.random() * (0.25 if not crystal else 0.6)
        P.cone((math.cos(a) * 0.22, math.sin(a) * 0.22, 0.05), (math.cos(a) * 0.45, math.sin(a) * 0.45, h), 0.06 if not crystal else 0.08, "glow" if crystal else "horn", "n1", segs=5 if not crystal else 4)
    P.finish(node)
    return clean(node)


# ============================================================== LEVIATHAN --
def leviathan():
    """A whale of the abyss: smooth and vast, grooved belly, dorsal fins, glowing freckles."""
    out = []
    J = {"a": ((0, 0.62, 0), (0.46, 0.42)), "m": ((0, 0, 0.0), (0.5, 0.46)), "b": ((0, -0.62, 0), (0.46, 0.42)),
         "belly": ((0, 0, -0.18), (0.36, 0.3))}
    seg = organic("leviathan_seg", J, [("s1", None, "a", "m"), ("s2", "s1", "m", "b")], 11, detail=0.015, scales=0.0, ridge=0.3,
                  colour=dict(belly=0.85, back=0.22, mottle=0.1, seed=11, stripes=0.0), extra=[("m", "belly")])
    # ventral grooves: paler stripes painted lengthwise along the belly
    me = seg.data
    col = me.color_attributes["Col"]
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            if v.z < -0.1:
                g = 0.5 + 0.4 * (0.5 + 0.5 * math.sin(v.x * 60))
                col.data[li].color = (g, g, g * 1.04, 1)
    P = K.Parts("seg", seg)
    P.plate((0, 0.1, 0.5), (0.03, 0.5, 0.35), (0, 0, 1), "hide", "s1", snap=True)
    rnd = random.Random(4)
    for k in range(26):
        a = rnd.random() * math.pi
        y = rnd.uniform(-0.55, 0.55)
        P.eye((math.cos(a) * 0.48, y, math.sin(a) * 0.45), 0.02 + rnd.random() * 0.015, "s1")
    P.finish(seg)
    out.append(clean(seg))
    # tail: flukes
    J = {"a": ((0, 0.62, 0), (0.42, 0.38)), "m": ((0, 0, 0), (0.3, 0.27)), "b": ((0, -0.62, 0), (0.12, 0.1))}
    tail = organic("leviathan_tail", J, [("s1", None, "a", "m"), ("s2", "s1", "m", "b")], 12, detail=0.015, scales=0.0, ridge=0.3,
                   colour=dict(belly=0.85, back=0.22, mottle=0.1, seed=12))
    P = K.Parts("tail", tail)
    for sn in (-1, 1):
        bm = bmesh.new()
        pts = [(0.05, -0.5), (1.2, -0.95), (1.45, -1.35), (0.9, -1.15), (0.1, -0.95)]
        vs_t = [bm.verts.new((sn * x, y, 0.035)) for x, y in pts]
        vs_b = [bm.verts.new((sn * x, y, -0.035)) for x, y in pts]
        bm.faces.new(vs_t); bm.faces.new(list(reversed(vs_b)))
        for i in range(len(pts)):
            j = (i + 1) % len(pts)
            bm.faces.new((vs_t[j], vs_t[i], vs_b[i], vs_b[j]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        P.add(bm, "hide", "s2")
        P.plate((sn * 1.3, -1.2, 0), (0.12, 0.06, 0.03), (0, 0, 1), "glow", "s2", snap=False, bevel=False)
    P.finish(tail)
    out.append(clean(tail))
    # head: a broad blunt skull, small eyes far back, pectoral fins, open mouth at the front
    J = {"neck": ((0, 0.7, 0), (0.5, 0.46)), "skull": ((0, 0.05, 0.1), (0.62, 0.5)), "rim": ((0, -0.55, 0.05), (0.62, 0.45))}
    head = organic("leviathan_head", J, [("h1", None, "neck", "skull"), ("h2", "h1", "skull", "rim")], 13, detail=0.015, scales=0.0, ridge=0.3,
                   colour=dict(belly=0.85, back=0.22, mottle=0.1, seed=13))
    bm = bmesh.new(); bm.from_mesh(head.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().y < -0.7], context="FACES")
    bm.to_mesh(head.data); bm.free()
    P = K.Parts("head", head)
    for sn in (-1, 1):
        P.eye((sn * 0.55, 0.15, 0.12), 0.06, "h1")
        bm = bmesh.new()
        pts = [(0.4, 0.2), (1.5, 0.6), (1.7, 0.9), (1.2, 0.85), (0.45, 0.5)]
        vt = [bm.verts.new((sn * x, y, -0.22 - x * 0.12 + 0.03)) for x, y in pts]
        vb = [bm.verts.new((sn * x, y, -0.22 - x * 0.12 - 0.03)) for x, y in pts]
        bm.faces.new(vt); bm.faces.new(list(reversed(vb)))
        for i in range(len(pts)):
            j = (i + 1) % len(pts)
            bm.faces.new((vt[j], vt[i], vb[i], vb[j]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        P.add(bm, "hide", "h1")
    # baleen: a curtain of dark plates hanging inside the mouth
    for k in range(30):
        a = math.pi * (0.05 + 0.9 * k / 29)
        P.plate((math.cos(a) * 0.5, -0.58, math.sin(a) * 0.38), (0.015, 0.03, 0.18), (0, -1, 0), "dark", "h1", snap=False, bevel=False)
    P.eye((0, 0.0, 0.05), 0.22, "h1")
    P.finish(head)
    out.append(clean(head))
    out.append(shell_petal("leviathan_petal", 1.25, 0.7, 0.12, 0.08, kind="hide"))
    out.append(node_piece("leviathan_node", 14))
    return out


# =============================================================== SKYWYRM --
def skywyrm():
    """A dragon of the burning sky: scaled and horned, wings along its body, a spade-bladed tail."""
    out = []
    J = {"a": ((0, 0.62, 0), (0.4, 0.38)), "m": ((0, 0, 0.03), (0.43, 0.41)), "b": ((0, -0.62, 0), (0.4, 0.38))}
    seg = organic("skywyrm_seg", J, [("s1", None, "a", "m"), ("s2", "s1", "m", "b")], 21, detail=0.03, scales=0.028, ridge=1.0,
                  colour=dict(belly=0.75, back=0.2, mottle=0.25, seed=21, stripes=0.25))
    P = K.Parts("seg", seg)
    for k in range(3):
        y = -0.4 + k * 0.4
        P.cone((0, y, 0.4), (0, y + 0.15, 0.95 - k * 0.1), 0.09, "horn", "s1", segs=6, curve=0.3, side=(0, 1, 0), snap=True)
    for sn in (-1, 1):
        for k in range(4):
            P.plate((sn * 0.4, -0.45 + k * 0.3, 0.18), (0.12, 0.14, 0.03), (sn, 0, 0.6), "dark", "s1")
        P.cone((sn * 0.3, 0.0, -0.3), (sn * 0.55, 0.15, -0.55), 0.04, "horn", "s1", segs=5)
    P.finish(seg)
    out.append(clean(seg))
    J = {"a": ((0, 0.62, 0), (0.36, 0.34)), "m": ((0, 0, 0), (0.24, 0.22)), "b": ((0, -0.62, 0), (0.08, 0.08))}
    tail = organic("skywyrm_tail", J, [("s1", None, "a", "m"), ("s2", "s1", "m", "b")], 22, detail=0.03, scales=0.028,
                   colour=dict(belly=0.75, back=0.2, mottle=0.25, seed=22, stripes=0.25))
    P = K.Parts("tail", tail)
    bm = bmesh.new()
    pts = [(0, -0.55), (0.5, -0.85), (0.0, -1.6), (-0.5, -0.85)]
    vt = [bm.verts.new((x, y, 0.04)) for x, y in pts]
    vb = [bm.verts.new((x, y, -0.04)) for x, y in pts]
    bm.faces.new(vt); bm.faces.new(list(reversed(vb)))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((vt[j], vt[i], vb[i], vb[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    P.add(bm, "glow", "s2")
    P.finish(tail)
    out.append(clean(tail))
    J = {"neck": ((0, 0.7, 0), (0.42, 0.4)), "skull": ((0, 0.1, 0.12), (0.46, 0.4)), "snout": ((0, -0.7, 0.0), (0.24, 0.2)),
         "brow_l": ((0.25, -0.05, 0.36), (0.14, 0.1)), "brow_r": ((-0.25, -0.05, 0.36), (0.14, 0.1))}
    head = organic("skywyrm_head", J, [("h1", None, "neck", "skull"), ("h2", "h1", "skull", "snout")], 23, detail=0.035, scales=0.025, ridge=1.1,
                   colour=dict(belly=0.75, back=0.2, mottle=0.25, seed=23, stripes=0.2), extra=[("skull", "brow_l"), ("skull", "brow_r")])
    bm = bmesh.new(); bm.from_mesh(head.data)
    # open the front of the snout for the jaws
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().y < -0.78], context="FACES")
    bm.to_mesh(head.data); bm.free()
    P = K.Parts("head", head)
    for sn in (-1, 1):
        P.eye((sn * 0.3, -0.25, 0.3), 0.06, "h1")
        P.eye((sn * 0.34, -0.12, 0.34), 0.035, "h1")
        P.cone((sn * 0.2, 0.05, 0.45), (sn * 0.5, 0.9, 0.95), 0.1, "horn", "h1", segs=7, curve=0.4, side=(0, 1, 0), snap=True)
        P.cone((sn * 0.35, 0.15, 0.3), (sn * 0.85, 0.75, 0.45), 0.07, "horn", "h1", segs=6, curve=0.3, side=(0, 1, 0), snap=True)
        for k in range(4):
            P.cone((sn * 0.38, 0.2 + k * 0.12, 0.05), (sn * 0.7, 0.35 + k * 0.15, 0.0), 0.03, "horn", "h1", segs=5, snap=True)
    P.cone((0, -0.65, 0.2), (0, -0.85, 0.42), 0.05, "horn", "h1", segs=6, curve=0.2, side=(0, 1, 0), snap=True)
    P.eye((0, -0.3, 0.0), 0.16, "h1")
    P.finish(head)
    out.append(clean(head))
    out.append(shell_petal("skywyrm_petal", 1.0, 0.36, 0.14, 0.06, teeth=(7, 0.22, "horn")))
    out.append(node_piece("skywyrm_node", 24))
    # a membrane wing: finger bones fanning out from the root, skin stretched between them
    bm = bmesh.new()
    fingers = [(2.6, 0.2), (2.4, 0.9), (1.9, 1.6), (1.2, 2.0)]
    root = bm.verts.new((0, 0, 0))
    tips = [bm.verts.new((x, y, 0.15 * x)) for x, y in fingers]
    mid = [bm.verts.new((x * 0.55, y * 0.55 + 0.25, 0.08 * x)) for x, y in fingers]
    for i in range(len(fingers) - 1):
        bm.faces.new((root, tips[i], mid[i + 0], ))
    for i in range(len(fingers) - 1):
        bm.faces.new((tips[i], tips[i + 1], mid[i + 1], mid[i]))
        bm.faces.new((root, mid[i], mid[i + 1]))
    bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=0.03)
    wing = mesh_object("skywyrm_wing", bm, "hide")
    P = K.Parts("wing", None)
    for x, y in fingers:
        P.cone((0, 0, 0), (x, y, 0.15 * x), 0.06, "horn", "w", segs=6)
    P.finish(wing)
    out.append(clean(wing))
    return out


# =============================================================== JADEBONE --
def jadebone():
    """A colossus of bone: a vertebral column wrapped in ribs, jade crystal growing through it."""
    out = []
    # segment: a vertebra disc with a spinous process, ribs arcing round and down, crystals
    J = {"a": ((0, 0.5, 0.1), (0.2, 0.2)), "b": ((0, -0.5, 0.1), (0.2, 0.2)), "c": ((0, 0, 0.12), (0.3, 0.27))}
    seg = organic("jadebone_seg", J, [("s1", None, "a", "c"), ("s2", "s1", "c", "b")], 31, detail=0.03, scales=0.0, ridge=1.2,
                  colour=dict(belly=0.9, back=0.75, mottle=0.12, seed=31))
    seg.data.materials.clear()
    seg.data.materials.append(K.material("horn"))
    P = K.Parts("seg", seg)
    P.cone((0, 0.05, 0.3), (0, 0.35, 0.95), 0.1, "horn", "s1", segs=6, curve=0.3, side=(0, 1, 0))
    for sn in (-1, 1):
        for k in range(3):
            y = -0.35 + k * 0.35
            # a rib: an arc of short bone segments sweeping out and down
            prev = Vector((sn * 0.18, y, 0.15))
            for t in range(1, 7):
                a = t / 6 * 2.4
                cur = Vector((sn * (0.18 + math.sin(a) * 0.45), y + 0.05 * t, 0.15 + math.cos(a) * 0.5 - 0.35))
                P.cone(tuple(prev), tuple(cur), 0.05 - t * 0.004, "horn", "s1", segs=6)
                prev = cur
        P.cone((sn * 0.2, 0.0, 0.0), (sn * 0.5, 0.0, 0.05), 0.07, "horn", "s1", segs=6)
    rnd = random.Random(7)
    for k in range(7):
        x, y, z = rnd.uniform(-0.25, 0.25), rnd.uniform(-0.4, 0.4), rnd.uniform(0.2, 0.35)
        P.cone((x, y, z), (x * 2.2, y + rnd.uniform(-0.1, 0.1), z + rnd.uniform(0.25, 0.55)), 0.06, "glow", "s1", segs=4)
    P.finish(seg)
    out.append(clean(seg))
    # tail: tapering vertebrae ending in a crystal blade
    J = {"a": ((0, 0.6, 0.05), (0.18, 0.18)), "m": ((0, 0, 0.05), (0.13, 0.13)), "b": ((0, -0.6, 0.05), (0.05, 0.05))}
    tail = organic("jadebone_tail", J, [("s1", None, "a", "m"), ("s2", "s1", "m", "b")], 32, detail=0.03, scales=0.0, ridge=1.2,
                   colour=dict(belly=0.9, back=0.75, mottle=0.12, seed=32))
    tail.data.materials.clear()
    tail.data.materials.append(K.material("horn"))
    P = K.Parts("tail", tail)
    for k in range(5):
        P.cone((0, -0.5 + k * 0.25, 0.1), (0, -0.4 + k * 0.25, 0.4 - k * 0.04), 0.05, "horn", "s1", segs=5)
    P.cone((0, -0.55, 0.05), (0, -1.6, 0.1), 0.14, "glow", "s2", segs=4)
    P.finish(tail)
    out.append(clean(tail))
    # head: a long skull with deep sockets, a crest of crystal, four bone mandibles
    J = {"neck": ((0, 0.65, 0.05), (0.25, 0.25)), "skull": ((0, 0.05, 0.12), (0.5, 0.42)), "rim": ((0, -0.5, 0.0), (0.42, 0.36))}
    head = organic("jadebone_head", J, [("h1", None, "neck", "skull"), ("h2", "h1", "skull", "rim")], 33, detail=0.04, scales=0.0, ridge=1.4,
                   colour=dict(belly=0.9, back=0.75, mottle=0.12, seed=33))
    head.data.materials.clear()
    head.data.materials.append(K.material("horn"))
    bm = bmesh.new(); bm.from_mesh(head.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().y < -0.62], context="FACES")
    bm.to_mesh(head.data); bm.free()
    P = K.Parts("head", head)
    for sn in (-1, 1):
        # eye sockets: dark hollows with a burning pinpoint
        P.plate((sn * 0.25, -0.25, 0.32), (0.14, 0.14, 0.03), (sn * 0.4, -0.5, 1), "dark", "h1")
        P.eye((sn * 0.25, -0.3, 0.36), 0.05, "h1")
    for k in range(7):
        a = (k - 3) * 0.28
        P.cone((math.sin(a) * 0.2, 0.15 + abs(k - 3) * 0.05, 0.42), (math.sin(a) * 0.45, 0.7, 1.1 - abs(k - 3) * 0.1), 0.07, "glow", "h1", segs=4)
    P.eye((0, 0.0, 0.05), 0.18, "h1")
    P.finish(head)
    out.append(clean(head))
    out.append(shell_petal("jadebone_petal", 1.15, 0.22, 0.25, 0.08, kind="horn", teeth=(4, 0.25, "glow")))
    out.append(node_piece("jadebone_node", 34, crystal=True))
    return out


# =============================================================== SENTINEL --
def sentinel():
    """An ancient machine: armoured rings on a spine of light, thrusters, a shuttered eye."""
    out = []
    parts = []
    core = mesh_object("sentinel_seg", cyl(0.36, 0.36, -0.6, 0.6, segs=8), "metal")
    for y in (-0.45, 0.0, 0.45):
        parts.append(mesh_object("r", ring(0.44, 0.07, y, segs=8), "metal"))
    parts.append(mesh_object("g", ring(0.4, 0.025, -0.22, segs=24), "glow"))
    parts.append(mesh_object("g", ring(0.4, 0.025, 0.22, segs=24), "glow"))
    # armour plates and thruster nozzles
    for k in range(8):
        a = k / 8 * TAU + TAU / 16
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1)
        for v in bm.verts:
            v.co = Vector((v.co.x * 0.28, v.co.y * 0.36, v.co.z * 0.06))
        bmesh.ops.transform(bm, verts=bm.verts, matrix=Matrix.Translation((math.cos(a) * 0.47, -0.22, math.sin(a) * 0.47)) @ Vector((0, 0, 1)).rotation_difference(Vector((math.cos(a), 0, math.sin(a)))).to_matrix().to_4x4())
        parts.append(mesh_object("p", bm, "dark"))
    for sn in (-1, 1):
        parts.append(mesh_object("n", cyl(0.06, 0.1, 0.25, 0.6, segs=12, x=sn * 0.5, z=-0.1), "metal"))
        parts.append(mesh_object("ng", cyl(0.05, 0.05, 0.58, 0.62, segs=12, x=sn * 0.5, z=-0.1), "glow"))
    seg = join(parts, core)
    out.append(clean(seg))
    # tail: an engine cluster
    parts = []
    tail = mesh_object("sentinel_tail", cyl(0.36, 0.2, -0.6, 0.6, segs=8), "metal")
    for k in range(5):
        a = k / 5 * TAU
        parts.append(mesh_object("e", cyl(0.12, 0.16, -0.95, -0.55, segs=12, x=math.cos(a) * 0.15, z=math.sin(a) * 0.15), "dark"))
        parts.append(mesh_object("eg", cyl(0.1, 0.1, -0.97, -0.94, segs=12, x=math.cos(a) * 0.15, z=math.sin(a) * 0.15), "glow"))
    parts.append(mesh_object("r", ring(0.4, 0.06, 0.3, segs=8), "metal"))
    out.append(clean(join(parts, tail)))
    # head: an angular wedge, a great eye behind the shutters, antennae
    parts = []
    head = mesh_object("sentinel_head", cyl(0.42, 0.62, 0.7, -0.55, segs=6), "metal")
    bm = bmesh.new(); bm.from_mesh(head.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().y < -0.5], context="FACES")
    bm.to_mesh(head.data); bm.free()
    parts.append(mesh_object("eye", cyl(0.5, 0.5, -0.1, 0.0, segs=32), "dark"))
    e = bmesh.new()
    bmesh.ops.create_uvsphere(e, u_segments=24, v_segments=16, radius=0.3)
    bmesh.ops.translate(e, verts=e.verts, vec=(0, -0.15, 0))
    parts.append(mesh_object("eyeball", e, "eye"))
    parts.append(mesh_object("rim", ring(0.6, 0.06, -0.55, segs=6), "glow"))
    for sn in (-1, 1):
        parts.append(mesh_object("ant", cyl(0.03, 0.01, 0.2, 1.6, segs=6, x=sn * 0.35, z=0.45), "metal"))
        parts.append(mesh_object("fin", cyl(0.05, 0.02, -0.3, 0.7, segs=4, x=sn * 0.65, z=0.0), "dark"))
    out.append(clean(join(parts, head)))
    # shutter blade (six around the eye)
    bm = bmesh.new()
    pts = [(-0.28, 0), (0.28, 0), (0.12, -0.62), (-0.05, -0.66)]
    vt = [bm.verts.new((x, y, 0.025)) for x, y in pts]
    vb = [bm.verts.new((x, y, -0.025)) for x, y in pts]
    bm.faces.new(vt); bm.faces.new(list(reversed(vb)))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((vt[j], vt[i], vb[i], vb[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    out.append(mesh_object("sentinel_petal", bm, "dark"))
    # node: an exposed reactor
    parts = []
    node = mesh_object("sentinel_node", cyl(0.22, 0.28, -0.1, 0.25, segs=12), "metal")
    g = bmesh.new()
    bmesh.ops.create_uvsphere(g, u_segments=16, v_segments=10, radius=0.24)
    bmesh.ops.translate(g, verts=g.verts, vec=(0, 0, 0.35))
    bmesh.ops.rotate(g, verts=g.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(0, 3, "X"))
    parts.append(mesh_object("core", g, "glow"))
    parts.append(mesh_object("cage", ring(0.3, 0.03, 0.0, segs=12), "metal"))
    n = join(parts, node)
    # stand it up: the node's "up" is +z like the organic ones
    for v in n.data.vertices:
        v.co = Vector((v.co.x, v.co.z, v.co.y)) if False else v.co
    out.append(clean(n))
    return out


VARIANTS = {"devourer": devourer, "leviathan": leviathan, "skywyrm": skywyrm, "jadebone": jadebone, "sentinel": sentinel}


def preview(pieces, path, name):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x, scene.render.resolution_y = 1200, 500
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.16, 0.17, 0.2, 1)
    scene.world = w
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (0.9, 0.2, 2.4)
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    # head, three segments and the tail in a row, angled, so the creature reads
    order = [p for p in pieces if p.name.endswith("_head")] + [p for p in pieces if p.name.endswith("_seg")] + [p for p in pieces if p.name.endswith("_tail")]
    head = order[0]
    seg = [p for p in pieces if p.name.endswith("_seg")][0]
    copies = []
    for i in range(3):
        c = seg.copy()
        c.data = seg.data
        bpy.context.scene.collection.objects.link(c)
        c.location = (0, 1.25 + i * 1.15, 0)
        copies.append(c)
    head.location = (0, 0, 0)
    tail = [p for p in pieces if p.name.endswith("_tail")][0]
    tail.location = (0, 1.25 + 3 * 1.15, 0)
    others = [p for p in pieces if p not in (head, seg, tail)]
    for i, o in enumerate(others):
        o.location = (3 + i * 1.6, 2, 0)
    seg.location = (-3, 2, 0)
    cam.location = (7, -5, 4.5)
    cam.rotation_euler = (Vector((0.5, 2.5, 0)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(path, f"we-{name}.png")
    bpy.ops.render.render(write_still=True)
    for c in copies:
        bpy.data.objects.remove(c, do_unlink=True)


os.makedirs(args.out, exist_ok=True)
for name, fn in VARIANTS.items():
    if args.only and name not in args.only.split(","):
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    K.MATS.clear()
    pieces = fn()
    if args.preview:
        preview(pieces, args.preview, name)
    for p in pieces:
        p.location = (0, 0, 0)
    bpy.ops.object.select_all(action="DESELECT")
    for p in pieces:
        p.select_set(True)
    out = os.path.join(args.out, f"{name}.glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                              export_animations=False, export_vertex_color="ACTIVE")
    print("EXPORTED", name, os.path.getsize(out), [(p.name, len(p.data.vertices)) for p in pieces])
