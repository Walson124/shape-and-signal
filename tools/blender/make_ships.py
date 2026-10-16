"""Build the five player ships and export them to one .glb.

Run headless:
  blender -b --factory-startup --python tools/blender/make_ships.py -- --out public/models/ships.glb --preview previews/

Each ship is a root empty "ship<tier>" holding four merged meshes (hull, dark,
glass, neon: the game recolours the neon and textures the hull), a "gear"
mesh for the landing gear, and "engine_<n>" empties where exhaust flames go
(custom property "radius"). Sizes match the old code-built ships, so collision
and landing are unchanged (the game still scales by tier).
"""
import argparse
import math
import os
import random
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shipkit as K  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--preview", default="")
ap.add_argument("--only", default="")
args = ap.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)


def root(name):
    r = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(r)
    return r


def mirror(fn):
    for s in (-1, 1):
        fn(s)


def gear_legs(r, legs, length=2.6):
    g = root(f"{r.name}_gear")
    g.parent = r
    for i, (x, z) in enumerate(legs):
        K.lathe(f"{r.name}_leg{i}", [(0.16, 0), (0.14, length * 0.6), (0.18, length * 0.62), (0.18, length)], x, -0.6, z, "dark", parent=g, axis="y" if False else "z")
        # legs run downwards: rebuild as a vertical strut
        ob = bpy.data.objects[f"{r.name}_leg{i}"]
        bpy.data.objects.remove(ob, do_unlink=True)
        K.box(f"{r.name}_strut{i}", 0.26, length, 0.32, x, -0.6 - length / 2, z, "dark", parent=g, bevel=0.06)
        K.box(f"{r.name}_foot{i}", 1.0, 0.22, 1.2, x, -0.6 - length, z, "dark", parent=g, bevel=0.08)
    g["kind"] = "gear"
    return g


# ---------------------------------------------------------------- ships --
def skyjet():
    r = root("ship0")
    engines = []
    K.loft("s0_body", [
        (-9.2, 0, 0, 0.05, 2, 0),
        (-8.0, 0.45, 0.32, 0.05, 2.2, 0.2),
        (-5.5, 1.05, 0.72, 0.15, 2.4, 0.3),
        (-2.0, 1.4, 1.0, 0.25, 2.6, 0.35),
        (2.0, 1.45, 1.0, 0.2, 2.8, 0.35),
        (5.5, 1.15, 0.85, 0.1, 2.8, 0.3),
        (7.0, 1.0, 0.8, 0.0, 2.6, 0.2),
    ], parent=r)
    K.loft("s0_canopy", [
        (-5.6, 0, 0, 0.75, 2, 0), (-4.6, 0.55, 0.35, 0.78, 2, 0), (-2.8, 0.72, 0.55, 0.82, 2.2, 0),
        (-0.8, 0.62, 0.42, 0.85, 2.2, 0), (0.6, 0, 0, 0.9, 2, 0)], kind="glass", parent=r, subsurf=1)
    # delta wings with upturned tips
    K.slab("s0_wing", [(0, -4.5), (8.6, 4.0), (7.9, 6.0), (0, 4.0), (-7.9, 6.0), (-8.6, 4.0)], 0.38, y=-0.35, parent=r)
    mirror(lambda s: K.slab(f"s0_tip{s}", [(3.4, 0.0), (6.2, 0.0), (6.1, 1.9), (4.6, 1.5)], 0.14, up=True, parent=r, bevel=0.03) and None)
    for s in (-1, 1):
        tip = bpy.data.objects[f"s0_tip{s}"]
        tip.location = K.P(s * 8.2, -0.2, 0)
        tip.rotation_euler = (0, s * 0.35, 0)
        K.strip(r, f"s0_lead{s}", [(s * 0.9, -0.15, -3.6), (s * 8.4, -0.15, 4.0)])
        # side intakes
        K.loft(f"s0_intake{s}", [(-1.5, 0, 0, 0, 2, 0), (-0.6, 0.38, 0.42, 0, 2.6, 0), (3.5, 0.42, 0.48, 0, 2.8, 0), (4.5, 0.3, 0.35, 0, 2.6, 0)], kind="dark", parent=r, subsurf=1)
        bpy.data.objects[f"s0_intake{s}"].location = K.P(s * 1.35, -0.15, 0)
    K.slab("s0_fin", [(1.5, 0.6), (5.8, 0.6), (6.6, 2.6), (5.0, 2.4)], 0.16, up=True, parent=r, bevel=0.03)
    engine(r, "s0_eng", 0, 0, 5.4, 0.92, 2.6, engines)
    greebles(r, "s0_g", random.Random(1), 4, ((0.5, 0.9), (1.5, 4.5)))
    gear_legs(r, [(0, -5.2), (-1.9, 3.5), (1.9, 3.5)])
    return r


def corvette():
    r = root("ship1")
    engines = []
    K.loft("s1_body", [
        (-9.0, 0, 0, 0.0, 2, 0), (-7.6, 0.6, 0.4, 0.05, 2.3, 0.2), (-4.8, 1.5, 0.95, 0.15, 2.8, 0.35),
        (-0.5, 1.9, 1.1, 0.2, 3.2, 0.4), (4.0, 1.9, 1.05, 0.15, 3.2, 0.4), (7.0, 1.6, 0.9, 0.05, 3.0, 0.3)], parent=r)
    K.loft("s1_canopy", [(-5.4, 0, 0, 0.7, 2, 0), (-4.4, 0.7, 0.32, 0.82, 2.2, 0), (-2.4, 0.85, 0.45, 0.9, 2.4, 0), (-0.8, 0, 0, 1.0, 2, 0)], kind="glass", parent=r, subsurf=1)
    for s in (-1, 1):
        K.slab(f"s1_wing{s}", [(s * 1.6, -1.5), (s * 5.6, 3.0), (s * 5.2, 5.4), (s * 1.6, 4.6)], 0.36, y=-0.3, parent=r)
        K.slab(f"s1_canard{s}", [(s * 1.4, -6.2), (s * 3.2, -5.0), (s * 3.0, -4.3), (s * 1.4, -4.6)], 0.16, y=0.1, parent=r, bevel=0.03)
        K.box(f"s1_spine{s}", 0.35, 0.22, 5.5, s * 1.0, 1.15, 0.8, "dark", parent=r)
        K.strip(r, f"s1_lead{s}", [(s * 1.7, -0.12, -1.3), (s * 5.5, -0.12, 3.1)])
        K.slab(f"s1_fin{s}", [(1.5, 0.7), (5.2, 0.7), (6.0, 2.3), (4.6, 2.1)], 0.14, up=True, parent=r, bevel=0.03)
        fin = bpy.data.objects[f"s1_fin{s}"]
        fin.location = K.P(s * 1.3, 0, 0)
        fin.rotation_euler = (0, s * 0.3, 0)
        engine(r, f"s1_eng{s}", s * 1.75, -0.05, 4.9, 0.8, 2.6, engines)
    greebles(r, "s1_g", random.Random(2), 4, ((0.4, 0.8), (1.0, 4.0)))
    gear_legs(r, [(0, -5.0), (-2.5, 3.6), (2.5, 3.6)])
    return r


def frigate():
    r = root("ship2")
    engines = []
    K.loft("s2_body", faceted=True, n=8, sections=[
        (-11.4, 0, 0, -0.2, 2, 0), (-10.0, 1.4, 0.8, -0.15, 2.4, 0.3), (-6.5, 3.0, 1.55, 0.0, 3.0, 0.4),
        (-1.0, 3.4, 1.65, 0.0, 3.4, 0.45), (5.0, 3.3, 1.6, 0.0, 3.4, 0.45), (9.0, 2.8, 1.4, 0.0, 3.0, 0.4), (10.4, 2.5, 1.2, 0.0, 2.8, 0.3)], parent=r)
    K.loft("s2_bridge", faceted=True, n=8, sections=[(-5.8, 0, 0, 1.6, 2, 0), (-4.8, 1.6, 0.6, 1.8, 2.6, 0.2), (-1.0, 2.4, 0.85, 1.9, 3, 0.2), (4.5, 2.3, 0.8, 1.85, 3, 0.2), (6.0, 1.8, 0.6, 1.7, 2.6, 0.2)], parent=r)
    K.box("s2_window", 3.4, 0.38, 0.3, 0, 2.35, -4.95, "glass", parent=r, rot=(0.5, 0, 0))
    for s in (-1, 1):
        # armoured flank plates and engine pods on pylons
        K.slab(f"s2_flank{s}", [(s * 3.0, -7.0), (s * 3.9, -4.0), (s * 3.9, 7.5), (s * 3.0, 9.0)], 0.6, y=0.1, parent=r, bevel=0.08)
        K.slab(f"s2_pylon{s}", [(s * 3.2, -0.5), (s * 5.4, 1.0), (s * 5.4, 6.0), (s * 3.2, 7.0)], 0.4, y=-0.2, parent=r)
        engine(r, f"s2_eng{s}", s * 5.6, -0.2, 0.4, 1.15, 6.6, engines)
        K.strip(r, f"s2_line{s}", [(s * 3.95, 0.4, -6.0), (s * 3.95, 0.4, 7.0)])
        K.windows(r, f"s2_win{s}", [(s * 3.42, 0.55, -7.5 + i * 1.3) for i in range(9)])
    K.slab("s2_fin", [(3.5, 1.7), (8.5, 1.7), (9.2, 4.2), (7.0, 3.9)], 0.2, up=True, parent=r, bevel=0.04)
    greebles(r, "s2_g", random.Random(3), 8, ((0.9, 2.4), (6.6, 9.4)))
    greebles(r, "s2_g2", random.Random(13), 6, ((2.4, 2.9), (-3.5, 4.5)))
    gear_legs(r, [(-0.9, -6.0), (0.9, -6.0), (-1.9, 5.0), (1.9, 5.0)])
    return r


def cruiser():
    r = root("ship3")
    engines = []
    # a wide armoured wedge in two layers
    K.slab("s3_lower", [(-0.9, -11.5), (0.9, -11.5), (8.6, -3.0), (10.2, 5.0), (7.0, 8.6), (-7.0, 8.6), (-10.2, 5.0), (-8.6, -3.0)], 1.9, y=0, parent=r, taper=0.55, bevel=0.12)
    K.slab("s3_upper", [(-0.6, -8.5), (0.6, -8.5), (6.2, -1.5), (7.2, 5.5), (5.0, 7.8), (-5.0, 7.8), (-7.2, 5.5), (-6.2, -1.5)], 1.2, y=1.35, parent=r, taper=0.5, bevel=0.1)
    K.loft("s3_tower", faceted=True, n=8, sections=[(-3.8, 0, 0, 2.2, 2, 0), (-3.0, 1.6, 0.8, 2.5, 2.6, 0.2), (1.5, 2.4, 1.1, 2.8, 3, 0.2), (4.5, 2.2, 1.0, 2.7, 3, 0.2), (5.6, 1.6, 0.7, 2.5, 2.6, 0.2)], parent=r)
    K.box("s3_window", 3.6, 0.4, 0.3, 0, 3.2, -3.1, "glass", parent=r, rot=(0.45, 0, 0))
    for s in (-1, 1):
        for i in range(3):
            K.box(f"s3_plate{s}_{i}", 1.6, 0.32, 3.6, s * (4.0 + i * 1.5), 2.05, 0.5 + i * 0.6, "dark", parent=r, bevel=0.05)
        K.box(f"s3_turret{s}", 1.2, 0.5, 1.2, s * 3.2, 2.2, -4.2, "dark", parent=r, bevel=0.1)
        K.box(f"s3_barrel{s}", 0.2, 0.2, 2.4, s * 3.2, 2.35, -5.6, "dark", parent=r, bevel=0.03)
        K.strip(r, f"s3_edge{s}", [(s * 0.9, 1.0, -11.3), (s * 8.5, 1.0, -3.0), (s * 10.0, 1.0, 5.0)])
    for x in (-5.7, -1.9, 1.9, 5.7):
        engine(r, f"s3_eng{x}", x, -0.1, 5.2, 0.86, 3.2, engines)
    greebles(r, "s3_g", random.Random(4), 9, ((3.6, 5.8), (-2.5, 5.5)))
    greebles(r, "s3_g2", random.Random(14), 4, ((0.6, 1.4), (5.8, 7.4)))
    for s in (-1, 1):
        K.windows(r, f"s3_win{s}", [(s * 2.42, 2.75, -2.5 + i * 0.9) for i in range(7)])
    gear_legs(r, [(-4.8, -4.8), (4.8, -4.8), (-4.8, 5.0), (4.8, 5.0)])
    return r


def ark():
    r = root("ship4")
    engines = []
    K.loft("s4_spine", faceted=True, n=8, sections=[(-12.0, 0, 0, 0.0, 2, 0), (-10.5, 1.0, 0.8, 0.0, 2.4, 0.2), (-6.0, 2.3, 1.5, 0.1, 3, 0.3),
                        (4.0, 2.3, 1.5, 0.1, 3, 0.3), (10.0, 2.0, 1.3, 0.0, 2.8, 0.3), (11.6, 1.6, 1.0, 0.0, 2.6, 0.2)], parent=r)
    K.loft("s4_bridge", faceted=True, n=8, sections=[(-8.0, 0, 0, 1.4, 2, 0), (-7.0, 1.4, 0.5, 1.6, 2.6, 0.2), (-3.0, 1.9, 0.7, 1.8, 3, 0.2), (0.0, 1.5, 0.5, 1.7, 2.6, 0.2)], parent=r)
    K.box("s4_window", 3.0, 0.36, 0.3, 0, 2.1, -6.9, "glass", parent=r, rot=(0.5, 0, 0))
    for s in (-1, 1):
        K.loft(f"s4_hab{s}", faceted=True, n=10, sections=[(-8.0, 0, 0, 0, 2, 0), (-6.8, 1.4, 1.2, 0, 2.4, 0), (-3.0, 2.05, 1.75, 0, 2.8, 0),
                               (5.0, 2.05, 1.75, 0, 2.8, 0), (8.6, 1.7, 1.5, 0, 2.6, 0), (9.4, 1.2, 1.0, 0, 2.4, 0)], parent=r)
        bpy.data.objects[f"s4_hab{s}"].location = K.P(s * 5.0, 0, 0.6)
        K.windows(r, f"s4_win{s}", [(s * 7.05, 0.2 + row * 0.7, -5.5 + i * 1.2) for row in (0, 1) for i in range(12)])
        K.windows(r, f"s4_win{s}i", [(s * 2.95, 0.4, -5.5 + i * 1.2) for i in range(12)])
        for zz in (-3.8, 4.5):
            K.box(f"s4_strut{s}{zz}", 3.6, 0.6, 1.6, s * 2.9, -0.5, zz, "hull", parent=r, bevel=0.1)
        K.strip(r, f"s4_line{s}", [(s * 7.05, 0.6, -6.5), (s * 7.05, 0.6, 8.0)])
    # the exposed drive hoop
    K.lathe("s4_hoop", [(3.0, -0.4), (3.6, -0.4), (3.6, 0.4), (3.0, 0.4), (3.0, -0.4)], 0, 1.4, 2.0, "dark", parent=r, n=48)
    K.lathe("s4_hoopglow", [(3.62, -0.08), (3.7, 0.0), (3.62, 0.08)], 0, 1.4, 2.0, "neon", parent=r, n=48)
    for x in (-6, -3.4, -1.1, 1.1, 3.4, 6):
        engine(r, f"s4_eng{x}", x, -0.3, 6.3, 0.75, 3.2, engines)
    greebles(r, "s4_g", random.Random(5), 8, ((0.6, 1.6), (3.0, 9.0)))
    greebles(r, "s4_g2", random.Random(15), 8, ((4.0, 6.0), (-4.0, 6.0)))
    gear_legs(r, [(-4.8, -4.8), (4.8, -4.8), (-4.8, 5.0), (4.8, 5.0)])
    return r


engine, greebles = K.engine, K.greebles
BUILDERS = [skyjet, corvette, frigate, cruiser, ark]
only = [int(x) for x in args.only.split(",")] if args.only else range(5)
ships = [BUILDERS[i]() for i in only]


# ---- merge each ship's parts by material (four draw calls plus the gear), UV the hull
def merge_ship(r):
    dg = bpy.context.evaluated_depsgraph_get()
    gear = next(c for c in r.children if c.get("kind") == "gear")
    groups = {"hull": [], "dark": [], "glass": [], "neon": [], "light": [], "gear": []}
    def collect(o, in_gear):
        for c in o.children:
            if c.type == "MESH":
                groups["gear" if in_gear else c["kind"]].append(c)
            collect(c, in_gear or c == gear)
    collect(r, False)
    for kind, objs in groups.items():
        if not objs:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.convert(target="MESH")
        if len(objs) > 1:
            bpy.ops.object.join()
        m = bpy.context.view_layer.objects.active
        m.name = f"{r.name}_{kind}"
        mat_kind = "dark" if kind == "gear" else kind
        m.data.materials.clear()
        m.data.materials.append(K.material(mat_kind))
        # keep the world transform but hang it off the ship (or gear) root
        mw = m.matrix_world.copy()
        m.parent = gear if kind == "gear" else r
        m.matrix_world = mw
        if kind == "hull":
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.01)
            bpy.ops.object.mode_set(mode="OBJECT")
    print("SHIP", r.name, {k: len(v) for k, v in groups.items()})


for r in ships:
    merge_ship(r)


# ---- previews
def preview(path):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x, scene.render.resolution_y = 900, 560
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.2, 0.24, 0.3, 1)
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4
    sun.rotation_euler = (0.8, 0.3, 0.9)
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    for r in ships:
        for o in ships:
            for c in o.children_recursive:
                c.hide_render = o != r
        for view, (az, el, dist) in {"front": (0.75, 0.32, 34), "rear": (2.6, 0.38, 34)}.items():
            target = Vector((0, 0, 0.5))
            cam.location = target + Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * dist
            cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
            scene.render.filepath = os.path.join(path, f"{r.name}-{view}.png")
            bpy.ops.render.render(write_still=True)
    for o in ships:
        for c in o.children_recursive:
            c.hide_render = False


if args.preview:
    preview(args.preview)

for o in bpy.data.objects:
    o.select_set(any(o == r or o in r.children_recursive for r in ships))
os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=args.out, export_format="GLB", use_selection=True, export_extras=True,
                          export_yup=True, export_apply=True, export_animations=False, export_texcoords=True)
print("EXPORTED", args.out, os.path.getsize(args.out))
