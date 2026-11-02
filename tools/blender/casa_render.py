"""Photoreal renders of the Casa AMS flat in Blender (Cycles), from the planner's "Download 3D model (.glb)".

Render everything without opening Blender's window:
    blender -b -P casa_render.py -- --glb casa-ams.glb --out renders
Only set up the scene and save it, to explore it yourself in Blender:
    blender -b -P casa_render.py -- --glb casa-ams.glb --out renders --no-render
Options: --times morning,afternoon,sunset,night  --views living,kitchen,bedroom,balcony,overview
         --samples 128  --res 1600x1000  --north 0 (compass bearing the drawing's top edge faces)
         --site X,Y,Z --radius 1000 (real buildings and water around, Netherlands only: the drawing's origin in
         RD New metres and metres above NAP; also writes casa-context.glb next to the flat's .glb for Unreal)

What it does, so you can find it in the .blend: imports the flat, adds a ceiling, a sun and a physical sky
for the chosen time of day, turns the lamps' glowing parts into real lights, upgrades materials (glass,
mirrors, fabric, a real oak laminate floor from Poly Haven, CC0), adds one camera per room, renders with
the GPU (OptiX on NVIDIA).
"""
import argparse
import hashlib
import json
import math
import os
import sys
import urllib.request

import bmesh
import bpy
import mathutils


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument('--glb', required=True)
    p.add_argument('--out', default='renders')
    p.add_argument('--times', default='morning,afternoon,sunset,night')
    p.add_argument('--views', default='living,kitchen,bedroom,balcony,overview')
    p.add_argument('--samples', type=int, default=128)
    p.add_argument('--res', default='1600x1000')
    p.add_argument('--north', type=float, default=0.0)
    p.add_argument('--site', help="real surroundings (NL only): RD New x,y and NAP height in metres of the drawing's origin")
    p.add_argument('--radius', type=float, default=1000, help='metres of city around the flat, with --site')
    p.add_argument('--no-render', action='store_true')
    return p.parse_args(argv)


def plan(x, y, h=0.0):
    """Planner millimetres (x east, y south, height) -> Blender metres. The glTF import turns Y-up into Z-up."""
    return mathutils.Vector((x / 1000, -y / 1000, h / 1000))


# eye, target (planner mm, height mm), lens mm
VIEWS = {
    'living': ((3550, 850, 1550), (900, 4300, 850), 16),
    'kitchen': ((500, 5750, 1550), (3700, 2000, 1000), 16),
    'bedroom': ((5900, 1600, 1600), (4900, 5700, 650), 16),
    'balcony': ((-2300, 6150, 1600), (-800, 1500, 800), 16),
    'overview': ((-3500, 10500, 9500), (3400, 2300, 0), 26),
}
# sun elevation°, azimuth° (from north, clockwise), sun strength, sky strength, lamps on, exposure
TIMES = {
    'morning': (16, 95, 30, 0.4, False, -1.5),
    'afternoon': (42, 200, 30, 0.4, False, -1.5),
    'sunset': (3, 285, 12, 0.35, True, -0.5),
    'night': (-15, 300, 0.0, 0.02, True, 0.0),
}
INTERIOR = (-100, -2165, 9290, 6350)   # planner mm: where the ceiling goes (not over the balcony)
CEILING_H = 2600


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_flat(path):
    bpy.ops.import_scene.gltf(filepath=path)


def set_input(node, names, value):
    """Blender renames sockets between versions ('Transmission' -> 'Transmission Weight'); try each name."""
    for n in names:
        if n in node.inputs:
            node.inputs[n].default_value = value
            return True
    return False


def bsdf_of(mat):
    if not mat or not mat.use_nodes:
        return None
    return next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)


UA = {'User-Agent': 'CasaAMS-Blender/1.0 (github.com/DavideBarto/casa-ams)'}   # Poly Haven asks apps to identify themselves


def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30)


def polyhaven(asset, out_dir, res='1k'):
    """Download a CC0 texture set from Poly Haven once; returns {'diff': path, 'nor': path, 'rough': path} or {}."""
    folder = os.path.join(out_dir, 'textures', asset)
    os.makedirs(folder, exist_ok=True)
    try:
        with fetch(f'https://api.polyhaven.com/files/{asset}') as r:
            files = json.load(r)
    except OSError as e:
        print(f'[casa] no texture download ({e}); keeping the planner texture')
        return {}
    maps = {}
    for key, name in (('diff', 'Diffuse'), ('nor', 'nor_gl'), ('rough', 'Rough')):
        url = files.get(name, {}).get(res, {}).get('jpg', {}).get('url')
        if not url:
            continue
        path = os.path.join(folder, os.path.basename(url))
        try:
            if not os.path.exists(path):
                with fetch(url) as r, open(path + '.part', 'wb') as f:
                    f.write(r.read())
                os.replace(path + '.part', path)
            maps[key] = path
        except OSError as e:
            print(f'[casa] skipped {name} map ({e})')
    if 'diff' not in maps:
        return {}
    return maps


def world_mapped_image(nt, path, scale, colorspace):
    """Image texture projected from above in world space (floors), so planks keep their real size."""
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (1 / scale, 1 / scale, 1 / scale)
    nt.links.new(geo.outputs['Position'], mapping.inputs['Vector'])
    img = nt.nodes.new('ShaderNodeTexImage')
    img.image = bpy.data.images.load(path, check_existing=True)
    img.image.colorspace_settings.name = colorspace
    nt.links.new(mapping.outputs['Vector'], img.inputs['Vector'])
    return img


def upgrade_materials(out_dir):
    floor = polyhaven('laminate_floor_02', out_dir)
    for mat in bpy.data.materials:
        b = bsdf_of(mat)
        if not b:
            continue
        kind = mat.name.split('.')[0]
        nt = mat.node_tree
        if kind == 'glass':
            set_input(b, ['Transmission Weight', 'Transmission'], 1.0)
            set_input(b, ['Roughness'], 0.0)
            set_input(b, ['Alpha'], 1.0)
            set_input(b, ['Base Color'], (1, 1, 1, 1))
        elif kind == 'mirror':
            set_input(b, ['Metallic'], 1.0)
            set_input(b, ['Roughness'], 0.02)
        elif kind in ('fabric', 'drape'):
            set_input(b, ['Sheen Weight', 'Sheen'], 0.4)
            set_input(b, ['Roughness'], 1.0)
        elif kind == 'wood':
            set_input(b, ['Roughness'], 0.45)
            set_input(b, ['Coat Weight', 'Clearcoat'], 0.15)
        elif kind == 'floor-wood' and floor:
            for link in list(b.inputs['Base Color'].links):
                nt.links.remove(link)
            diff = world_mapped_image(nt, floor['diff'], 1.2, 'sRGB')
            nt.links.new(diff.outputs['Color'], b.inputs['Base Color'])
            if 'rough' in floor:
                rough = world_mapped_image(nt, floor['rough'], 1.2, 'Non-Color')
                nt.links.new(rough.outputs['Color'], b.inputs['Roughness'])
            if 'nor' in floor:
                nor_img = world_mapped_image(nt, floor['nor'], 1.2, 'Non-Color')
                nmap = nt.nodes.new('ShaderNodeNormalMap')
                nt.links.new(nor_img.outputs['Color'], nmap.inputs['Color'])
                nt.links.new(nmap.outputs['Normal'], b.inputs['Normal'])
        elif kind == 'wall':
            set_input(b, ['Roughness'], 0.9)
    for obj in bpy.data.objects:
        if obj.type == 'MESH' and any(s.material and s.material.name.split('.')[0] == 'glass' for s in obj.material_slots):
            obj.visible_shadow = False   # let the sun through the panes: Cycles won't trace sunlight through real glass


RD = 'http://www.opengis.net/def/crs/EPSG/0/28992'   # Dutch national grid: metres east / north


def cached_json(url, cache):
    path = os.path.join(cache, hashlib.md5(url.encode()).hexdigest() + '.json')
    if not os.path.exists(path):
        with fetch(url) as r, open(path + '.part', 'wb') as f:
            f.write(r.read())
        os.replace(path + '.part', path)
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except ValueError:
        os.remove(path)                                  # an error page, not data: don't keep it
        raise


def pages(url, cache):
    """Follow an OGC API's 'next' links."""
    while url:
        d = cached_json(url, cache)
        yield d
        url = next((l['href'] for l in d.get('links', []) if l.get('rel') == 'next'), None)


def inside(x, y, ring):
    c = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            c = not c
    return c


def near(x, y, ring, margin):
    """Inside the ring, or within margin of its edges."""
    if inside(x, y, ring):
        return True
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        dx, dy = x2 - x1, y2 - y1
        t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy or 1)))
        if math.hypot(x - x1 - t * dx, y - y1 - t * dy) < margin:
            return True
    return False


def thin(ring, step=2.0):
    """Drop points closer than step metres to the last one kept: BGT outlines are traced at centimetre detail."""
    kept = ring[:1]
    for p in ring[1:]:
        if math.dist(p[:2], kept[-1][:2]) >= step:
            kept.append(p)
    return kept if len(kept) >= 3 else ring


def mesh_object(name, verts, faces, mat, coll):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    coll.objects.link(obj)
    return obj


def flat_mat(name, color, roughness, **inputs):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = bsdf_of(mat)
    set_input(b, ['Base Color'], (*color, 1))
    set_input(b, ['Roughness'], roughness)
    for k, v in inputs.items():
        set_input(b, [k], v)
    return mat


def add_context(site, north, radius, cache):
    """The real city around the flat: every building from the 3D BAG (TU Delft, CC BY 4.0) with its real roof shape,
    and the water from the BGT (Dutch large-scale topography, CC0). The flat's own tower is cut off below the flat;
    other towers of the same building stay whole."""
    try:
        e0, n0, z0 = (float(v) for v in site.split(','))
    except ValueError:
        raise SystemExit(f'--site needs X,Y,Z (RD New metres and metres above NAP), got {site!r}')
    c, s = math.cos(math.radians(north)), math.sin(math.radians(north))
    local = lambda e, n, z: ((e - e0) * c - (n - n0) * s, (e - e0) * s + (n - n0) * c, z - z0)
    os.makedirs(cache, exist_ok=True)
    coll = bpy.data.collections.new('Context')
    bpy.context.scene.collection.children.link(coll)
    box = lambda r: f'{e0 - r:.0f},{n0 - r:.0f},{e0 + r:.0f},{n0 + r:.0f}'

    town, own, roofs = ([], []), ([], []), []
    for d in pages(f'https://api.3dbag.nl/collections/pand/items?bbox={box(radius)}&limit=100', cache):
        (sx, sy, sz), (tx, ty, tz) = d['metadata']['transform']['scale'], d['metadata']['transform']['translate']
        for f in d['features']:
            v = f['vertices']
            xyz = lambda i: (v[i][0] * sx + tx, v[i][1] * sy + ty, v[i][2] * sz + tz)
            mine = any(inside(e0, n0, [xyz(i)[:2] for i in g['boundaries'][0][0]])
                       for o in f['CityObjects'].values() if o['type'] == 'Building'
                       for g in o.get('geometry', []) if g['lod'] == '0')
            verts, faces = own if mine else town
            ids = {}
            for o in f['CityObjects'].values():
                for g in o.get('geometry', []):
                    if g['lod'] != '2.2':
                        continue
                    for shell in g['boundaries']:
                        for surface in shell:   # ponytail: outer ring only, holes in walls are rare in LoD 2.2
                            face = []
                            for i in surface[0]:
                                if i not in ids:
                                    ids[i] = len(verts)
                                    verts.append(local(*xyz(i)))
                                face.append(ids[i])
                            faces.append(face)
                            if mine:
                                ring = [verts[k] for k in face]
                                if max(p[2] for p in ring) - min(p[2] for p in ring) < 0.25 and ring[0][2] > 0:   # 3D BAG roofs vary by cm
                                    roofs.append([p[:2] for p in ring])     # a flat roof above the flat's floor
    building = flat_mat('context-building', (0.5, 0.48, 0.45), 0.85)
    mesh_object('Context buildings', *town, building, coll)
    if own[1]:
        tower = mesh_object('Context own building', *own, building, coll)
        bm = bmesh.new()
        bm.from_mesh(tower.data)
        # one building can hold several towers on a shared podium: remove only the flat's own tower, i.e. the roofs above
        # the flat's floor that cover it or touch one that does (setbacks, plant rooms); other towers don't touch
        region = [r for r in roofs if inside(0, 0, r)]
        grown = True
        while grown:
            grown = False
            for r in roofs:
                if r not in region and any(near(x, y, q, 1.0) for x, y in r for q in region):
                    region.append(r)
                    grown = True
        ours = lambda co: not region or any(near(co.x, co.y, r, 1.0) for r in region)
        print(f'[casa] own tower: {len(region)} roofs above the flat, cut below the flat' if region
              else '[casa] no flat roof over the flat: cutting its whole building below the flat')
        cut = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, -0.35), plane_no=(0, 0, 1))
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().z > -0.35 and ours(f.calc_center_median())], context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        bmesh.ops.holes_fill(bm, edges=[e for e in cut['geom_cut'] if isinstance(e, bmesh.types.BMEdge) and e.is_valid and e.is_boundary
                                        and ours((e.verts[0].co + e.verts[1].co) / 2)], sides=0)
        bm.to_mesh(tower.data)
        bm.free()

    ground_z = 1.0 - z0    # Amsterdam's streets are about 1 m above NAP; water drawn just above them
    water_v, water_f = [], []
    for d in pages(f'https://api.pdok.nl/lv/bgt/ogc/v1/collections/waterdeel/items?bbox={box(radius * 3)}&bbox-crs={RD}&crs={RD}&f=json&limit=1000', cache):
        for f in d['features']:
            if f['properties'].get('eind_registratie') or not f.get('geometry'):
                continue   # older versions of the same water
            g = f['geometry']
            for poly in ([g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']):
                rings = [[local(e, n, 0)[:2] + (ground_z + 0.05,) for e, n, *_ in thin(ring[:-1])] for ring in poly]
                base = len(water_v)
                water_v += [p for ring in rings for p in ring]
                water_f += [tuple(base + i for i in tri) for tri in mathutils.geometry.tessellate_polygon(rings)]
    mesh_object('Context water', water_v, water_f, flat_mat('water', (0.02, 0.05, 0.07), 0.03, IOR=1.33), coll)
    g = 20000
    mesh_object('Context ground', [(-g, -g, ground_z), (g, -g, ground_z), (g, g, ground_z), (-g, g, ground_z)], [(0, 1, 2, 3)],
                flat_mat('ground', (0.1, 0.11, 0.1), 0.9), coll)
    print(f'[casa] context: {len(town[1])} building faces, {len(water_f)} water triangles')
    return coll


def export_context(coll, path):
    """The same surroundings as a .glb for Unreal, lined up with the flat's own .glb."""
    bpy.ops.object.select_all(action='DESELECT')
    for obj in coll.objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True)
    print(f'[casa] saved {path}')


def add_ceiling():
    x1, y1, x2, y2 = INTERIOR
    c = plan((x1 + x2) / 2, (y1 + y2) / 2, CEILING_H)
    bpy.ops.mesh.primitive_plane_add(size=1, location=c)
    ceiling = bpy.context.active_object
    ceiling.name = 'Ceiling'
    ceiling.scale = ((x2 - x1) / 1000, (y2 - y1) / 1000, 1)
    mat = bpy.data.materials.new('ceiling')
    mat.use_nodes = True
    set_input(bsdf_of(mat), ['Base Color'], (0.92, 0.92, 0.9, 1))
    ceiling.data.materials.append(mat)
    return ceiling


def lamp_lights():
    """A warm point light inside every glowing lamp part (material 'light'), plus the glow itself."""
    coll = bpy.data.collections.new('Lamp lights')
    bpy.context.scene.collection.children.link(coll)
    glows, lights = [], []
    for obj in list(bpy.data.objects):
        if obj.type != 'MESH' or not any(s.material and s.material.name.split('.')[0] == 'light' for s in obj.material_slots):
            continue
        for part in (obj.parent.children_recursive if obj.parent else [obj]):
            part.visible_shadow = False                      # the lamp's own shade would otherwise trap the bulb's light
        centre = sum((obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box), mathutils.Vector()) / 8
        data = bpy.data.lights.new(f'{obj.name} light', 'POINT')
        data.energy, data.shadow_soft_size = 40, 0.06
        data.color = (1.0, 0.78, 0.55)                       # ~2700 K, like the SOLHETTA bulbs
        light = bpy.data.objects.new(data.name, data)
        light.location = centre - mathutils.Vector((0, 0, 0.05))
        coll.objects.link(light)
        lights.append(light)
    for mat in bpy.data.materials:
        if mat.name.split('.')[0] == 'light':
            glows.append(mat)
    return lights, glows


def setup_world():
    world = bpy.data.worlds.new('Sky')
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    sky = nt.nodes.new('ShaderNodeTexSky')
    types = [i.identifier for i in sky.bl_rna.properties['sky_type'].enum_items]
    sky.sky_type = next(t for t in ('MULTIPLE_SCATTERING', 'NISHITA', 'SINGLE_SCATTERING', 'HOSEK_WILKIE', 'PREETHAM') if t in types)
    if hasattr(sky, 'sun_disc'):
        sky.sun_disc = False                                  # the sun lamp gives the direct light and shadows
    bg = nt.nodes['Background']
    nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
    return sky, bg


def add_sun():
    data = bpy.data.lights.new('Sun', 'SUN')
    data.angle = math.radians(0.6)
    sun = bpy.data.objects.new('Sun', data)
    bpy.context.scene.collection.objects.link(sun)
    return sun


def apply_time(name, sun, sky, bg, lights, glows, north):
    elev, azim, sun_w, sky_w, lamps_on, exposure = TIMES[name]
    a, e = math.radians(azim - north), math.radians(elev)
    to_sun = mathutils.Vector((math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e)))
    sun.rotation_euler = (-to_sun).to_track_quat('-Z', 'Y').to_euler()
    sun.data.energy = sun_w if elev > 0 else 0
    sun.data.color = (1.0, 0.62, 0.38) if elev < 8 else (1.0, 0.95, 0.88)
    if hasattr(sky, 'sun_elevation'):
        sky.sun_elevation = max(e, math.radians(-5))
    if hasattr(sky, 'sun_rotation'):
        sky.sun_rotation = a
    bg.inputs['Strength'].default_value = sky_w
    for light in lights:
        light.hide_render = not lamps_on
    for mat in glows:
        b = bsdf_of(mat)
        if b:
            set_input(b, ['Emission Strength'], 6.0 if lamps_on else 0.0)
    bpy.context.scene.view_settings.exposure = exposure


def add_cameras():
    cams = {}
    for name, (eye, target, lens) in VIEWS.items():
        data = bpy.data.cameras.new(f'Camera {name}')
        data.lens, data.clip_end = lens, 20000          # far enough for the city around
        cam = bpy.data.objects.new(data.name, data)
        cam.location = plan(*eye)
        cam.rotation_euler = (plan(*target) - plan(*eye)).to_track_quat('-Z', 'Y').to_euler()
        bpy.context.scene.collection.objects.link(cam)
        cams[name] = cam
    return cams


def setup_render(samples, res):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('OPTIX', 'CUDA', 'HIP', 'METAL', 'ONEAPI'):
        try:
            prefs.compute_device_type = kind
        except TypeError:
            continue
        prefs.get_devices()
        if any(d.type == kind for d in prefs.devices):
            break
    for d in prefs.devices:
        d.use = d.type != 'CPU'
    gpu = any(d.use for d in prefs.devices)
    scene.cycles.device = 'GPU' if gpu else 'CPU'
    print(f'[casa] rendering on {"GPU " + prefs.compute_device_type if gpu else "CPU"}')
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 8
    scene.render.use_persistent_data = True              # build the scene once, not for every frame
    w, h = (int(v) for v in res.lower().split('x'))
    scene.render.resolution_x, scene.render.resolution_y = w, h
    looks = [i.identifier for i in scene.view_settings.bl_rna.properties['view_transform'].enum_items]
    scene.view_settings.view_transform = 'AgX' if 'AgX' in looks else 'Filmic'


README = """Casa AMS in Blender — where things are

Outliner (top right):
  Apartment   walls, windows, floors, kitchen, bathroom (from the planner)
  Furniture   every piece, named like the IKEA product; Custom Properties hold article number, price, link
  Ceiling     added here so light only comes in through the windows (hidden in the overview camera)
  Sun, Sky    time of day (World tab for the sky)
  Lamp lights warm point lights inside each lamp
  Context     the real buildings and water around (only with --site)
  Camera ...  one per room: select one, then View > Cameras > Set Active Object as Camera (Ctrl+Numpad 0)

Try: press F12 to render the active camera. Z switches Solid / Rendered view in the viewport.
Change the Sun's rotation to move the light; click a material in the Shading workspace to see its nodes.
"""


def main():
    args = parse_args()
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    clear_scene()
    import_flat(os.path.abspath(args.glb))
    upgrade_materials(out)
    ceiling = add_ceiling()
    lights, glows = lamp_lights()
    sky, bg = setup_world()
    sun = add_sun()
    cams = add_cameras()
    if args.site:
        try:
            coll = add_context(args.site, args.north, args.radius, os.path.join(out, 'context-cache'))
            export_context(coll, os.path.join(os.path.dirname(os.path.abspath(args.glb)), 'casa-context.glb'))
        except (OSError, ValueError) as e:   # 3D BAG / PDOK unreachable or not JSON: render the flat on its own
            print(f'[casa] no surroundings ({e})')
    setup_render(args.samples, args.res)
    text = bpy.data.texts.new('README')
    text.write(README)

    times = [t for t in args.times.split(',') if t in TIMES]
    views = [v for v in args.views.split(',') if v in VIEWS]
    apply_time(times[0] if times else 'afternoon', sun, sky, bg, lights, glows, args.north)
    bpy.context.scene.camera = cams[views[0] if views else 'living']
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, 'casa-ams.blend'))
    print(f'[casa] saved {os.path.join(out, "casa-ams.blend")}')
    if args.no_render:
        return
    for t in times:
        apply_time(t, sun, sky, bg, lights, glows, args.north)
        for v in views:
            bpy.context.scene.camera = cams[v]
            ceiling.hide_render = v == 'overview'
            bpy.context.scene.render.filepath = os.path.join(out, f'{v}-{t}.png')
            bpy.ops.render.render(write_still=True)
            print(f'[casa] rendered {v}-{t}.png')


if __name__ == '__main__':
    main()
