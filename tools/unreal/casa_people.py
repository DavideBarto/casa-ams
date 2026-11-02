"""Two people in the Casa AMS flat, to walk around as in a game: Tab switches who you control.

After casa_setup.py, type in the editor's Cmd box:
    py "path/to/casa_people.py" --heights 180,165
--heights are the two people's heights in centimetres. Needs the "All Toolsets" plugin: its Blueprint tools
write the switching logic (the SwitchPerson function in /Game/CasaAMS/People/BP_CasaPerson, open it to read it).

BP_CasaPerson is a copy of the template's first-person character with a camera behind it and its full body shown;
BP_CasaGameMode spawns no player of its own, so the first person placed here is the one you start as.
Running it again updates both Blueprints and puts the two people back in the living room.
"""
import argparse
import sys

import unreal
from editor_toolset.toolsets import blueprint_dsl
from editor_toolset.toolsets.blueprint import BlueprintTools as B

FOLDER = '/Game/CasaAMS/People'
LEVEL = '/Game/CasaAMS/CasaAMS'
FIRST_PERSON = '/Game/FirstPerson/Blueprints/BP_FirstPerson'
MESHES = ('/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple', '/Game/Characters/Mannequins/Meshes/SKM_Quinn_Simple')
MANNEQUIN_CM = 180.0                  # both mannequins are 1.80 m tall
SPOTS = ((300, 420), (250, 120))      # free floor in the living room, cm in the drawing's frame

# Blueprint DSL (see BlueprintTools.get_graph_dsl_docs): hand the player's controller to the other person.
SWITCH = f'''
(fn SwitchPerson ()
  (bind people (Actor|GetAllActorsOfClass "{FOLDER}/BP_CasaPerson.BP_CasaPerson_C"))
  (for p people
    (if (!= p self)
      (bind other (Utilities|Casting|CastToPawn :Object p)
        (:then
          (Pawn|Possess :self (Pawn|GetController) :InPawn other))
        (:CastFailed)))))
'''

actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
log = lambda msg: unreal.log(f'[casa] {msg}')
info = lambda node: B.get_node_infos([node])[0]


def person_blueprint():
    """A copy, not a child: listing a child Blueprint's components crashed UE 5.8, and a copy owns its components."""
    path = f'{FOLDER}/BP_CasaPerson'
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        return unreal.load_asset(path)
    return unreal.EditorAssetLibrary.duplicate_asset(f'{FIRST_PERSON}Character', path)


def camera_behind(bp):
    sds, lib = unreal.get_engine_subsystem(unreal.SubobjectDataSubsystem), unreal.SubobjectDataBlueprintFunctionLibrary
    found = lambda: {str(lib.get_variable_name(lib.get_data(h))): h for h in sds.k2_gather_subobject_data_for_blueprint(bp)}
    handles = found()
    if 'CameraBoom' not in handles:
        boom, _ = sds.add_new_subobject(unreal.AddNewSubobjectParams(parent_handle=handles['CapsuleComponent'], new_class=unreal.SpringArmComponent, blueprint_context=bp))
        sds.rename_subobject(boom, 'CameraBoom')
        camera, _ = sds.add_new_subobject(unreal.AddNewSubobjectParams(parent_handle=boom, new_class=unreal.CameraComponent, blueprint_context=bp))
        sds.rename_subobject(camera, 'BehindCamera')
        handles = found()
    part = lambda name: lib.get_object(lib.get_data(handles[name]))
    boom = part('CameraBoom')
    boom.set_editor_property('relative_location', unreal.Vector(0, 0, 60))     # from the shoulders
    boom.set_editor_property('target_arm_length', 200.0)                       # pulls in by itself near walls
    boom.set_editor_property('socket_offset', unreal.Vector(0, 35, 0))         # a little over the right shoulder
    boom.set_editor_property('use_pawn_control_rotation', True)
    part('FirstPersonCamera').set_editor_property('auto_activate', False)      # so the camera behind is the one used
    part('FirstPersonMesh').set_editor_property('hidden_in_game', True)        # the floating first-person arms
    body = part('Mesh')                     # the full body: the template hides it from its own player in two ways
    body.set_editor_property('owner_no_see', False)
    body.set_editor_property('first_person_primitive_type', unreal.FirstPersonPrimitiveType.NONE)


def switch_logic(bp):
    names = [g.get_name() for g in B.list_graphs(bp)]
    graph = B.get_graph(bp, 'SwitchPerson') if 'SwitchPerson' in names else B.add_function_graph(bp, 'SwitchPerson')
    # BlueprintTools.write_graph_dsl does this too, but swallows DSL errors outside an MCP tool call
    blueprint_dsl.Transpiler(graph, B.create_node, B.connect_pins, info, B.set_pin_value, B.find_nodes,
                             delete_node_fn=B.delete_node, find_node_types_fn=lambda f: B.find_node_types(graph, f)).transpile(SWITCH)
    # the DSL can't hang code on a key, so wire Tab's Pressed to a SwitchPerson call by hand
    events = B.get_graph(bp, 'EventGraph')
    for old in B.find_nodes(events):
        if info(old).type_id in ('Input|KeyboardEvents|Tab', 'CallFunction|SwitchPerson'):
            B.delete_node(old)
    key = B.create_node(events, 'Input|KeyboardEvents|Tab', unreal.IntPoint(0, 1200))
    call = B.create_node(events, 'CallFunction|SwitchPerson', unreal.IntPoint(250, 1200))
    pressed = next(p for p in info(key).output_pins if p.name == 'Pressed')
    execute = next(p for p in info(call).input_pins if p.name == 'execute')
    B.connect_pins(pressed.pin_id, execute.pin_id)


def place(person, heights):
    for old in [a for a in actors.get_all_level_actors() if a.get_actor_label().startswith('Casa Person')]:
        actors.destroy_actor(old)
    for i, (cm, mesh, (x, y)) in enumerate(zip(heights, MESHES, SPOTS)):
        s = cm / MANNEQUIN_CM
        a = actors.spawn_actor_from_class(person, unreal.Vector(x, y, 96 * s + 2), unreal.Rotator(yaw=180))
        a.set_actor_label(f'Casa Person {i + 1} ({cm / 100:.2f} m)')
        a.set_actor_scale3d(unreal.Vector(s, s, s))
        a.get_editor_property('mesh').set_skeletal_mesh_asset(unreal.load_asset(mesh))
        if i == 0:
            a.set_editor_property('auto_possess_player', unreal.AutoReceiveInput.PLAYER0)


def main():
    p = argparse.ArgumentParser(prog='casa_people.py')
    p.add_argument('--heights', default='180,165', help='the two heights in cm, comma-separated')
    heights = [float(h) for h in p.parse_args(sys.argv[1:]).heights.split(',')][:2]
    editor = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if not editor.get_editor_world().get_path_name().startswith(LEVEL + '.'):
        unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).load_level(LEVEL)

    person = person_blueprint()
    camera_behind(person)
    switch_logic(person)
    B.compile_blueprint(person)
    mode_path = f'{FOLDER}/BP_CasaGameMode'
    mode = unreal.load_asset(mode_path) if unreal.EditorAssetLibrary.does_asset_exist(mode_path) else \
        B.create(FOLDER, 'BP_CasaGameMode', unreal.load_asset(f'{FIRST_PERSON}GameMode').generated_class())
    unreal.get_default_object(mode.generated_class()).set_editor_property('default_pawn_class', None)
    editor.get_editor_world().get_world_settings().set_editor_property('default_game_mode', mode.generated_class())
    place(person.generated_class(), heights)

    unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()
    unreal.EditorAssetLibrary.save_directory(FOLDER, only_if_is_dirty=False)
    log(f'two people placed ({", ".join(f"{h / 100:.2f} m" for h in heights)}): press Play, walk with W A S D, Tab to switch')


main()
