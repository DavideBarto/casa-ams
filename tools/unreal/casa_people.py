"""Two people in the Casa AMS flat, to walk around as in a game: Tab switches who you control.

After casa_setup.py, type in the editor's Cmd box:
    py "path/to/casa_people.py" --heights 180,165
--heights are the two people's heights in centimetres. Needs the "All Toolsets" plugin: its Blueprint tools
write the switching logic (the SwitchPerson function in /Game/CasaAMS/People/BP_CasaPerson, open it to read it).

--looks optionally dresses them as MetaHumans: Blueprints assembled with MetaHuman Creator (Optimized pipeline),
built at 1.80 m so they match the mannequin they follow; the person's height then scales them. Each MetaHuman's body
and clothes copy its hidden mannequin's pose (WearLookAlike), so walking, jumping and Tab work as before.

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
# WearLookAlike: a MetaHuman attached to the person follows its hidden mannequin bone for bone (same bone names).
# The face keeps its own animation Blueprint, so only meshes without one follow.
WEAR = '''
(fn WearLookAlike ()
  (bind kids (Actor|GetAttachedActors))
  (for kid kids
    (bind comps (Actor|GetComponentsByClass :self kid :ComponentClass "/Script/Engine.SkeletalMeshComponent"))
    (for c comps
      (bind sk (Utilities|Casting|CastToSkeletalMeshComponent :Object c)
        (:then
          (Utilities|IsValid (Components|SkeletalMesh|GetAnimInstance :self sk)
            (:"Is Valid")
            (:"Is Not Valid"
              (Components|SkinnedMesh|SetLeaderPoseComponent :self sk :NewLeaderBoneComponent (Variables|Character|GetMesh))
              (Rendering|SetVisibility :self (Variables|Character|GetMesh) :bNewVisibility false))))
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
    # hidden under a MetaHuman, it must keep animating for the MetaHuman to follow
    body.set_editor_property('visibility_based_anim_tick_option', unreal.VisibilityBasedAnimTickOption.ALWAYS_TICK_POSE_AND_REFRESH_BONES)


def function(bp, name, code):
    names = [g.get_name() for g in B.list_graphs(bp)]
    graph = B.get_graph(bp, name) if name in names else B.add_function_graph(bp, name)
    # BlueprintTools.write_graph_dsl does this too, but swallows DSL errors outside an MCP tool call
    blueprint_dsl.Transpiler(graph, B.create_node, B.connect_pins, info, B.set_pin_value, B.find_nodes,
                             delete_node_fn=B.delete_node, find_node_types_fn=lambda f: B.find_node_types(graph, f)).transpile(code)


def wire(graph, event, function_name, at):
    """Call a function from a key or event node (the DSL can't hang code on keys), replacing an earlier wiring."""
    for old in B.find_nodes(graph):
        t = info(old).type_id
        if t == f'CallFunction|{function_name}' or (t == event and not event.startswith('AddEvent|')):
            B.delete_node(old)                  # an event like BeginPlay can exist only once: it is reused instead
    start = next((n for n in B.find_nodes(graph) if info(n).type_id == event), None) or B.create_node(graph, event, unreal.IntPoint(0, at))
    call = B.create_node(graph, f'CallFunction|{function_name}', unreal.IntPoint(250, at))
    out = next(p for p in info(start).output_pins if p.name in ('Pressed', 'then'))
    B.connect_pins(out.pin_id, next(p for p in info(call).input_pins if p.name == 'execute').pin_id)


def switch_logic(bp):
    function(bp, 'SwitchPerson', SWITCH)
    function(bp, 'WearLookAlike', WEAR)
    events = B.get_graph(bp, 'EventGraph')
    wire(events, 'Input|KeyboardEvents|Tab', 'SwitchPerson', 1200)
    wire(events, 'AddEvent|EventBeginPlay', 'WearLookAlike', 1500)


def place(person, heights, looks):
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
        if i < len(looks):              # a MetaHuman on the mannequin; WearLookAlike makes it follow at Play
            mh = actors.spawn_actor_from_class(unreal.load_asset(looks[i]).generated_class(), a.get_actor_location())
            mh.set_actor_label(f'Casa Person {i + 1} look')
            snap = unreal.AttachmentRule.SNAP_TO_TARGET
            mh.attach_to_component(a.get_editor_property('mesh'), '', snap, snap, snap, False)


def main():
    p = argparse.ArgumentParser(prog='casa_people.py')
    p.add_argument('--heights', default='180,165', help='the two heights in cm, comma-separated')
    p.add_argument('--looks', default='', help='MetaHuman Blueprints to wear, comma-separated (built at 1.80 m, the mannequin height)')
    a = p.parse_args(sys.argv[1:])
    heights, looks = [float(h) for h in a.heights.split(',')][:2], [l for l in a.looks.split(',') if l]
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
    place(person.generated_class(), heights, looks)

    unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()
    unreal.EditorAssetLibrary.save_directory(FOLDER, only_if_is_dirty=False)
    log(f'two people placed ({", ".join(f"{h / 100:.2f} m" for h in heights)}): press Play, walk with W A S D, Tab to switch')


main()
