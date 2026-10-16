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
        "gender": 1.0, "age": 0.5, "muscle": 0.62, "weight": 0.48, "proportions": 0.6, "height": 0.55,
        "cupsize": 0.5, "firmness": 0.5,
        "race": {"asian": 0.75, "caucasian": 0.2, "african": 0.05},
    },
    "rig": "game_engine",
    "proxy": "male_generic/male_generic.proxy",
    "skin_mhmat": "young_asian_male/young_asian_male.mhmat",
    "skin_material_type": "MAKESKIN",
    "eyes": "low-poly/low-poly.mhclo",
    "eyes_material_type": "MAKESKIN",
    "eyebrows": "eyebrow001/eyebrow001.mhclo",
    "eyelashes": "eyelashes01/eyelashes01.mhclo",
    "hair": "short02/short02.mhclo",
    "clothes": ["male_casualsuit01/male_casualsuit01.mhclo", "shoes06/shoes06.mhclo"],
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


for o in meshes:
    simplify(o)

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
    for name, ang in (("front", 0), ("side", math.pi / 2), ("face", 0)):
        d = 1.6 if name == "face" else 5.2
        z = top - 0.12 if name == "face" else top * 0.52
        cam.location = (math.sin(ang) * -d, -math.cos(ang) * d, z)
        cam.rotation_euler = (math.pi / 2, 0, -ang)
        scene.render.filepath = os.path.join(path, f"char-{name}.png")
        bpy.ops.render.render(write_still=True)
    print("HEIGHT", round(top, 3))


if args.preview:
    preview(args.preview)

os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=args.out, export_format="GLB", use_selection=True,
    export_skins=True, export_animations=False, export_morph=False,
    export_image_format="WEBP", export_yup=True, export_apply=True,
)
print("EXPORTED", args.out, os.path.getsize(args.out))
