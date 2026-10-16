"""Build the player character with MPFB (MakeHuman for Blender) and export it as a .glb.

Run headless:
  blender -b --factory-startup --python tools/blender/make_character.py -- --out public/models/player.glb --preview previews/

Needs the MPFB extension and the MakeHuman system asset pack (CC0) installed.
Everything it uses is CC0, so the result can ship with the game.
"""
import argparse
import os
import sys

import addon_utils
import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--preview", default="")
ap.add_argument("--tex", type=int, default=1024, help="largest texture size in the export")
ap.add_argument("--ual1", default="", help="Quaternius Universal Animation Library (CC0): AL_Standard.fbx (Unreal Engine folder)")
ap.add_argument("--ual2", default="", help="Quaternius Universal Animation Library 2 (CC0): UAL2_Standard.glb")
ap.add_argument("--poses", default="", help="comma-separated action:frame list to render in the preview")
args = ap.parse_args(argv)

addon_utils.enable("bl_ext.blender_org.mpfb", default_set=True)
from bl_ext.blender_org.mpfb.services.humanservice import HumanService  # noqa: E402

# start from an empty scene
bpy.ops.wm.read_factory_settings(use_empty=True)
addon_utils.enable("bl_ext.blender_org.mpfb", default_set=True)

human = HumanService._create_default_human_info_dict()
human.update({
    "name": "player",
    "phenotype": {
        "gender": 1.0, "age": 0.44, "muscle": 0.74, "weight": 0.42, "proportions": 0.92, "height": 0.62,
        "cupsize": 0.5, "firmness": 0.5,
        "race": {"asian": 0.85, "caucasian": 0.15, "african": 0.0},
    },
    "rig": "game_engine",
    "proxy": "male_generic/male_generic.proxy",
    "skin_mhmat": "young_asian_male/young_asian_male.mhmat",
    "skin_material_type": "MAKESKIN",
    "eyes": "low-poly/low-poly.mhclo",
    "eyes_material_type": "MAKESKIN",
    "eyebrows": "eyebrow001/eyebrow001.mhclo",
    "eyelashes": "eyelashes01/eyelashes01.mhclo",
    "hair": "short04/short04.mhclo",
    # the combat suit is painted onto the body (see suit_textures); only boots go on top
    "clothes": ["shoes03/shoes03.mhclo"],
    "clothes_material_type": "MAKESKIN",
    "alternative_materials": {},
})
settings = HumanService.get_default_deserialization_settings()
settings.update({"subdiv_levels": 0, "override_skin_model": "PRESET", "override_rig": "PRESET"})
basemesh = HumanService.deserialize_from_dict(human, settings)

rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
print("OBJECTS", [(o.name, o.type, len(o.data.vertices) if o.type == "MESH" else 0) for o in bpy.data.objects])


# ---- materials: one plain Principled BSDF per mesh, using the asset's colour texture
# hair, brows and lashes use their texture's alpha (asset names, as the objects are named after them)
CUTOUTS = [os.path.basename(human[k]).split(".")[0] for k in ("hair", "eyebrows", "eyelashes") if human.get(k)]
def find_image(mat):
    if not mat or not mat.use_nodes:
        return None
    best = None
    for n in mat.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image:
            name = (n.label + n.name + n.image.name).lower()
            if any(k in name for k in ("normal", "bump", "rough", "spec", "displ", "ao")):
                continue
            best = best or n.image
            if "diffuse" in name or "color" in name or "albedo" in name:
                return n.image
    return best


def simplify(obj):
    for slot in obj.material_slots:
        old = slot.material
        img = find_image(old)
        mat = bpy.data.materials.new(f"{obj.name}_mat")
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        bsdf.inputs["Roughness"].default_value = 0.6
        bsdf.inputs["Metallic"].default_value = 0.0
        if img:
            if max(img.size) > args.tex:
                k = args.tex / max(img.size)
                img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = img
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
            # hair, brows and lashes are cut-outs: use the texture's alpha
            if any(obj.name.endswith(k) for k in CUTOUTS):
                nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
                mat.blend_method = "HASHED" if hasattr(mat, "blend_method") else mat.blend_method
                mat.surface_render_method = "DITHERED"
        slot.material = mat


# ---- the combat suit: MakeHuman's "special suit" skin, recoloured graphite, on this character's
# own face and neck, with its piping split out as a glow map the game tints with the realm colour
def head_uv_mask(obj, size, groups=("head",)):
    """Pixels of the skin texture used by faces weighted mostly to the given bones (the head by default)."""
    import numpy as np
    w, h = size
    me = obj.data
    me.calc_loop_triangles()
    gis = {obj.vertex_groups[n].index for n in groups if n in obj.vertex_groups}
    def head_w(v):
        return sum(g.weight for g in me.vertices[v].groups if g.group in gis)
    uv = me.uv_layers.active.data
    m = np.zeros((h, w), dtype=np.float32)
    for t in me.loop_triangles:
        if sum(head_w(v) for v in t.vertices) / 3 < 0.5:
            continue
        p = np.array([[uv[l].uv[0] * w, uv[l].uv[1] * h] for l in t.loops])
        x0, y0 = np.floor(p.min(0)).astype(int) - 2
        x1, y1 = np.ceil(p.max(0)).astype(int) + 2
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w - 1), min(y1, h - 1)
        if x1 < x0 or y1 < y0:
            continue
        ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
        a, b, c = p
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-9:
            continue
        l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
        l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
        inside = (l1 >= -0.02) & (l2 >= -0.02) & (1 - l1 - l2 >= -0.02)
        m[y0:y1 + 1, x0:x1 + 1][inside] = 1
    return m


def suit_textures(body):
    import numpy as np
    from bl_ext.blender_org.mpfb.services.assetservice import AssetService
    skins = os.path.dirname(os.path.dirname(AssetService.find_asset_absolute_path(human["skin_mhmat"], "skins")))
    def load(rel):
        img = bpy.data.images.load(os.path.join(skins, rel))
        w, h = img.size
        return np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4), (w, h)
    own, size = load("young_asian_male/young_lightskinned_male_diffuse3.png")
    plain, _ = load("young_caucasian_male/young_lightskinned_male_diffuse.png")
    suit, _ = load("young_caucasian_male_special_suit/young_caucasian_male_special_suit.png")
    # where the suit differs from the plain skin it was painted over, it's suit
    diff = np.abs(suit[..., :3] - plain[..., :3]).max(axis=2)
    mask = (diff > 0.12).astype(np.float32)
    # drop the specks where the painted suit's face differs slightly from the plain skin
    # (shrink the mask, then grow it back: small islands vanish, the suit itself survives)
    def spread(m, n, op):
        for _ in range(n):
            m = op.reduce([m, np.roll(m, 1, 0), np.roll(m, -1, 0), np.roll(m, 1, 1), np.roll(m, -1, 1)])
        return m
    mask = spread(spread(mask, 10, np.minimum), 10, np.maximum)
    # and never on the head
    mask *= 1 - spread(head_uv_mask(body, size), 3, np.maximum)
    # black gloves: the hands are suit too (plain, without piping)
    hand_bones = [f"{b}_{s}" for s in ("l", "r") for b in ["hand"] + [f"{f}_0{i}" for f in ("index", "middle", "ring", "pinky", "thumb") for i in (1, 2, 3)]]
    gloves = spread(head_uv_mask(body, size, hand_bones), 2, np.maximum)[..., None]
    # soften the edge a little (box blur)
    for _ in range(2):
        mask = (mask + np.roll(mask, 1, 0) + np.roll(mask, -1, 0) + np.roll(mask, 1, 1) + np.roll(mask, -1, 1)) / 5
    mask = np.clip((mask - 0.3) * 2.5, 0, 1)[..., None]
    rgb = suit[..., :3]
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    sat = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
    # the orange piping: bright, saturated, red above blue
    lines = ((sat > 0.45) & (mx > 0.35) & (rgb[..., 0] > rgb[..., 2] * 1.6)).astype(np.float32) * mask[..., 0]
    lum = rgb @ np.array([0.3, 0.55, 0.15], dtype=np.float32)
    # graphite with a cool sheen, keeping the folds and seams of the painted suit
    graphite = np.stack([0.035 + lum * 0.28, 0.04 + lum * 0.31, 0.05 + lum * 0.38], axis=2)
    graphite = graphite * (1 - lines[..., None]) + np.array([0.55, 0.62, 0.7], dtype=np.float32) * lines[..., None]
    glove = np.stack([0.03 + own[..., 0] * 0.06, 0.032 + own[..., 1] * 0.06, 0.04 + own[..., 2] * 0.07], axis=2)
    out = own.copy()
    out[..., :3] = own[..., :3] * (1 - mask) + graphite * mask
    out[..., :3] = out[..., :3] * (1 - gloves) + glove * gloves
    glow = np.zeros_like(own)
    glow[..., :3] = lines[..., None] * (1 - gloves)
    glow[..., 3] = 1
    def make(name, arr):
        img = bpy.data.images.new(name, size[0], size[1], alpha=False)
        img.pixels.foreach_set(arr.ravel())
        img.pack()
        return img
    return make("suit_color", out), make("suit_glow", glow)


body = next(o for o in meshes if o.name.endswith(os.path.basename(human["proxy"]).split(".")[0]))
SUIT, GLOW = suit_textures(body)
for o in meshes:
    simplify(o)
# the body wears the suit: colour plus a glow map on the piping
for slot in body.material_slots:
    nt = slot.material.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = next((n for n in nt.nodes if n.type == "TEX_IMAGE"), None) or nt.nodes.new("ShaderNodeTexImage")
    tex.image = SUIT
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    glow = nt.nodes.new("ShaderNodeTexImage")
    glow.image = GLOW
    nt.links.new(glow.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.42
    bsdf.inputs["Metallic"].default_value = 0.15
    slot.material.name = "suit"
    for img in (SUIT, GLOW):
        if max(img.size) > args.tex:
            img.scale(args.tex, args.tex)

# ---- animations: retarget the clips the game uses, and build the poses no library has
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import math  # noqa: E402
import retarget as RT  # noqa: E402

UE_BONES = ["pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l",
            "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r", "thigh_l", "calf_l", "foot_l", "ball_l", "thigh_r", "calf_r", "foot_r", "ball_r"]
for side in ("l", "r"):
    for fing in ("index", "middle", "ring", "pinky", "thumb"):
        UE_BONES += [f"{fing}_0{i}_{side}" for i in (1, 2, 3)]
MAPPING = {b: b for b in UE_BONES}
MAPPING["Head"] = "head"

tgt = RT.Target(rig)
made = []


def import_source(path):
    before = set(bpy.data.objects)
    acts_before = set(bpy.data.actions)
    if path.lower().endswith(".fbx"):
        bpy.ops.import_scene.fbx(filepath=path)
    else:
        bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == "ARMATURE")
    return arm, new, [a for a in bpy.data.actions if a not in acts_before]


def clip_name(full):
    return full.split("|")[-1]


sources = []
if args.ual1:
    arm, objs, acts = import_source(args.ual1)
    sources.append((arm, objs, acts, {
        "Idle_Loop": "idle", "Walk_Loop": "walk", "Jog_Fwd_Loop": "jog", "Sprint_Loop": "sprint",
        "Jump_Start": "jump_start", "Jump_Loop": "fall", "Jump_Land": "land",
        "Punch_Jab": "punch_jab", "Punch_Cross": "punch_cross", "Sword_Attack": "sword_heavy", "Sword_Idle": "sword_idle",
        "Spell_Simple_Shoot": "cast", "Spell_Simple_Idle_Loop": "cast_idle", "Roll": "roll",
        "Hit_Chest": "hit", "Death01": "death", "Driving_Loop": "drive", "Swim_Fwd_Loop": "swim", "Swim_Idle_Loop": "swim_idle",
        "Pistol_Shoot": "shoot",
    }))
if args.ual2:
    arm, objs, acts = import_source(args.ual2)
    sources.append((arm, objs, acts, {
        "Idle_FoldArms_Loop": "idle_folded", "Melee_Hook": "punch_hook", "Sword_Regular_A": "sword_a", "Sword_Regular_B": "sword_b",
        "Sword_Regular_C": "sword_c", "Sword_Block": "guard", "NinjaJump_Start": "leap", "NinjaJump_Idle_Loop": "air",
        "NinjaJump_Land": "leap_land", "Hit_Knockback": "knockback", "Consume": "consume", "OverhandThrow": "throw",
    }))
for arm, objs, acts, wanted in sources:
    by_clip = {clip_name(a.name): a.name for a in acts}
    made += RT.retarget(arm, tgt, {by_clip[k]: v for k, v in wanted.items() if k in by_clip}, MAPPING)


# poses built from limb directions (Blender axes: +x the character's left, -y forward, +z up)
def fist(side, amount=1.0):
    """Finger curl for a closed fist on one hand."""
    out = {}
    for fing in ("index", "middle", "ring", "pinky"):
        for i, a in ((1, 1.2), (2, 1.5), (3, 1.0)):
            out[f"{fing}_0{i}_{side}"] = a * amount
    out[f"thumb_02_{side}"] = 0.5 * amount
    out[f"thumb_03_{side}"] = 0.6 * amount
    return out


def mirror(d):
    out = {}
    for k, v in d.items():
        out[k] = v
        if k.endswith("_l"):
            out[k[:-2] + "_r"] = (-v[0], v[1], v[2])
    return out


def looped(name, frames_n, build):
    frames = [build(i / frames_n * 2 * math.pi) for i in range(frames_n + 1)]
    made.append(RT.write_action(rig, name, frames, bpy.context.scene.render.fps))


# cross-legged meditation: hips on the ground, hands resting on the knees, a slow breath
def meditate(t):
    b = 0.02 * math.sin(t)
    return RT.pose_from_directions(tgt, mirror({
        "thigh_l": (0.78, -0.58, -0.12), "calf_l": (-0.86, -0.3, -0.08), "foot_l": (-0.5, -0.1, -0.85),
        "upperarm_l": (0.28, -0.2, -0.94), "lowerarm_l": (0.22, -0.78, -0.58),
        "spine_03": (0, 0.04 - b, 1), "neck_01": (0, -0.05, 1), "head": (0, -0.08, 1),
    }), pelvis_drop=0.76 - b * 0.5)


# hovering: legs hang loose, one knee a little more bent, arms relaxed and slightly out
def hover(t):
    s = math.sin(t)
    d = {
        "thigh_l": (0.06, -0.12 - 0.04 * s, -1), "calf_l": (0.02, 0.18 + 0.05 * s, -1), "foot_l": (0, -0.25, -1),
        "thigh_r": (-0.06, -0.28 + 0.04 * s, -1), "calf_r": (-0.02, 0.4 - 0.05 * s, -1), "foot_r": (0, -0.1, -1),
        "upperarm_l": (0.42 + 0.04 * s, 0.02, -1), "lowerarm_l": (0.3, -0.3, -1),
        "upperarm_r": (-0.42 - 0.04 * s, 0.02, -1), "lowerarm_r": (-0.3, -0.3, -1),
        "head": (0, -0.04, 1),
    }
    return RT.pose_from_directions(tgt, d)


# cruising flight (the game tips the whole body forward): arms swept back, legs together, head up
def cruise(t):
    s = math.sin(t)
    return RT.pose_from_directions(tgt, mirror({
        "upperarm_l": (0.22, 0.2, -1), "lowerarm_l": (0.12, 0.32, -1),
        "thigh_l": (0.05, 0.04 + 0.03 * s, -1), "calf_l": (0.02, 0.16 - 0.03 * s, -1), "foot_l": (0, 0.6, -1),
        "spine_03": (0, 0.1, 1), "neck_01": (0, 0.45, 1), "head": (0, 1.0, 0.85),
    }))


# full speed: one fist driving ahead, the other arm back, body stretched out
def dash(t):
    s = math.sin(t * 2)
    return RT.pose_from_directions(tgt, {
        "upperarm_r": (-0.12, -0.18, 1), "lowerarm_r": (-0.04, -0.12, 1),
        "upperarm_l": (0.22, 0.24, -1), "lowerarm_l": (0.12, 0.34, -1),
        "thigh_l": (0.06, 0.05, -1), "calf_l": (0.02, 0.2 + 0.03 * s, -1), "foot_l": (0, 0.7, -1),
        "thigh_r": (-0.04, 0.0, -1), "calf_r": (-0.02, 0.08 - 0.03 * s, -1), "foot_r": (0, 0.7, -1),
        "spine_03": (0, 0.12, 1), "neck_01": (0, 0.5, 1), "head": (0, 1.1, 0.8),
    }, curl={**fist("r"), **fist("l", 0.45)})


looped("meditate", 96, meditate)
looped("fly_hover", 72, hover)
looped("fly_cruise", 48, cruise)
looped("fly_dash", 24, dash)

# the libraries' own rigs, meshes and clips don't ship
for arm, objs, acts, wanted in sources:
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
    for a in acts:
        bpy.data.actions.remove(a)
# bind every clip to the character once: the exporter only takes actions with a slot for this rig
rig.animation_data_create()
for act in made:
    rig.animation_data.action = act
    if hasattr(rig.animation_data, "action_slot") and getattr(act, "slots", None) and len(act.slots):
        rig.animation_data.action_slot = act.slots[0]
rig.animation_data.action = None
print("ACTIONS", [a.name for a in made])

# first-person arms: a copy of the suited body with everything but the arms cut away,
# so the view model never shows a shoulder or chest
import bmesh  # noqa: E402
fparms = body.copy()
fparms.data = body.data.copy()
fparms.name = "player.fparms"
bpy.context.scene.collection.objects.link(fparms)
arm_groups = {fparms.vertex_groups[n].index for n in fparms.vertex_groups.keys()
              if any(n.startswith(p) for p in ("upperarm_", "lowerarm_", "hand_", "index_", "middle_", "ring_", "pinky_", "thumb_"))}
bm = bmesh.new()
bm.from_mesh(fparms.data)
deform = bm.verts.layers.deform.verify()
drop = [v for v in bm.verts if sum(w for g, w in v[deform].items() if g in arm_groups) < 0.5]
bmesh.ops.delete(bm, geom=drop, context="VERTS")
bm.to_mesh(fparms.data)
bm.free()
meshes.append(fparms)
print("FPARMS verts", len(fparms.data.vertices))

# the full-resolution body is only used to fit the proxy and clothes; it doesn't ship
export = [rig] + [o for o in meshes if o != basemesh]
for o in bpy.data.objects:
    o.select_set(o in export)
    o.hide_render = o not in export
bpy.context.view_layer.objects.active = rig


# ---- previews: front and side, so the result can be checked without opening Blender
def preview(path):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x, scene.render.resolution_y = 700, 900
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.32, 0.34, 0.38, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.9
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (0.9, 0.2, 0.6)
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 60
    scene.collection.objects.link(cam)
    scene.camera = cam
    import math
    from mathutils import Vector
    top = max((o.matrix_world @ Vector(c)).z for o in meshes if o != basemesh for c in o.bound_box)
    shots = [("front", 0, None, 0), ("side", math.pi / 2, None, 0), ("face", 0, None, 0)]
    for item in filter(None, args.poses.split(",")):
        an, fr = item.split(":")
        shots += [(f"{an}-{fr}", math.pi / 2.6, an, int(fr))]
    rig.animation_data_create()
    for name, ang, an, fr in shots:
        rig.animation_data.action = bpy.data.actions.get(an) if an else None
        act = rig.animation_data.action
        if act is not None and hasattr(rig.animation_data, "action_slot") and getattr(act, "slots", None) and len(act.slots):
            rig.animation_data.action_slot = act.slots[0]
        if not an:
            for pb in rig.pose.bones:
                pb.rotation_quaternion = (1, 0, 0, 0)
                pb.location = (0, 0, 0)
        scene.frame_set(fr or 1)
        d = 1.6 if name == "face" else 5.2
        z = top - 0.12 if name == "face" else top * 0.52
        cam.location = (math.sin(ang) * -d, -math.cos(ang) * d, z)
        cam.rotation_euler = (math.pi / 2, 0, -ang)
        scene.render.filepath = os.path.join(path, f"char-{name}.png")
        bpy.ops.render.render(write_still=True)
    rig.animation_data.action = None
    print("HEIGHT", round(top, 3))


if args.preview:
    preview(args.preview)

os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=args.out, export_format="GLB", use_selection=True,
    export_skins=True, export_animations=bool(made), export_animation_mode="ACTIONS", export_morph=False,
    export_force_sampling=True, export_optimize_animation_size=True, export_frame_step=1,
    export_image_format="WEBP", export_yup=True, export_apply=True,
)
print("EXPORTED", args.out, os.path.getsize(args.out))
