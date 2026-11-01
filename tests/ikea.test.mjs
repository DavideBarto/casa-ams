// node tests/ikea.test.mjs
import assert from 'node:assert/strict';
import { classify, sizeOf } from '../js/ikea.js';

const cases = {
  'Table lamp': 'tablelamp', 'Desk lamp': 'tablelamp', 'Bedside lamp': 'tablelamp', 'Floor/reading lamp': 'floorlamp', 'Pendant lamp': 'pendant',
  'LED ceiling/wall lamp': 'ceillamp', 'Cover for 2-seat sofa': 'accessory', 'LED bulb E27 806 lumen': 'accessory',
  'Three-seat sofa-bed': 'sofa', 'Upholstered bed frame': 'bed', 'Pocket sprung mattress': 'mattress', 'Bedside table': 'nightstand',
  'TV bench': 'cabinet', 'Bench': 'bench', 'Coffee table': 'lowtable', 'Table and 4 chairs': 'diningset', 'Table+2 chairs, outdoor': 'diningset',
  'Dining table': 'table', 'Desk': 'desk', 'Office chair': 'officechair', 'Chair': 'chair', 'Wardrobe with 3 doors': 'wardrobe',
  'Chest of 3 drawers': 'chest', 'Shoe cabinet/storage': 'cabinet', 'Bookcase': 'shelf', 'Rug, low pile': 'rug',
  'Room darkening curtains, 1 pair': 'curtain', 'Curtain rod combination': 'rod', 'Mirror': 'mirror', 'Spotlight': 'ceillamp', 'LED strip': 'tablelamp',
};
for (const [type, shape] of Object.entries(cases)) assert.equal(classify(type), shape, type);

// measured sizes beat the search text; a bed's text is the mattress size
const dims = { 1: { Width: 164, Length: 206, 'Headboard height': 85 } };
assert.deepEqual(sizeOf({ itemNo: '1', itemMeasureReferenceText: '160x200 cm' }, 'bed', dims), { w: 1640, d: 2060, h: 850, exact: true, known: true });
assert.deepEqual(sizeOf({ itemNo: '2', itemMeasureReferenceText: '117x50x190 cm' }, 'wardrobe', {}), { w: 1170, d: 500, h: 1900, exact: true, known: true });
// unparseable text ("Medium") falls back to a typical size and says so
const chair = sizeOf({ itemNo: '3', itemMeasureReferenceText: 'Medium' }, 'officechair', {});
assert.equal(chair.known, false);
assert.equal(chair.exact, false);

console.log('ikea tests passed');
