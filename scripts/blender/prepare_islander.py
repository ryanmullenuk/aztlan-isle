"""
Prepare an islander character GLB for the game (run by `npm run islander:prepare`).

Takes the artist's full-detail file (about 200,000 triangles, 2048 px colour, normal and
metal/roughness textures, 52 animated bones) and makes it light enough for a village of them
on a phone:

- welds the seams, then decimates the mesh to TARGET_TRIS with flat facets;
- keeps at most four bone weights per vertex;
- keeps only the colour texture, scaled down to TEX px and stored as JPEG (the game's lighting
  stands in for the normal and metal/roughness maps);
- drops the finger and toe animation (the game folds those bones into the hands and feet);
- names the clips by their length (the same seven clips in every file from the artist).

Usage: Blender -b --factory-startup --python prepare_islander.py -- in.glb out.glb TARGET_TRIS TEX
"""
import sys
import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst, target, tex = argv[0], argv[1], int(argv[2]), int(argv[3])

# Clip lengths (seconds) and the names the game plays them by.
CLIPS = [(15.2, 'twerk'), (6.0, 'idle'), (5.13, 'zombie_crawl'), (2.8, 'sad_idle'), (2.57, 'jog'), (2.23, 'run_look_back'), (0.63, 'injured_run')]

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
print('triangles', tris, '->', sum(len(p.vertices) - 2 for p in mesh.data.polygons))

# Only the colour texture, smaller.
for mat in mesh.data.materials:
    if not mat or not mat.use_nodes:
        continue
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf:
        continue
    for name in ('Normal', 'Metallic', 'Roughness'):
        for link in list(bsdf.inputs[name].links):
            links.remove(link)
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = 0.8
    for n in list(nodes):
        if n.type in ('NORMAL_MAP', 'SEPARATE_COLOR', 'SEPARATE_RGB') or (n.type == 'TEX_IMAGE' and not any(l.to_node == bsdf and l.to_socket.name == 'Base Color' for l in n.outputs['Color'].links)):
            nodes.remove(n)
    mat.use_backface_culling = True
for img in bpy.data.images:
    if img.users and img.size[0] > tex:
        print('texture', img.name, tuple(img.size), '->', tex)
        img.scale(tex, tex)

# Finger and toe animation goes (folded into the hands and feet in the game).
def curve_sets(act):
    """An action's F-curve collections: one in older Blender, one per slot in layered actions."""
    if hasattr(act, 'fcurves'):
        return [act.fcurves]
    return [bag.fcurves for layer in act.layers for strip in layer.strips for bag in strip.channelbags]


for act in bpy.data.actions:
    for curves in curve_sets(act):
        for fc in list(curves):
            if any(k in fc.data_path for k in ('HandThumb', 'HandIndex', 'HandMiddle', 'HandRing', 'HandPinky', 'ToeBase', 'Toe_End')):
                curves.remove(fc)
    secs = (act.frame_range[1] - act.frame_range[0]) / bpy.context.scene.render.fps
    length, name = min(CLIPS, key=lambda c: abs(c[0] - secs))
    print('clip', act.name, f'{secs:.2f}s', '->', name)
    act.name = name

bpy.ops.export_scene.gltf(
    filepath=dst, export_format='GLB', export_animations=True, export_animation_mode='ACTIONS',
    export_optimize_animation_size=True, export_texcoords=True, export_materials='EXPORT',
    export_image_format='JPEG', export_jpeg_quality=85,
    export_skins=True, export_all_influences=False, export_morph=False, export_yup=True,
)
