"""Build the beasts: sculpted, rigged and animated creatures, one .glb per body plan.

Run headless:
  blender -b --factory-startup --python tools/blender/make_beasts.py -- --out public/models/beasts --preview previews/ [--only wolf,rhino]

Each file holds one creature at unit scale (the game multiplies by the species radius),
facing -y in Blender (+z in the game), feet at -footing. Clips are named
"<plan>|idle", "|walk", "|run", "|attack", "|windup", "|hit", "|death".
Rotations in clips are in the creature's own axes (see beastkit.action):
pitch > 0 tips a forward-pointing bone down and swings a hanging leg back.
"""
import argparse
import math
import os
import random
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import beastkit as K  # noqa: E402
from beastkit import S, C, TAU  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--preview", default="")
ap.add_argument("--only", default="")
args = ap.parse_args(argv)


def mirror_joints(j):
    out = {}
    for k, (p, r) in j.items():
        out[k] = (p, r)
        if k.endswith("_l"):
            out[k[:-2] + "_r"] = ((-p[0], p[1], p[2]), r)
    return out


def mirror_bones(bs):
    out = []
    sub = lambda s: s[:-2] + "_r" if s and s.endswith("_l") else s
    for b in bs:
        out.append(b)
        if b[0].endswith("_l"):
            out.append(tuple(sub(x) for x in b))
    return out


def mirror_pairs(ps):
    out = []
    for a, b in ps:
        out.append((a, b))
        if a.endswith("_l") or b.endswith("_l"):
            out.append((a[:-2] + "_r" if a.endswith("_l") else a, b[:-2] + "_r" if b.endswith("_l") else b))
    return out


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def ramp(t, a, b):
    """0 before a, 1 after b, smooth in between."""
    return smooth((t - a) / max(1e-6, b - a))


def sides():
    return (("l", 1), ("r", -1))


def finish(name, arm, body, clips):
    for clip, (frames, fn) in clips.items():
        K.action(arm, f"{name}|{clip}", frames, fn)
    return arm, body


# ----------------------------------------------------------- quadrupeds --
QUAD_BONES = mirror_bones([
    ("pelvis", None, "hips", "mid"),
    ("spine", "pelvis", "mid", "chest"),
    ("neck", "spine", "chest", "neckend"),
    ("head", "neck", "neckend", "skull"),
    ("snout", "head", "skull", "nose"),
    ("jaw", "head", "jawhinge", "chin"),
    ("tail1", "pelvis", "hips", "t1"),
    ("tail2", "tail1", "t1", "t2"),
    ("tail3", "tail2", "t2", "t3"),
    ("upperarm_l", "spine", "shoulder_l", "elbow_l"),
    ("forearm_l", "upperarm_l", "elbow_l", "wrist_l"),
    ("paw_l", "forearm_l", "wrist_l", "paw_l"),
    ("thigh_l", "pelvis", "hip_l", "knee_l"),
    ("shin_l", "thigh_l", "knee_l", "hock_l"),
    ("foot_l", "shin_l", "hock_l", "hpaw_l"),
])
QUAD_EXTRA = mirror_pairs([("chest", "shoulder_l"), ("hips", "hip_l"), ("neckend", "jawhinge")])


def quad_clips(o):
    """Clips for a four-legged plan. o: sprawl (legs out to the side), heavy (0..1, slower,
    shorter strides), windup ('snarl', 'paw', 'rear'), attack ('bite', 'gore', 'swipe')."""
    sprawl, heavy = o.get("sprawl", False), o.get("heavy", 0.0)
    amp = 0.45 * (1 - heavy * 0.4)

    def leg(side, front, a, swing_amp, lift):
        s = S(a) * swing_amp
        fl = max(0.0, C(a)) * lift
        out = {}
        if sprawl:
            # legs reach out sideways: swinging forward/back is a yaw, lifting is a roll
            sgn = 1 if side == "l" else -1
            if front:
                out[f"upperarm_{side}"] = (0, sgn * fl * 0.5, -sgn * s)
                out[f"forearm_{side}"] = (0, -sgn * fl * 0.3, 0)
            else:
                out[f"thigh_{side}"] = (0, sgn * fl * 0.5, -sgn * s)
                out[f"shin_{side}"] = (0, -sgn * fl * 0.3, 0)
        elif front:
            out[f"upperarm_{side}"] = (s, 0, 0)
            out[f"forearm_{side}"] = (-fl * 1.2, 0, 0)
            out[f"paw_{side}"] = (fl * 1.3 - s * 0.3, 0, 0)
        else:
            out[f"thigh_{side}"] = (s, 0, 0)
            out[f"shin_{side}"] = (fl * 1.1, 0, 0)
            out[f"foot_{side}"] = (-fl * 1.2 - s * 0.2, 0, 0)
        return out

    def gait(t, a, lift, gallop=False):
        out = {}
        for side, base in (("l", 0.0), ("r", 0.5)):
            if gallop:
                fo, ho = (0.0 if side == "l" else 0.1), (0.45 if side == "l" else 0.55)
            else:
                fo, ho = base, base + 0.5
            out.update(leg(side, True, TAU * (t + fo), a, lift))
            out.update(leg(side, False, TAU * (t + ho), a, lift))
        return out

    def tail(t, lift=-0.2, sway=0.22):
        return {"tail1": (lift, 0, S(TAU * t) * sway), "tail2": (0.06, 0, S(TAU * t - 0.7) * sway * 1.2), "tail3": (0.06, 0, S(TAU * t - 1.4) * sway * 1.4)}

    def idle(t):
        b = S(TAU * t)
        p = {"spine": (b * 0.02, 0, 0), "neck": (-0.1 + b * 0.03, 0, S(TAU * t) * 0.22), "head": (0.08, 0, S(TAU * t + 1) * 0.14),
             "jaw": (max(0, S(TAU * t * 2)) * 0.1, 0, 0), **tail(t, -0.25, 0.18)}
        p["_root"] = (0, 0, b * 0.01)
        return p

    def walk(t):
        p = gait(t, amp, 0.55)
        wig = S(TAU * t) * (0.18 if sprawl else 0.06)
        p.update({"spine": (0, 0, wig), "pelvis": (0, 0, -wig * 0.6), "neck": (-0.05 + S(TAU * t * 2) * 0.04, 0, -wig * 0.8), **tail(t)})
        p["_root"] = (0, 0, abs(S(TAU * t * 2)) * 0.02 * (1 - heavy * 0.5))
        return p

    def run(t):
        if sprawl:
            p = gait(t, amp * 1.4, 0.8)
            wig = S(TAU * t) * 0.28
            p.update({"spine": (0, 0, wig), "pelvis": (0, 0, -wig), "neck": (-0.1, 0, -wig), **tail(t, -0.1, 0.3)})
            return p
        p = gait(t, amp * 1.9, 0.9, gallop=True)
        flex = S(TAU * t) * (1 - heavy * 0.6)
        p.update({"pelvis": (flex * 0.12, 0, 0), "spine": (-flex * 0.18, 0, 0), "neck": (0.15 + flex * 0.1, 0, 0), "head": (0.18 - flex * 0.08, 0, 0),
                  "jaw": (0.15, 0, 0), "tail1": (-0.1 - flex * 0.2, 0, 0)})
        p["_root"] = (0, 0, max(0, S(TAU * t)) * 0.1 * (1 - heavy * 0.5))
        return p

    def attack(t):
        kind = o.get("attack", "bite")
        crouch = ramp(t, 0, 0.3) * (1 - ramp(t, 0.3, 0.45))
        hitk = ramp(t, 0.3, 0.45) * (1 - ramp(t, 0.6, 1.0))
        jaw = ramp(t, 0.2, 0.35) * (1 - ramp(t, 0.48, 0.55))
        if kind == "swipe":
            # rise on the haunches and rake with the right forepaw
            p = {"spine": (-0.35 * crouch - 0.2 * hitk, 0, 0.2 * hitk), "upperarm_r": (-1.4 * crouch + 1.0 * hitk, 0, 0.5 * hitk), "forearm_r": (-0.6 * crouch, 0, 0),
                 "upperarm_l": (-0.3 * crouch, 0, 0), "neck": (-0.2 * crouch + 0.2 * hitk, 0, 0), "jaw": (0.6 * jaw, 0, 0), "thigh_l": (-0.3 * crouch, 0, 0), "thigh_r": (-0.3 * crouch, 0, 0)}
            p["_root"] = (0, 0.15 * hitk, 0.15 * crouch)
        elif kind == "gore":
            # head down, then drive the horn up and through
            p = {"neck": (0.5 * crouch - 0.6 * hitk, 0, 0), "head": (0.2 * crouch - 0.4 * hitk, 0, 0),
                 "thigh_l": (-0.4 * crouch + 0.4 * hitk, 0, 0), "thigh_r": (-0.4 * crouch + 0.4 * hitk, 0, 0), "upperarm_l": (0.2 * crouch - 0.4 * hitk, 0, 0), "upperarm_r": (0.2 * crouch - 0.4 * hitk, 0, 0)}
            p["_root"] = (0, 0.35 * hitk - 0.05 * crouch, -0.06 * crouch + 0.05 * hitk)
        else:
            p = {"thigh_l": (-0.3 * crouch + 0.5 * hitk, 0, 0), "thigh_r": (-0.3 * crouch + 0.5 * hitk, 0, 0), "shin_l": (0.6 * crouch, 0, 0), "shin_r": (0.6 * crouch, 0, 0),
                 "upperarm_l": (0.3 * crouch - 0.7 * hitk, 0, 0), "upperarm_r": (0.3 * crouch - 0.7 * hitk, 0, 0), "forearm_l": (-0.5 * crouch, 0, 0), "forearm_r": (-0.5 * crouch, 0, 0),
                 "neck": (0.25 * crouch - 0.2 * hitk, 0, 0), "head": (-0.15 * jaw, 0, 0), "jaw": (0.75 * jaw, 0, 0), "tail1": (0.3 * crouch - 0.2, 0, 0)}
            p["_root"] = (0, 0.45 * hitk - 0.05 * crouch, -0.1 * crouch + 0.1 * hitk)
        return p

    def windup(t):
        kind = o.get("windup", "snarl")
        sh = S(TAU * t * 6) * 0.015
        if kind == "rear":
            up = ramp(t, 0, 0.35)
            roar = S(TAU * t * 2) * 0.1
            p = {"pelvis": (-0.6 * up, 0, 0), "spine": (-0.2 * up, 0, 0), "thigh_l": (0.6 * up, 0, 0), "thigh_r": (0.6 * up, 0, 0), "shin_l": (-0.2 * up, 0, 0), "shin_r": (-0.2 * up, 0, 0),
                 "upperarm_l": (-0.6 * up, 0, -0.4 * up), "upperarm_r": (-0.6 * up, 0, 0.4 * up), "forearm_l": (-0.8 * up, 0, 0), "forearm_r": (-0.8 * up, 0, 0),
                 "neck": (0.5 * up, 0, 0), "head": (-0.4 * up + roar, 0, 0), "jaw": (0.8 * up, 0, 0)}
            p["_root"] = (sh, -0.05 * up, 0.12 * up)
            return p
        if kind == "paw":
            scrape = S(TAU * t * 2)
            return {"upperarm_r": (0.4 * max(0, scrape) - 0.5 * max(0, -scrape), 0, 0), "forearm_r": (-0.6 * max(0, -scrape), 0, 0),
                    "neck": (0.45, 0, sh * 3), "head": (0.2, 0, 0), "thigh_l": (-0.2, 0, 0), "thigh_r": (-0.2, 0, 0), "shin_l": (0.4, 0, 0), "shin_r": (0.4, 0, 0),
                    "jaw": (0.3, 0, 0), "_root": (sh, 0, -0.04)}
        return {"neck": (0.3, 0, sh * 4), "head": (-0.2, 0, 0), "jaw": (0.45 + S(TAU * t * 3) * 0.12, 0, 0),
                "thigh_l": (-0.25, 0, 0), "thigh_r": (-0.25, 0, 0), "shin_l": (0.5, 0, 0), "shin_r": (0.5, 0, 0),
                "upperarm_l": (0.2, 0, 0), "upperarm_r": (0.2, 0, 0), "tail1": (0.35, 0, 0), "tail2": (0.2, 0, 0), "_root": (sh, 0, -0.08)}

    def hit(t):
        k = S(math.pi * t)
        return {"spine": (-0.15 * k, 0, 0.1 * k), "neck": (-0.3 * k, 0, 0.2 * k), "head": (-0.2 * k, 0, 0), "jaw": (0.4 * k, 0, 0), "_root": (0, -0.08 * k, 0)}

    def death(t):
        k = ramp(t, 0, 0.7)
        p = {"neck": (0.5 * k, 0, 0.4 * k), "head": (0.3 * k, 0, 0), "jaw": (0.5 * k, 0, 0),
             "upperarm_l": (-0.4 * k, 0, 0), "upperarm_r": (0.3 * k, 0, 0), "thigh_l": (0.5 * k, 0, 0), "thigh_r": (-0.3 * k, 0, 0),
             "pelvis": (0, 1.4 * k, 0), "tail1": (0.3 * k, 0, 0)}
        p["_root"] = (-0.25 * k, 0, -o.get("drop", 0.45) * k)
        return p

    return {"idle": (60, idle), "walk": (30, walk), "run": (16 if not sprawl else 20, run), "attack": (24, attack),
            "windup": (30, windup), "hit": (10, hit), "death": (36, death)}


def teeth(P, J, rows=7, spread=0.05, top=0.25, length=0.06, fang=0.06):
    y0 = J["skull"][0][1] - 0.06
    y1 = J["nose"][0][1] + 0.04
    for sn, sg in sides():
        for i in range(rows):
            y = y0 + (y1 - y0) * i / (rows - 1)
            big = fang if i == rows - 1 else 0
            P.cone((sg * spread, y, top), (sg * spread, y - 0.005, top - length - big), 0.012 + big * 0.15, "horn", "snout")
            P.cone((sg * spread * 0.85, y + 0.01, top - 0.03), (sg * spread * 0.85, y + 0.008, top - 0.03 + length * 0.8 + big * 0.6), 0.01 + big * 0.1, "horn", "jaw")


def claws(P, J, n=4, size=0.1, r=0.014):
    for sn, sg in sides():
        for paw, bone in ((f"paw_{sn}", f"paw_{sn}"), (f"hpaw_{sn}", f"foot_{sn}")):
            p = Vector(J[paw][0])
            for c in range(n):
                cx = (c - (n - 1) / 2)
                P.cone((p.x + cx * 0.02, p.y + 0.01, p.z + 0.005), (p.x + cx * 0.028, p.y - size, p.z - size * 0.35), r, "horn", bone, segs=5, curve=0.3, side=(0, 0, -1))


def ridge(P, pts, kind="horn", curve=0.2):
    for bone, (x, y, z), h in pts:
        P.cone((x, y, z - 0.03), (x, y + h * 0.6, z + h), h * 0.28, kind, bone, segs=5, curve=curve, side=(0, 1, 0), snap=True)


def build_quad(name, J, *, extra=(), detail=0.035, ridge_amt=0.9, scales=0.012, seed=11, colour=None):
    desc = {"joints": J, "bones": QUAD_BONES, "extra": QUAD_EXTRA + list(extra), "root_joint": "mid"}
    arm = K.build_armature(name, desc)
    body = K.build_body(f"{name}_body", desc, detail=detail, seed=seed, ridge=ridge_amt, scales=scales)
    K.colour(body, **(colour or {}))
    return arm, body, K.Parts(name, body)


def wolf():
    J = mirror_joints({
        "hips": ((0, 0.5, 0.12), (0.21, 0.23)), "mid": ((0, 0.05, 0.16), (0.17, 0.2)), "chest": ((0, -0.36, 0.17), (0.28, 0.34)),
        "neckend": ((0, -0.62, 0.32), (0.16, 0.18)), "skull": ((0, -0.78, 0.37), (0.15, 0.15)), "nose": ((0, -1.14, 0.3), (0.06, 0.06)),
        "jawhinge": ((0, -0.74, 0.25), (0.09, 0.07)), "chin": ((0, -1.06, 0.2), (0.045, 0.035)),
        "t1": ((0, 0.86, 0.12), (0.09, 0.09)), "t2": ((0, 1.18, 0.04), (0.07, 0.07)), "t3": ((0, 1.5, -0.04), (0.035, 0.035)),
        "shoulder_l": ((0.16, -0.32, 0.1), (0.12, 0.14)), "elbow_l": ((0.19, -0.27, -0.26), (0.085, 0.085)),
        "wrist_l": ((0.19, -0.33, -0.6), (0.055, 0.055)), "paw_l": ((0.19, -0.43, -0.69), (0.065, 0.04)),
        "hip_l": ((0.15, 0.48, 0.08), (0.14, 0.16)), "knee_l": ((0.18, 0.32, -0.27), (0.095, 0.095)),
        "hock_l": ((0.18, 0.6, -0.5), (0.055, 0.055)), "hpaw_l": ((0.18, 0.52, -0.69), (0.065, 0.04)),
        "scap_l": ((0.12, -0.42, 0.42), (0.1, 0.07)), "keel": ((0, -0.4, -0.13), (0.15, 0.13)), "rib_l": ((0.2, -0.16, 0.06), (0.11, 0.15)),
        "haunch_l": ((0.13, 0.4, 0.24), (0.12, 0.12)), "scruff": ((0, -0.52, 0.45), (0.13, 0.09)), "brow_l": ((0.07, -0.82, 0.43), (0.05, 0.035)),
    })
    extra = mirror_pairs([("chest", "scap_l"), ("chest", "keel"), ("chest", "rib_l"), ("hips", "haunch_l"), ("neckend", "scruff"), ("skull", "brow_l")])
    arm, body, P = build_quad("wolf", J, extra=extra, colour=dict(belly=0.7, back=0.18, mottle=0.22, seed=4, stripes=0.12))
    teeth(P, J)
    for sn, sg in sides():
        P.eye((sg * 0.085, -0.88, 0.37), 0.024, "head")
        P.eye((sg * 0.1, -0.82, 0.41), 0.014, "head")
        P.cone((sg * 0.08, -0.72, 0.46), (sg * 0.13, -0.58, 0.66), 0.05, "dark", "head", segs=5, curve=0.15, side=(0, 1, 0))
        for k in range(3):
            P.plate((sg * 0.2, -0.42 + k * 0.12, 0.34 - k * 0.03), (0.13, 0.1, 0.025), (sg * 0.55, 0.0, 1), "dark", "spine", yaw=sg * 0.2)
        for k in range(2):
            P.plate((sg * 0.17, 0.34 + k * 0.13, 0.3), (0.12, 0.09, 0.022), (sg * 0.45, 0.0, 1), "dark", "pelvis", yaw=sg * 0.15)
    claws(P, J)
    ridge(P, [("neck", (0, -0.55, 0.47), 0.06), ("spine", (0, -0.42, 0.5), 0.1), ("spine", (0, -0.28, 0.5), 0.12), ("spine", (0, -0.12, 0.45), 0.11),
              ("spine", (0, 0.02, 0.41), 0.1), ("pelvis", (0, 0.18, 0.38), 0.09), ("pelvis", (0, 0.34, 0.36), 0.08), ("tail1", (0, 0.62, 0.3), 0.06), ("tail1", (0, 0.78, 0.22), 0.045)])
    P.finish(body)
    K.skin_to(body, arm, None)
    return finish("wolf", arm, body, quad_clips({"attack": "bite", "windup": "snarl", "drop": 0.45}))


def lizard():
    J = mirror_joints({
        "hips": ((0, 0.45, 0.03), (0.19, 0.14)), "mid": ((0, 0.0, 0.04), (0.22, 0.15)), "chest": ((0, -0.42, 0.05), (0.21, 0.15)),
        "neckend": ((0, -0.7, 0.09), (0.13, 0.1)), "skull": ((0, -0.84, 0.12), (0.13, 0.09)), "nose": ((0, -1.14, 0.07), (0.05, 0.04)),
        "jawhinge": ((0, -0.82, 0.04), (0.09, 0.05)), "chin": ((0, -1.1, 0.0), (0.04, 0.03)),
        "t1": ((0, 0.88, 0.02), (0.12, 0.09)), "t2": ((0, 1.38, -0.0), (0.075, 0.055)), "t3": ((0, 1.95, -0.03), (0.025, 0.02)),
        "shoulder_l": ((0.17, -0.4, 0.02), (0.09, 0.08)), "elbow_l": ((0.42, -0.42, 0.04), (0.065, 0.06)),
        "wrist_l": ((0.46, -0.48, -0.24), (0.045, 0.045)), "paw_l": ((0.5, -0.57, -0.29), (0.055, 0.025)),
        "hip_l": ((0.16, 0.42, 0.02), (0.1, 0.09)), "knee_l": ((0.44, 0.4, 0.05), (0.07, 0.065)),
        "hock_l": ((0.48, 0.5, -0.24), (0.045, 0.045)), "hpaw_l": ((0.52, 0.41, -0.29), (0.055, 0.025)),
        "throat": ((0, -0.62, -0.06), (0.1, 0.07)), "flank_l": ((0.2, 0.0, 0.02), (0.1, 0.11)),
    })
    extra = mirror_pairs([("neckend", "throat"), ("mid", "flank_l")])
    arm, body, P = build_quad("lizard", J, extra=extra, scales=0.02, ridge_amt=0.5, seed=21,
                              colour=dict(belly=0.72, back=0.2, mottle=0.25, seed=8, stripes=0.2))
    teeth(P, J, rows=8, spread=0.045, top=0.06, length=0.045, fang=0.03)
    for sn, sg in sides():
        P.eye((sg * 0.095, -0.9, 0.16), 0.022, "head")
        P.cone((sg * 0.07, -0.78, 0.18), (sg * 0.12, -0.6, 0.32), 0.03, "horn", "head", segs=5, curve=0.3, side=(0, 1, 0))
        P.cone((sg * 0.1, -0.76, 0.13), (sg * 0.2, -0.62, 0.22), 0.022, "horn", "head", segs=5, curve=0.3, side=(0, 1, 0))
    # a crest of glowing spines that crackle like its lightning, and a glowing throat sac
    pts = []
    for i in range(12):
        y = -0.6 + i * 0.16
        bone = "neck" if y < -0.45 else "spine" if y < 0.05 else "pelvis" if y < 0.5 else "tail1"
        h = 0.07 + 0.1 * math.sin(min(1, (i + 1) / 10) * math.pi)
        pts.append((bone, (0, y, 0.17 if y < 0.6 else 0.12), h))
    ridge(P, pts, kind="glow", curve=0.25)
    P.plate((0, -0.62, -0.12), (0.08, 0.12, 0.02), (0, 0, -1), "glow", "neck")
    claws(P, J, n=3, size=0.07, r=0.01)
    P.finish(body)
    K.skin_to(body, arm, None)
    return finish("lizard", arm, body, quad_clips({"sprawl": True, "attack": "bite", "windup": "snarl", "drop": 0.12}))


def rhino():
    J = mirror_joints({
        "hips": ((0, 0.55, 0.16), (0.4, 0.4)), "mid": ((0, 0.0, 0.2), (0.44, 0.44)), "chest": ((0, -0.5, 0.2), (0.46, 0.48)),
        "neckend": ((0, -0.86, 0.15), (0.3, 0.3)), "skull": ((0, -1.05, 0.08), (0.23, 0.22)), "nose": ((0, -1.4, -0.03), (0.13, 0.12)),
        "jawhinge": ((0, -1.0, -0.06), (0.15, 0.09)), "chin": ((0, -1.32, -0.12), (0.08, 0.05)),
        "t1": ((0, 0.86, 0.12), (0.08, 0.08)), "t2": ((0, 1.02, 0.0), (0.05, 0.05)), "t3": ((0, 1.12, -0.1), (0.03, 0.03)),
        "shoulder_l": ((0.27, -0.5, -0.02), (0.18, 0.18)), "elbow_l": ((0.3, -0.48, -0.25), (0.15, 0.15)),
        "wrist_l": ((0.3, -0.5, -0.44), (0.12, 0.12)), "paw_l": ((0.3, -0.56, -0.5), (0.14, 0.07)),
        "hip_l": ((0.26, 0.55, 0.0), (0.2, 0.2)), "knee_l": ((0.29, 0.48, -0.25), (0.15, 0.15)),
        "hock_l": ((0.29, 0.6, -0.42), (0.12, 0.12)), "hpaw_l": ((0.29, 0.54, -0.5), (0.14, 0.07)),
        "hump": ((0, -0.42, 0.62), (0.3, 0.16)), "belly": ((0, 0.0, -0.18), (0.36, 0.2)),
    })
    extra = mirror_pairs([("chest", "hump"), ("mid", "belly")])
    arm, body, P = build_quad("rhino", J, extra=extra, detail=0.045, ridge_amt=1.2, scales=0.01, seed=31,
                              colour=dict(belly=0.6, back=0.3, mottle=0.18, seed=9))
    # the great horn, a second horn, and a bony frill behind the skull
    P.cone((0, -1.32, 0.06), (0, -1.55, 0.62), 0.11, "horn", "snout", segs=8, curve=0.25, side=(0, 1, 0))
    P.cone((0, -1.1, 0.24), (0, -1.18, 0.5), 0.07, "horn", "head", segs=7, curve=0.2, side=(0, 1, 0))
    for sn, sg in sides():
        P.eye((sg * 0.17, -1.12, 0.14), 0.02, "head")
        P.plate((sg * 0.22, -0.88, 0.36), (0.18, 0.22, 0.03), (sg * 0.6, 0.5, 1), "horn", "neck", yaw=sg * 0.4)
        P.cone((sg * 0.28, -0.82, 0.42), (sg * 0.45, -0.7, 0.68), 0.05, "horn", "neck", segs=6, curve=0.2, side=(0, 1, 0))
        for k in range(5):
            P.plate((sg * 0.38, -0.55 + k * 0.24, 0.32), (0.16, 0.13, 0.035), (sg * 0.7, 0, 1), "dark", "spine" if k < 2 else "pelvis", yaw=sg * 0.1)
            P.plate((sg * 0.48, -0.5 + k * 0.24, 0.05), (0.12, 0.12, 0.03), (sg * 1, 0, 0.2), "dark", "spine" if k < 2 else "pelvis")
    for k in range(6):
        y = -0.6 + k * 0.24
        P.plate((0, y, 0.66 if y < -0.2 else 0.62), (0.16, 0.13, 0.04), (0, 0, 1), "dark", "spine" if y < 0.1 else "pelvis")
    claws(P, J, n=3, size=0.06, r=0.03)
    P.finish(body)
    K.skin_to(body, arm, None)
    return finish("rhino", arm, body, quad_clips({"heavy": 0.8, "attack": "gore", "windup": "paw", "drop": 0.3}))


def bear():
    J = mirror_joints({
        "hips": ((0, 0.45, 0.18), (0.33, 0.34)), "mid": ((0, 0.0, 0.26), (0.36, 0.38)), "chest": ((0, -0.42, 0.3), (0.4, 0.42)),
        "neckend": ((0, -0.72, 0.28), (0.22, 0.23)), "skull": ((0, -0.88, 0.28), (0.2, 0.19)), "nose": ((0, -1.14, 0.2), (0.085, 0.075)),
        "jawhinge": ((0, -0.84, 0.17), (0.12, 0.08)), "chin": ((0, -1.08, 0.11), (0.06, 0.04)),
        "t1": ((0, 0.72, 0.18), (0.08, 0.07)), "t2": ((0, 0.8, 0.12), (0.05, 0.05)), "t3": ((0, 0.86, 0.06), (0.03, 0.03)),
        "shoulder_l": ((0.24, -0.42, 0.08), (0.16, 0.17)), "elbow_l": ((0.27, -0.4, -0.22), (0.13, 0.13)),
        "wrist_l": ((0.27, -0.46, -0.5), (0.11, 0.11)), "paw_l": ((0.27, -0.58, -0.59), (0.13, 0.06)),
        "hip_l": ((0.22, 0.45, 0.05), (0.18, 0.19)), "knee_l": ((0.25, 0.32, -0.25), (0.13, 0.13)),
        "hock_l": ((0.25, 0.52, -0.48), (0.1, 0.1)), "hpaw_l": ((0.25, 0.42, -0.59), (0.13, 0.06)),
        "hump": ((0, -0.32, 0.68), (0.3, 0.2)), "ear_l": ((0.13, -0.8, 0.44), (0.05, 0.04)),
    })
    extra = mirror_pairs([("chest", "hump"), ("skull", "ear_l")])
    arm, body, P = build_quad("bear", J, extra=extra, detail=0.05, ridge_amt=1.0, scales=0.0, seed=41,
                              colour=dict(belly=0.65, back=0.4, mottle=0.2, seed=10))
    teeth(P, J, rows=6, spread=0.06, top=0.17, length=0.05, fang=0.07)
    for sn, sg in sides():
        P.eye((sg * 0.09, -0.98, 0.32), 0.022, "head")
        P.eye((sg * 0.12, -0.92, 0.36), 0.013, "head")
    claws(P, J, n=4, size=0.2, r=0.022)
    # ice crystals growing out of the back and shoulders
    rnd = random.Random(5)
    for i in range(16):
        y = -0.55 + rnd.random() * 1.0
        x = (rnd.random() - 0.5) * 0.5
        z = 0.75 if y < -0.1 else 0.55
        h = 0.1 + rnd.random() * 0.22
        P.cone((x, y, z - 0.05), (x * 1.6, y + 0.05, z + h), 0.04 + h * 0.15, "glow", "spine" if y < 0.05 else "pelvis", segs=5, snap=True)
    P.finish(body)
    K.skin_to(body, arm, None)
    return finish("bear", arm, body, quad_clips({"heavy": 0.5, "attack": "swipe", "windup": "rear", "drop": 0.4}))


# ---------------------------------------------------------------- raptor --
def raptor():
    J = mirror_joints({
        "hips": ((0, 0.28, 0.0), (0.15, 0.16)), "chest": ((0, -0.22, 0.03), (0.2, 0.22)), "neckend": ((0, -0.5, 0.14), (0.09, 0.09)),
        "skull": ((0, -0.62, 0.17), (0.09, 0.085)), "nose": ((0, -0.9, 0.07), (0.03, 0.035)), "jawhinge": ((0, -0.62, 0.11), (0.06, 0.04)),
        "chin": ((0, -0.85, 0.05), (0.025, 0.02)), "t1": ((0, 0.55, 0.02), (0.08, 0.035)), "t2": ((0, 0.82, 0.03), (0.04, 0.02)),
        "shoulder_l": ((0.14, -0.2, 0.1), (0.07, 0.06)), "elbow_l": ((0.55, -0.12, 0.12), (0.055, 0.04)),
        "wrist_l": ((0.95, -0.2, 0.1), (0.04, 0.03)), "tip_l": ((1.45, 0.02, 0.07), (0.02, 0.015)),
        "hip_l": ((0.08, 0.12, -0.1), (0.07, 0.07)), "knee_l": ((0.1, 0.0, -0.3), (0.05, 0.05)),
        "ankle_l": ((0.1, 0.06, -0.45), (0.03, 0.03)), "talon_l": ((0.1, -0.08, -0.5), (0.04, 0.02)),
    })
    bones = mirror_bones([
        ("pelvis", None, "hips", "chest"), ("neck", "pelvis", "chest", "neckend"), ("head", "neck", "neckend", "skull"),
        ("snout", "head", "skull", "nose"), ("jaw", "head", "jawhinge", "chin"), ("tail1", "pelvis", "hips", "t1"), ("tail2", "tail1", "t1", "t2"),
        ("wing1_l", "pelvis", "shoulder_l", "elbow_l"), ("wing2_l", "wing1_l", "elbow_l", "wrist_l"), ("wing3_l", "wing2_l", "wrist_l", "tip_l"),
        ("thigh_l", "pelvis", "hip_l", "knee_l"), ("shin_l", "thigh_l", "knee_l", "ankle_l"), ("foot_l", "shin_l", "ankle_l", "talon_l"),
    ])
    desc = {"joints": J, "bones": bones, "extra": mirror_pairs([("chest", "shoulder_l"), ("hips", "hip_l"), ("neckend", "jawhinge")]), "root_joint": "chest"}
    arm = K.build_armature("raptor", desc)
    body = K.build_body("raptor_body", desc, detail=0.02, seed=51, ridge=0.4, scales=0.008, scale_size=40)
    K.colour(body, belly=0.7, back=0.25, mottle=0.2, seed=12, stripes=0.15)
    P = K.Parts("raptor", body)
    P.cone((0, -0.72, 0.12), (0, -0.95, 0.02), 0.045, "horn", "snout", segs=6, curve=0.3, side=(0, 0, -1))
    for sn, sg in sides():
        P.eye((sg * 0.06, -0.68, 0.2), 0.016, "head")
        P.cone((sg * 0.04, -0.6, 0.24), (sg * 0.07, -0.42, 0.34), 0.025, "dark", "head", segs=5, curve=0.2, side=(0, 1, 0))
        # blade feathers: secondaries along the forearm, long primaries off the hand with glowing edges
        for k in range(6):
            a = Vector(J[f"elbow_{sn}"][0]).lerp(Vector(J[f"wrist_{sn}"][0]), k / 5)
            P.plate((a.x, a.y + 0.22, a.z), (0.05, 0.22, 0.008), (0, 0, 1), "dark", f"wing2_{sn}", yaw=sg * -0.15)
        for k in range(6):
            a = Vector(J[f"wrist_{sn}"][0]).lerp(Vector(J[f"tip_{sn}"][0]), k / 5)
            L = 0.38 - k * 0.04
            P.plate((a.x, a.y + L * 0.7, a.z - 0.005), (0.045, L, 0.008), (0, 0, 1), "dark", f"wing3_{sn}", yaw=sg * (-0.3 - k * 0.08))
            P.plate((a.x + sg * 0.015, a.y + L * 1.3, a.z), (0.012, L * 0.4, 0.006), (0, 0, 1), "glow", f"wing3_{sn}", yaw=sg * (-0.3 - k * 0.08), bevel=False)
        for k in range(4):
            a = Vector(J[f"shoulder_{sn}"][0]).lerp(Vector(J[f"elbow_{sn}"][0]), k / 3)
            P.plate((a.x, a.y + 0.16, a.z), (0.06, 0.16, 0.008), (0, 0, 1), "dark", f"wing1_{sn}")
        p = Vector(J[f"talon_{sn}"][0])
        for c in (-1, 0, 1):
            P.cone((p.x + c * 0.02, p.y + 0.03, p.z + 0.02), (p.x + c * 0.03, p.y - 0.06, p.z - 0.05), 0.012, "horn", f"foot_{sn}", segs=5, curve=0.4, side=(0, 0, -1))
    for k in range(5):
        P.plate(((k - 2) * 0.05, 0.85, 0.03), (0.035, 0.22, 0.006), (0, 0, 1), "dark", "tail2", yaw=(k - 2) * 0.25)
    P.finish(body)
    K.skin_to(body, arm, None)

    def flap(t, amp=0.9, sweep=0.0):
        a = TAU * t
        f = S(a)
        out = {}
        for sn, sg in sides():
            out[f"wing1_{sn}"] = (0, sg * f * amp * 0.8, -sg * sweep)
            out[f"wing2_{sn}"] = (0, sg * S(a - 0.5) * amp * 0.5, -sg * sweep * 0.6)
            out[f"wing3_{sn}"] = (0, sg * S(a - 1.0) * amp * 0.4, -sg * sweep * 0.8)
            out[f"thigh_{sn}"] = (0.6, 0, 0)
            out[f"shin_{sn}"] = (-0.8, 0, 0)
        out["tail1"] = (S(a) * 0.1, 0, 0)
        out["_root"] = (0, 0, -f * 0.05 * amp)
        return out

    def idle(t):
        p = flap(t, 0.8)
        p["neck"] = (S(TAU * t) * 0.05, 0, S(TAU * t * 0.5) * 0.3)
        return p

    def run(t):
        # a fast glide: wings swept back, small beats
        p = flap(t, 0.25, sweep=0.55)
        p["neck"] = (0.1, 0, 0)
        return p

    def attack(t):
        # fold and dive, talons thrown forward, then beat away
        d = ramp(t, 0, 0.35) * (1 - ramp(t, 0.6, 1))
        p = flap(t * 2, 0.3 * (1 - d))
        for sn, sg in sides():
            p[f"wing1_{sn}"] = (0, sg * 0.6 * d, -sg * 0.9 * d)
            p[f"wing2_{sn}"] = (0, 0, -sg * 0.6 * d)
            p[f"thigh_{sn}"] = (-1.2 * d + 0.6 * (1 - d), 0, 0)
            p[f"shin_{sn}"] = (-0.2 * d - 0.8 * (1 - d), 0, 0)
        p["neck"] = (-0.3 * d, 0, 0)
        p["jaw"] = (0.6 * d, 0, 0)
        p["_root"] = (0, 0.3 * d, -0.2 * d)
        return p

    def windup(t):
        # wings flung wide, head thrown back, a screech
        p = {}
        for sn, sg in sides():
            p[f"wing1_{sn}"] = (0, sg * -0.5, 0)
            p[f"wing2_{sn}"] = (0, sg * -0.2, 0)
            p[f"wing3_{sn}"] = (0, sg * 0.3, 0)
            p[f"thigh_{sn}"] = (0.4, 0, 0)
        p["neck"] = (-0.6, 0, S(TAU * t * 3) * 0.1)
        p["head"] = (-0.3, 0, 0)
        p["jaw"] = (0.7, 0, 0)
        return p

    def hit(t):
        k = S(math.pi * t)
        p = flap(t, 0.5)
        p["pelvis"] = (0, 0.5 * k, 0)
        p["neck"] = (-0.3 * k, 0, 0)
        return p

    def death(t):
        k = ramp(t, 0, 0.8)
        p = {}
        for sn, sg in sides():
            p[f"wing1_{sn}"] = (0, sg * 0.9 * k, 0)
            p[f"wing2_{sn}"] = (0, sg * -1.5 * k, 0)
        p["pelvis"] = (2.5 * k, 1.2 * k, 0)
        p["neck"] = (0.8 * k, 0, 0)
        p["_root"] = (0, 0, -0.8 * k)
        return p

    return finish("raptor", arm, body, {"idle": (40, idle), "walk": (20, lambda t: flap(t, 1.0)), "run": (24, run), "attack": (30, attack),
                                         "windup": (30, windup), "hit": (10, hit), "death": (36, death)})


# ---------------------------------------------------------------- mantis --
def mantis():
    J = mirror_joints({
        "waist": ((0, 0.12, 0.06), (0.11, 0.1)), "thorax": ((0, -0.18, 0.1), (0.13, 0.12)), "abd": ((0, 0.5, 0.16), (0.24, 0.2)),
        "abd_end": ((0, 1.0, 0.22), (0.08, 0.07)), "pro": ((0, -0.52, 0.36), (0.075, 0.075)), "neckend": ((0, -0.64, 0.48), (0.06, 0.06)),
        "skull": ((0, -0.72, 0.53), (0.11, 0.08)), "nose": ((0, -0.84, 0.47), (0.04, 0.03)), "jawhinge": ((0, -0.74, 0.47), (0.04, 0.03)),
        "chin": ((0, -0.84, 0.42), (0.02, 0.02)),
        "coxa1_l": ((0.1, -0.12, 0.05), (0.045, 0.045)), "fem1_l": ((0.42, -0.28, 0.26), (0.035, 0.035)), "tib1_l": ((0.56, -0.4, -0.41), (0.02, 0.02)),
        "coxa2_l": ((0.1, 0.18, 0.04), (0.045, 0.045)), "fem2_l": ((0.44, 0.36, 0.28), (0.035, 0.035)), "tib2_l": ((0.62, 0.58, -0.41), (0.02, 0.02)),
        "sh_l": ((0.07, -0.48, 0.32), (0.055, 0.055)), "el_l": ((0.16, -0.74, 0.12), (0.045, 0.045)), "blade_l": ((0.16, -0.6, 0.48), (0.035, 0.03)),
    })
    bones = mirror_bones([
        ("pelvis", None, "waist", "thorax"), ("abdomen", "pelvis", "waist", "abd"), ("abdomen2", "abdomen", "abd", "abd_end"),
        ("pro", "pelvis", "thorax", "pro"), ("neck", "pro", "pro", "neckend"), ("head", "neck", "neckend", "skull"),
        ("snout", "head", "skull", "nose"), ("jaw", "head", "jawhinge", "chin"),
        ("leg1_l", "pelvis", "coxa1_l", "fem1_l"), ("leg1b_l", "leg1_l", "fem1_l", "tib1_l"),
        ("leg2_l", "pelvis", "coxa2_l", "fem2_l"), ("leg2b_l", "leg2_l", "fem2_l", "tib2_l"),
        ("arm_l", "pro", "sh_l", "el_l"), ("fore_l", "arm_l", "el_l", "blade_l"),
    ])
    extra = mirror_pairs([("thorax", "coxa1_l"), ("waist", "coxa2_l"), ("pro", "sh_l"), ("neckend", "jawhinge")])
    desc = {"joints": J, "bones": bones, "extra": extra, "root_joint": "thorax"}
    arm = K.build_armature("mantis", desc)
    body = K.build_body("mantis_body", desc, detail=0.012, seed=61, ridge=0.3, scales=0.006, scale_size=50)
    K.colour(body, belly=0.55, back=0.22, mottle=0.15, seed=14, stripes=0.25)
    P = K.Parts("mantis", body)
    for sn, sg in sides():
        # a cluster of eyes, mandibles, serrated scythes with glowing edges, wing-shells
        P.eye((sg * 0.09, -0.74, 0.56), 0.035, "head")
        for k in range(3):
            P.eye((sg * (0.03 + k * 0.025), -0.76, 0.6), 0.012, "head")
        P.cone((sg * 0.04, -0.82, 0.45), (sg * 0.01, -0.92, 0.38), 0.018, "horn", "jaw", segs=5, curve=0.3, side=(-sg, 0, 0))
        e, b = Vector(J[f"el_{sn}"][0]), Vector(J[f"blade_{sn}"][0])
        d = b - e
        P.cone(tuple(b - d * 0.1), tuple(b + d * 0.45 + Vector((0, -0.08, 0.05))), 0.035, "horn", f"fore_{sn}", segs=6, curve=0.35, side=(0, -1, 0))
        for k in range(5):
            q = e.lerp(b, 0.2 + k * 0.16)
            P.cone(tuple(q), tuple(q + Vector((0, -0.06, -0.01))), 0.01, "horn", f"fore_{sn}", segs=4)
        P.plate(tuple(e.lerp(b, 0.5) + Vector((0, -0.03, 0))), (0.012, d.length * 0.45, 0.006), (1, 0, 0), "glow", f"fore_{sn}", bevel=False)
        P.plate((sg * 0.1, 0.45, 0.33), (0.1, 0.42, 0.012), (sg * 0.3, 0, 1), "dark", "abdomen", yaw=sg * 0.08)
        for k in range(3):
            P.cone((sg * 0.18, 0.3 + k * 0.2, 0.2), (sg * 0.3, 0.32 + k * 0.2, 0.32), 0.02, "horn", "abdomen", segs=4, snap=True)
    P.finish(body)
    K.skin_to(body, arm, None)

    def legs(t, amp, lift):
        out = {}
        for sn, sg in sides():
            for bone, sub, off in ((f"leg1_{sn}", f"leg1b_{sn}", 0.0), (f"leg2_{sn}", f"leg2b_{sn}", 0.5)):
                a = TAU * (t + off + (0.5 if sn == "r" else 0))
                out[bone] = (0, sg * max(0.0, C(a)) * lift, -sg * S(a) * amp)
                out[sub] = (0, -sg * max(0.0, C(a)) * lift * 0.5, 0)
        return out

    def guard(k=1.0):
        out = {}
        for sn, sg in sides():
            out[f"arm_{sn}"] = (-0.1 * k, 0, 0)
            out[f"fore_{sn}"] = (0.2 * k, 0, 0)
        return out

    def idle(t):
        return {**guard(), "pro": (S(TAU * t) * 0.05, 0, S(TAU * t * 0.5) * 0.12), "head": (0, 0, S(TAU * t + 1) * 0.3), "abdomen": (S(TAU * t) * 0.04, 0, 0)}

    def walk(t):
        p = legs(t, 0.35, 0.45)
        p.update(guard())
        p["pro"] = (0, 0, S(TAU * t) * 0.08)
        return p

    def run(t):
        p = legs(t, 0.55, 0.7)
        p.update(guard())
        p["pro"] = (0.25, 0, 0)
        p["_root"] = (0, 0, abs(S(TAU * t * 2)) * 0.03)
        return p

    def attack(t):
        # both scythes snap out and rake down
        raise_k = ramp(t, 0, 0.35) * (1 - ramp(t, 0.35, 0.5))
        strike = ramp(t, 0.35, 0.5) * (1 - ramp(t, 0.65, 1))
        p = {}
        for sn, sg in sides():
            p[f"arm_{sn}"] = (-1.1 * raise_k + 0.6 * strike, 0, sg * 0.3 * raise_k)
            p[f"fore_{sn}"] = (-0.9 * raise_k - 1.0 * strike, 0, 0)
        p["pro"] = (-0.3 * raise_k + 0.35 * strike, 0, 0)
        p["jaw"] = (0.5 * strike, 0, 0)
        p["_root"] = (0, 0.25 * strike, 0)
        return p

    def windup(t):
        # the threat display: scythes raised and spread, swaying
        p = {}
        for sn, sg in sides():
            p[f"arm_{sn}"] = (-1.2, 0, sg * 0.6)
            p[f"fore_{sn}"] = (-0.6 + S(TAU * t * 2) * 0.1, 0, 0)
        p["pro"] = (-0.35, 0, S(TAU * t) * 0.2)
        p["abdomen"] = (-0.3, 0, 0)
        p["jaw"] = (0.4, 0, 0)
        return p

    def hit(t):
        k = S(math.pi * t)
        return {**guard(), "pro": (-0.4 * k, 0, 0.2 * k), "_root": (0, -0.06 * k, 0)}

    def death(t):
        k = ramp(t, 0, 0.7)
        p = {}
        for sn, sg in sides():
            for b in (f"leg1_{sn}", f"leg2_{sn}"):
                p[b] = (0, sg * -0.8 * k, 0)
            for b in (f"leg1b_{sn}", f"leg2b_{sn}"):
                p[b] = (0, sg * -1.0 * k, 0)
            p[f"arm_{sn}"] = (0.8 * k, 0, 0)
        p["pelvis"] = (0, 2.6 * k, 0)
        p["_root"] = (0, 0, -0.1 * k)
        return p

    return finish("mantis", arm, body, {"idle": (60, idle), "walk": (24, walk), "run": (14, run), "attack": (24, attack),
                                         "windup": (40, windup), "hit": (10, hit), "death": (36, death)})


# ------------------------------------------------------------------ wyrm --
def wyrm():
    J = {"mid": ((0, 0.2, 0.0), (0.27, 0.25))}
    for i in range(1, 5):
        J[f"f{i}"] = ((0, 0.2 - i * 0.42, 0.02 + i * 0.01), (0.27 - i * 0.015, 0.25 - i * 0.015))
    for i in range(1, 6):
        r = 0.26 * (1 - i / 6.5)
        J[f"b{i}"] = ((0, 0.2 + i * 0.45, -0.02), (r, r * 0.92))
    J.update({
        "skull": ((0, -1.98, 0.08), (0.2, 0.16)), "nose": ((0, -2.36, 0.03), (0.08, 0.06)),
        "jawhinge": ((0, -1.92, -0.04), (0.13, 0.08)), "chin": ((0, -2.28, -0.1), (0.06, 0.04)),
    })
    bones = [("pelvis", None, "mid", "f1")]
    prev = "pelvis"
    for i in range(2, 5):
        bones.append((f"fw{i}", prev, f"f{i - 1}", f"f{i}"))
        prev = f"fw{i}"
    bones += [("neck", prev, "f4", "skull"), ("head", "neck", "skull", "nose"), ("jaw", "head", "jawhinge", "chin")]
    prev, pj = "pelvis", "mid"
    for i in range(1, 6):
        bones.append((f"bw{i}", prev, pj, f"b{i}"))
        prev, pj = f"bw{i}", f"b{i}"
    desc = {"joints": J, "bones": bones, "extra": [("skull", "jawhinge")], "root_joint": "mid"}
    arm = K.build_armature("wyrm", desc)
    body = K.build_body("wyrm_body", desc, detail=0.04, seed=71, ridge=0.7, scales=0.02, scale_size=22)
    K.colour(body, belly=0.75, back=0.22, mottle=0.2, seed=15, stripes=0.18)
    P = K.Parts("wyrm", body)
    for sn, sg in sides():
        for i in range(6):
            y = -2.02 - i * 0.05
            big = 0.08 if i == 5 else 0
            P.cone((sg * 0.07, y, -0.0), (sg * 0.07, y, -0.07 - big), 0.016 + big * 0.2, "horn", "head")
            P.cone((sg * 0.06, y + 0.02, -0.08), (sg * 0.06, y + 0.02, -0.01 + big * 0.5), 0.013, "horn", "jaw")
        P.eye((sg * 0.12, -2.1, 0.13), 0.026, "head")
        P.eye((sg * 0.14, -2.02, 0.17), 0.015, "head")
        # swept-back horns and a bony frill
        P.cone((sg * 0.1, -1.92, 0.18), (sg * 0.28, -1.5, 0.42), 0.05, "horn", "neck", segs=6, curve=0.3, side=(0, 1, 0))
        for k in range(4):
            a = -0.6 + k * 0.35
            P.plate((sg * 0.2, -1.78, 0.12 + k * 0.02), (0.05, 0.18, 0.012), (sg * math.cos(a), 0.3, math.sin(a) + 0.4), "horn", "neck", yaw=sg * 0.5)
    # armour scutes, flank plates and spines down the back
    for i, bone in enumerate(["fw4", "fw3", "fw2", "pelvis", "bw1", "bw2", "bw3", "bw4", "bw5"]):
        b = arm.data.bones[bone]
        c = (b.head_local + b.tail_local) / 2
        r = 0.24 * (1 - i / 11)
        P.plate((c.x, c.y, c.z + r * 0.95), (r * 0.7, 0.18, 0.025), (0, 0, 1), "dark", bone)
        P.cone((c.x, c.y, c.z + r * 1.05), (c.x, c.y + 0.1, c.z + r * 1.05 + 0.14 * (1 - i / 12)), 0.035, "horn", bone, segs=5, curve=0.2, side=(0, 1, 0), snap=True)
        for sn, sg in sides():
            P.plate((sg * r * 0.8, c.y, c.z + r * 0.45), (0.1, 0.14, 0.02), (sg, 0, 0.6), "dark", bone)
    P.finish(body)
    K.skin_to(body, arm, None)
    chain_f = ["pelvis", "fw2", "fw3", "fw4", "neck"]
    chain_b = ["bw1", "bw2", "bw3", "bw4", "bw5"]

    def wave(t, amp, k=1.2):
        out = {}
        for i, b in enumerate(chain_f):
            out[b] = (0, 0, S(TAU * t + i * k) * amp * (0.6 if b == "neck" else 1))
        for i, b in enumerate(chain_b):
            out[b] = (0, 0, S(TAU * t - (i + 1) * k) * amp * (1 + i * 0.15))
        return out

    def idle(t):
        p = wave(t * 0.5, 0.06)
        p["fw4"] = (-0.25, 0, p["fw4"][2])
        p["neck"] = (-0.35 + S(TAU * t) * 0.05, 0, S(TAU * t) * 0.25)
        p["head"] = (0.35, 0, 0)
        p["jaw"] = (max(0, S(TAU * t * 2)) * 0.15, 0, 0)
        return p

    def walk(t):
        p = wave(t, 0.22)
        p["head"] = (0, 0, -p["neck"][2] * 0.8)
        return p

    def run(t):
        p = wave(t, 0.32, 1.4)
        p["head"] = (0, 0, -p["neck"][2] * 0.9)
        return p

    def attack(t):
        coil = ramp(t, 0, 0.35) * (1 - ramp(t, 0.35, 0.45))
        strike = ramp(t, 0.35, 0.45) * (1 - ramp(t, 0.6, 1))
        p = wave(t, 0.08)
        p["fw3"] = (-0.4 * coil + 0.1 * strike, 0, 0.5 * coil)
        p["fw4"] = (-0.5 * coil + 0.3 * strike, 0, -0.9 * coil)
        p["neck"] = (-0.3 * coil + 0.2 * strike, 0, 0.6 * coil)
        p["head"] = (0.2 * coil - 0.1 * strike, 0, 0)
        p["jaw"] = (0.9 * ramp(t, 0.25, 0.4) * (1 - ramp(t, 0.5, 0.56)), 0, 0)
        p["_root"] = (0, 0.6 * strike - 0.1 * coil, 0)
        return p

    def windup(t):
        # rears up: the front of the body lifts, the jaws gape
        up = ramp(t, 0, 0.3)
        sway = S(TAU * t) * 0.15
        p = wave(t, 0.06)
        p["fw2"] = (-0.2 * up, 0, sway)
        p["fw3"] = (-0.25 * up, 0, -sway)
        p["fw4"] = (-0.15 * up, 0, sway)
        p["neck"] = (0.35 * up, 0, 0)
        p["head"] = (0.2 * up, 0, 0)
        p["jaw"] = (0.8 * up, 0, 0)
        return p

    def hit(t):
        k = S(math.pi * t)
        p = wave(t, 0.1)
        p["neck"] = (-0.4 * k, 0, 0.3 * k)
        p["jaw"] = (0.5 * k, 0, 0)
        return p

    def death(t):
        k = ramp(t, 0, 0.8)
        p = wave(t * 0.3, 0.25 * (1 - k))
        p["pelvis"] = (0, 1.6 * k, p["pelvis"][2])
        p["neck"] = (0.3 * k, 0, 0.5 * k)
        p["jaw"] = (0.6 * k, 0, 0)
        return p

    return finish("wyrm", arm, body, {"idle": (60, idle), "walk": (30, walk), "run": (20, run), "attack": (30, attack),
                                       "windup": (40, windup), "hit": (10, hit), "death": (40, death)})


# ----------------------------------------------------------------- golem --
def golem():
    J = mirror_joints({
        "hips": ((0, 0.04, -0.05), (0.32, 0.27)), "mid": ((0, 0.0, 0.25), (0.3, 0.27)), "chest": ((0, -0.06, 0.6), (0.48, 0.38)),
        "neckend": ((0, -0.16, 0.86), (0.19, 0.18)), "skull": ((0, -0.26, 0.96), (0.2, 0.18)),
        "shoulder_l": ((0.55, -0.04, 0.72), (0.27, 0.27)), "elbow_l": ((0.73, -0.06, 0.25), (0.19, 0.19)),
        "wrist_l": ((0.8, -0.16, -0.2), (0.17, 0.17)), "fist_l": ((0.82, -0.22, -0.48), (0.27, 0.24)),
        "hip_l": ((0.22, 0.05, -0.12), (0.24, 0.24)), "knee_l": ((0.28, -0.05, -0.56), (0.2, 0.2)),
        "ankle_l": ((0.3, 0.05, -0.94), (0.17, 0.15)), "toe_l": ((0.3, -0.16, -1.02), (0.2, 0.1)),
        "back": ((0, 0.18, 0.72), (0.38, 0.28)),
    })
    bones = mirror_bones([
        ("pelvis", None, "hips", "mid"), ("spine", "pelvis", "mid", "chest"), ("neck", "spine", "chest", "neckend"), ("head", "neck", "neckend", "skull"),
        ("upperarm_l", "spine", "shoulder_l", "elbow_l"), ("forearm_l", "upperarm_l", "elbow_l", "wrist_l"), ("fist_l", "forearm_l", "wrist_l", "fist_l"),
        ("thigh_l", "pelvis", "hip_l", "knee_l"), ("shin_l", "thigh_l", "knee_l", "ankle_l"), ("foot_l", "shin_l", "ankle_l", "toe_l"),
    ])
    desc = {"joints": J, "bones": bones, "extra": mirror_pairs([("chest", "shoulder_l"), ("hips", "hip_l"), ("chest", "back")]), "root_joint": "mid"}
    arm = K.build_armature("golem", desc)
    body = K.build_body("golem_body", desc, detail=0.09, seed=81, ridge=1.4, scales=0.0)
    K.colour(body, belly=0.55, back=0.35, mottle=0.25, seed=16)
    P = K.Parts("golem", body)
    rnd = random.Random(9)
    # rock slabs over shoulders, back, forearms and thighs
    slabs = [("spine", (0, 0.2, 0.85), (0, 0.6, 1), 0.3), ("spine", (0, -0.25, 0.75), (0, -0.7, 1), 0.25)]
    for sn, sg in sides():
        slabs += [("upperarm_" + sn, (sg * 0.62, -0.04, 0.95), (sg * 0.4, 0, 1), 0.26), ("upperarm_" + sn, (sg * 0.82, -0.04, 0.6), (sg, 0, 0.3), 0.2),
                  ("forearm_" + sn, (sg * 0.92, -0.1, 0.0), (sg, -0.3, 0), 0.18), ("fist_" + sn, (sg * 0.86, -0.42, -0.45), (0, -1, 0.2), 0.2),
                  ("thigh_" + sn, (sg * 0.42, -0.1, -0.3), (sg, -0.4, 0), 0.18), ("shin_" + sn, (sg * 0.32, -0.22, -0.72), (0, -1, 0.2), 0.16)]
    for bone, c, n, size in slabs:
        P.plate(c, (size, size * (0.7 + rnd.random() * 0.5), size * 0.25), n, "stone", bone, yaw=rnd.random())
    # a crown of crystal, glowing eye slits, crystal spines down the back
    for k in range(5):
        a = (k - 2) * 0.35
        P.cone((math.sin(a) * 0.12, -0.24, 1.08), (math.sin(a) * 0.28, -0.14, 1.36 - abs(k - 2) * 0.06), 0.05, "glow", "head", segs=5)
    for sn, sg in sides():
        P.plate((sg * 0.08, -0.43, 0.98), (0.06, 0.012, 0.015), (0, -1, 0), "eye", "head", bevel=False)
    for k in range(5):
        P.cone(((rnd.random() - 0.5) * 0.3, 0.25, 0.55 + k * 0.1), ((rnd.random() - 0.5) * 0.4, 0.6, 0.7 + k * 0.12), 0.05, "glow", "spine", segs=5, snap=True)
    P.finish(body)
    K.skin_to(body, arm, None)

    def walk_pose(t, amp, heavy=1.0):
        a = TAU * t
        p = {}
        for sn, sg, off in (("l", 1, 0.0), ("r", -1, math.pi)):
            s = S(a + off)
            p[f"thigh_{sn}"] = (-s * amp, 0, 0)
            p[f"shin_{sn}"] = (max(0.0, -C(a + off)) * amp * 1.2, 0, 0)
            p[f"upperarm_{sn}"] = (s * amp * 0.8, 0, 0)
            p[f"forearm_{sn}"] = (-0.2, 0, 0)
        p["spine"] = (0.15, 0, S(a) * 0.08 * heavy)
        p["pelvis"] = (0, S(a) * 0.05, 0)
        p["_root"] = (0, 0, abs(C(a)) * 0.04 - 0.02)
        return p

    def idle(t):
        b = S(TAU * t)
        return {"spine": (0.12 + b * 0.03, 0, 0), "neck": (0.1, 0, S(TAU * t * 0.5) * 0.15), "upperarm_l": (0.05, 0, b * 0.03), "upperarm_r": (0.05, 0, -b * 0.03), "_root": (0, 0, b * 0.01)}

    def attack(t):
        # both fists overhead, then down like a falling mountain
        up = ramp(t, 0, 0.4) * (1 - ramp(t, 0.4, 0.55))
        slam = ramp(t, 0.4, 0.55) * (1 - ramp(t, 0.75, 1))
        p = {}
        for sn, sg in sides():
            p[f"upperarm_{sn}"] = (-2.6 * up - 0.6 * slam, 0, -sg * 0.3 * up)
            p[f"forearm_{sn}"] = (-0.8 * up + 0.2 * slam, 0, 0)
            p[f"thigh_{sn}"] = (-0.3 * slam, 0, 0)
            p[f"shin_{sn}"] = (0.4 * slam, 0, 0)
        p["spine"] = (-0.35 * up + 0.6 * slam, 0, 0)
        p["neck"] = (-0.2 * up + 0.2 * slam, 0, 0)
        p["_root"] = (0, 0.1 * slam, -0.15 * slam)
        return p

    def windup(t):
        # fists raised, chest thrown open, a grinding roar
        sh = S(TAU * t * 5) * 0.01
        p = {}
        for sn, sg in sides():
            p[f"upperarm_{sn}"] = (-1.2, 0, -sg * 0.9)
            p[f"forearm_{sn}"] = (-1.0, 0, 0)
        p["spine"] = (-0.3, 0, 0)
        p["neck"] = (-0.4, 0, 0)
        p["_root"] = (sh, 0, 0)
        return p

    def hit(t):
        k = S(math.pi * t)
        return {"spine": (-0.2 * k, 0, 0.15 * k), "neck": (-0.2 * k, 0, 0), "_root": (0, -0.05 * k, 0)}

    def death(t):
        k = ramp(t, 0, 0.9)
        return {"spine": (0.6 * k, 0, 0), "thigh_l": (-0.9 * k, 0, 0), "thigh_r": (-0.9 * k, 0, 0), "shin_l": (1.4 * k, 0, 0), "shin_r": (1.4 * k, 0, 0),
                "upperarm_l": (-0.8 * k, 0, 0), "upperarm_r": (-0.6 * k, 0, 0), "_root": (0, 0.3 * k, -0.6 * k)}

    return finish("golem", arm, body, {"idle": (60, idle), "walk": (40, lambda t: walk_pose(t, 0.35)), "run": (26, lambda t: walk_pose(t, 0.6, 1.5)),
                                        "attack": (36, attack), "windup": (40, windup), "hit": (10, hit), "death": (48, death)})


PLANS = {"wolf": wolf, "lizard": lizard, "rhino": rhino, "bear": bear, "raptor": raptor, "mantis": mantis, "wyrm": wyrm, "golem": golem}


# ---------------------------------------------------------------- output --
def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def preview(arm, body, name, path, poses):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x, scene.render.resolution_y = 800, 520
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.16, 0.17, 0.2, 1)
    scene.world = w
    sun = link(bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")))
    sun.data.energy = 3.5
    sun.rotation_euler = (0.9, 0.2, 2.4)
    cam = link(bpy.data.objects.new("cam", bpy.data.cameras.new("cam")))
    cam.data.lens = 50
    scene.camera = cam
    vs = [v.co for v in body.data.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    target = (lo + hi) / 2
    d = max((hi - lo).length * 1.2, 2.5)
    for act_name, frame, az in poses:
        act = bpy.data.actions[f"{name}|{act_name}"]
        arm.animation_data.action = act
        if hasattr(arm.animation_data, "action_slot") and len(act.slots):
            arm.animation_data.action_slot = act.slots[0]
        scene.frame_set(frame)
        cam.location = target + Vector((math.sin(az) * d, -math.cos(az) * d, d * 0.28))
        cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(path, f"{name}-{act_name}-{frame}.png")
        bpy.ops.render.render(write_still=True)


os.makedirs(args.out, exist_ok=True)
for name, fn in PLANS.items():
    if args.only and name not in args.only.split(","):
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    K.MATS.clear()
    arm, body = fn()
    print("BEAST", name, "verts", len(body.data.vertices), "bones", len(arm.data.bones))
    if args.preview:
        preview(arm, body, name, args.preview, [("idle", 1, -2.3), ("run", 5, -1.4), ("attack", 13, -1.1), ("windup", 12, -2.5)])
    arm.animation_data.action = None
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    body.select_set(True)
    out = os.path.join(args.out, f"{name}.glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_skins=True, export_animations=True,
                              export_animation_mode="ACTIONS", export_force_sampling=True, export_optimize_animation_size=True,
                              export_yup=True, export_apply=False, export_vertex_color="ACTIVE")
    print("EXPORTED", out, os.path.getsize(out))
