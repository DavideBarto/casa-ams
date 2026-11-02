"""Set up the Casa AMS flat in Unreal Engine 5 as a walkable level.

In the Unreal editor, type in the Cmd box at the bottom (or Tools > Execute Python Script... if your version has it):
    py "path/to/casa_setup.py" --north 0
--north is the compass bearing the drawing's top edge faces (the same number as the Blender script's --north).
(Needs the "Python Editor Script Plugin"; the sun uses the "Sun Position Calculator" plugin if it is enabled.)

It imports the newest casa-ams-*.glb from your Downloads folder (the planner's "Download 3D model (.glb)"),
builds a level /Game/CasaAMS/CasaAMS with a sun and sky for Amsterdam, clouds, fog, a warm light in every lamp
(tagged "CasaLamp", ready for a light switch) and a Player Start inside the flat. Press Play to walk around.
If Downloads also holds casa-context.glb (the real city around the flat, from the Blender script's --site),
that comes in too. Run it again later to add the city or re-aim the sun: the flat is not imported twice.
Everything it adds is labelled "Casa ..." in the Outliner, so you can see what each piece does.
"""
import argparse
import glob
import math
import os
import re
import sys

import unreal

GLB = ''                      # leave empty to use the newest casa-ams-*.glb in Downloads
CONTENT = '/Game/CasaAMS'
LEVEL = f'{CONTENT}/CasaAMS'
AMSTERDAM = (52.37, 4.90, 1)  # latitude, longitude, time zone (CET)
SOLAR_TIME = 16.0             # 16:00; try 8 (morning), 13, 19.5 (sunset), 22 (night)

actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
log = lambda msg: unreal.log(f'[casa] {msg}')


def newest(pattern):
    hits = sorted(glob.glob(os.path.join(os.path.expanduser('~'), 'Downloads', pattern)), key=os.path.getmtime)
    return hits[-1] if hits else None


def find_glb():
    path = GLB or newest('casa-ams*.glb')
    if not path:
        msg = 'No casa-ams*.glb in Downloads: use "Download 3D model (.glb)" in the planner first.'
        unreal.EditorDialog.show_message('Casa AMS', msg, unreal.AppMsgType.OK)   # the log alone is easy to miss
        raise RuntimeError(msg)
    return path


def import_glb(path, folder):
    """Interchange scene import keeps every piece placed where it is in the planner."""
    mgr = unreal.InterchangeManager.get_interchange_manager_scripted()
    source = unreal.InterchangeManager.create_source_data(path)
    params = unreal.ImportAssetParameters()
    params.is_automated = True                                    # no import dialog
    mgr.import_scene(folder, source, params)
    log(f'importing {path}')


def labelled(prefix):
    return [a for a in actors.get_all_level_actors() if a.get_actor_label().startswith(prefix)]


def mesh_path(a):
    mesh = a.static_mesh_component.static_mesh if isinstance(a, unreal.StaticMeshActor) else None
    return mesh.get_path_name() if mesh else ''


def city():
    """The surroundings, recognised by where their meshes were imported (actor labels depend on the importer)."""
    return [a for a in actors.get_all_level_actors() if mesh_path(a).startswith(f'{CONTENT}/Context/')]


def is_flat(a):
    return mesh_path(a).startswith(f'{CONTENT}/Model/')


def spawn(cls, label, location=unreal.Vector(0, 0, 0), rotation=unreal.Rotator(0, 0, 0)):
    a = actors.spawn_actor_from_class(cls, location, rotation)
    a.set_actor_label(label)
    return a


def add_sky():
    """Sun Position Calculator's SunSky gives Amsterdam's real sun; otherwise a plain sun + atmosphere."""
    sunsky = unreal.EditorAssetLibrary.load_blueprint_class('/SunPosition/SunSky') if unreal.EditorAssetLibrary.does_asset_exist('/SunPosition/SunSky') else None
    if sunsky:
        s = spawn(sunsky, 'Casa Sun and Sky (Amsterdam)')
        lat, lon, tz = AMSTERDAM
        for prop, value in (('Latitude', lat), ('Longitude', lon), ('TimeZone', float(tz)), ('Month', 6), ('Day', 21), ('SolarTime', SOLAR_TIME)):
            try:
                s.set_editor_property(prop, value)
            except Exception as e:  # property names differ between engine versions
                log(f'SunSky has no {prop} ({e})')
        log('added SunSky for Amsterdam; change SolarTime in its Details panel to move the sun')
    else:
        sun = spawn(unreal.DirectionalLight, 'Casa Sun', rotation=unreal.Rotator(0, -35, 200))
        sun.light_component.set_editor_property('atmosphere_sun_light', True)
        sun.light_component.set_editor_property('intensity', 10.0)
        spawn(unreal.SkyAtmosphere, 'Casa Sky atmosphere')
        sky = spawn(unreal.SkyLight, 'Casa Sky light')
        sky.light_component.set_editor_property('real_time_capture', True)
        log('Sun Position Calculator not enabled: added a fixed sun and sky')
    spawn(unreal.VolumetricCloud, 'Casa Clouds')
    spawn(unreal.ExponentialHeightFog, 'Casa Fog')
    pp = spawn(unreal.PostProcessVolume, 'Casa Post process (whole level)')
    pp.set_editor_property('unbound', True)


def orient_sun(north):
    """SunSky computes Amsterdam's real sun; turn its compass so the sun comes in on the right side of the flat.
    The drawing's x axis is Unreal's +X and faces the bearing north + 90. Rather than trust SunSky's compass
    convention, measure it: where the sun points with NorthOffset 0 and 90, against the sun's real bearing."""
    sky = labelled('Casa Sun and Sky')
    light = sky[0].get_component_by_class(unreal.DirectionalLightComponent) if sky else None
    if not light:
        return
    s = sky[0]

    def towards_sun(offset):
        s.set_editor_property('NorthOffset', offset)
        f = light.get_forward_vector()
        return math.degrees(math.atan2(-f.y, -f.x)), math.degrees(math.asin(max(-1.0, min(1.0, -f.z))))

    try:
        (y0, elev), (y90, _) = towards_sun(0.0), towards_sun(90.0)
        lat, lon, tz = AMSTERDAM
        h = float(s.get_editor_property('SolarTime'))
        when = [int(s.get_editor_property(p)) for p in ('Year', 'Month', 'Day')]
        # SunSky's own daylight-saving setting is whichever matches the sun height it shows
        sun = min((unreal.SunPositionFunctionLibrary.get_sun_position(lat, lon, tz, dst, *when, int(h), int(h % 1 * 60), 0) for dst in (False, True)),
                  key=lambda d: abs(d.elevation - elev))
    except Exception as e:
        log(f"couldn't aim the sun ({e}); turn NorthOffset on 'Casa Sun and Sky' by hand")
        return
    turn = (y90 - y0 + 180) % 360 - 180          # how far the sun swings when NorthOffset grows by 90
    if abs(abs(turn) - 90) > 5:
        towards_sun(0.0)
        log(f'SunSky swung {turn:.0f}° instead of 90° for NorthOffset 90; set NorthOffset by hand')
        return
    want = sun.azimuth - (north + 90)            # the sun's real bearing, measured from the drawing's x axis
    offset = ((want - y0) * 90 / turn) % 360
    towards_sun(offset)
    log(f'sun at bearing {sun.azimuth:.0f}°, height {sun.elevation:.0f}°: SunSky NorthOffset set to {offset:.0f}°')


def place_fog():
    """Height fog thickens downwards from the fog actor: put it on the street, not at the flat's floor."""
    ground, fog = [a for a in city() if 'ground' in mesh_path(a).lower()], labelled('Casa Fog')
    if ground and fog:
        fog[0].set_actor_location(unreal.Vector(0, 0, ground[0].get_actor_bounds(False)[0].z), False, False)


def flat_bounds():
    """Bounds of the imported flat, in centimetres."""
    lo, hi = None, None
    for a in filter(is_flat, actors.get_all_level_actors()):
        origin, extent = a.get_actor_bounds(False)
        amin, amax = origin - extent, origin + extent
        lo = amin if lo is None else unreal.Vector(min(lo.x, amin.x), min(lo.y, amin.y), min(lo.z, amin.z))
        hi = amax if hi is None else unreal.Vector(max(hi.x, amax.x), max(hi.y, amax.y), max(hi.z, amax.z))
    return lo, hi


LIGHT_MAT = re.compile(r'(^|[_\s])light($|[_\s\d.])', re.I)   # the planner names glowing lamp parts 'light'


def materials(a):
    comp = a.get_component_by_class(unreal.StaticMeshComponent)
    return comp, [m.get_name() for m in comp.get_materials() if m]


def add_lamp_lights():
    n = 0
    for a in filter(is_flat, actors.get_all_level_actors()):
        if not any(LIGHT_MAT.search(m) for m in materials(a)[1]):
            continue
        origin, _ = a.get_actor_bounds(False)
        light = spawn(unreal.PointLight, f'Casa Lamp light ({a.get_actor_label()})', origin - unreal.Vector(0, 0, 5))
        lc = light.point_light_component
        lc.set_editor_property('intensity_units', unreal.LightUnits.LUMENS)
        lc.set_editor_property('intensity', 800.0)                   # an 806 lm SOLHETTA bulb
        lc.set_editor_property('light_color', unreal.Color(r=255, g=197, b=143, a=255))   # ~2700 K
        lc.set_editor_property('attenuation_radius', 700.0)
        light.set_editor_property('tags', [unreal.Name('CasaLamp')])
        n += 1
    log(f'added {n} lamp lights (tag CasaLamp)')


def tune_pieces():
    """Nanite can't draw see-through glass (it shows a grey grid instead), and a lamp's own shade must not block its bulb."""
    glass = shades = 0
    for a in filter(is_flat, actors.get_all_level_actors()):
        comp, names = materials(a)
        if any(n.lower().startswith('glass') for n in names):
            comp.set_editor_property('disallow_nanite', True)
            glass += 1
        if any(LIGHT_MAT.search(n) for n in names):
            parent = a.get_attach_parent_actor()
            for part in parent.get_attached_actors(True, True) if parent else [a]:
                c = part.get_component_by_class(unreal.StaticMeshComponent)
                if c:
                    c.set_cast_shadow(False)
                    shades += 1
    log(f'{glass} glass pieces drawn without Nanite, {shades} lamp parts no longer cast shadows')


def add_player_start():
    lo, hi = flat_bounds()
    if lo is None:
        log('nothing imported, no Player Start')
        return
    centre = unreal.Vector((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z + 100)
    spawn(unreal.PlayerStart, 'Casa Player start', centre)
    log(f'Player Start at {centre}; drag it in the viewport if it lands inside furniture')


def imported_count():
    return sum(1 for a in actors.get_all_level_actors() if isinstance(a, unreal.StaticMeshActor) and not a.get_actor_label().startswith('Casa'))


def finish(fresh, north):
    tune_pieces()
    if fresh:
        add_sky()
        add_lamp_lights()
        add_player_start()
    place_fog()
    orient_sun(north)
    levels.save_current_level()
    unreal.EditorAssetLibrary.save_directory(CONTENT)
    log('done: press Play (Alt+P) and walk with W A S D; Shift+F1 frees the mouse')


def main():
    p = argparse.ArgumentParser(prog='casa_setup.py')
    p.add_argument('--north', type=float, default=0.0, help="compass bearing the drawing's top edge faces")
    north = p.parse_args(sys.argv[1:]).north
    if not levels.new_level(LEVEL):
        levels.load_level(LEVEL)
    fresh = not any(map(is_flat, actors.get_all_level_actors()))
    if fresh:
        import_glb(find_glb(), f'{CONTENT}/Model')
    else:
        log('the flat is already in this level, not importing it again (delete the CasaAMS folder in the Content Browser to start over)')
    town = None if city() else newest('casa-context*.glb')
    if town:
        import_glb(town, f'{CONTENT}/Context')
    # Interchange may finish in the background: wait (without blocking the editor) until the pieces stop arriving.
    state = {'ticks': 0, 'last': -1, 'still': 0}

    def wait(_delta):
        state['ticks'] += 1
        n = imported_count()
        state['still'] = state['still'] + 1 if n == state['last'] and n > 0 else 0
        state['last'] = n
        if state['still'] > 30 or state['ticks'] > 3000:
            unreal.unregister_slate_post_tick_callback(handle)
            if n == 0:
                log('the import produced no pieces; check the Output Log for Interchange errors')
            finish(fresh, north)

    handle = unreal.register_slate_post_tick_callback(wait)


main()
