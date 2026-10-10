#!/usr/bin/env python3
"""Regenerate src/colors.json — average colour of every vanilla block.

Usage:  pip install pillow
        python3 tools/build_colors.py 1.21.10

Downloads the vanilla assets for that version from InventivetalentDev/minecraft-assets
(only block textures and blockstate names are used; textures are NOT shipped with the app),
averages each texture's opaque pixels and writes {"block_id": "rrggbb" | "rrggbbRRGGBB"}
where the optional second colour is for side faces (first = top).
"""
import glob, io, json, os, re, sys, urllib.request, zipfile
from PIL import Image

VER = sys.argv[1] if len(sys.argv) > 1 else '1.21.10'
ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, 'textures', VER)
OUT = os.path.join(ROOT, '..', 'src', 'colors.json')

if not os.path.isdir(CACHE):
    url = f'https://codeload.github.com/InventivetalentDev/minecraft-assets/zip/refs/heads/{VER}'
    print('downloading', url)
    data = urllib.request.urlopen(url).read()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for n in z.namelist():
            m = re.search(r'assets/minecraft/(textures/block|blockstates)/([^/]+)$', n)
            if m:
                dst = os.path.join(CACHE, m.group(1).split('/')[-1], m.group(2))
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                with open(dst, 'wb') as f: f.write(z.read(n))
TEX = os.path.join(CACHE, 'block')
NAMES = sorted(os.path.basename(p)[:-5] for p in glob.glob(os.path.join(CACHE, 'blockstates', '*.json')))

_cache = {}
def avg(name):
    if name in _cache: return _cache[name]
    p = os.path.join(TEX, name + '.png'); c = None
    if os.path.exists(p):
        im = Image.open(p).convert('RGBA'); w, h = im.size; im = im.crop((0, 0, w, min(h, w)))
        px = [q for q in im.getdata() if q[3] > 128]
        if px: c = tuple(sum(q[i] for q in px) / len(px) / 255 for i in range(3))
    _cache[name] = c; return c

FOLIAGE, GRASS, SPRUCE = (0.47, 0.67, 0.29), (0.55, 0.74, 0.36), (0.38, 0.6, 0.38)
SUFFIXES = ['_stairs', '_slab', '_wall', '_fence_gate', '_fence', '_pressure_plate', '_button',
            '_wall_sign', '_hanging_sign', '_sign', '_carpet']
def bases(n):
    out = [n]
    for s in SUFFIXES:
        if n.endswith(s):
            b = n[:-len(s)]; out += [b, b + 's', b + '_planks', b + '_block']
            if s == '_carpet': out.append(b + '_wool')
    out = [o.replace('waxed_', '') for o in out] + out
    more = []
    for o in out:
        if o.endswith('_wood'): more.append(o[:-5] + '_log')
        if o.startswith('smooth_'): more += [o[7:] + '_top', o[7:] + '_block_bottom']
        if o.endswith('brick'): more.append(o + 's')
    return out + more

def color(n, face):
    for b in bases(n):
        tries = [b + '_top', b + '_end', b, b + '_side'] if face == 'top' else [b + '_side', b, b + '_outside', b + '_front', b + '_top']
        for t in tries:
            c = avg(t)
            if c:
                if 'leaves' in n and 'azalea' not in n:
                    tint = SPRUCE if 'spruce' in n else FOLIAGE; c = tuple(c[i] * tint[i] * 1.6 for i in range(3))
                if n == 'grass_block' and face == 'top': c = tuple(c[i] * GRASS[i] * 1.5 for i in range(3))
                return c
    return None

COLORS16 = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray',
            'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black']
def alias(n):
    for c in COLORS16:
        if n.startswith(c + '_') and re.search(r'_(banner|wall_banner|bed|candle_cake)$', n): return c + '_wool'
    if n.endswith('_wall_hanging_sign'): return n[:-18] + '_planks'
    if n.startswith('infested_'): return n[9:]
    if n.endswith('_wall_fan'): return n[:-9] + '_fan'
    if n.endswith('_hyphae'): return n[:-7] + '_stem'
    return {'heavy_weighted_pressure_plate': 'iron_block', 'light_weighted_pressure_plate': 'gold_block',
            'bamboo': 'bamboo_stalk', 'dried_kelp_block': 'dried_kelp_side', 'copper_wall_torch': 'copper_torch'}.get(n)

MANUAL = {'lava': 'd96a1c', 'water': '4f7fc4', 'fire': 'e8962b', 'snow_block': 'f0f4f4', 'magma_block': '9a4126',
          'chest': 'a27434', 'trapped_chest': 'a27434', 'ender_chest': '1e2d2d', 'decorated_pot': '96553c',
          'player_head': '785a46', 'player_wall_head': '785a46', 'wall_torch': 'd8b45a', 'end_portal': '101820'}
hx = lambda c: '%02x%02x%02x' % tuple(int(max(0, min(1, v)) * 255) for v in c)
tab = {}
for n in NAMES:
    if n.startswith('_') or n in ('air', 'cave_air', 'void_air', 'light', 'barrier', 'structure_void'): continue
    if n in MANUAL: tab[n] = MANUAL[n]; continue
    src = n if (color(n, 'top') or color(n, 'side')) else alias(n)
    if n.startswith('potted_'): tab[n] = '8a4f3a'; continue
    if not src: continue
    t, s = color(src, 'top'), color(src, 'side')
    t = t or s; s = s or t
    if not t: continue
    if n in ('short_grass', 'tall_grass', 'fern', 'large_fern', 'vine', 'lily_pad', 'sugar_cane'):
        t = s = tuple(t[i] * FOLIAGE[i] * 1.6 for i in range(3))
    tab[n] = hx(t) if t == s else hx(t) + hx(s)
with open(OUT, 'w') as f: json.dump(tab, f, separators=(',', ':'))
print(f'{len(tab)} blocks -> {os.path.relpath(OUT)}  (blocks not listed fall back to name-based guesses)')
