# Casa AMS Planner

A 3D furnishing planner for our Amsterdam apartment (54 m² + 16 m² balcony), built on the real floor plan.

**Open it:** https://davidebarto.github.io/casa-ams/

- Search the whole IKEA.nl catalogue live, with photos and current prices, and add pieces to the flat.
- Swap any piece for another product or colour; "Fits here" shows whether the new one fits the spot.
- Drag, rotate and resize furniture. Pieces snap flush against walls, and distance labels show the gap on every side.
- Fit check: overlaps, walls, blocked doors and missing clearance (wardrobe doors, desk chair, around the bed).
- Add things you already own as simple boxes.
- 3D, plan and walk-through views, with cutaway walls.
- Several layouts per browser; share a layout as a link or a file. Shopping list with a budget, per room.

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
