"""The planetary titans: Vesper, Serekh and Ilyra. Built like the beasts (see make_beasts.py)
but much more detailed, with a full move set for their boss fights.

Run headless:
  blender -b --factory-startup --python tools/blender/make_titans.py -- --out public/models/titans --preview previews/

Clips: idle, walk, run, swipe_l, swipe_r, bite, slam, tail, leap, roar, beam, stagger, death
(Serekh swaps walk/run for slither and adds burrow/emerge; Ilyra flies: idle is a hover,
walk/run are glides, leap is a dive). Weak points are glow parts the game finds by bone:
core (spine), crown (head) and sacs.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import beastkit as K  # noqa: E402
import make_beasts as B  # noqa: E402
from beastkit import S, C, TAU  # noqa: E402
from mathutils import Vector  # noqa: E402

ramp, sides, mirror_joints, mirror_bones, mirror_pairs = B.ramp, B.sides, B.mirror_joints, B.mirror_bones, B.mirror_pairs


def blend(a, b, k):
    """Mix two poses (k=0 a, k=1 b)."""
    out = {}
    for key in set(a) | set(b):
        va, vb = a.get(key, (0, 0, 0)), b.get(key, (0, 0, 0))
        out[key] = tuple(x + (y - x) * k for x, y in zip(va, vb))
    return out


def env(t, a0, a1, b0, b1):
    """Rise between a0..a1, hold, fall between b0..b1."""
    return ramp(t, a0, a1) * (1 - ramp(t, b0, b1))


# ---------------------------------------------------------------- vesper --
def vesper():
    """The Worldbreaker: a crowned, armoured colossus on four pillar-legs, a burning core in
    its chest, six eyes and a crown of black horns."""
    J = mirror_joints({
        "hips": ((0, 0.55, 0.25), (0.42, 0.42)), "mid": ((0, 0.0, 0.3), (0.4, 0.42)), "chest": ((0, -0.55, 0.38), (0.52, 0.55)),
        "neckend": ((0, -0.95, 0.5), (0.3, 0.32)), "skull": ((0, -1.15, 0.55), (0.26, 0.24)), "nose": ((0, -1.55, 0.42), (0.12, 0.11)),
        "jawhinge": ((0, -1.1, 0.36), (0.18, 0.12)), "chin": ((0, -1.48, 0.27), (0.09, 0.06)),
        "t1": ((0, 1.05, 0.25), (0.22, 0.2)), "t2": ((0, 1.6, 0.18), (0.14, 0.13)), "t3": ((0, 2.2, 0.1), (0.06, 0.06)),
        "shoulder_l": ((0.36, -0.55, 0.22), (0.24, 0.26)), "elbow_l": ((0.46, -0.5, -0.22), (0.2, 0.2)),
        "wrist_l": ((0.48, -0.58, -0.62), (0.16, 0.16)), "paw_l": ((0.5, -0.75, -0.72), (0.2, 0.09)),
        "hip_l": ((0.32, 0.55, 0.12), (0.24, 0.26)), "knee_l": ((0.38, 0.38, -0.28), (0.19, 0.19)),
        "hock_l": ((0.38, 0.64, -0.58), (0.14, 0.14)), "hpaw_l": ((0.38, 0.52, -0.72), (0.19, 0.09)),
        "hump": ((0, -0.4, 0.95), (0.34, 0.2)), "keel": ((0, -0.55, -0.02), (0.3, 0.26)), "rib_l": ((0.32, -0.2, 0.25), (0.18, 0.24)),
        "haunch_l": ((0.24, 0.48, 0.5), (0.2, 0.18)), "brow_l": ((0.12, -1.22, 0.68), (0.08, 0.05)),
    })
    extra = mirror_pairs([("chest", "hump"), ("chest", "keel"), ("chest", "rib_l"), ("hips", "haunch_l"), ("skull", "brow_l")])
    arm, body, P = B.build_quad("vesper", J, extra=extra, detail=0.05, ridge_amt=1.3, scales=0.014, seed=101,
                                colour=dict(belly=0.42, back=0.14, mottle=0.18, seed=21, stripes=0.08))
    B.teeth(P, J, rows=9, spread=0.11, top=0.33, length=0.09, fang=0.12)
    rnd = random.Random(3)
    # the black crown: a ring of great horns sweeping back, with smaller horns between
    for k in range(9):
        a = (k - 4) / 4 * 1.25
        x, z = math.sin(a) * 0.24, 0.78 + math.cos(a) * 0.05
        h = 0.55 - abs(k - 4) * 0.07
        P.cone((x, -1.12, z - 0.05), (x * 2.2, -0.75 + abs(k - 4) * 0.05, z + h), 0.07 - abs(k - 4) * 0.005, "dark", "head", segs=7, curve=0.3, side=(0, 1, 0))
    for sn, sg in sides():
        # six eyes, burning
        for k, (y, z, r) in enumerate(((-1.32, 0.6, 0.035), (-1.24, 0.66, 0.03), (-1.16, 0.7, 0.024))):
            P.eye((sg * (0.15 + k * 0.025), y, z), r, "head")
        # tusks
        P.cone((sg * 0.12, -1.42, 0.3), (sg * 0.22, -1.7, 0.42), 0.04, "horn", "jaw", segs=6, curve=0.3, side=(0, 0, 1))
        # armour: shoulder pauldrons, rows of flank plates, leg plates
        P.plate((sg * 0.5, -0.55, 0.55), (0.28, 0.32, 0.06), (sg * 0.7, -0.1, 1), "dark", "spine", yaw=sg * 0.3)
        P.plate((sg * 0.56, -0.45, 0.25), (0.22, 0.26, 0.05), (sg, 0, 0.3), "dark", "spine")
        for k in range(5):
            P.plate((sg * 0.42, -0.25 + k * 0.2, 0.55 - k * 0.02), (0.18, 0.15, 0.04), (sg * 0.6, 0, 1), "dark", "spine" if k < 2 else "pelvis", yaw=sg * 0.15)
            P.plate((sg * 0.5, -0.2 + k * 0.2, 0.25), (0.15, 0.14, 0.035), (sg, 0, 0.2), "dark", "spine" if k < 2 else "pelvis")
        for leg in ("upperarm", "thigh"):
            b = arm.data.bones[f"{leg}_{sn}"]
            c = (b.head_local + b.tail_local) / 2
            P.plate(tuple(c + Vector((sg * 0.18, -0.08, 0))), (0.16, 0.2, 0.04), (sg, -0.5, 0), "dark", f"{leg}_{sn}")
        # glowing veins along the flanks that lead to the core
        for k in range(4):
            P.plate((sg * 0.5, -0.4 + k * 0.22, 0.42), (0.015, 0.1, 0.01), (sg, 0, 0.4), "glow", "spine" if k < 2 else "pelvis", bevel=False)
    # the core: a burning heart showing through cracked chest plates
    P.eye((0, -0.95, 0.12), 0.16, "spine").name = "vesper_core"
    for k in range(6):
        a = k / 6 * TAU
        P.plate((math.cos(a) * 0.18, -0.95, 0.12 + math.sin(a) * 0.18), (0.08, 0.1, 0.03), (math.cos(a) * 0.4, -1, math.sin(a) * 0.4), "dark", "spine", yaw=a)
    # spines down the back to the tail
    pts = []
    for i in range(14):
        y = -0.8 + i * 0.2
        bone = "neck" if y < -0.7 else "spine" if y < 0.0 else "pelvis" if y < 0.6 else "tail1" if y < 1.3 else "tail2"
        h = 0.12 + 0.18 * math.sin(min(1, (i + 2) / 12) * math.pi)
        pts.append((bone, (0, y, 1.0 if y < -0.1 else 0.7), h))
    B.ridge(P, pts, kind="dark", curve=0.3)
    B.claws(P, J, n=4, size=0.22, r=0.04)
    P.finish(body)
    K.skin_to(body, arm, None)
    base = B.quad_clips({"heavy": 0.75, "attack": "swipe", "windup": "rear", "drop": 0.6})

    def leg_pose(side, front, raise_k, reach=0.0):
        if front:
            return {f"upperarm_{side}": (-1.6 * raise_k + reach, 0, 0), f"forearm_{side}": (-0.9 * raise_k, 0, 0), f"paw_{side}": (0.6 * raise_k, 0, 0)}
        return {f"thigh_{side}": (-0.4 * raise_k, 0, 0), f"shin_{side}": (0.6 * raise_k, 0, 0)}

    def swipe(side):
        o = "r" if side == "l" else "l"
        sg = 1 if side == "l" else -1

        def f(t):
            up = env(t, 0.0, 0.42, 0.42, 0.55)       # long, readable lift
            hit = env(t, 0.42, 0.55, 0.62, 1.0)      # fast rake across
            p = {**leg_pose(side, True, up), f"upperarm_{side}": (-1.7 * up + 0.9 * hit, 0, sg * (0.5 * up - 0.9 * hit)),
                 f"forearm_{side}": (-0.9 * up - 0.2 * hit, 0, 0), f"upperarm_{o}": (0.15 * up, 0, 0),
                 "spine": (-0.2 * up + 0.15 * hit, 0, sg * (0.15 * up - 0.3 * hit)), "neck": (0.1 * hit, 0, -sg * 0.3 * hit), "jaw": (0.3 * up, 0, 0),
                 "pelvis": (0, 0, -sg * 0.1 * hit)}
            p["_root"] = (sg * 0.05 * hit, 0.15 * hit, 0.05 * up)
            return p
        return f

    def bite(t):
        coil = env(t, 0, 0.45, 0.45, 0.55)
        lunge = env(t, 0.45, 0.55, 0.65, 1.0)
        jaw = env(t, 0.3, 0.45, 0.56, 0.62)
        p = {"neck": (-0.3 * coil + 0.35 * lunge, 0, 0), "head": (-0.2 * coil, 0, 0), "jaw": (0.9 * jaw, 0, 0),
             "spine": (0.1 * coil, 0, 0), "upperarm_l": (0.3 * coil - 0.4 * lunge, 0, 0), "upperarm_r": (0.3 * coil - 0.4 * lunge, 0, 0),
             "thigh_l": (-0.3 * coil + 0.5 * lunge, 0, 0), "thigh_r": (-0.3 * coil + 0.5 * lunge, 0, 0), "shin_l": (0.5 * coil, 0, 0), "shin_r": (0.5 * coil, 0, 0)}
        p["_root"] = (0, 0.5 * lunge - 0.08 * coil, -0.08 * coil)
        return p

    def slam(t):
        # rear up on the hind legs, hold, crash down with both forelegs
        up = env(t, 0.0, 0.5, 0.55, 0.62)
        down = env(t, 0.55, 0.62, 0.7, 1.0)
        p = {"pelvis": (-0.75 * up + 0.1 * down, 0, 0), "spine": (-0.25 * up + 0.15 * down, 0, 0), "thigh_l": (0.75 * up, 0, 0), "thigh_r": (0.75 * up, 0, 0),
             "shin_l": (-0.3 * up, 0, 0), "shin_r": (-0.3 * up, 0, 0), "upperarm_l": (-0.9 * up + 0.3 * down, 0, -0.3 * up), "upperarm_r": (-0.9 * up + 0.3 * down, 0, 0.3 * up),
             "forearm_l": (-1.0 * up, 0, 0), "forearm_r": (-1.0 * up, 0, 0), "neck": (0.4 * up - 0.2 * down, 0, 0), "head": (-0.3 * up, 0, 0), "jaw": (0.7 * up, 0, 0)}
        p["_root"] = (0, -0.05 * up + 0.1 * down, 0.35 * up - 0.12 * down)
        return p

    def tail(t):
        # pivot on the forelegs and whip the tail round behind it
        w = env(t, 0.0, 0.35, 0.45, 0.55)
        whip = env(t, 0.45, 0.55, 0.65, 1.0)
        p = {"pelvis": (0, 0, 0.5 * w - 1.2 * whip), "spine": (0, 0, 0.2 * w - 0.3 * whip), "tail1": (-0.1, 0, 0.6 * w - 1.0 * whip), "tail2": (0, 0, 0.5 * w - 0.9 * whip),
             "tail3": (0, 0, 0.4 * w - 0.8 * whip), "neck": (0, 0, -0.3 * w + 0.4 * whip), "thigh_l": (0.3 * whip, 0, 0), "thigh_r": (-0.3 * whip, 0, 0)}
        p["_root"] = (0.2 * whip, 0, 0)
        return p

    def leap(t):
        # a deep crouch, a launch, legs tucked in the air, forelegs reaching for the landing
        crouch = env(t, 0.0, 0.3, 0.3, 0.38)
        air = env(t, 0.35, 0.45, 0.8, 0.88)
        land = env(t, 0.82, 0.88, 0.92, 1.0)
        p = {"thigh_l": (-0.5 * crouch + 0.4 * air, 0, 0), "thigh_r": (-0.5 * crouch + 0.4 * air, 0, 0), "shin_l": (0.9 * crouch + 0.5 * air, 0, 0), "shin_r": (0.9 * crouch + 0.5 * air, 0, 0),
             "upperarm_l": (0.5 * crouch - 1.0 * air + 0.3 * land, 0, 0), "upperarm_r": (0.5 * crouch - 1.0 * air + 0.3 * land, 0, 0), "forearm_l": (-0.6 * crouch, 0, 0), "forearm_r": (-0.6 * crouch, 0, 0),
             "neck": (0.3 * crouch - 0.2 * air, 0, 0), "jaw": (0.6 * air, 0, 0), "spine": (-0.15 * air, 0, 0)}
        p["_root"] = (0, 0, -0.25 * crouch - 0.2 * land)
        return p

    def roar(t):
        k = env(t, 0.0, 0.25, 0.8, 1.0)
        sh = S(TAU * t * 8) * 0.02 * k
        p = {"neck": (-0.5 * k, 0, sh * 5), "head": (-0.45 * k, 0, 0), "jaw": (1.0 * k, 0, 0), "spine": (-0.2 * k, 0, 0),
             "upperarm_l": (-0.2 * k, 0, -0.3 * k), "upperarm_r": (-0.2 * k, 0, 0.3 * k), "tail1": (0.3 * k, 0, 0)}
        p["_root"] = (sh, 0, 0.05 * k)
        return p

    def beam(t):
        # head low and forward, jaws wide, swinging slowly across
        k = env(t, 0.0, 0.25, 0.85, 1.0)
        sweep = (t - 0.25) / 0.6 if 0.25 < t < 0.85 else (0 if t <= 0.25 else 1)
        p = {"neck": (0.25 * k, 0, (-0.5 + sweep) * 0.7 * k), "head": (0.1 * k, 0, (-0.5 + sweep) * 0.3 * k), "jaw": (0.85 * k, 0, 0),
             "spine": (0.1 * k, 0, (-0.5 + sweep) * 0.2 * k), "thigh_l": (-0.2 * k, 0, 0), "thigh_r": (-0.2 * k, 0, 0), "shin_l": (0.3 * k, 0, 0), "shin_r": (0.3 * k, 0, 0)}
        p["_root"] = (0, 0, -0.06 * k)
        return p

    def stagger(t):
        k = env(t, 0.0, 0.15, 0.6, 1.0)
        p = {"pelvis": (0, 0.35 * k, 0), "spine": (0.3 * k, 0.15 * k, 0), "neck": (0.6 * k, 0, 0.4 * k), "head": (0.3 * k, 0, 0), "jaw": (0.6 * k, 0, 0),
             "upperarm_l": (0.6 * k, 0, 0), "forearm_l": (-0.8 * k, 0, 0), "thigh_r": (0.3 * k, 0, 0)}
        p["_root"] = (-0.1 * k, 0, -0.3 * k)
        return p

    clips = {"idle": base["idle"], "walk": base["walk"], "run": base["run"], "death": base["death"],
             "swipe_l": (48, swipe("l")), "swipe_r": (48, swipe("r")), "bite": (40, bite), "slam": (64, slam), "tail": (48, tail),
             "leap": (72, leap), "roar": (60, roar), "beam": (120, beam), "stagger": (60, stagger)}
    return B.finish("vesper", arm, body, clips)


# ---------------------------------------------------------------- serekh --
def serekh():
    """The Buried Sun: a colossal sand wyrm with a lamprey mouth of ringed teeth, sun-glass sacs
    burning along its flanks and armoured segments that grind like tectonic plates."""
    n_f, n_b = 5, 9
    J = {"mid": ((0, 0.2, 0.0), (0.3, 0.29))}
    for i in range(1, n_f + 1):
        J[f"f{i}"] = ((0, 0.2 - i * 0.42, 0.0), (0.31 - i * 0.004, 0.3 - i * 0.004))
    for i in range(1, n_b + 1):
        r = 0.3 * (1 - i / (n_b + 2.5))
        J[f"b{i}"] = ((0, 0.2 + i * 0.4, 0.0), (r, r * 0.95))
    y_head = 0.2 - n_f * 0.42
    J.update({"skull": ((0, y_head - 0.35, 0.0), (0.33, 0.33)), "nose": ((0, y_head - 0.75, 0.0), (0.3, 0.3)),
              "jawhinge": ((0, y_head - 0.3, -0.05), (0.2, 0.15)), "chin": ((0, y_head - 0.7, -0.12), (0.12, 0.08))})
    bones = [("pelvis", None, "mid", "f1")]
    prev = "pelvis"
    for i in range(2, n_f + 1):
        bones.append((f"fw{i}", prev, f"f{i - 1}", f"f{i}"))
        prev = f"fw{i}"
    bones += [("neck", prev, f"f{n_f}", "skull"), ("head", "neck", "skull", "nose"), ("jaw", "head", "jawhinge", "chin")]
    prev, pj = "pelvis", "mid"
    for i in range(1, n_b + 1):
        bones.append((f"bw{i}", prev, pj, f"b{i}"))
        prev, pj = f"bw{i}", f"b{i}"
    desc = {"joints": J, "bones": bones, "extra": [("skull", "jawhinge")], "root_joint": "mid"}
    arm = K.build_armature("serekh", desc)
    body = K.build_body("serekh_body", desc, detail=0.05, seed=111, ridge=0.8, scales=0.022, scale_size=18)
    K.colour(body, belly=0.7, back=0.3, mottle=0.22, seed=22, stripes=0.15)
    P = K.Parts("serekh", body)
    # the mouth: three rings of inward teeth on the open front of the head
    mouth_y = y_head - 0.8
    for ring, (r, n, L) in enumerate(((0.24, 18, 0.14), (0.18, 14, 0.12), (0.11, 10, 0.1))):
        for k in range(n):
            a = k / n * TAU + ring * 0.2
            base = Vector((math.cos(a) * r, mouth_y + ring * 0.07, math.sin(a) * r))
            tip = Vector((math.cos(a) * r * 0.35, mouth_y + ring * 0.07 + L, math.sin(a) * r * 0.35))
            P.cone(tuple(base), tuple(tip), 0.025 - ring * 0.004, "horn", "head", segs=5)
    P.eye((0, mouth_y + 0.25, 0.0), 0.1, "head").name = "serekh_maw"
    # armoured segment plates, flank spikes and glowing sun-glass sacs (the weak points)
    chain = [f"fw{i}" for i in range(n_f, 1, -1)] + ["pelvis"] + [f"bw{i}" for i in range(1, n_b + 1)]
    for i, bone in enumerate(chain):
        b = arm.data.bones[bone]
        c = (b.head_local + b.tail_local) / 2
        r = 0.3 * (1 - max(0, i - n_f) / (n_b + 2.5))
        for k in range(5):
            a = math.pi * (0.15 + k * 0.175)
            P.plate((math.cos(a) * r, c.y, math.sin(a) * r), (0.11 * r / 0.3, 0.16, 0.03), (math.cos(a), 0, math.sin(a)), "dark", bone, yaw=0)
        P.cone((0, c.y, r * 0.95), (0, c.y + 0.1, r + 0.22 * r / 0.3), 0.04, "horn", bone, segs=5, curve=0.2, side=(0, 1, 0), snap=True)
        if i % 3 == 1:
            for sn, sg in sides():
                P.eye((sg * r * 0.9, c.y, r * 0.05), 0.06 * r / 0.3, bone).name = f"serekh_sac_{bone}_{sn}"
    P.finish(body)
    K.skin_to(body, arm, None)
    cf = ["pelvis"] + [f"fw{i}" for i in range(2, n_f + 1)] + ["neck"]
    cb = [f"bw{i}" for i in range(1, n_b + 1)]

    def wave(t, amp, k=1.0):
        out = {}
        for i, b in enumerate(cf):
            out[b] = (0, 0, S(TAU * t + i * k) * amp * (0.5 if b == "neck" else 1))
        for i, b in enumerate(cb):
            out[b] = (0, 0, S(TAU * t - (i + 1) * k) * amp * (1 + i * 0.1))
        return out

    def raised(t, k, sway=0.1):
        """Front third reared up like a cobra."""
        p = wave(t, sway * 0.5)
        p["fw3"] = (-0.35 * k, 0, p.get("fw3", (0, 0, 0))[2])
        p["fw4"] = (-0.45 * k, 0, p.get("fw4", (0, 0, 0))[2])
        p["fw5"] = (-0.35 * k, 0, p.get("fw5", (0, 0, 0))[2])
        p["neck"] = (0.5 * k, 0, S(TAU * t) * sway)
        p["head"] = (0.45 * k, 0, 0)
        return p

    def idle(t):
        p = raised(t * 0.5, 1.0, 0.15)
        p["jaw"] = (max(0, S(TAU * t)) * 0.2, 0, 0)
        return p

    def slither(t):
        return wave(t, 0.24, 0.9)

    def fast(t):
        return wave(t, 0.32, 1.1)

    def bite(t):
        k = env(t, 0.0, 0.45, 0.45, 0.55)
        strike = env(t, 0.45, 0.55, 0.65, 1.0)
        p = raised(t, k + strike * 0.3)
        p["neck"] = (0.5 * k - 0.1 * strike, 0, 0)
        p["head"] = (0.45 * k - 0.4 * strike, 0, 0)
        p["jaw"] = (0.9 * env(t, 0.35, 0.48, 0.56, 0.6), 0, 0)
        p["_root"] = (0, 0.8 * strike, 0)
        return p

    def slam(t):
        up = env(t, 0.0, 0.5, 0.55, 0.62)
        down = env(t, 0.55, 0.62, 0.72, 1.0)
        p = raised(t, up * 1.6)
        for b in ("fw3", "fw4", "fw5"):
            p[b] = (p[b][0] + 0.35 * down, 0, 0)
        p["neck"] = (0.5 * up - 0.3 * down, 0, 0)
        return p

    def tail(t):
        w = env(t, 0.0, 0.4, 0.45, 0.55)
        whip = env(t, 0.45, 0.55, 0.65, 1.0)
        p = wave(t * 0.3, 0.05)
        for i, b in enumerate(cb):
            p[b] = (0, 0, (0.25 * w - 0.45 * whip) * (1 + i * 0.12))
        return p

    def burrow(t):
        # the head dives and the body follows it down
        k = ramp(t, 0.0, 1.0)
        p = wave(t, 0.2)
        p["neck"] = (0.8 * min(1, k * 2), 0, 0)
        p["head"] = (0.4 * min(1, k * 2), 0, 0)
        p["_root"] = (0, 0.5 * k, -1.6 * k)
        return p

    def emerge(t):
        k = 1 - ramp(t, 0.0, 0.6)
        up = env(t, 0.3, 0.6, 0.85, 1.0)
        p = raised(t, up * 1.4)
        p["jaw"] = (0.9 * up, 0, 0)
        p["_root"] = (0, 0, -1.6 * k)
        return p

    def roar(t):
        k = env(t, 0.0, 0.25, 0.8, 1.0)
        p = raised(t, 1.0 + 0.5 * k, 0.2 * k)
        p["head"] = (0.1, 0, S(TAU * t * 6) * 0.06 * k)
        p["jaw"] = (1.0 * k, 0, 0)
        return p

    def beam(t):
        k = env(t, 0.0, 0.25, 0.85, 1.0)
        sweep = min(1, max(0, (t - 0.25) / 0.6))
        p = raised(t, 1.0 * k)
        p["neck"] = (0.3 * k, 0, (-0.5 + sweep) * 0.8 * k)
        p["head"] = (0.25 * k, 0, 0)
        p["jaw"] = (0.9 * k, 0, 0)
        return p

    def stagger(t):
        k = env(t, 0.0, 0.15, 0.6, 1.0)
        p = wave(t, 0.1)
        p["neck"] = (-0.3 * k, 0, 0.6 * k)
        p["pelvis"] = (0, 0.6 * k, 0)
        p["jaw"] = (0.6 * k, 0, 0)
        return p

    def death(t):
        k = ramp(t, 0.0, 0.8)
        p = wave(t * 0.2, 0.3 * (1 - k))
        p["pelvis"] = (0, 1.4 * k, 0)
        p["neck"] = (0.4 * k, 0, 0.8 * k)
        p["jaw"] = (0.6 * k, 0, 0)
        return p

    clips = {"idle": (90, idle), "walk": (40, slither), "run": (28, fast), "swipe_l": (48, tail), "swipe_r": (48, tail), "bite": (44, bite),
             "slam": (64, slam), "tail": (48, tail), "leap": (60, burrow), "burrow": (60, burrow), "emerge": (60, emerge),
             "roar": (60, roar), "beam": (120, beam), "stagger": (60, stagger), "death": (60, death)}
    return B.finish("serekh", arm, body, clips)


# ----------------------------------------------------------------- ilyra --
def ilyra():
    """The Silent Choir: a vast crystalline wyvern. Its wings are fans of singing glass, a heart
    of light shows through its ribs and its long tail ends in a crystal blade."""
    J = mirror_joints({
        "hips": ((0, 0.3, 0.0), (0.18, 0.19)), "chest": ((0, -0.25, 0.04), (0.24, 0.26)), "neckend": ((0, -0.6, 0.2), (0.11, 0.11)),
        "skull": ((0, -0.78, 0.25), (0.11, 0.1)), "nose": ((0, -1.08, 0.16), (0.04, 0.04)), "jawhinge": ((0, -0.78, 0.18), (0.08, 0.05)),
        "chin": ((0, -1.02, 0.12), (0.03, 0.025)), "t1": ((0, 0.75, 0.0), (0.1, 0.08)), "t2": ((0, 1.25, 0.0), (0.06, 0.05)), "t3": ((0, 1.8, 0.0), (0.03, 0.025)),
        "shoulder_l": ((0.17, -0.22, 0.13), (0.09, 0.08)), "elbow_l": ((0.7, -0.12, 0.16), (0.07, 0.05)),
        "wrist_l": ((1.2, -0.22, 0.13), (0.05, 0.04)), "tip_l": ((1.85, 0.05, 0.1), (0.025, 0.02)),
        "hip_l": ((0.1, 0.15, -0.12), (0.08, 0.08)), "knee_l": ((0.12, 0.0, -0.36), (0.06, 0.06)),
        "ankle_l": ((0.12, 0.08, -0.54), (0.04, 0.04)), "talon_l": ((0.12, -0.08, -0.6), (0.05, 0.025)),
    })
    bones = mirror_bones([
        ("pelvis", None, "hips", "chest"), ("neck", "pelvis", "chest", "neckend"), ("head", "neck", "neckend", "skull"),
        ("snout", "head", "skull", "nose"), ("jaw", "head", "jawhinge", "chin"), ("tail1", "pelvis", "hips", "t1"), ("tail2", "tail1", "t1", "t2"),
        ("tail3", "tail2", "t2", "t3"),
        ("wing1_l", "pelvis", "shoulder_l", "elbow_l"), ("wing2_l", "wing1_l", "elbow_l", "wrist_l"), ("wing3_l", "wing2_l", "wrist_l", "tip_l"),
        ("thigh_l", "pelvis", "hip_l", "knee_l"), ("shin_l", "thigh_l", "knee_l", "ankle_l"), ("foot_l", "shin_l", "ankle_l", "talon_l"),
    ])
    desc = {"joints": J, "bones": bones, "extra": mirror_pairs([("chest", "shoulder_l"), ("hips", "hip_l"), ("neckend", "jawhinge")]), "root_joint": "chest"}
    arm = K.build_armature("ilyra", desc)
    body = K.build_body("ilyra_body", desc, detail=0.025, seed=121, ridge=0.6, scales=0.01, scale_size=36)
    K.colour(body, belly=0.75, back=0.4, mottle=0.15, seed=23, stripes=0.1)
    P = K.Parts("ilyra", body)
    rnd = random.Random(8)
    # crystal crown and face
    for k in range(7):
        a = (k - 3) / 3 * 1.0
        P.cone((math.sin(a) * 0.07, -0.75, 0.33), (math.sin(a) * 0.2, -0.5, 0.55 - abs(k - 3) * 0.04), 0.03, "glow", "head", segs=5).name = "ilyra_crown"
    for sn, sg in sides():
        P.eye((sg * 0.07, -0.86, 0.29), 0.02, "head")
        P.eye((sg * 0.09, -0.8, 0.32), 0.014, "head")
        # wings: fans of glass blades, each with a glowing edge
        for k in range(7):
            a = Vector(J[f"wrist_{sn}"][0]).lerp(Vector(J[f"tip_{sn}"][0]), k / 6)
            L = 0.55 - k * 0.05
            P.plate((a.x, a.y + L * 0.7, a.z), (0.05, L, 0.01), (0, 0, 1), "dark", f"wing3_{sn}", yaw=sg * (-0.25 - k * 0.07), snap=False)
            P.plate((a.x + sg * 0.02, a.y + L * 1.35, a.z), (0.012, L * 0.35, 0.008), (0, 0, 1), "glow", f"wing3_{sn}", yaw=sg * (-0.25 - k * 0.07), bevel=False, snap=False)
        for k in range(7):
            a = Vector(J[f"elbow_{sn}"][0]).lerp(Vector(J[f"wrist_{sn}"][0]), k / 6)
            P.plate((a.x, a.y + 0.3, a.z), (0.06, 0.3, 0.01), (0, 0, 1), "dark", f"wing2_{sn}", yaw=sg * -0.12, snap=False)
        for k in range(5):
            a = Vector(J[f"shoulder_{sn}"][0]).lerp(Vector(J[f"elbow_{sn}"][0]), k / 4)
            P.plate((a.x, a.y + 0.22, a.z), (0.07, 0.22, 0.01), (0, 0, 1), "dark", f"wing1_{sn}", snap=False)
        # crystal growths along the flanks
        for k in range(4):
            y = -0.2 + k * 0.15
            P.cone((sg * 0.18, y, 0.08), (sg * 0.32, y + 0.05, 0.2), 0.03, "glow", "pelvis", segs=5, snap=True)
        p = Vector(J[f"talon_{sn}"][0])
        for c in (-1, 0, 1):
            P.cone((p.x + c * 0.025, p.y + 0.03, p.z + 0.02), (p.x + c * 0.035, p.y - 0.1, p.z - 0.06), 0.015, "horn", f"foot_{sn}", segs=5, curve=0.4, side=(0, 0, -1))
    # the heart of light, and the crystal tail blade
    P.eye((0, -0.3, -0.1), 0.09, "pelvis").name = "ilyra_heart"
    P.cone((0, 1.75, 0.0), (0, 2.25, 0.04), 0.07, "glow", "tail3", segs=4)
    for i in range(10):
        y = -0.45 + i * 0.22
        bone = "neck" if y < -0.35 else "pelvis" if y < 0.35 else "tail1" if y < 0.8 else "tail2" if y < 1.3 else "tail3"
        P.cone((0, y, 0.2 if y < 0.4 else 0.1), (0, y + 0.06, 0.32 if y < 0.4 else 0.2), 0.03, "glow", bone, segs=4, snap=True)
    P.finish(body)
    K.skin_to(body, arm, None)

    def flap(t, amp=0.9, sweep=0.0):
        a = TAU * t
        out = {}
        for sn, sg in sides():
            out[f"wing1_{sn}"] = (0, sg * S(a) * amp * 0.8, -sg * sweep)
            out[f"wing2_{sn}"] = (0, sg * S(a - 0.5) * amp * 0.5, -sg * sweep * 0.6)
            out[f"wing3_{sn}"] = (0, sg * S(a - 1.0) * amp * 0.4, -sg * sweep * 0.8)
            out[f"thigh_{sn}"] = (0.7, 0, 0)
            out[f"shin_{sn}"] = (-0.9, 0, 0)
        out["tail1"] = (S(a) * 0.08, 0, S(a * 0.5) * 0.15)
        out["tail2"] = (0, 0, S(a * 0.5 - 0.6) * 0.2)
        out["tail3"] = (0, 0, S(a * 0.5 - 1.2) * 0.25)
        out["_root"] = (0, 0, -S(a) * 0.05 * amp)
        return out

    def idle(t):
        p = flap(t, 0.85)
        p["neck"] = (S(TAU * t) * 0.06, 0, S(TAU * t * 0.5) * 0.25)
        return p

    def swipe(side):
        sg = 1 if side == "l" else -1

        def f(t):
            # one wing folds back, then cuts forward like a blade
            up = env(t, 0.0, 0.42, 0.42, 0.55)
            hit = env(t, 0.42, 0.55, 0.62, 1.0)
            p = flap(t, 0.3)
            p[f"wing1_{side}"] = (0, sg * 0.3, -sg * (-0.8 * up + 1.0 * hit))
            p[f"wing2_{side}"] = (0, 0, -sg * (-0.5 * up + 0.6 * hit))
            p["pelvis"] = (0, 0, sg * (0.2 * up - 0.4 * hit))
            return p
        return f

    def dive(t):
        d = env(t, 0.0, 0.35, 0.7, 1.0)
        p = flap(t * 2, 0.2 * (1 - d))
        for sn, sg in sides():
            p[f"wing1_{sn}"] = (0, sg * 0.5 * d, -sg * 1.0 * d)
            p[f"wing2_{sn}"] = (0, 0, -sg * 0.6 * d)
            p[f"thigh_{sn}"] = (-1.3 * d + 0.7 * (1 - d), 0, 0)
        p["neck"] = (-0.4 * d, 0, 0)
        p["jaw"] = (0.7 * d, 0, 0)
        return p

    def slam(t):
        # wings beat down together: a shockwave of sound
        up = env(t, 0.0, 0.5, 0.55, 0.62)
        down = env(t, 0.55, 0.62, 0.72, 1.0)
        p = {}
        for sn, sg in sides():
            p[f"wing1_{sn}"] = (0, sg * (-0.9 * up + 0.8 * down), 0)
            p[f"wing2_{sn}"] = (0, sg * (-0.4 * up + 0.5 * down), 0)
            p[f"wing3_{sn}"] = (0, sg * (0.3 * up + 0.4 * down), 0)
            p[f"thigh_{sn}"] = (0.6, 0, 0)
        p["neck"] = (-0.4 * up + 0.2 * down, 0, 0)
        p["jaw"] = (0.8 * down, 0, 0)
        p["_root"] = (0, 0, 0.1 * up - 0.15 * down)
        return p

    def tail(t):
        w = env(t, 0.0, 0.4, 0.45, 0.55)
        whip = env(t, 0.45, 0.55, 0.65, 1.0)
        p = flap(t, 0.4)
        p["pelvis"] = (0, 0, 0.6 * w - 1.6 * whip)
        p["tail1"] = (0, 0, 0.5 * w - 0.9 * whip)
        p["tail2"] = (0, 0, 0.4 * w - 0.8 * whip)
        p["tail3"] = (0, 0, 0.3 * w - 0.7 * whip)
        return p

    def roar(t):
        k = env(t, 0.0, 0.25, 0.8, 1.0)
        p = {}
        for sn, sg in sides():
            p[f"wing1_{sn}"] = (0, sg * -0.5 * k, 0)
            p[f"wing2_{sn}"] = (0, sg * -0.25 * k, 0)
            p[f"wing3_{sn}"] = (0, sg * 0.35 * k, 0)
            p[f"thigh_{sn}"] = (0.5, 0, 0)
        p["neck"] = (-0.6 * k, 0, S(TAU * t * 4) * 0.08 * k)
        p["head"] = (-0.35 * k, 0, 0)
        p["jaw"] = (0.8 * k, 0, 0)
        return p

    def beam(t):
        k = env(t, 0.0, 0.25, 0.85, 1.0)
        sweep = min(1, max(0, (t - 0.25) / 0.6))
        p = flap(t * 2, 0.4)
        p["neck"] = (0.3 * k, 0, (-0.5 + sweep) * 0.9 * k)
        p["head"] = (0.2 * k, 0, 0)
        p["jaw"] = (0.8 * k, 0, 0)
        return p

    def stagger(t):
        k = env(t, 0.0, 0.15, 0.6, 1.0)
        p = flap(t, 0.5)
        p["pelvis"] = (0.5 * k, 0.6 * k, 0)
        p["neck"] = (-0.4 * k, 0, 0.5 * k)
        p["_root"] = (0, 0, -0.3 * k)
        return p

    def death(t):
        k = ramp(t, 0.0, 0.8)
        p = {}
        for sn, sg in sides():
            p[f"wing1_{sn}"] = (0, sg * 0.9 * k, 0)
            p[f"wing2_{sn}"] = (0, sg * -1.4 * k, 0)
        p["pelvis"] = (2.2 * k, 1.0 * k, 0)
        p["neck"] = (0.8 * k, 0, 0)
        p["_root"] = (0, 0, -1.0 * k)
        return p

    clips = {"idle": (48, idle), "walk": (40, lambda t: flap(t, 1.0)), "run": (36, lambda t: flap(t, 0.3, sweep=0.5)),
             "swipe_l": (48, swipe("l")), "swipe_r": (48, swipe("r")), "bite": (40, dive), "slam": (64, slam), "tail": (48, tail),
             "leap": (60, dive), "roar": (60, roar), "beam": (120, beam), "stagger": (60, stagger), "death": (60, death)}
    return B.finish("ilyra", arm, body, clips)


TITANS = {"vesper": vesper, "serekh": serekh, "ilyra": ilyra}

if __name__ == "__main__":
    B.run(TITANS, [("idle", 1, -2.3), ("swipe_l", 28, -1.3), ("slam", 34, -1.6), ("beam", 60, -0.9), ("roar", 30, -2.0)])
