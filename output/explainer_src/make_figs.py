import math, numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, Circle, Wedge, FancyBboxPatch, FancyArrowPatch, Polygon

import os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fig") + os.sep
os.makedirs(OUT, exist_ok=True)
INK = "#1F2933"; GREY = "#8A94A6"; LIGHT = "#E5E9F0"
BLUE = "#3B6EA8"; TEAL = "#0F766E"; ORANGE = "#C2410C"; GOLD = "#B7791F"; GREEN="#2F855A"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11, "axes.edgecolor": INK,
                     "axes.labelcolor": INK, "xtick.color": INK, "ytick.color": INK,
                     "axes.spines.top": False, "axes.spines.right": False})

def box(ax, x, y, w, h, text, fc="white", ec=INK, fs=10, lw=1.4, bold=False, tc=INK):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.02,rounding_size=0.15",
                                fc=fc, ec=ec, lw=lw))
    ax.text(x + w/2, y + h/2, text, ha="center", va="center", fontsize=fs, color=tc,
            fontweight="bold" if bold else "normal", wrap=True)

def arrow(ax, x1, y1, x2, y2, color=INK, lw=1.6, style="-|>"):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle=style, mutation_scale=14,
                                 color=color, lw=lw))

# ---------- Figure 1: scores ----------
fig, ax = plt.subplots(figsize=(9, 4.6))
runs = ["PPO_25\nknown target", "PPO_27", "PPO_28", "PPO_29", "PPO_30\n200k", "PPO_30\n500k", "PPO_31\n160k*"]
vals = [93, 64, 71, 69, 53, 39, 20]
cols = [BLUE, TEAL, TEAL, TEAL, ORANGE, ORANGE, ORANGE]
bars = ax.bar(runs, vals, color=cols, width=0.62)
for b, v in zip(bars, vals):
    ax.text(b.get_x() + b.get_width()/2, v + 1.5, f"{v}%", ha="center", fontsize=11, color=INK, fontweight="bold")
ax.axhspan(60, 78, color=TEAL, alpha=0.08)
ax.text(6.45, 79.2, "≈ noise band of a 100-maze exam\n(anything from 60% to 78% is a tie with 69%)",
        ha="right", va="bottom", fontsize=8.5, color=TEAL)
ax.axvline(0.5, color=GREY, ls="--", lw=1)
ax.text(0, 100, "EASIER exam:\ntarget location\nalways given", ha="center", va="bottom", fontsize=8.5, color=BLUE)
ax.text(3.5, 100, "HARDER exam: target hidden until seen  (teal = plain brain,  orange = memory brain / LSTM)",
        ha="center", va="bottom", fontsize=8.5, color=INK)
ax.set_ylim(0, 112); ax.set_ylabel("Success on the fixed 100-maze exam")
ax.set_yticks([0, 20, 40, 60, 80, 100])
fig.text(0.99, 0.01, "*PPO_31: 25-maze checkpoint, not a final exam", ha="right", fontsize=8, color=GREY)
plt.tight_layout(rect=(0,0.03,1,1)); plt.savefig(OUT + "fig_scores.png", dpi=200); plt.close()

# ---------- Figure 2: the arena / what Leaper senses ----------
fig, ax = plt.subplots(figsize=(7.2, 7.2))
L = 31.25
ax.add_patch(Rectangle((-L, -L), 2*L, 2*L, fc="#FAFBFC", ec=INK, lw=1.5))
obst = [(-18, 12, 3.2), (-4, 20, 3.0), (10, 14, 2.8), (16, -6, 3.4), (-12, -16, 2.6), (4, -22, 3.1)]
for ox, oz, r in obst:
    ax.add_patch(Circle((ox, oz), r, fc=LIGHT, ec=GREY, lw=1.2))
rx, rz, yaw = -6, -4, math.radians(35)  # yaw measured from +z axis clockwise-ish; we draw in x/z plane
# vision wedge: 270 degrees centred on facing. facing vector = (sin yaw, cos yaw)
face_deg = math.degrees(math.atan2(math.cos(yaw), math.sin(yaw)))  # angle in matplotlib convention
ax.add_patch(Wedge((rx, rz), 28, face_deg - 135, face_deg + 135, fc=TEAL, alpha=0.10, ec=TEAL, lw=1))
# 16 rays
for i in range(16):
    a = math.radians(face_deg - 135 + (i + 0.5) * 270/16)
    ex, ez = rx + 28*math.cos(a), rz + 28*math.sin(a)
    ax.plot([rx, ex], [rz, ez], color=TEAL, lw=0.7, alpha=0.6)
ax.add_patch(Circle((rx, rz), 1.4, fc=INK, ec=INK))
ax.annotate("Leaper", (rx, rz), (rx - 11, rz - 9), fontsize=10, color=INK,
            arrowprops=dict(arrowstyle="-", color=INK, lw=0.8))
# target hidden behind obstacle at (16,-6): place target beyond it along the line
tx, tz = 24, -8
ax.add_patch(Rectangle((tx-1.4, tz-1.4), 2.8, 2.8, fc="#E879A0", ec=INK, lw=1))
ax.annotate("target (hidden behind a rock,\nso Leaper gets NO direction to it)", (tx, tz), (2, -29), fontsize=9,
            color=INK, arrowprops=dict(arrowstyle="-", color=INK, lw=0.8))
ax.text(rx + 2, rz + 30.5, "270° sight cone, reach 28 units", fontsize=9, color=TEAL, ha="center")
ax.text(-L+1, L-2.5, "Arena 62.5 × 62.5 units, 6 random rocks", fontsize=9, color=INK)
ax.text(rx - 30*0.35, rz - 30*0.9, "blind 90° wedge\nbehind her", fontsize=8.5, color=GREY, ha="center")
ax.set_xlim(-L-2, L+2); ax.set_ylim(-L-2, L+2); ax.set_aspect("equal"); ax.axis("off")
plt.tight_layout(); plt.savefig(OUT + "fig_arena.png", dpi=200); plt.close()

# ---------- Figure 3: plain brain vs memory brain ----------
fig, axes = plt.subplots(1, 2, figsize=(10, 4.4))
for ax in axes: ax.set_xlim(0, 10); ax.set_ylim(0, 10); ax.axis("off")
ax = axes[0]
ax.text(5, 9.6, "Plain brain (PPO_25 … PPO_29)", ha="center", fontsize=12, fontweight="bold", color=TEAL)
box(ax, 1, 7.2, 8, 1.4, "26 sense numbers\n(target note, heading, last action, 16 rays)", fc="#F1F5F9")
arrow(ax, 5, 7.2, 5, 5.9)
box(ax, 2, 4.2, 6, 1.7, "Small reflex brain\n12,000 knobs", fc="#D9F0EC", ec=TEAL, bold=True)
arrow(ax, 5, 4.2, 5, 2.9)
box(ax, 2.5, 1.5, 5, 1.4, "throttle + turn", fc="#F1F5F9")
ax.text(5, 0.5, "Every step is judged fresh. No memory of previous steps\n(except the notes the game hands it).",
        ha="center", fontsize=8.5, color=GREY)
ax = axes[1]
ax.text(5, 9.6, "Memory brain / LSTM (PPO_30, PPO_31)", ha="center", fontsize=12, fontweight="bold", color=ORANGE)
box(ax, 1, 7.9, 8, 1.1, "the same 26 sense numbers", fc="#F1F5F9")
arrow(ax, 5, 7.9, 5, 6.9)
box(ax, 0.8, 5.2, 7.0, 1.7, "Learned notepad (LSTM, 256 cells)\nrewrites itself every step; rays included", fc="#FDE8DC", ec=ORANGE, bold=True, fs=9.5)
arrow(ax, 5, 5.2, 5, 4.2)
box(ax, 2, 2.7, 6, 1.5, "Reflex brain, now reading 256 notepad\nvalues instead of the 26 senses", fc="#FDE8DC", ec=ORANGE)
arrow(ax, 5, 2.7, 5, 1.7)
box(ax, 2.5, 0.4, 5, 1.2, "throttle + turn", fc="#F1F5F9")
ax.annotate("", xy=(7.8, 6.6), xytext=(7.8, 5.5), arrowprops=dict(arrowstyle="-|>", color=ORANGE, lw=1.2,
            connectionstyle="arc3,rad=-1.8"))
ax.text(9.2, 6.05, "carried\nto the\nnext step", fontsize=7.5, color=ORANGE, ha="center", va="center")
plt.tight_layout(); plt.savefig(OUT + "fig_two_brains.png", dpi=200); plt.close()

# ---------- Figure 4: sizes ----------
fig, ax = plt.subplots(figsize=(9, 3.2))
names = ["PPO_29 plain brain", "PPO_30 memory brain (1 layer)", "PPO_31 memory brain (2 layers)"]
sizes = [11973, 623045, 1675717]
cols = [TEAL, ORANGE, ORANGE]
y = [2, 1, 0]
for yi, n, s, c in zip(y, names, sizes, cols):
    ax.barh(yi, s, color=c, height=0.55)
    ax.text(s + 25000, yi, f"{s:,} knobs  ({s/11973:.0f}×)" if s > 20000 else f"{s:,} knobs", va="center", fontsize=10, color=INK)
ax.set_yticks(y); ax.set_yticklabels(names)
ax.set_xlim(0, 2_300_000); ax.set_xticks([]); ax.spines["bottom"].set_visible(False)
ax.set_title("Knobs (parameters) to tune — all three got roughly the same amount of practice", fontsize=10.5, color=INK, loc="left")
plt.tight_layout(); plt.savefig(OUT + "fig_sizes.png", dpi=200); plt.close()

# ---------- Figure 5: PPO_31 curve ----------
fig, ax = plt.subplots(figsize=(9, 3.6))
steps = list(range(10, 170, 10))
succ = [0,0,0,0,0,4,8,12,12,24,20,16,24,20,24,20]
ax.plot(steps, succ, marker="o", color=ORANGE, lw=2)
ax.axhline(69, color=TEAL, ls="--", lw=1.4); ax.text(162, 71, "PPO_29 plain brain: 69%", ha="right", color=TEAL, fontsize=9)
ax.axhline(39, color=ORANGE, ls=":", lw=1.2); ax.text(162, 41, "PPO_30 memory brain (final): 39%", ha="right", color=ORANGE, fontsize=9)
ax.axvspan(100, 165, color=ORANGE, alpha=0.07); ax.text(132, 30, "flat, wobbling 16-24%", ha="center", fontsize=9, color=ORANGE)
ax.axvline(163.8, color=GREY, lw=1); ax.text(164.5, 55, "process ended\n(no error saved)", fontsize=8.5, color=GREY)
ax.set_xlabel("training steps (thousands)"); ax.set_ylabel("success, 25-maze spot-check")
ax.set_ylim(0, 80); ax.set_xlim(5, 185)
plt.tight_layout(); plt.savefig(OUT + "fig_ppo31_curve.png", dpi=200); plt.close()

# ---------- Figure 6: freeze fix ----------
fig, axes = plt.subplots(1, 2, figsize=(9, 3.4))
ax = axes[0]
b = ax.bar(["PPO_28", "PPO_29"], [56.7, 6.3], color=[GREY, TEAL], width=0.55)
for bi, v in zip(b, [56.7, 6.3]): ax.text(bi.get_x()+bi.get_width()/2, v+1.5, f"{v}%", ha="center", fontweight="bold")
ax.set_ylim(0, 70); ax.set_title("Steps spent standing still", fontsize=10.5, loc="left")
ax = axes[1]
b = ax.bar(["PPO_28", "PPO_29"], [71, 69], color=[GREY, TEAL], width=0.55)
for bi, v in zip(b, [71, 69]): ax.text(bi.get_x()+bi.get_width()/2, v+1.5, f"{v}%", ha="center", fontweight="bold")
ax.set_ylim(0, 100); ax.set_title("Success on the 100-maze exam", fontsize=10.5, loc="left")
ax.text(0.5, 88, "a tie", ha="center", color=GREY, fontsize=9)
plt.tight_layout(); plt.savefig(OUT + "fig_freeze.png", dpi=200); plt.close()

# ---------- Figure 7: recommended architecture ----------
fig, ax = plt.subplots(figsize=(10, 5.6)); ax.set_xlim(0, 10); ax.set_ylim(0, 10); ax.axis("off")
ax.text(5, 9.65, "Recommended: keep the walker, add memory as extra notes written by the game", ha="center", fontsize=12, fontweight="bold", color=INK)
# left column inputs
box(ax, 0.3, 7.3, 2.9, 1.5, "Body senses\nheading, last action,\ncollision, 16 rays", fc="#F1F5F9")
box(ax, 0.3, 5.0, 2.9, 1.5, "Target sightings\n(only when actually in view)", fc="#F1F5F9")
box(ax, 0.3, 2.7, 2.9, 1.5, "Where Leaper has been\nand what she has seen", fc="#F1F5F9")
# middle: notepads
box(ax, 3.9, 5.0, 2.7, 1.5, "TARGET NOTE\nlast seen where, how long\nago, (later) moving which way", fc="#FFF4E0", ec=GOLD, bold=True, fs=9)
box(ax, 3.9, 2.7, 2.7, 1.5, "CLEARED MAP\n'no target here yet' for\nevery patch already checked", fc="#FFF4E0", ec=GOLD, bold=True, fs=9)
ax.text(5.25, 1.9, "written by the game engine,\nplain numbers, fully inspectable", ha="center", fontsize=8.5, color=GOLD)
# right: walker
box(ax, 7.3, 3.6, 2.4, 3.6, "WALKER BRAIN\n(PPO_29 weights kept)\n\nnew inputs start at\nzero so old reflexes\nare untouched", fc="#D9F0EC", ec=TEAL, bold=True, fs=9.5)
box(ax, 7.4, 1.0, 2.2, 1.2, "throttle + turn", fc="#F1F5F9")
arrow(ax, 3.2, 8.05, 7.3, 6.3)
arrow(ax, 3.2, 5.75, 3.9, 5.75); arrow(ax, 6.6, 5.75, 7.3, 5.6)
arrow(ax, 3.2, 3.45, 3.9, 3.45); arrow(ax, 6.6, 3.45, 7.3, 4.2)
arrow(ax, 8.5, 3.6, 8.5, 2.2)
ax.text(6.3, 9.05, "body senses go STRAIGHT to the walker — no memory in the way", ha="center", fontsize=9, color=TEAL)
plt.tight_layout(); plt.savefig(OUT + "fig_recommended.png", dpi=200); plt.close()

# ---------- Figure 8: cleared map illustration ----------
fig, ax = plt.subplots(figsize=(7.2, 7.2))
n = 21; cell = 2*L/n
grid = np.zeros((n, n))
# path of robot: a few positions with cones marking cleared cells
path = [(-24, -22, 60), (-14, -10, 40), (-2, 2, 20), (8, 10, -30), (14, 0, -80)]
def in_cone(cx, cz, px, pz, face, rng=28, fov=270):
    dx, dz = cx-px, cz-pz; d = math.hypot(dx, dz)
    if d > rng: return False
    ang = math.degrees(math.atan2(dz, dx)); rel = (ang - face + 180) % 360 - 180
    return abs(rel) <= fov/2
for i in range(n):
    for j in range(n):
        cx, cz = -L + (i+0.5)*cell, -L + (j+0.5)*cell
        for (px, pz, face) in path:
            blocked = False
            for ox, oz, r in obst:
                # crude occlusion: cell behind rock if rock lies between and near the line
                vx, vz = cx-px, cz-pz; ux, uz = ox-px, oz-pz
                dl = math.hypot(vx, vz)
                if dl < 1e-6: continue
                t = (ux*vx+uz*vz)/(dl*dl)
                if 0 < t < 1:
                    qx, qz = px+t*vx, pz+t*vz
                    if math.hypot(qx-ox, qz-oz) < r: blocked = True; break
            if in_cone(cx, cz, px, pz, face) and not blocked:
                grid[i, j] = 1; break
for i in range(n):
    for j in range(n):
        cx, cz = -L + i*cell, -L + j*cell
        ax.add_patch(Rectangle((cx, cz), cell, cell, fc=("#CFE9E4" if grid[i,j] else "white"), ec="#E3E7ED", lw=0.5))
for ox, oz, r in obst:
    ax.add_patch(Circle((ox, oz), r, fc=LIGHT, ec=GREY, lw=1.2))
xs = [p[0] for p in path]; zs = [p[1] for p in path]
ax.plot(xs, zs, color=INK, lw=1.5, ls="--")
ax.add_patch(Circle((xs[-1], zs[-1]), 1.4, fc=INK))
ax.add_patch(Rectangle((-22-1.4, 22-1.4), 2.8, 2.8, fc="#E879A0", ec=INK, lw=1))
ax.text(-22, 26.5, "target still hidden\n(never in view)", ha="center", fontsize=9, color=INK)
ax.add_patch(Rectangle((-L, -L), 2*L, 2*L, fc="none", ec=INK, lw=1.5))
ax.text(-L+1, -L-2.6, "shaded = 'cleared': a target here would already have been spotted", fontsize=9, color=TEAL)
ax.text(-L+1, -L-4.6, "white = still unknown  →  the map says 'search up-left next', without ever revealing the target", fontsize=9, color=INK)
ax.set_xlim(-L-2, L+2); ax.set_ylim(-L-6, L+2); ax.set_aspect("equal"); ax.axis("off")
plt.tight_layout(); plt.savefig(OUT + "fig_cleared_map.png", dpi=200); plt.close()

# ---------- Figure 9: roadmap ----------
fig, ax = plt.subplots(figsize=(10, 3.6)); ax.set_xlim(0, 10); ax.set_ylim(0.8, 7.6); ax.axis("off")
phases = [
 ("Phase 0\n(1 hour)", "Close the books on\nPPO_31: run the 160k\ncheckpoint on the\n100-maze exam; record.", GREY),
 ("Phase 1\n(½ day)", "PPO_32: plain brain +\nCLEARED MAP inputs,\nwarm-started from PPO_29.\n3 seeds × 250k.", TEAL),
 ("Phase 2\n(1-2 days)", "Slow, visible, moving\ntarget. Target note gains\n'moving which way'.\nMeasure tracking error.", GOLD),
 ("Phase 3\n(2-3 days)", "Occlusions grow longer.\nOnly if the note fails:\nadd a SMALL target-only\nmemory (32-64 cells).", ORANGE),
 ("Phase 4\n(ongoing)", "Curriculum: denser\nrocks, faster target,\nfull game distribution.", BLUE),
]
x = 0.2
for title, body, c in phases:
    box(ax, x, 5.0, 1.8, 1.2, title, fc=c, ec=c, tc="white", bold=True, fs=9.5)
    box(ax, x, 1.2, 1.8, 3.6, body, fc="white", ec=c, fs=8.2)
    if x < 8: arrow(ax, x+1.85, 5.6, x+1.95, 5.6, color=INK)
    x += 1.98
ax.text(0.2, 7.1, "Gate between phases: the 100-maze deterministic exam, 3 training seeds, and a written go / no-go number.",
        fontsize=9.5, color=INK)
ax.text(0.2, 6.5, "Fallback at every step: PPO_29 (69%) stays the champion until something beats it by more than the noise band.",
        fontsize=9.5, color=GREY)
plt.tight_layout(); plt.savefig(OUT + "fig_roadmap.png", dpi=200); plt.close()

# ---------- Figure 10: reward for a moving target ----------
fig, ax = plt.subplots(figsize=(9, 3.6)); ax.set_xlim(0, 10); ax.set_ylim(0, 4); ax.axis("off")
# Leaper at (1,2) moves to (2.2,2); target at (7,2) moves to (8.5,2)
ax.add_patch(Circle((1, 2), 0.25, fc=INK)); ax.add_patch(Circle((2.2, 2), 0.25, fc=INK, alpha=0.45))
arrow(ax, 1.3, 2, 1.95, 2)
ax.add_patch(Rectangle((6.8, 1.8), 0.4, 0.4, fc="#E879A0", ec=INK)); ax.add_patch(Rectangle((8.3, 1.8), 0.4, 0.4, fc="#E879A0", ec=INK, alpha=0.45))
arrow(ax, 7.3, 2, 8.2, 2, color="#E879A0")
ax.plot([2.2, 6.8], [2.75, 2.75], color=TEAL, lw=1.5); ax.text(4.5, 2.95, "score Leaper's step against where the target WAS", ha="center", color=TEAL, fontsize=9.5)
ax.plot([2.2, 8.3], [1.2, 1.2], color=GREY, lw=1.5, ls="--"); ax.text(5.25, 0.85, "not against where it is NOW (the target's own move would change the score)", ha="center", color=GREY, fontsize=9.5)
ax.text(1, 3.4, "Leaper", ha="center", fontsize=9); ax.text(7, 3.4, "target", ha="center", fontsize=9)
plt.tight_layout(); plt.savefig(OUT + "fig_moving_reward.png", dpi=200); plt.close()

# ---------- Figure 11: what goes into memory ----------
fig, ax = plt.subplots(figsize=(10, 3.9)); ax.set_xlim(0, 10); ax.set_ylim(0, 10); ax.axis("off")
box(ax, 0.3, 6.2, 4.4, 3.2, "GOES INTO THE TARGET MEMORY\n\n• target seen? (yes/no)\n• where it was, relative to Leaper\n• how Leaper herself moved since (step + turn)\n• how long since the last sighting", fc="#FFF4E0", ec=GOLD, fs=9.5)
box(ax, 5.3, 6.2, 4.4, 3.2, "STAYS OUT (goes straight to the walker)\n\n• the 16 obstacle rays\n• collision flag\n• last throttle / turn\n(unless a controlled test proves they help)", fc="#D9F0EC", ec=TEAL, fs=9.5)
box(ax, 0.3, 1.2, 9.4, 3.8, "WHY: target motion can be worked out from sightings + Leaper's own movement alone.\n"
    "Rays describe rocks, not the target; feeding them into memory lets a confused memory\n"
    "distort an obstacle reflex that already works. Search coverage needs POSITION history,\n"
    "which is far better kept as an explicit map than squeezed through a learned notepad.", fc="white", ec=GREY, fs=9.5)
plt.tight_layout(); plt.savefig(OUT + "fig_memory_inputs.png", dpi=200); plt.close()
print("figures done")

# ---------- Figure 12: the two-branch brain (owner's idea) ----------
fig, ax = plt.subplots(figsize=(10, 6.4)); ax.set_xlim(0, 10); ax.set_ylim(0, 10); ax.axis("off")
ax.text(5, 9.7, "The two-branch brain: a plain walker plus a small target-only memory", ha="center", fontsize=12, fontweight="bold", color=INK)
# inputs
box(ax, 0.3, 7.2, 3.0, 1.6, "BODY SENSES\nheading, last move, collision,\n16 obstacle rays (+ cleared map)", fc="#F1F5F9", fs=9)
box(ax, 0.3, 4.2, 3.0, 1.9, "TARGET STREAM\nseen? · where it was (relative)\nhow I moved since last step\ntime since last sighting", fc="#F1F5F9", fs=9)
# branches
box(ax, 3.9, 7.1, 2.6, 1.8, "PLAIN BRANCH\n(the PPO_29 walker,\nweights carried over)", fc="#D9F0EC", ec=TEAL, bold=True, fs=9.5)
box(ax, 3.9, 4.2, 2.3, 1.9, "MEMORY BRANCH\nLSTM, 32-64 cells\ncarried step to step", fc="#FDE8DC", ec=ORANGE, bold=True, fs=9.2)
ax.annotate("", xy=(6.2, 5.8), xytext=(6.2, 4.5), arrowprops=dict(arrowstyle="-|>", color=ORANGE, lw=1.2, connectionstyle="arc3,rad=-1.5"))
ax.text(6.9, 4.05, "remembers\nbetween steps", fontsize=7.5, color=ORANGE, ha="center", va="center")
# belief
box(ax, 3.9, 2.0, 2.6, 1.3, "BELIEF (5-8 numbers)\nwhere the target probably\nis now + how sure", fc="#FFF4E0", ec=GOLD, fs=8.8)
# join
box(ax, 7.6, 5.4, 2.1, 1.6, "JOIN\nstarts at zero,\nso day one = PPO_29", fc="white", ec=INK, fs=8.8)
box(ax, 7.6, 3.0, 2.1, 1.2, "ACTION HEAD\nthrottle + turn", fc="#F1F5F9", fs=9)
box(ax, 7.6, 1.2, 2.1, 1.2, "VALUE HEAD\nscore guess\n(training only)", fc="#F1F5F9", fs=8.6)
# teacher
box(ax, 0.3, 1.4, 3.0, 1.3, "TEACHER (training only)\nthe simulator's true target\nposition scores the belief", fc="white", ec=GREY, fs=8.6, tc=GREY)
arrow(ax, 3.3, 8.0, 3.9, 8.0); arrow(ax, 3.3, 5.15, 3.9, 5.15)
arrow(ax, 5.05, 4.2, 5.05, 3.3)
arrow(ax, 6.5, 8.0, 7.6, 6.6); arrow(ax, 6.5, 2.65, 7.6, 5.8)
arrow(ax, 8.65, 5.4, 8.65, 4.2); arrow(ax, 8.65, 3.0, 8.65, 2.4)
arrow(ax, 3.3, 2.05, 3.9, 2.35, color=GREY, style="<|-")
ax.text(5.2, 0.6, "The rays never touch the memory. The memory never touches the rays.", ha="center", fontsize=9.5, color=TEAL, fontweight="bold")
plt.tight_layout(); plt.savefig(OUT + "fig_two_branch.png", dpi=200); plt.close()

# ---------- Figure 13: how training works (PPO loop) ----------
fig, ax = plt.subplots(figsize=(10, 3.4)); ax.set_xlim(0, 10); ax.set_ylim(0, 10); ax.axis("off")
steps_ = [("1. TRY", "Leaper plays 8 arenas\nat once, with a little\ndice in every move"), ("2. SCORE", "the game hands out\npoints every step\n(+25 goal, -0.18 bump...)"),
          ("3. COMPARE", "the coach looks at which\nmoves led to more points\nthan expected"), ("4. NUDGE", "adjust the 12,000 knobs\na tiny bit toward\nthose moves")]
x = 0.3
for t, b in steps_:
    box(ax, x, 5.2, 2.1, 1.3, t, fc=TEAL, ec=TEAL, tc="white", bold=True, fs=10)
    box(ax, x, 1.3, 2.1, 3.6, b, fc="white", ec=TEAL, fs=8.8)
    if x < 7: arrow(ax, x+2.15, 5.85, x+2.35, 5.85)
    x += 2.45
ax.annotate("", xy=(0.6, 6.9), xytext=(9.0, 6.9), arrowprops=dict(arrowstyle="-|>", color=GREY, lw=1.2, connectionstyle="arc3,rad=0.25"))
ax.text(4.85, 8.9, "repeat about 60 times for a 500k run (8,192 moves per lap)", ha="center", fontsize=9, color=GREY)
plt.tight_layout(); plt.savefig(OUT + "fig_ppo_loop.png", dpi=200); plt.close()

# ---------- Figure 14: exam noise ----------
from math import comb
fig, ax = plt.subplots(figsize=(9, 3.2))
p = 0.69; xs = list(range(50, 90)); ys = [comb(100, k) * p**k * (1-p)**(100-k) * 100 for k in xs]
cols = [TEAL if 60 <= k <= 78 else LIGHT for k in xs]
ax.bar(xs, ys, color=cols, width=0.85)
ax.axvline(69, color=INK, lw=1); ax.text(57, max(ys)*0.8, "true skill 69%", fontsize=9, color=INK, ha="right")
ax.annotate("", xy=(68.6, max(ys)*0.82), xytext=(57.3, max(ys)*0.82), arrowprops=dict(arrowstyle="-|>", color=INK, lw=0.8))
ax.text(78.6, max(ys)*0.55, "95% of exams land\nbetween 60% and 78%", fontsize=9, color=TEAL)
ax.set_xlabel("score a 100-maze exam could give"); ax.set_ylabel("how often (%)")
ax.set_yticks([])
plt.tight_layout(); plt.savefig(OUT + "fig_noise.png", dpi=200); plt.close()
print("extra figures done")
