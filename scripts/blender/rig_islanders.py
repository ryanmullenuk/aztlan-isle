"""
Rig the islander models in Blender: build the game's 19-bone skeleton at the measured joints
(src/entities/glbPeople.ts RIGS, dumped by dump-rigs.ts), bind each mesh to it with Blender's
automatic (bone heat) weights, and write the skinned model back as a GLB. The game reads those
weights in place of its own automatic ones (hair and skirts keep the game's handling).

  npm run rig:blender            (all models: the unrigged meshes in art/islanders, rigged into public/models)
  blender -b --factory-startup --python scripts/blender/rig_islanders.py -- rigs.json src_dir out_dir [keys...]

Open any output GLB in Blender to look at or repaint the weights by hand, and export it back
(glTF binary, with skinning) to public/models.
"""
import bpy, json, sys, os
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
rigs_path, src_dir, out_dir, *only = argv
data = json.load(open(rigs_path))
FILE = {'m': 'islander_male', 'f': 'islander_female', 'boy': 'islander_boy', 'girl': 'islander_girl',
        'oldm': 'islander_oldm', 'oldf': 'islander_oldf', 'fatm': 'islander_fatm', 'fatf': 'islander_fatf'}
PARENT = {'hips': None, 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck',
          'thighL': 'hips', 'shinL': 'thighL', 'footL': 'shinL', 'thighR': 'hips', 'shinR': 'thighR', 'footR': 'shinR'}
for s in 'LR':
    PARENT.update({f'shoulder{s}': 'chest', f'upper_arm{s}': f'shoulder{s}', f'forearm{s}': f'upper_arm{s}', f'hand{s}': f'forearm{s}'})


def bl(p):
    """Game space (y up, facing +z) to Blender (z up, facing -y), as the glTF importer converts."""
    return Vector((p[0], -p[2], p[1]))


def tails(r):
    J = r['joint']
    mir = lambda p: [-p[0], p[1], p[2]]
    t = {'hips': J['spine'], 'spine': J['chest'], 'chest': J['neck'], 'neck': J['head'], 'head': r['top']}
    for s, m in (('L', lambda p: p), ('R', mir)):
        t.update({f'shoulder{s}': J[f'upper_arm{s}'], f'upper_arm{s}': J[f'forearm{s}'], f'forearm{s}': J[f'hand{s}'],
                  f'hand{s}': m(r['tipL']), f'thigh{s}': J[f'shin{s}'], f'shin{s}': J[f'foot{s}'], f'foot{s}': m(r['toeL'])})
    return t


def rig_one(key):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(src_dir, FILE[key] + '.glb'))
    mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
    for o in list(bpy.context.scene.objects):
        if o is not mesh and o.type != 'MESH':
            bpy.data.objects.remove(o)
    bpy.context.view_layer.objects.active = mesh
    mesh.select_set(True)
    mesh.parent = None
    # Re-rigging an already rigged model: start from the bare mesh.
    mesh.vertex_groups.clear()
    mesh.modifiers.clear()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    r = data['rigs'][key]
    J, T = r['joint'], tails(r)
    arm_data = bpy.data.armatures.new('islander_rig')
    arm = bpy.data.objects.new('islander_rig', arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for b in data['bones']:
        e = arm_data.edit_bones.new(b)
        e.head, e.tail = bl(J[b]), bl(T[b])
        # Limbs roll so their bend axis is the model's x (knees and elbows hinge sideways-on).
        e.align_roll(Vector((0, -1, 0)) if not b.startswith(('foot', 'hand')) else Vector((0, 0, 1)))
    for b in data['bones']:
        if PARENT[b]:
            arm_data.edit_bones[b].parent = arm_data.edit_bones[PARENT[b]]
    bpy.ops.object.mode_set(mode='OBJECT')

    # Bone heat needs one connected surface: weight a welded copy (the model is split at its UV
    # seams), then copy each vertex's weights back from the welded vertex at the same place.
    proxy = mesh.copy()
    proxy.data = mesh.data.copy()
    bpy.context.scene.collection.objects.link(proxy)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = proxy
    proxy.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0005)
    bpy.ops.object.mode_set(mode='OBJECT')
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    weighted = sum(1 for v in proxy.data.vertices if any(g.weight > 0 for g in v.groups))
    print(f'[{key}] heat weights: {weighted}/{len(proxy.data.vertices)} welded vertices')

    for b in data['bones']:
        mesh.vertex_groups.new(name=b)
    names = {g.index: g.name for g in proxy.vertex_groups}
    at = {}
    for v in proxy.data.vertices:
        at[tuple(round(c, 4) for c in v.co)] = [(names[g.group], g.weight) for g in v.groups if g.weight > 0]
    from mathutils.kdtree import KDTree
    kd = KDTree(len(proxy.data.vertices))
    for v in proxy.data.vertices:
        kd.insert(v.co, v.index)
    kd.balance()
    pw = [[(names[g.group], g.weight) for g in v.groups if g.weight > 0] for v in proxy.data.vertices]
    missing = 0
    for v in mesh.data.vertices:
        ws = at.get(tuple(round(c, 4) for c in v.co))
        if ws is None:
            ws = pw[kd.find(v.co)[1]]
        if not ws:
            # Heat found nothing here: take the nearest weighted vertex's weights.
            missing += 1
            for _, i, _ in kd.find_n(v.co, 24):
                if pw[i]:
                    ws = pw[i]
                    break
        for name, w in ws:
            mesh.vertex_groups[name].add([v.index], w, 'REPLACE')
    print(f'[{key}] {len(mesh.data.vertices)} vertices, {missing} filled from neighbours')
    bpy.data.objects.remove(proxy)

    mod = mesh.modifiers.new('rig', 'ARMATURE')
    mod.object = arm
    mesh.parent = arm
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, FILE[key] + '.glb'), export_format='GLB', use_selection=True,
                              export_skins=True, export_influence_nb=4, export_animations=False, export_image_format='NONE',
                              export_yup=True, export_apply=False)


for key in (only or FILE.keys()):
    rig_one(key)
