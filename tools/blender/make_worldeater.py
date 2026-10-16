"""The World-Eater: a serpent leviathan big enough to coil around a planet.

Run headless:
  blender -b --factory-startup --python tools/blender/make_worldeater.py -- --out public/models/worldeater.glb --preview previews/

It is a kit of rigid pieces the game strings along a path (a 20 km skinned mesh
would be fragile): we_head (skull, origin at the neck, the open maw facing -y),
we_petal (one of the four jaw petals, origin at its hinge, laid along -y),
we_seg (a body segment one unit long, radius ~0.45), we_tail and we_node (a glowing
weak-point growth). Materials hide/dark/horn/glow are tinted per boss by the game.
"""
import argparse
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import beastkit as K  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--preview", default="")
args = ap.parse_args(argv)
bpy.ops.wm.read_factory_settings(use_empty=True)
K.MATS.clear()


def body(name, joints, bones, seed, detail=0.03, scales=0.016, colour=None, extra=()):
    desc = {"joints": joints, "bones": bones, "extra": list(extra), "root_joint": bones[0][2]}
    ob = K.build_body(name, desc, subdiv=3, detail=detail, seed=seed, ridge=0.8, scales=scales, scale_size=14)
    K.colour(ob, **(colour or dict(belly=0.65, back=0.2, mottle=0.22, seed=seed, stripes=0.12)))
    return ob


def clean(ob):
    for vg in list(ob.vertex_groups):
        ob.vertex_groups.remove(vg)
    return ob


# ---------------------------------------------------------------- segment --
J = {"a": ((0, 0.62, 0), (0.43, 0.41)), "m": ((0, 0, 0.02), (0.47, 0.45)), "b": ((0, -0.62, 0), (0.43, 0.41)),
     "rib_l": ((0.34, 0, -0.05), (0.18, 0.22)), "rib_r": ((-0.34, 0, -0.05), (0.18, 0.22))}
seg = body("we_seg", J, [("s1", None, "a", "m"), ("s2", "s1", "m", "b")], 5, extra=[("m", "rib_l"), ("m", "rib_r")])
P = K.Parts("we_seg", seg)
# a great dorsal spine, armour scutes over the back, a ring of smaller spines on the flanks
P.cone((0, 0.05, 0.42), (0, 0.32, 1.05), 0.12, "dark", "s1", segs=7, curve=0.25, side=(0, 1, 0), snap=True)
for k in range(5):
    a = math.pi * (0.2 + k * 0.15)
    P.plate((math.cos(a) * 0.46, -0.1, math.sin(a) * 0.44), (0.14, 0.32, 0.04), (math.cos(a), 0, math.sin(a)), "dark", "s1")
for sn in (-1, 1):
    for k in range(3):
        P.cone((sn * 0.45, -0.3 + k * 0.3, 0.05), (sn * 0.72, -0.2 + k * 0.3, 0.12), 0.05, "horn", "s1", segs=5, curve=0.2, side=(0, 1, 0), snap=True)
    # bioluminescent pores along the flanks
    for k in range(4):
        P.eye((sn * 0.44, -0.4 + k * 0.27, -0.12), 0.03, "s1")
P.finish(seg)
clean(seg)

# ---------------------------------------------------------------- tail --
J = {"a": ((0, 0.62, 0), (0.4, 0.38)), "m": ((0, 0, 0), (0.32, 0.3)), "b": ((0, -0.62, 0), (0.06, 0.06))}
tail = body("we_tail", J, [("s1", None, "a", "m"), ("s2", "s1", "m", "b")], 6)
P = K.Parts("we_tail", tail)
# a fan of fin-blades with glowing edges
for k in range(5):
    a = (k - 2) * 0.35
    P.plate((math.sin(a) * 0.35, -0.75, math.cos(a) * 0.35), (0.08, 0.6, 0.02), (math.sin(a), 0, math.cos(a)), "dark", "s2", snap=False)
    P.plate((math.sin(a) * 0.62, -1.15, math.cos(a) * 0.62), (0.02, 0.25, 0.012), (math.sin(a), 0, math.cos(a)), "glow", "s2", snap=False, bevel=False)
P.finish(tail)
clean(tail)

# ---------------------------------------------------------------- head --
J = {"neck": ((0, 0.75, 0), (0.48, 0.46)), "skull": ((0, 0.1, 0.06), (0.58, 0.56)), "rim": ((0, -0.45, 0.02), (0.6, 0.58)),
     "brow_l": ((0.3, -0.1, 0.4), (0.18, 0.12)), "brow_r": ((-0.3, -0.1, 0.4), (0.18, 0.12))}
head = body("we_head", J, [("h1", None, "neck", "skull"), ("h2", "h1", "skull", "rim")], 7, detail=0.04,
            extra=[("skull", "brow_l"), ("skull", "brow_r")])
# hollow the front: delete faces in front of the rim so the maw is open
bm = bmesh.new()
bm.from_mesh(head.data)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().y < -0.62], context="FACES")
bm.to_mesh(head.data)
bm.free()
P = K.Parts("we_head", head)
for sn in (-1, 1):
    # rows of burning eyes along the brow, and swept horns
    for k in range(4):
        P.eye((sn * (0.36 + k * 0.05), -0.3 + k * 0.12, 0.4 - k * 0.04), 0.06 - k * 0.008, "h1")
    P.cone((sn * 0.32, 0.0, 0.45), (sn * 0.95, 0.9, 1.0), 0.1, "dark", "h1", segs=7, curve=0.35, side=(0, 1, 0), snap=True)
    P.cone((sn * 0.45, 0.25, 0.2), (sn * 1.05, 0.95, 0.35), 0.07, "dark", "h1", segs=6, curve=0.3, side=(0, 1, 0), snap=True)
# the throat: a ring of inward teeth and a glowing core deep inside
for ring, (r, n, y) in enumerate(((0.5, 22, -0.55), (0.38, 16, -0.35), (0.25, 12, -0.15))):
    for k in range(n):
        a = k / n * math.tau + ring * 0.13
        base = Vector((math.cos(a) * r, y, math.sin(a) * r))
        tip = Vector((math.cos(a) * r * 0.55, y + 0.12, math.sin(a) * r * 0.55))
        P.cone(tuple(base), tuple(tip), 0.03, "horn", "h1", segs=5)
P.eye((0, 0.1, 0.02), 0.2, "h1")
P.finish(head)
clean(head)

# ---------------------------------------------------------------- petal --
# one jaw petal: a curved armoured shell, hinged at the origin, reaching forward (-y) and in to the axis
bm = bmesh.new()
rows, cols = 6, 7
grid = []
for i in range(rows + 1):
    t = i / rows
    row = []
    for j in range(cols + 1):
        u = (j / cols - 0.5) * 2
        w = (1 - t * 0.8) * 0.55
        x = u * w
        y = -t * 1.1
        z = 0.05 + math.sin(t * math.pi * 0.9) * 0.18 - abs(u) * 0.12 * (1 - t)
        row.append(bm.verts.new((x, y, z)))
    grid.append(row)
for i in range(rows):
    for j in range(cols):
        bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))
bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=0.06)
me = bpy.data.meshes.new("we_petal")
bm.to_mesh(me)
bm.free()
petal = bpy.data.objects.new("we_petal", me)
bpy.context.scene.collection.objects.link(petal)
me.materials.append(K.material("dark"))
for p in me.polygons:
    p.use_smooth = True
P = K.Parts("we_petal", None)
for j in range(9):
    u = (j / 8 - 0.5) * 2
    for t in (0.35, 0.6, 0.85):
        w = (1 - t * 0.8) * 0.55
        P.cone((u * w * 0.9, -t * 1.1, 0.02), (u * w * 0.7, -t * 1.1 - 0.02, -0.22 + t * 0.05), 0.035 * (1.2 - t * 0.5), "horn", "p", segs=5)
P.finish(petal)
clean(petal)

# ---------------------------------------------------------------- node --
J = {"a": ((0, 0, -0.1), (0.2, 0.2)), "b": ((0, 0, 0.25), (0.28, 0.28))}
node = body("we_node", J, [("n1", None, "a", "b")], 9, detail=0.05, scales=0.0)
node.data.materials.clear()
node.data.materials.append(K.material("glow"))
P = K.Parts("we_node", node)
rnd = random.Random(2)
for k in range(9):
    a = k / 9 * math.tau
    P.cone((math.cos(a) * 0.22, math.sin(a) * 0.22, 0.05), (math.cos(a) * 0.45, math.sin(a) * 0.45, 0.4 + rnd.random() * 0.25), 0.06, "horn", "n1", segs=5)
P.finish(node)
clean(node)

pieces = [seg, tail, head, petal, node]
for i, ob in enumerate(pieces):
    ob.location = (i * 3.2 - 6, 0, 0)

if args.preview:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x, scene.render.resolution_y = 1100, 520
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
    cam.location = (0, -12, 4)
    cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(args.preview, "worldeater-kit.png")
    bpy.ops.render.render(write_still=True)

for ob in pieces:
    ob.location = (0, 0, 0)
bpy.ops.object.select_all(action="DESELECT")
for ob in pieces:
    ob.select_set(True)
os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=args.out, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                          export_animations=False, export_vertex_color="ACTIVE")
print("EXPORTED", args.out, os.path.getsize(args.out), [ (o.name, len(o.data.vertices)) for o in pieces])
