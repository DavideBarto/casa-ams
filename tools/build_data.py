"""Build the data files the planner ships with.

  data/dims.json            itemNo -> product measurements (cm) scraped from IKEA.nl product pages
  data/default-layout.json  the suggested furnishing plan, with live names, prices, photos and colours

IKEA's search API allows browser requests, but product pages don't, so measurements are collected here.
Run from the repo root:  python3 tools/build_data.py            (both files)
                         python3 tools/build_data.py layout     (layout only, fast)
"""
import concurrent.futures as cf
import gzip
import html
import json
import re
import sys
import urllib.parse
import urllib.request

SEARCH = "https://sik.search.blue.cdtapps.com/nl/en/search-result-page"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36",
      "Accept-Encoding": "gzip"}
MEASURE = re.compile(r'measurement-name">([^<]+)</span><span class="pipf-measurements-tab__measurement-value">([^<]+)<')
UNIT = {"mm": 0.1, "cm": 1, "m": 100}
KEEP = {"Width", "Depth", "Height", "Length", "Diameter", "Thickness", "Headboard height", "Min. height", "Max. height",
        "Table length", "Table width", "Table height", "Shade diameter", "Base diameter", "Chair width", "Chair depth"}

QUERIES = ["sofa", "sofa-bed", "corner sofa", "armchair", "footstool", "bed frame", "mattress", "wardrobe", "pax wardrobe",
           "chest of drawers", "bedside table", "desk", "office chair", "dining table", "dining chair", "table and chairs",
           "coffee table", "side table", "tv bench", "bookcase", "shelving unit", "sideboard", "cabinet", "shoe cabinet",
           "hallway furniture", "coat rack", "bench", "bar stool", "floor lamp", "table lamp", "pendant lamp", "ceiling lamp",
           "rug", "curtains", "mirror", "outdoor table", "outdoor chair", "kitchen island", "trolley", "plant stand"]


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        body = r.read()
        return gzip.decompress(body) if r.headers.get("Content-Encoding") == "gzip" else body


def search(q, size=48, sort=None):
    params = {"q": q, "size": size, "types": "PRODUCT", "c": "sr", "v": "20240110"}
    if sort:
        params["sort"] = sort
    d = json.loads(get(SEARCH + "?" + urllib.parse.urlencode(params)))
    return [it["product"] for it in d["searchResultPage"]["products"]["main"]["items"]]


def measurements(pip_url):
    page = get(pip_url).decode("utf8", "ignore")
    out = {}
    for name, value in MEASURE.findall(page):
        name = html.unescape(name).strip(": ")
        m = re.match(r"([\d.,]+)\s*(mm|cm|m)\b", html.unescape(value).replace(",", "."))
        if name in KEEP and name not in out and m:
            out[name] = round(float(m.group(1)) * UNIT[m.group(2)], 1)
    return out


def build_dims():
    products = {}
    for q in QUERIES:
        for sort in (None, "PRICE_LOW_TO_HIGH"):
            try:
                for p in search(q, 48 if sort is None else 24, sort):
                    products.setdefault(p["itemNo"], p)
            except Exception as e:
                print("search failed", q, sort, e, file=sys.stderr)
    for spec in LAYOUT:
        if spec["no"] not in products:
            hits = search(spec["no"], 2)
            if hits:
                products[hits[0]["itemNo"]] = hits[0]
    print(f"{len(products)} products, fetching measurements…", file=sys.stderr)

    dims = {}
    with cf.ThreadPoolExecutor(6) as ex:
        futures = {ex.submit(measurements, p["pipUrl"]): p for p in products.values()}
        for i, f in enumerate(cf.as_completed(futures)):
            p = futures[f]
            try:
                d = f.result()
            except Exception as e:
                print("page failed", p["pipUrl"], e, file=sys.stderr)
                continue
            if not d:
                continue
            dims[p["itemNo"]] = d
            # colour variants share the measurements when IKEA lists the same size for them
            for v in (p.get("gprDescription") or {}).get("variants", []):
                if v.get("itemMeasureReferenceText", "") == p.get("itemMeasureReferenceText", ""):
                    dims.setdefault(v["itemNo"], d)
            if i % 100 == 0:
                print(f"  {i}/{len(futures)}", file=sys.stderr)
    with open("data/dims.json", "w") as f:
        json.dump(dims, f, separators=(",", ":"), sort_keys=True)
    print(f"wrote data/dims.json ({len(dims)} items)", file=sys.stderr)


# The suggested plan. Positions are plan millimetres (x east, y south, origin = living room's inside top-left corner),
# rot is degrees (0 = front faces south). Shape-specific sizes override the measured ones where noted.
LAYOUT = [
    {"no": "40571248", "x": 5400, "y": 3625, "rot": 90},                      # SLATTUM bed 160
    {"no": "40450623", "x": 5400, "y": 3625, "rot": 90},                      # VESTERÖY mattress
    {"no": "40407922", "x": 4620, "y": 1805, "rot": 90},                      # BRIMNES wardrobe
    {"no": "20569977", "x": 4580, "y": 2598, "rot": 0},                       # KNARREVIK
    {"no": "20569977", "x": 4580, "y": 4633, "rot": 180},                     # KNARREVIK
    {"no": "69416817", "x": 4670, "y": 5440, "rot": 90, "side": -1},                      # LAGKAPTEN/ALEX desk
    {"no": "70261150", "x": 5330, "y": 5490, "rot": -90},                     # MARKUS
    {"no": "50355395", "x": 4410, "y": 4960, "rot": 90, "elev": 730},         # TERTIAL on the desk
    {"no": "90346752", "x": 4700, "y": 6095, "rot": 180},                     # MAJGULL pair (left)
    {"no": "90346752", "x": 6620, "y": 6095, "rot": 180},                     # MAJGULL pair (right)
    {"no": "09634074", "x": 5660, "y": 6115, "rot": 0, "w": 2560},            # RÄCKA rod
    {"no": "50599402", "x": 5870, "y": 3600, "rot": 0},                       # KÄRRNOCKA
    {"no": "50341148", "x": 1640, "y": 3125, "rot": 180},                     # FRIHETEN sofa-bed
    {"no": "00474070", "x": 1900, "y": 220, "rot": 0},                        # BESTÅ TV bench
    {"no": "50319029", "x": 1700, "y": 1900, "rot": 0},                       # LACK coffee table
    {"no": "10425526", "x": 1680, "y": 2050, "rot": 90},                      # STOENSE rug
    {"no": "00110640", "x": 270, "y": 3400, "rot": 0},                        # LERSTA
    {"no": "29640333", "x": 1400, "y": 5000, "rot": 90},                      # VIHALS table + 4 chairs
    {"no": "00508536", "x": 1400, "y": 5000, "rot": 0},                       # SINNERLIG
    {"no": "80437234", "x": 3995, "y": 1660, "rot": -90},                     # KLEPPSTAD in the niche
    {"no": "60583924", "placed": False, "qty": 3},                            # SOLHETTA bulbs
    {"no": "00397307", "x": 8900, "y": -380, "rot": -90, "elev": 100, "w": 1060},  # TRONES 2-pack, side by side
    {"no": "40551047", "x": 8975, "y": 600, "rot": -90, "elev": 900},         # LILJETRÄD
    {"no": "00525908", "x": 8445, "y": -1000, "rot": 0},                      # BARLAST hall
    {"no": "00525908", "x": 5200, "y": 550, "rot": 0},                        # BARLAST corridor
    {"no": "69898415", "x": -1330, "y": 4600, "rot": 0, "w": 550, "d": 540, "h": 700},                     # TÄRNÖ table + 2 chairs
]


def build_layout():
    out = []
    for spec in LAYOUT:
        hits = [p for p in search(spec["no"], 3) if p["itemNo"] == spec["no"]]
        if not hits:
            sys.exit(f"product {spec['no']} not found on IKEA.nl")
        p = hits[0]
        out.append({**spec, "product": slim(p)})
    with open("data/default-layout.json", "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"wrote data/default-layout.json ({len(out)} pieces)", file=sys.stderr)


def slim(p):
    """The fields the planner uses from a search-API product (same shape the browser gets live)."""
    keep = ["itemNo", "name", "typeName", "validDesignText", "itemMeasureReferenceText", "pipUrl", "mainImageUrl",
            "colors", "ratingValue", "ratingCount"]
    s = {k: p.get(k) for k in keep}
    s["salesPrice"] = {"numeral": p["salesPrice"]["numeral"]}
    s["gprDescription"] = {"variants": [{k: v.get(k) for k in ["itemNo", "validDesignText", "mainImageUrl", "pipUrl",
                                                              "itemMeasureReferenceText", "typeName", "name"]}
                                        | {"salesPrice": {"numeral": v["salesPrice"]["numeral"]}}
                                        for v in (p.get("gprDescription") or {}).get("variants", [])[:12]]}
    return s


if __name__ == "__main__":
    build_layout()
    if sys.argv[1:] != ["layout"]:
        build_dims()
