"""Set up the Casa AMS flat in Unreal Engine 5 as a walkable level.

In the Unreal editor: Tools > Execute Python Script... and pick this file.
(Needs the "Python Editor Script Plugin"; the sun uses the "Sun Position Calculator" plugin if it is enabled.)

It imports the newest casa-ams-*.glb from your Downloads folder (the planner's "Download 3D model (.glb)"),
builds a level /Game/CasaAMS/CasaAMS with a sun and sky for Amsterdam, clouds, fog, a warm light in every lamp
(tagged "CasaLamp", ready for a light switch) and a Player Start inside the flat. Press Play to walk around.
Everything it adds is labelled "Casa ..." in the Outliner, so you can see what each piece does.
"""
import glob
import os
import re

import unreal

GLB = ''                      # leave empty to use the newest casa-ams-*.glb in Downloads
CONTENT = '/Game/CasaAMS'
LEVEL = f'{CONTENT}/CasaAMS'
AMSTERDAM = (52.37, 4.90, 1)  # latitude, longitude, time zone (CET)
SOLAR_TIME = 16.0             # 16:00; try 8 (morning), 13, 19.5 (sunset), 22 (night)
NORTH_OFFSET = 0.0            # degrees between the plan's top edge and real north (unknown: adjust to taste)

actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
log = lambda msg: unreal.log(f'[casa] {msg}')


def find_glb():
    if GLB:
        return GLB
    hits = sorted(glob.glob(os.path.join(os.path.expanduser('~'), 'Downloads', 'casa-ams*.glb')), key=os.path.getmtime)
    if not hits:
        raise RuntimeError('No casa-ams*.glb in Downloads: use "Download 3D model (.glb)" in the planner first.')
    return hits[-1]


def import_flat(path):
    """Interchange scene import keeps every piece placed where it is in the planner."""
    mgr = unreal.InterchangeManager.get_interchange_manager_scripted()
    source = unreal.InterchangeManager.create_source_data(path)
    params = unreal.ImportAssetParameters()
    params.is_automated = True                                    # no import dialog
    mgr.import_scene(f'{CONTENT}/Model', source, params)
    log(f'importing {path}')


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
        for prop, value in (('Latitude', lat), ('Longitude', lon), ('TimeZone', float(tz)), ('NorthOffset', NORTH_OFFSET),
                            ('Month', 6), ('Day', 21), ('SolarTime', SOLAR_TIME)):
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


def flat_bounds():
    """Bounds of everything imported (the flat), in centimetres."""
    lo, hi = None, None
    for a in actors.get_all_level_actors():
        if isinstance(a, unreal.StaticMeshActor) and not a.get_actor_label().startswith('Casa'):
            origin, extent = a.get_actor_bounds(False)
            amin, amax = origin - extent, origin + extent
            lo = amin if lo is None else unreal.Vector(min(lo.x, amin.x), min(lo.y, amin.y), min(lo.z, amin.z))
            hi = amax if hi is None else unreal.Vector(max(hi.x, amax.x), max(hi.y, amax.y), max(hi.z, amax.z))
    return lo, hi


LIGHT_MAT = re.compile(r'(^|[_\s])light($|[_\s\d.])', re.I)   # the planner names glowing lamp parts 'light'


def add_lamp_lights():
    n = 0
    for a in actors.get_all_level_actors():
        comp = a.get_component_by_class(unreal.StaticMeshComponent) if isinstance(a, unreal.StaticMeshActor) else None
        if not comp or not any(m and LIGHT_MAT.search(m.get_name()) for m in comp.get_materials()):
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


def finish():
    add_sky()
    add_lamp_lights()
    add_player_start()
    levels.save_current_level()
    unreal.EditorAssetLibrary.save_directory(CONTENT)
    log('done: press Play (Alt+P) and walk with W A S D; Shift+F1 frees the mouse')


def main():
    path = find_glb()
    if not levels.new_level(LEVEL):
        log(f'{LEVEL} already exists: opening it and adding to it')
        levels.load_level(LEVEL)
    import_flat(path)
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
            finish()

    handle = unreal.register_slate_post_tick_callback(wait)


main()
