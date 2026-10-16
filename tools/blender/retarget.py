"""Retarget animations between humanoid armatures, and build poses from limb directions.

Works on world-space rotations: each source bone's turn away from its own rest
pose is applied to the matching target bone, after first swinging the target's
rest pose onto the source's (so an A-pose character can use T-pose clips).
Keys are written straight into F-curves, which is far faster than keyframe_insert.
"""
import bpy
from mathutils import Matrix, Quaternion, Vector


def walk(bones):
    """Bones parents-first."""
    out = []
    def rec(b):
        out.append(b)
        for c in b.children:
            rec(c)
    for b in bones:
        if b.parent is None:
            rec(b)
    return out


class Target:
    def __init__(self, rig):
        self.rig = rig
        self.order = walk(rig.data.bones)
        self.wm = rig.matrix_world.copy()
        self.wm_rot = self.wm.to_quaternion()
        self.rest = {b.name: b.matrix_local.copy() for b in rig.data.bones}       # armature space
        self.rest_w = {n: (self.wm @ m) for n, m in self.rest.items()}            # world
        for pb in rig.pose.bones:
            pb.rotation_mode = "QUATERNION"

    def dir_w(self, name):
        b = self.rig.data.bones[name]
        return ((self.wm @ b.tail_local) - (self.wm @ b.head_local)).normalized()

    def solve(self, desired_rot_w, pelvis=None, pelvis_t_w=None):
        """World rotations per bone (missing bones keep their rest pose relative to the parent)
        -> basis (location, quaternion) per bone."""
        posed = {}
        out = {}
        for b in self.order:
            n = b.name
            A = self.rest[n]
            if b.parent:
                P_par = posed[b.parent.name]
                rel = self.rest[b.parent.name].inverted() @ A
            else:
                P_par = Matrix.Identity(4)
                rel = A
            if n in desired_rot_w:
                R = (self.wm_rot.inverted() @ desired_rot_w[n]).to_matrix().to_4x4()
                if n == pelvis and pelvis_t_w is not None:
                    want = Matrix.Translation(self.wm.inverted() @ pelvis_t_w) @ R
                else:
                    # translation follows the hierarchy: posed parent * rest offset
                    head = (P_par @ rel).translation
                    want = Matrix.Translation(head) @ R
                basis = rel.inverted() @ P_par.inverted() @ want
            else:
                basis = Matrix.Identity(4)
            posed[n] = P_par @ rel @ basis
            loc, rot, _ = basis.decompose()
            out[n] = (loc, rot)
        return out


def write_action(rig, name, frames, fps):
    """frames: list of {bone: (loc, quat)}; writes an action with one key per frame."""
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    bones = frames[0].keys()
    for bn in bones:
        prev = None
        quats = []
        for fr in frames:
            q = fr[bn][1].copy()
            if prev is not None and prev.dot(q) < 0:
                q.negate()
            quats.append(q)
            prev = q
        locs = [fr[bn][0] for fr in frames]
        # the hips are always keyed, so one clip never inherits another's height
        moving = bn == "pelvis" or any((l - locs[0]).length > 1e-4 for l in locs) or locs[0].length > 1e-4
        chans = [("rotation_quaternion", 4, lambda i, k: quats[i][k])]
        if moving:
            chans.append(("location", 3, lambda i, k: locs[i][k]))
        for path, n, get in chans:
            for k in range(n):
                fc = act.fcurves.new(f'pose.bones["{bn}"].{path}', index=k, action_group=bn)
                fc.keyframe_points.add(len(frames))
                co = []
                for i in range(len(frames)):
                    co += [i + 1, get(i, k)]
                fc.keyframe_points.foreach_set("co", co)
                for kp in fc.keyframe_points:
                    kp.interpolation = "LINEAR"
                fc.update()
    act["fps"] = fps
    return act


def retarget(src, tgt, actions, mapping, *, pelvis="pelvis", step=1):
    """src: source armature object (actions play on it); tgt: Target.
    actions: {source_action_name: new_name}. mapping: {source_bone: target_bone}."""
    scene = bpy.context.scene
    swm = src.matrix_world.copy()
    s_rest_w = {b.name: (swm @ b.matrix_local) for b in src.data.bones}
    # swing each target rest bone onto the source rest bone's direction
    aligned = {}
    for sb, tb in mapping.items():
        if sb not in src.data.bones or tb not in tgt.rig.data.bones:
            continue
        b = src.data.bones[sb]
        sd = ((swm @ b.tail_local) - (swm @ b.head_local)).normalized()
        td = tgt.dir_w(tb)
        swing = td.rotation_difference(sd)
        aligned[sb] = swing @ tgt.rest_w[tb].to_quaternion()
    s_pelvis_rest = s_rest_w[next(k for k, v in mapping.items() if v == pelvis)].translation
    t_pelvis_rest = tgt.rest_w[pelvis].translation
    k = t_pelvis_rest.z / max(1e-6, s_pelvis_rest.z)
    src.animation_data_create()
    made = []
    for sname, new in actions.items():
        act = bpy.data.actions.get(sname)
        if act is None:
            print("RETARGET missing", sname)
            continue
        src.animation_data.action = act
        # Blender 4.4+: an action only plays once one of its slots is assigned
        if hasattr(src.animation_data, "action_slot") and getattr(act, "slots", None) and len(act.slots):
            src.animation_data.action_slot = act.slots[0]
        f0, f1 = (int(round(v)) for v in act.frame_range)
        frames = []
        for f in range(f0, f1 + 1, step):
            scene.frame_set(f)
            desired = {}
            for sb, tb in mapping.items():
                if sb not in aligned:
                    continue
                S = swm @ src.pose.bones[sb].matrix
                desired[tb] = S.to_quaternion() @ s_rest_w[sb].to_quaternion().inverted() @ aligned[sb]
            sp = (swm @ src.pose.bones[[s for s, t in mapping.items() if t == pelvis][0]].matrix).translation
            pt = t_pelvis_rest + (sp - s_pelvis_rest) * k
            frames.append(tgt.solve(desired, pelvis=pelvis, pelvis_t_w=pt))
        made.append(write_action(tgt.rig, new, frames, scene.render.fps / step))
        print("RETARGET", sname, "->", new, len(frames), "frames")
    return made


def pose_from_directions(tgt, dirs, *, twist=None, curl=None, pelvis_drop=0.0, pelvis_fwd=0.0):
    """A pose built from wanted world directions for some bones (head -> tail).
    Bones not listed keep their rest turn relative to the parent; listed bones swing
    from the direction their parent chain has carried them to. Returns basis per bone."""
    desired = {}
    carried = {}
    for b in tgt.order:
        n = b.name
        R_rest = tgt.rest_w[n].to_quaternion()
        if b.parent and b.parent.name in carried:
            par = b.parent.name
            # carry the parent's turn down to this bone
            delta = carried[par] @ tgt.rest_w[par].to_quaternion().inverted()
        else:
            delta = Quaternion()
        R = delta @ R_rest
        if n in dirs:
            cur = (delta @ tgt.dir_w(n)).normalized()
            R = cur.rotation_difference(Vector(dirs[n]).normalized()) @ R
        if curl and n in curl:
            # bend about the bone's own side axis (fingers curling into a fist)
            ax = (R @ Vector((1, 0, 0))).normalized()
            R = Quaternion(ax, curl[n]) @ R
        if twist and n in twist:
            ax = (R @ Vector((0, 1, 0))).normalized()
            R = Quaternion(ax, twist[n]) @ R
        carried[n] = R
        desired[n] = R
    p = tgt.rest_w["pelvis"].translation.copy()
    p.z -= pelvis_drop
    p.y -= pelvis_fwd
    return tgt.solve(desired, pelvis="pelvis", pelvis_t_w=p)
