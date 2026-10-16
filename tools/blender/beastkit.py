"""Creature building kit: a skeleton becomes an armature and a skinned, sculpted body.

A creature is described in Blender axes (x = its left, -y = forward, z = up), at unit
scale: the game multiplies by the species radius. A description has:
  joints: {name: ((x, y, z), (radius_side, radius_up))}
  bones:  [(name, parent_or_None, head_joint, tail_joint)]
Parts (teeth, claws, spikes, plates, horns, eyes) are added on top, each rigidly bound
to one bone. Materials: hide (vertex-coloured, tinted by the game), horn, glow, eye.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

MATS = {}


def material(kind):
    if kind in MATS:
        return MATS[kind]
    m = bpy.data.materials.new(kind)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    if kind == "hide":
        attr = nt.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "Col"
        nt.links.new(attr.outputs["Color"], b.inputs["Base Color"])
        b.inputs["Roughness"].default_value = 0.72
    elif kind == "dark":
        b.inputs["Base Color"].default_value = (0.06, 0.065, 0.075, 1)
        b.inputs["Metallic"].default_value = 0.55
        b.inputs["Roughness"].default_value = 0.4
    elif kind == "stone":
        b.inputs["Base Color"].default_value = (0.32, 0.3, 0.28, 1)
        b.inputs["Roughness"].default_value = 0.9
    elif kind == "horn":
        b.inputs["Base Color"].default_value = (0.78, 0.72, 0.62, 1)
        b.inputs["Roughness"].default_value = 0.38
    elif kind in ("glow", "eye"):
        b.inputs["Base Color"].default_value = (1, 0.5, 0.2, 1)
        b.inputs["Emission Color"].default_value = (1, 0.5, 0.2, 1)
        b.inputs["Emission Strength"].default_value = 4.0
    MATS[kind] = m
    return m


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


# ------------------------------------------------------------- skeleton --
def build_armature(name, desc):
    arm = bpy.data.armatures.new(name)
    ob = link(bpy.data.objects.new(name, arm))
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    J = desc["joints"]
    for bn, parent, h, t in desc["bones"]:
        eb = arm.edit_bones.new(bn)
        eb.head = Vector(J[h][0])
        eb.tail = Vector(J[t][0])
        d = (eb.tail - eb.head).normalized()
        # roll: local X is always the creature's side axis, so X rotations pitch every bone
        eb.align_roll(Vector((0, -1, 0)) if abs(d.z) > 0.7 else Vector((0, 0, 1)))
        if parent:
            eb.parent = arm.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in ob.pose.bones:
        pb.rotation_mode = "XYZ"
    return ob


def desc_head(desc, bone):
    for bn, parent, h, t in desc["bones"]:
        if bn == bone:
            return h
    return None


# ------------------------------------------------------------------ body --
def build_body(name, desc, *, subdiv=2, detail=0.035, seed=1, ridge=0.0, scales=0.0, scale_size=26.0):
    """Skin-modifier body along the bones, smoothed and roughened."""
    J = desc["joints"]
    names = list(J.keys())
    me = bpy.data.meshes.new(name)
    verts = [J[n][0] for n in names]
    idx = {n: i for i, n in enumerate(names)}
    edges = []
    for bn, parent, h, t in desc["bones"]:
        if desc.get("skinless") and bn in desc["skinless"]:
            continue
        edges.append((idx[h], idx[t]))
    # skin-only links (shoulders and hips into the body, the jaw into the neck)
    for a, b in desc.get("extra", []):
        edges.append((idx[a], idx[b]))
    me.from_pydata(verts, edges, [])
    ob = link(bpy.data.objects.new(name, me))
    skin = ob.modifiers.new("skin", "SKIN")
    skin.use_smooth_shade = True
    sv = me.skin_vertices[0].data
    for n, i in idx.items():
        r = J[n][1]
        sv[i].radius = (r[0], r[1]) if isinstance(r, (tuple, list)) else (r, r)
    # every connected piece of the skeleton needs one root for the skin modifier
    adj = {i: set() for i in range(len(verts))}
    for a, b in edges:
        adj[a].add(b)
        adj[b].add(a)
    seen = set()
    first = idx.get(desc.get("root_joint"), 0)
    for start in [first] + list(range(len(verts))):
        if start in seen or not adj[start]:
            continue
        sv[start].use_root = True
        stack = [start]
        while stack:
            v = stack.pop()
            if v in seen:
                continue
            seen.add(v)
            stack.extend(adj[v] - seen)
    sub = ob.modifiers.new("sub", "SUBSURF")
    sub.levels = sub.render_levels = subdiv
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    # organic detail: lumpy muscle at large scale, scaly grain at small scale
    rnd = random.Random(seed)
    off = Vector((rnd.random() * 100, rnd.random() * 100, rnd.random() * 100))
    me.update()
    for v in me.vertices:
        p = v.co * 3.2 + off
        n = noise.noise(p) * 0.6 + noise.noise(p * 3.1) * 0.3 + noise.noise(p * 9.0) * 0.12
        if ridge:
            # sinew: sharp grooves between muscle masses
            n -= ridge * (1 - abs(noise.noise(p * 2.2))) ** 4
        d = n * detail
        if scales:
            # scale cells: each one domes up, grooves between them
            dist, _pts = noise.voronoi(v.co * scale_size + off)
            edge = dist[1] - dist[0]
            d += scales * (min(edge, 0.5) - 0.25)
        v.co += v.normal * d
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(material("hide"))
    return ob


def cracks(ob, *, width=0.05, freq=4.0, seed=7, coverage=1.0):
    """Glowing fissures: faces lying on thin noise ridges switch to the glow material."""
    me = ob.data
    if "glow" not in [m.name for m in me.materials]:
        me.materials.append(material("glow"))
    gi = [m.name for m in me.materials].index("glow")
    rnd = random.Random(seed)
    off = Vector((rnd.random() * 70, rnd.random() * 70, rnd.random() * 70))
    n = 0
    for p in me.polygons:
        c = p.center * freq + off
        if abs(noise.noise(c)) < width and noise.noise(c * 0.37 + off) > 1 - 2 * coverage:
            p.material_index = gi
            n += 1
    return n


def colour(ob, *, belly=0.55, back=0.32, mottle=0.18, seed=3, stripes=0.0, top_axis=2):
    """Vertex colours (grey: the game tints them): a darker back, paler belly and mottling."""
    me = ob.data
    if "Col" not in me.color_attributes:
        me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    col = me.color_attributes["Col"]
    zs = [v.co.z for v in me.vertices]
    z0, z1 = min(zs), max(zs)
    rnd = random.Random(seed)
    off = Vector((rnd.random() * 50, rnd.random() * 50, rnd.random() * 50))
    vals = []
    for v in me.vertices:
        up = max(0.0, min(1.0, (v.co.z - z0) / max(1e-6, z1 - z0)))
        nz = v.normal.z
        base = belly + (back - belly) * max(0.0, min(1.0, nz * 0.7 + 0.5))
        m = noise.noise(v.co * 6 + off) * mottle + noise.noise(v.co * 18 + off) * mottle * 0.5
        if stripes:
            m += stripes * max(0.0, math.sin(v.co.y * 18 + noise.noise(v.co * 3) * 2))
        g = max(0.04, min(1.0, base + m - 0.08 * (1 - up)))
        vals.append(g)
    for poly in me.polygons:
        for li in poly.loop_indices:
            g = vals[me.loops[li].vertex_index]
            col.data[li].color = (g, g, g * 1.02, 1)


# ----------------------------------------------------------------- parts --
class Parts:
    """Collects rigid parts, each bound to a bone, then joins them into the body."""

    def __init__(self, name, body=None):
        self.name = name
        self.objs = []
        self.body = body

    def surface(self, point, normal, reach=0.8):
        """Where a ray coming in along -normal towards point meets the body (or None)."""
        if not self.body:
            return None
        n = Vector(normal).normalized()
        origin = Vector(point) + n * reach
        ok, loc, nor, _ = self.body.ray_cast(origin, -n, distance=reach * 2.5)
        return (loc, nor) if ok else None

    def add(self, bm, kind, bone):
        me = bpy.data.meshes.new(f"{self.name}_part")
        bm.to_mesh(me)
        bm.free()
        ob = link(bpy.data.objects.new(f"{self.name}_part", me))
        me.materials.append(material(kind))
        for p in me.polygons:
            p.use_smooth = kind != "glow"
        vg = ob.vertex_groups.new(name=bone)
        vg.add(list(range(len(me.vertices))), 1.0, "REPLACE")
        self.objs.append(ob)
        return ob

    def cone(self, base, tip, r, kind, bone, segs=7, curve=0.0, side=None, snap=False):
        """A tooth, claw, spike or horn from base to tip, optionally curved (towards `side`).
        snap: slide it along its own axis so its base sits just inside the body surface."""
        bm = bmesh.new()
        base, tip = Vector(base), Vector(tip)
        if snap:
            hit = self.surface(base, (tip - base), reach=0.6)
            if hit:
                move = hit[0] - base - (tip - base).normalized() * r * 0.6
                base, tip = base + move, tip + move
        axis = tip - base
        L = axis.length
        a = axis.normalized()
        ref = Vector((0, 0, 1)) if abs(a.z) < 0.9 else Vector((1, 0, 0))
        u = a.cross(ref).normalized()
        w = a.cross(u).normalized()
        bend = Vector(side).normalized() if side else w
        rings = 5 if curve else 1
        prev = None
        for k in range(rings + 1):
            t = k / rings
            c = base + axis * t + bend * (curve * L * math.sin(t * math.pi * 0.5) ** 2)
            rr = r * (1 - t) ** 0.9
            if k == rings:
                tipv = bm.verts.new(c)
                for i in range(segs):
                    bm.faces.new((prev[i], prev[(i + 1) % segs], tipv))
                break
            ring = [bm.verts.new(c + (u * math.cos(i / segs * 2 * math.pi) + w * math.sin(i / segs * 2 * math.pi)) * rr) for i in range(segs)]
            if prev:
                for i in range(segs):
                    bm.faces.new((prev[i], prev[(i + 1) % segs], ring[(i + 1) % segs], ring[i]))
            else:
                bm.faces.new(list(reversed(ring)))
            prev = ring
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return self.add(bm, kind, bone)

    def plate(self, center, size, normal, kind, bone, yaw=0.0, bevel=True, snap=True):
        """An armour plate: a squashed, bevelled box lying on the body surface near `center`,
        facing along `normal` (snapped onto the body and tilted to it when a body is known)."""
        if snap:
            hit = self.surface(center, normal)
            if hit:
                center = hit[0] + hit[1] * size[2] * 0.25
                normal = (Vector(normal).normalized() + hit[1]).normalized()
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1)
        for v in bm.verts:
            v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
            # taper the top so it reads as a scale
            if v.co.z > 0:
                v.co.x *= 0.8
                v.co.y *= 0.8
        if bevel:
            bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(size) * 0.35, segments=2, affect="EDGES")
        n = Vector(normal).normalized()
        rot = Vector((0, 0, 1)).rotation_difference(n).to_matrix().to_4x4() @ Matrix.Rotation(yaw, 4, "Z")
        bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(center)) @ rot, verts=bm.verts)
        return self.add(bm, kind, bone)

    def eye(self, center, r, bone):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=7, radius=r)
        bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
        return self.add(bm, "eye", bone)

    def finish(self, body):
        """Join the parts into the body mesh."""
        if not self.objs:
            return body
        bpy.ops.object.select_all(action="DESELECT")
        for o in self.objs:
            o.select_set(True)
        body.select_set(True)
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.join()
        return body


def skin_to(body, arm, rigid_groups):
    """Automatic weights for the body, keeping the parts' rigid single-bone weights."""
    # store and clear the parts' groups (automatic weighting would overwrite them)
    keep = {}
    me = body.data
    for vg in body.vertex_groups:
        idx = vg.index
        keep[vg.name] = [(v.index, g.weight) for v in me.vertices for g in v.groups if g.group == idx]
    part_verts = {i for lst in keep.values() for i, _ in lst}
    for vg in list(body.vertex_groups):
        body.vertex_groups.remove(vg)
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    # parts: only their own bone
    for vg in body.vertex_groups:
        vg.remove(list(part_verts))
    for name, lst in keep.items():
        vg = body.vertex_groups.get(name) or body.vertex_groups.new(name=name)
        for i, w in lst:
            vg.add([i], w, "REPLACE")
    # any body vertex left without weight goes to the nearest bone
    unweighted = [v for v in me.vertices if not any(g.weight > 1e-4 for g in v.groups)]
    if unweighted:
        bones = [(b.name, b.head_local, b.tail_local) for b in arm.data.bones]
        for v in unweighted:
            best = min(bones, key=lambda b: seg_dist(v.co, b[1], b[2]))
            (body.vertex_groups.get(best[0]) or body.vertex_groups.new(name=best[0])).add([v.index], 1.0, "REPLACE")
    return len(unweighted)


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.length_squared)))
    return (a + ab * t - p).length


# ------------------------------------------------------------- animation --
def action(arm, name, frames, pose_fn, fps=30):
    """Key every frame of a clip. pose_fn(t in [0,1)) returns {bone: (pitch, roll, yaw)} in the
    creature's own axes (pitch about its side axis: positive tips a forward-pointing bone down and
    swings a hanging leg back; yaw about up; roll about forward), each applied at the bone's joint
    and carried by the bones above it; plus optional "_root": (side, forward, up) offset of the root."""
    from mathutils import Euler, Quaternion
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    if hasattr(arm.animation_data, "action_slot") and getattr(act, "slots", None) is not None:
        if not len(act.slots):
            act.slots.new(id_type="OBJECT", name=arm.name)
        arm.animation_data.action_slot = act.slots[0]
    bones = [pb.name for pb in arm.pose.bones]
    rest = {b.name: b.matrix_local.to_quaternion() for b in arm.data.bones}
    root_bone = arm.data.bones[0].name
    quats = {b: [] for b in bones}
    locs = []
    for f in range(frames + 1):
        t = f / frames
        pose = pose_fn(t)
        for b in bones:
            p, r, y = pose.get(b, (0, 0, 0))
            q_arm = Euler((p, -r, y), "XYZ").to_quaternion()
            q = rest[b].inverted() @ q_arm @ rest[b]
            if quats[b] and quats[b][-1].dot(q) < 0:
                q.negate()
            quats[b].append(q)
        sx, fw, up = pose.get("_root", (0, 0, 0))
        # creature axes -> armature (left = +x, forward = -y, up = +z) -> the root bone's frame
        locs.append(rest[root_bone].inverted() @ Vector((-sx, -fw, up)))
    for b in bones:
        arm.pose.bones[b].rotation_mode = "QUATERNION"
        for k in range(4):
            fc = act.fcurves.new(f'pose.bones["{b}"].rotation_quaternion', index=k, action_group=b)
            fc.keyframe_points.add(frames + 1)
            fc.keyframe_points.foreach_set("co", [c for i, q in enumerate(quats[b]) for c in (i + 1, q[k])])
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"
    for k in range(3):
        fc = act.fcurves.new(f'pose.bones["{root_bone}"].location', index=k, action_group=root_bone)
        fc.keyframe_points.add(frames + 1)
        fc.keyframe_points.foreach_set("co", [c for i, v in enumerate(locs) for c in (i + 1, v[k])])
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    act["fps"] = fps
    return act


S = math.sin
C = math.cos
TAU = math.tau
