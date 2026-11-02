"""
Prepare an islander character GLB for the game (run by `npm run islander:prepare`):
decimate the mesh to a mobile-friendly triangle count, keep at most four bone weights per
vertex, drop unused texture coordinates and materials, and name its animation clips.

Usage: Blender -b --factory-startup --python prepare_islander.py -- in.glb out.glb TARGET_TRIS name=prefix ...
"""
import sys
import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst, target = argv[0], argv[1], int(argv[2])
names = dict(a.split('=', 1) for a in argv[3:])  # uuid prefix -> clip name

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
bpy.context.view_layer.objects.active = mesh
mesh.select_set(True)
# Weld the seams first (split vertices would otherwise tear open as cracks when decimated).
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=0.0005)
bpy.ops.object.mode_set(mode='OBJECT')
dec = mesh.modifiers.new('decimate', 'DECIMATE')
dec.ratio = min(1.0, target / tris)
# Decimate the rest shape, before the armature deforms it.
while mesh.modifiers[0].name != 'decimate':
    bpy.ops.object.modifier_move_up(modifier='decimate')
bpy.ops.object.modifier_apply(modifier='decimate')
# Flat facets, as the blocky characters are drawn.
for poly in mesh.data.polygons:
    poly.use_smooth = False
bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
while mesh.data.uv_layers:
    mesh.data.uv_layers.remove(mesh.data.uv_layers[0])
print('triangles', tris, '->', sum(len(p.vertices) - 2 for p in mesh.data.polygons))

for act in bpy.data.actions:
    for prefix, name in names.items():
        if act.name.startswith(prefix):
            print('clip', act.name, '->', name, act.frame_range[:])
            act.name = name

bpy.ops.export_scene.gltf(
    filepath=dst, export_format='GLB', export_animations=True, export_animation_mode='ACTIONS',
    export_optimize_animation_size=True, export_texcoords=False, export_materials='NONE',
    export_skins=True, export_all_influences=False, export_morph=False, export_yup=True,
)
