"""Mirror the planner's furniture into the open Unreal level: live_bridge.py runs sync() after every change.

Each piece of furniture is one mesh, imported once per shape into /Game/CasaAMS/Live and placed as an actor labelled
"Casa Live ..." (tag CasaLive). The first sync replaces the furniture that came in with the flat's .glb.
"""
import json
import os

import unreal

import casa_setup as casa

LIVE = f'{casa.CONTENT}/Live'
TAG = unreal.Name('CasaLive')
assets = unreal.EditorAssetLibrary
actors = casa.actors


def mesh_in(folder):
    return next((a for a in map(assets.load_asset, assets.list_assets(folder)) if isinstance(a, unreal.StaticMesh)), None)


def live_mesh(key, cache):
    """The piece's shape, imported the first time it shows up (the key is a hash of the shape)."""
    folder = f'{LIVE}/{key}'
    mesh = mesh_in(folder) if assets.does_directory_exist(folder) else None
    if mesh:
        return mesh, False
    task = unreal.AssetImportTask()
    for prop, value in (('filename', os.path.join(cache, f'{key}.glb')), ('destination_path', folder), ('automated', True), ('save', True)):
        task.set_editor_property(prop, value)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    mesh = mesh_in(folder)
    if not mesh:
        raise RuntimeError(f'importing {key}.glb gave no mesh; see the Output Log')
    casa.solid(mesh)                               # the people walk around furniture, not through it
    assets.save_loaded_asset(mesh)
    return mesh, True


def drop_imported_furniture():
    """The first time, the furniture that came with the flat's .glb (and its lamp lights) makes way for the live pieces."""
    for group in casa.labelled('Furniture'):
        parts = group.get_attached_actors(True, True)
        if any(map(casa.is_flat, parts)):
            actors.destroy_actors([*parts, group, *casa.labelled('Casa Lamp light')])


def sync(cache):
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    if not world.get_path_name().startswith(casa.LEVEL + '.'):
        raise RuntimeError('open the CasaAMS level (Content Browser › CasaAMS) to see the planner live')
    with open(os.path.join(cache, 'layout.json'), encoding='utf-8') as f:
        items = json.load(f)['items']
    drop_imported_furniture()
    have = {str(a.tags[1]): a for a in actors.get_all_level_actors()
            if isinstance(a, unreal.StaticMeshActor) and len(a.tags) > 1 and a.tags[0] == TAG}
    new = 0
    for it in items:
        mesh, imported = live_mesh(it['key'], cache)
        new += imported
        a = have.pop(it['uid'], None)
        if a is None:
            a = casa.spawn(unreal.StaticMeshActor, '')
            a.set_editor_property('tags', [TAG, unreal.Name(it['uid'])])
        a.set_actor_label(f"Casa Live {it['name']}")
        # the planner's x and y (mm) are Unreal's X and Y; its turn goes the other way round
        a.set_actor_location_and_rotation(unreal.Vector(it['x'] / 10, it['y'] / 10, 0), unreal.Rotator(yaw=-it['rot']), False, False)
        comp = a.static_mesh_component
        if comp.static_mesh != mesh:
            comp.set_static_mesh(mesh)
            actors.destroy_actors(a.get_attached_actors(True, False))
            comp.set_cast_shadow(not it['light'])      # a lamp's shade must not block its own bulb
            if it['light']:
                x, y, z = it['light']                  # metres, three.js axes in the piece's own frame
                at = a.get_actor_transform().transform_location(unreal.Vector(x * 100, z * 100, y * 100 - 5))
                rule = unreal.AttachmentRule.KEEP_WORLD
                casa.lamp_light(f"Casa Live light ({it['name']})", at, ['CasaLive']).attach_to_actor(a, '', rule, rule, rule, False)
    for a in have.values():
        actors.destroy_actors([*a.get_attached_actors(True, False), a])
    print(f'{len(items)} pieces, {new} new shapes, {len(have)} removed')


def save():
    """Once the planner pauses: saving takes a moment, too long for every move."""
    if unreal.EditorLevelLibrary.get_pie_worlds(False):       # not while someone walks in Play
        return print('later')
    casa.levels.save_current_level()
    print('saved')
