// Live IKEA.nl search, and turning a search-API product into a planner item.
const API = 'https://sik.search.blue.cdtapps.com/nl/en/search-result-page';

export async function search(q, { size = 24, sort } = {}) {
  const params = new URLSearchParams({ q, size, types: 'PRODUCT', c: 'sr', v: '20240110' });
  if (sort) params.set('sort', sort);
  const r = await fetch(`${API}?${params}`);
  if (!r.ok) throw new Error(`IKEA search answered ${r.status}`);
  const main = (await r.json()).searchResultPage?.products?.main;
  return { products: (main?.items || []).map(i => i.product).filter(p => p?.itemNo), total: main?.max ?? 0 };
}

// The catalogue is searched in English; common Italian words are translated first ("divano con penisola").
const IT = [
  ['divano letto', 'sofa-bed'], ['divano angolare', 'corner sofa'], ['penisola', 'chaise longue'], ['chaise longue', 'chaise longue'], ['divano', 'sofa'],
  ['poltrona', 'armchair'], ['letto matrimoniale', 'double bed'], ['letto', 'bed'], ['materasso', 'mattress'], ['armadio', 'wardrobe'],
  ['cassettiera', 'chest of drawers'], ['comodino', 'bedside table'], ['scrivania', 'desk'], ['sedia da ufficio', 'office chair'], ['sedia ufficio', 'office chair'],
  ['sedie', 'chairs'], ['sedia', 'chair'], ['sgabello', 'stool'], ['panca', 'bench'], ['tavolo da pranzo', 'dining table'], ['tavolino', 'coffee table'],
  ['tavolo', 'table'], ['mobile tv', 'tv bench'], ['porta tv', 'tv bench'], ['libreria', 'bookcase'], ['scaffale', 'shelving unit'], ['credenza', 'sideboard'],
  ['madia', 'sideboard'], ['scarpiera', 'shoe cabinet'], ['appendiabiti', 'coat rack'], ['lampada da terra', 'floor lamp'], ['piantana', 'floor lamp'],
  ['lampada da tavolo', 'table lamp'], ['lampadario', 'pendant lamp'], ['plafoniera', 'ceiling lamp'], ['lampada', 'lamp'], ['tappeto', 'rug'],
  ['bastone per tende', 'curtain rod'], ['tende', 'curtains'], ['tenda', 'curtain'], ['specchio', 'mirror'], ['vaso', 'plant pot'], ['pianta', 'plant'],
  ['balcone', 'outdoor'], ['esterno', 'outdoor'], ['grigio scuro', 'dark grey'], ['grigio', 'grey'], ['bianco', 'white'], ['nero', 'black'], ['rovere', 'oak'],
  ['legno', 'wood'], ['con', 'with'],
];
export function translate(q) {
  let out = ` ${q.toLowerCase()} `;
  for (const [it, en] of IT) out = out.replace(new RegExp(`(?<=\\s)${it}(?=\\s)`, 'g'), en);
  return out.trim();
}

export async function byItemNo(no) {
  const { products } = await search(no, { size: 3 });
  return products.find(p => p.itemNo === no) || null;
}

// Order matters: the first match wins ("TV bench" is storage, not a bench; "Bedside table" isn't a dining table).
const SHAPES = [
  [/bulb|battery|cable|remote|hook\b|knob|cover\b|slipcover/, 'accessory'],   // "Cover for 2-seat sofa" is not a sofa
  [/pendant/, 'pendant'],                                                     // lamps before tables/desks: "Table lamp"
  [/ceiling|spotlight/, 'ceillamp'],
  [/floor\/|floor lamp|uplighter/, 'floorlamp'],
  [/lamp|lighting|\blight\b|led strip/, 'tablelamp'],
  [/mattress|topper/, 'mattress'],
  [/sofa|settee|chaise/, 'sofa'],
  [/bed frame|divan|day-?bed|bunk|loft bed|bed with|^bed\b|upholstered bed|bed$/, 'bed'],
  [/bedside/, 'nightstand'],
  [/desk|workstation/, 'desk'],
  [/office chair|swivel chair|gaming chair|conference chair/, 'officechair'],
  [/table ?(and|\+) ?\d|table and chairs|dining set/, 'diningset'],
  [/coffee table|side table|nest of tables|laptop table/, 'lowtable'],
  [/tv bench|tv storage|tv unit|sideboard|cabinet|storage unit|storage combination|shoe|hallway|trolley|bench with/, 'cabinet'],
  [/wardrobe/, 'wardrobe'],
  [/chest of|drawer unit|drawers/, 'chest'],
  [/armchair|easy chair|recliner|rocking/, 'armchair'],
  [/footstool|pouffe|ottoman/, 'pouf'],
  [/table|kitchen island/, 'table'],
  [/stool/, 'stool'],
  [/bench/, 'bench'],
  [/chair/, 'chair'],
  [/bookcase|shelving|shelf unit|shelf|display/, 'shelf'],
  [/rug|mat\b/, 'rug'],
  [/curtain rod|rod|rail|curtain wire/, 'rod'],
  [/curtain|blind/, 'curtain'],
  [/mirror/, 'mirror'],
  [/hat and coat|coat stand/, 'coatstand'],
  [/coat rack/, 'cabinet'],
  [/plant|pot\b/, 'plant'],
];
export const classify = (typeName = '') => SHAPES.find(([re]) => re.test(typeName.toLowerCase()))?.[1] || 'box';

// Typical sizes (mm, width × depth × height) when IKEA gives no measurements.
const DEFAULT = {
  sofa: [2000, 900, 830], bed: [1660, 2080, 900], mattress: [1600, 2000, 200], wardrobe: [1000, 580, 2010], chest: [800, 480, 780],
  nightstand: [420, 380, 520], desk: [1200, 600, 740], officechair: [650, 650, 1150], armchair: [750, 800, 800], pouf: [500, 500, 420],
  diningset: [1250, 750, 750], lowtable: [900, 550, 450], table: [1200, 750, 750], stool: [400, 400, 650], bench: [1200, 400, 450],
  chair: [450, 520, 820], cabinet: [1200, 400, 600], shelf: [800, 300, 2000], floorlamp: [300, 300, 1600], pendant: [300, 300, 300],
  ceillamp: [400, 400, 150], tablelamp: [200, 200, 450], rug: [1330, 1950, 15], rod: [2100, 60, 40], curtain: [1450, 60, 2500],
  mirror: [500, 30, 1500], plant: [400, 400, 1000], coatstand: [450, 450, 1750], accessory: [100, 100, 100], box: [600, 600, 600], tv: [1230, 250, 760],
};
export const defaultSize = shape => DEFAULT[shape] || DEFAULT.box;

// Measurements scraped from the product page (cm, see tools/build_data.py) -> w × d × h in mm.
function fromMeasures(m, shape) {
  const g = k => (m[k] ? m[k] * 10 : undefined);
  const first = (...ks) => ks.map(g).find(Boolean);
  let w, d, h;
  if (shape === 'sofa' || shape === 'armchair') {   // chaise and corner sofas list their L sizes separately
    w = first('Width', 'Max. width', 'Width right'); d = first('Depth chaise longue', 'Max. depth', 'Width left', 'Depth'); h = g('Height');
  } else if (shape === 'bed' || shape === 'mattress') { w = g('Width'); d = g('Length'); h = shape === 'bed' ? first('Headboard height', 'Height') : first('Thickness', 'Height'); }
  else if (shape === 'diningset') { w = first('Table length', 'Length', 'Diameter'); d = first('Table width', 'Width', 'Diameter'); h = first('Table height', 'Height'); }
  else if (shape === 'rug') { w = first('Width', 'Diameter'); d = first('Length', 'Diameter'); h = first('Thickness'); }
  else if (shape === 'curtain') { w = g('Width'); h = g('Length'); }
  else if (shape === 'rod') { w = first('Length', 'Min. length'); }
  else if (shape === 'floorlamp') { w = d = first('Base diameter', 'Shade diameter', 'Diameter', 'Width'); h = first('Height', 'Max. height'); }
  else if (/lamp|pendant/.test(shape)) { w = d = first('Shade diameter', 'Diameter', 'Width'); h = first('Height', 'Max. height'); }
  else if (/table|desk/.test(shape)) {
    if (g('Diameter')) w = d = g('Diameter');
    else if (g('Length')) { w = g('Length'); d = first('Width', 'Depth'); }
    else { w = g('Width'); d = g('Depth'); }
    h = first('Height', 'Max. height');
  } else if (shape === 'officechair') { w = g('Width'); d = g('Depth'); h = first('Max. height', 'Height'); }
  else { w = first('Width', 'Length', 'Diameter'); d = first('Depth', 'Diameter') ?? (g('Width') && g('Length')); h = first('Height', 'Max. height'); }
  return w ? { w, d, h } : null;
}

// "117x50x190 cm", "160x200 cm", "37 cm" -> partial sizes, read the way IKEA writes them for each kind of product.
function fromText(text = '', shape) {
  if (!/cm/.test(text)) return null;
  const n = [...text.replace(/,/g, '.').matchAll(/\d+(?:\.\d+)?/g)].map(x => +x[0] * 10);
  if (!n.length) return null;
  if (n.length >= 3) return { w: n[0], d: n[1], h: n[2] };
  if (n.length === 1) return { w: n[0], d: n[0] };
  const [a, b] = n;
  if (shape === 'bed') return { w: a + 60, d: b + 80 };              // text gives the mattress size
  if (shape === 'curtain' || shape === 'mirror' || shape === 'shelf') return { w: a, h: b };
  if (shape === 'rod') return { w: a };
  return { w: a, d: b };
}

/** Proportions the 3D model and the fit check use: sofa layout and arms, bed style, legs. All mm. */
export function shapeParams(product, shape, dims, size) {
  const m = dims?.[product.itemNo] || {}, g = k => (m[k] != null ? m[k] * 10 : undefined);   // 0 is real: "sits on the floor"
  const t = `${product.typeName || ''} ${product.name || ''}`.toLowerCase(), sp = {};
  if (g('Free height under furniture') !== undefined) sp.leg = g('Free height under furniture');
  if (shape === 'sofa' || shape === 'armchair') {
    // L and U layouts need room for a seat run beside the chaise; a lone chaise module (~90 cm) is just a deep seat
    const wide = size.w >= 1500;
    sp.kind = shape === 'armchair' || !wide ? 'straight' : /u-shaped/.test(t) ? 'u' : /chaise|corner sofa-bed/.test(t) ? 'chaise' : /corner/.test(t) ? 'corner' : size.d > 1250 ? 'chaise' : 'straight';
    const main = g('Min. depth') || (g('Depth') < size.d ? g('Depth') : undefined);
    if (sp.kind !== 'straight') sp.md = main || Math.min(1000, Math.max(800, size.d * 0.6));
    for (const [k, label] of [['arm', 'Armrest width'], ['armH', 'Armrest height'], ['seatH', 'Seat height']]) if (g(label)) sp[k] = g(label);
  } else if (shape === 'bed') {
    if (g('Footboard height')) sp.foot = g('Footboard height');
    sp.soft = /upholstered/.test(t);
    sp.storage = /storage|drawer/.test(t);
  }
  return sp;
}

export function sizeOf(product, shape, dims) {
  const [dw, dd, dh] = defaultSize(shape);
  const measured = dims?.[product.itemNo] && fromMeasures(dims[product.itemNo], shape);
  const text = fromText(product.itemMeasureReferenceText, shape);
  const s = measured || text || {};
  const exact = !!measured || (!!s.w && !!s.d && !!s.h);
  return { w: s.w || dw, d: s.d || dd, h: s.h || dh, exact, known: !!(measured || text) };   // known: not just a typical size
}

const WORDS = [
  [/dark grey|anthracite|dark gray/, '#50545b'], [/light grey|light gray/, '#c9ccd0'], [/grey-turquoise|grey-green/, '#6f8a85'], [/grey|gray/, '#8d9198'],
  [/black-brown|black brown/, '#3b302a'], [/white stained oak|white-stained oak/, '#d9c4a0'], [/black/, '#26282c'],
  [/oak|ash/, '#c8a676'], [/birch/, '#d8bf94'], [/pine/, '#d2a86a'], [/walnut/, '#7a5538'], [/bamboo|rattan|acacia|teak|eucalyptus/, '#b88a55'],
  [/beige|natural|cream|off-white/, '#e2d6bf'], [/light brown|brown stained/, '#b08a5c'], [/brown/, '#7b5a43'], [/green/, '#6f8d6a'], [/blue|turquoise/, '#4f6f9a'],
  [/red|terracotta/, '#a5463a'], [/yellow/, '#d9b44a'], [/pink/, '#d9a3a5'], [/white/, '#f4f4f1'],
];
const WOOD_TONES = new Set(['#c8a676', '#d8bf94', '#d2a86a', '#7a5538', '#b88a55', '#b08a5c']);
export function colorFor(p, shape) {
  if (shape === 'mattress') return '#e6edf3';
  const t = (p.validDesignText || '').toLowerCase();
  let best = null;   // the colour named first wins: "white/white/black" is white
  for (const [re, hex] of WORDS) { const i = t.search(re); if (i >= 0 && (!best || i < best[0])) best = [i, hex]; }
  // two-tone "black/light brown stained": the frame is black, the piece reads as its wood
  const woody = /\//.test(t) && WORDS.find(([re, hex]) => WOOD_TONES.has(hex) && re.test(t));
  if (woody && ['#26282c', '#f4f4f1'].includes(best?.[1])) return woody[1];
  if (best) return best[1];
  const hex = p.colors?.[0]?.hex;
  return hex && hex !== '949494' ? '#' + hex : '#c9c9c4';
}

export const uid = () => Math.random().toString(36).slice(2, 10);
const ELEV = { mattress: 260, mirror: 900 };

const variantOf = v => ({ itemNo: v.itemNo, design: v.validDesignText || '', img: v.mainImageUrl, url: v.pipUrl, price: v.salesPrice?.numeral ?? 0, measure: v.itemMeasureReferenceText || '', name: v.name, typeName: v.typeName });

/** A search-API product -> planner item (position 0,0; the caller places it). */
export function toItem(p, dims) {
  const shape = classify(p.typeName), size = sizeOf(p, shape, dims);
  return {
    uid: uid(), itemNo: p.itemNo, name: p.name, type: p.typeName, design: p.validDesignText || '', price: p.salesPrice?.numeral ?? 0,
    url: p.pipUrl, img: p.mainImageUrl, measure: p.itemMeasureReferenceText || '', shape, ...size, sp: shapeParams(p, shape, dims, size), flip: 1,
    color: colorFor(p, shape), x: 0, y: 0, rot: 0, elev: /standing/i.test(p.typeName) ? 0 : (ELEV[shape] || 0),
    placed: shape !== 'accessory', qty: 1, rating: p.ratingValue ?? null, ratingCount: p.ratingCount ?? 0,
    variants: (p.gprDescription?.variants || []).slice(0, 12).map(variantOf),
  };
}

/** A colour/size variant from an item's swatches -> a product record toItem() understands. */
export const variantProduct = v => ({ itemNo: v.itemNo, name: v.name, typeName: v.typeName, validDesignText: v.design, itemMeasureReferenceText: v.measure,
  pipUrl: v.url, mainImageUrl: v.img, salesPrice: { numeral: v.price } });

/** "20569977" -> "205.699.77", the way IKEA prints article numbers. */
export const articleNo = no => String(no).replace(/^s/i, '').replace(/^(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3');

/** Same image at a smaller size from IKEA's image service. */
export const thumb = (url, f = 'xs') => (url ? `${url.split('?')[0]}?f=${f}` : '');
