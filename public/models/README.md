# Player model slot

Place the player's model here as `player.obj`.

The live game automatically replaces the pink fallback with that file. If the
model includes materials, place its `player.mtl` file and referenced textures
in this folder too. The loader keeps the model's proportions, scales its largest
dimension to two-thirds of Leaper's full leg-to-leg size, centres it on the
player position, places it on the ground, and enables shadows.
