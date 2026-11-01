# Casa AMS Planner

A 3D furnishing planner for our Amsterdam apartment (54 m² + 16 m² balcony), built on the real floor plan.

**Open it:** https://davidebarto.github.io/casa-ams/

- Search the whole IKEA.nl catalogue live, with photos and current prices, and add pieces to the flat. Italian words work too ("divano con penisola").
- Swap any piece for another product or colour; "Fits here" shows whether the new one fits the spot.
- Drag, rotate and resize furniture. Pieces snap flush against walls, and distance labels show the gap on every side.
- Fit check: overlaps, walls, blocked doors and missing clearance (wardrobe doors, desk chair, around the bed).
- Add things you already own as simple boxes.
- Furniture modelled from each product's IKEA measurements: chaise, corner and U-shaped sofas, armrests, seat and leg heights, upholstered or wooden beds, drawers and doors, fabric and wood finishes.
- 3D, plan and walk-through views; walls full height, cut at 1 m, or off (drawn on the floor).
- Navigation by [camera-controls](https://github.com/yomotsu/camera-controls): zoom to the pointer, smooth moves, double-click to focus, jump to a room. The scene is drawn only when something changes, at 1× resolution while moving.
- Several layouts per browser; share a layout as a link or a file. Shopping list with a budget, per room.

## Blender and Unreal

The Layouts tab has **Download 3D model (.glb)**: the whole flat with named pieces and materials, in metres.

- Blender: `blender -b -P tools/blender/casa_render.py -- --glb casa-ams.glb --out renders` renders every room at
  morning, afternoon, sunset and night with Cycles, and saves `renders/casa-ams.blend` to explore (it has a README text block).
  Add `--no-render` to only build the scene. The floor texture comes from [Poly Haven](https://polyhaven.com) (CC0).
- Unreal Engine 5: drag the .glb into the Content Browser (Interchange glTF import).

## Run locally

Static files, no build step:

```bash
python3 -m http.server 8000
```

then open http://localhost:8000.

## Data

- `data/dims.json`: product measurements from IKEA.nl product pages (pages can't be read from the browser).
- `data/default-layout.json`: the suggested plan, with live names, prices and photos.

Refresh both with `python3 tools/build_data.py` (or `python3 tools/build_data.py layout` for the plan only).
Products not in `dims.json` get their size from the search result or a typical size, marked as estimated and editable.

## Tests

```bash
node tests/fit.test.mjs && node tests/ikea.test.mjs
```

Not affiliated with IKEA. Uses the public search behind ikea.com/nl.
