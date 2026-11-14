// Floor plan layouts arranged by code, not by the AI. DeepSeek is good at
// "which rooms and how big" and bad at placing rooms on a grid, so for ordinary
// houses (bungalows and maisonette ground floors) Buildsasa arranges the rooms
// itself in the classic Kenyan "spine" layout, which follows the rules by design:
//
//   [ parking ][ VERANDA across the front ............................ ]
//   [ parking ][ LIVING ROOM (front door) ][ DINING ......... ]
//              [                           ][ KITCHEN ........ ]
//              [ left rooms ][ CORRIDOR ][ right rooms        ]
//              [ (bedrooms, ][          ][ (bathroom,         ]
//              [  bathroom, ][          ][  bedrooms, master  ]
//              [  store...) ][          ][  + en-suite)       ]
//
// Every room in the back half touches the corridor (its door) and an outside
// wall (its window). The automatic repairs then add windows, beds, wardrobes,
// bathroom fittings, the kitchen, stairs and cars; the rule checker confirms it.
// All units are centimetres; x grows right, y grows down.

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const num = (s) => (WORDS[s] || Number(s) || 0);

/** Is this brief an ordinary house we can lay out ourselves? Returns its spec, or null. */
function houseSpec(prompt) {
  const s = String(prompt || '').toLowerCase();
  if (/shop|office|bedsitter|bed-sitter|studio|single rooms?|rental block|block of|apartment|flats?\b|hostel|church|school|warehouse|petrol|hotel|restaurant|clinic|hospital|factory|stall|kiosk|units? of|units each|storey block|commercial/.test(s)) return null;
  if (!/bed|bungalow|maisonette|house|home|villa|duplex|mansion|nyumba|vyumba/.test(s)) return null;
  const b = /(\d+|one|two|three|four|five|six)[\s-]*(bed|bd|br)/.exec(s) || /vyumba\s*(\d+|vitatu|viwili|vinne|vitano)/.exec(s);
  const bedrooms = b ? (num(b[1]) || { viwili: 2, vitatu: 3, vinne: 4, vitano: 5 }[b[1]] || 0) : 3;
  if (!bedrooms || bedrooms > 5) return null; // 6+ bedrooms: unusual, DeepSeek draws it
  const sized = /(\d{2,4})\s*(m²|m2|sqm|square met)/.exec(s);
  if (sized && Number(sized[1]) > 260) return null; // mansions: unusual, DeepSeek draws it
  const storey = /maisonette|two[- ]?stor(e)?y|double[- ]?stor(e)?y|duplex|upstairs|ground floor/.test(s);
  const area = /(\d{2,4})\s*(m²|m2|sqm|square met)/.exec(s);
  const carsM = /(\d+|one|two|three|four)\s*(cars?|vehicles?)/.exec(s);
  const cars = carsM ? Math.min(3, num(carsM[1]) || 1) : /parking|garage|carport/.test(s) ? 1 : 0;
  const askedEnsuite = /en-?suite|self[- ]contained|ensuite/.test(s);
  const m2 = area ? Number(area[1]) : [0, 50, 75, 115, 150, 190, 230][bedrooms];
  // A compact house (under ~35 m² per bedroom) has a living & dining room and no separate store.
  const compact = bedrooms <= 2 || m2 / bedrooms < 35;
  return {
    bedrooms, storey, cars, compact,
    area: m2,
    ensuite: !/no en-?suite|without en-?suite/.test(s) && ((bedrooms >= 3 && (!compact || askedEnsuite)) || (bedrooms === 2 && askedEnsuite)),
    veranda: !/no veranda|without veranda/.test(s),
    guestToilet: storey,
    store: /store|pantry/.test(s) || (bedrooms >= 3 && !compact),
  };
}

/** Lay out a house. variant 0-3 mirrors it and moves the parking, for "Try another design". */
function layoutHouse(spec, variant = 0) {
  // Draw once at standard sizes, measure, then redraw with every size scaled to the area asked for,
  // so nothing gets squeezed afterwards (doors and furniture keep their real size).
  const first = drawHouse(spec, variant, 1);
  const indoor = first.items.filter((i) => i.kind === 'room' && !/veranda|parking/i.test(i.name)).reduce((t, r) => t + r.w * r.h, 0);
  const k = spec.area && indoor ? Math.min(1.6, Math.max(0.8, Math.sqrt((spec.area * 1e4) / indoor))) : 1;
  return Math.abs(k - 1) < 0.03 ? first : drawHouse(spec, variant, k);
}

function drawHouse(spec, variant, k) {
  // Big houses grow more in width than depth, so the corridor stays short.
  const kx = k, ky = k;
  const zx = (v) => Math.round((v * kx) / 10) * 10, z = (v) => Math.round((v * ky) / 10) * 10;
  const small = spec.compact;
  // frontH is a multiple of 20 so dining and kitchen (half each) stay on the 10 cm grid.
  const leftW = zx(360), corW = Math.max(110, Math.min(150, zx(120))), rightW = spec.ensuite ? Math.max(510, zx(520)) : zx(small ? 360 : 400), frontH = 2 * z(small ? 200 : 265), verH = spec.veranda ? 200 : 0;
  const W = leftW + corW + rightW;
  const masterRoom = spec.bedrooms >= 2;
  // The rooms behind the front half. "side" = where it may go: L (left only), R (right only), any.
  // Deep enough that a full-width bathroom on the wide side isn't long and thin.
  const rooms = [{ key: 'bath', name: 'Bathroom', h: Math.max(z(250), Math.round((rightW / 2 - 10) / 10) * 10), side: 'any', wet: true }];
  if (spec.guestToilet) rooms.push({ key: 'gt', name: 'Guest toilet', h: z(180), side: 'L', wet: true, door: 80 });
  if (spec.store) rooms.push({ key: 'store', name: 'Store', h: z(180), side: 'L', door: 80 });
  const plain = masterRoom ? spec.bedrooms - 1 : 1;
  for (let i = 0; i < plain; i++) rooms.push({ key: `bed${i}`, name: 'Bedroom', h: z(small ? 350 : 330), side: 'any', bed: true });
  // In a compact house without an en-suite the biggest bedroom is just "Bedroom 1", not a master suite.
  const master = masterRoom ? { key: 'master', name: spec.ensuite || !small ? 'Master bedroom' : 'Bedroom 1', h: z(spec.ensuite ? 420 : 380), side: 'R' } : null;

  // Try every left/right split of the movable rooms; keep the one with the two sides closest in length.
  const movable = rooms.filter((r) => r.side === 'any');
  let best = null;
  for (let mask = 0; mask < (1 << movable.length); mask++) {
    const left = rooms.filter((r) => r.side === 'L' || (r.side === 'any' && mask & (1 << movable.indexOf(r))));
    const right = rooms.filter((r) => !left.includes(r));
    if (!left.some((r) => r.bed || r.key === 'bath')) continue; // the left side needs a real room
    const lh = left.reduce((t, r) => t + r.h, 0), rh = right.reduce((t, r) => t + r.h, 0) + (master ? master.h : 0);
    // Prefer the bathroom on the right (near the kitchen), then the closest balance.
    // The shorter side must have a room that can grow (a bedroom or the bathroom); a master suite can't stretch.
    const shorter = lh < rh ? left : rh < lh ? right : null;
    const stuck = shorter && !shorter.some((r) => r.bed || r.key === 'bath');
    const score = Math.abs(lh - rh) + (left.some((r) => r.key === 'bath') ? 60 : 0) + (stuck ? 1000 : 0);
    if (!best || score < best.score) best = { left, right, score };
  }
  // Wet rooms and the store go to the top of each side (nearest the kitchen), bedrooms below.
  const order = (a, b) => (a.bed ? 1 : 0) - (b.bed ? 1 : 0);
  const leftCol = best.left.slice().sort(order).map((r) => ({ ...r }));
  const rightCol = [...best.right.slice().sort(order), ...(master ? [master] : [])].map((r) => ({ ...r }));
  const sum = (c) => c.reduce((t, r) => t + r.h, 0);
  // The shorter side's bedrooms grow (10 cm at a time) to meet the longer side, so there are no gaps.
  const grow = (col, extra) => {
    const can = col.filter((r) => r.bed || r.key === 'master' && !spec.ensuite) .concat(col.filter((r) => r.key === 'bath'));
    const pool = can.length ? can : col;
    for (let i = 0; extra > 0 && i < 1000; i++) { const r = pool[i % pool.length]; r.h += 10; extra -= 10; }
  };
  const diff = sum(leftCol) - sum(rightCol);
  if (diff > 0) grow(rightCol, diff); else if (diff < 0) grow(leftCol, -diff);
  const depth = Math.max(sum(leftCol), sum(rightCol));

  const items = [];
  const room = (name, x, y, w, h) => { const r = { kind: 'room', name, x, y, w, h }; items.push(r); return r; };
  const door = (name, x, y, w, h, rot) => items.push({ kind: 'door', name, x, y, w, h, rot });
  const yFront = verH, yBack = verH + frontH;

  // Front half.
  if (verH) room('Veranda', 0, 0, W, verH);
  let dining = null, kitchen;
  room(small ? 'Living & dining' : 'Living room', 0, yFront, leftW + corW, frontH);
  if (small) {
    kitchen = room('Kitchen', leftW + corW, yFront, rightW, frontH);
  } else {
    dining = room('Dining', leftW + corW, yFront, rightW, frontH / 2);
    kitchen = room('Kitchen', leftW + corW, yFront + frontH / 2, rightW, frontH / 2);
  }
  // Back half: corridor down the middle.
  room('Corridor', leftW, yBack, corW, depth);
  let n = 2;
  const bedName = () => (masterRoom ? `Bedroom ${n++}` : 'Bedroom');
  const place = (col, x, w, doorRot) => {
    let y = yBack;
    col.forEach((c, i) => {
      const h = i === col.length - 1 ? yBack + depth - y : c.h;
      const dw = c.door || (c.wet ? 80 : 90);
      const doorX = doorRot === 3 ? x + w - dw : x;
      if (c.key === 'master' && spec.ensuite) {
        const ew = Math.max(180, Math.min(zx(210), w - 300));
        room('Master bedroom', x, y, w - ew, h); door('Door', x, y + Math.round(h / 2 - 45), 90, 90, 1);
        room('En-suite', x + w - ew, y, ew, h); door('Door', x + w - ew, y + Math.round(h / 2 - 40), 80, 80, 1);
      } else {
        room(c.bed ? bedName() : c.name === 'Master bedroom' || c.name === 'Bedroom 1' ? c.name : c.name, x, y, w, h);
        door('Door', doorX, y + Math.round(h / 2 - dw / 2), dw, dw, doorRot);
      }
      y += h;
    });
  };
  place(leftCol, 0, leftW, 3);
  place(rightCol, leftW + corW, rightW, 1);
  // Front doors: veranda into the living room, living room into the corridor, kitchen into dining.
  door('Front door', 60, yFront, 100, 100, 0);
  door('Door', leftW + Math.round((corW - 90) / 2), yBack, 90, 90, 0);
  if (dining) door('Door', kitchen.x + Math.round(rightW / 2 - 45), kitchen.y, 90, 90, 0);
  else door('Door', kitchen.x, kitchen.y + Math.round(frontH / 2 - 45), 90, 90, 1); // open kitchen off the living & dining
  // Seating and the dining table (the repairs add beds, wardrobes, fittings and the kitchen).
  items.push({ kind: 'sofa', name: 'Sofa', x: 30, y: yBack - 110, w: 200, h: 90, rot: 2 });
  // Dining table with four chairs (two each side).
  const tbl = dining
    ? { x: Math.round((dining.x + rightW / 2 - 80) / 10) * 10, y: Math.round((dining.y + frontH / 4 - 45) / 10) * 10, w: 160, h: 90 }
    : { x: 130, y: yFront + 80, w: 140, h: 80 };
  items.push({ kind: 'table', name: 'Dining table', ...tbl, rot: 0 });
  for (const cx of [tbl.x + 15, tbl.x + tbl.w - 60]) {
    items.push({ kind: 'chair', name: 'Chair', x: cx, y: tbl.y - 50, w: 45, h: 45, rot: 0 });
    items.push({ kind: 'chair', name: 'Chair', x: cx, y: tbl.y + tbl.h + 5, w: 45, h: 45, rot: 2 });
  }
  // Parking alongside the front of the house.
  if (spec.cars) {
    const pw = spec.cars >= 2 ? 560 + (spec.cars - 2) * 280 : 300;
    room('Parking', -pw, 0, pw, Math.max(520, yBack));
  }
  // Variants for "Try another design": mirror left-right, and/or parking beside the back half.
  let out = items;
  if (variant % 2 === 1) out = out.map((i) => ({ ...i, x: W - i.x - i.w, rot: i.kind === 'door' ? ({ 1: 3, 3: 1 }[i.rot] ?? i.rot) : i.rot }));
  if (variant >= 2 && spec.cars) {
    const p = out.find((i) => i.name === 'Parking');
    p.x = variant % 2 === 1 ? W : -p.w; p.y = yBack; p.h = Math.max(520, Math.min(depth, 700));
  }
  const x0 = Math.min(...out.map((i) => i.x)), y0 = Math.min(...out.map((i) => i.y));
  out = out.map((i) => ({ ...i, x: i.x - x0, y: i.y - y0 }));
  const name = `${spec.bedrooms}-bedroom ${spec.storey ? 'maisonette (ground floor)' : 'bungalow'}, ${spec.area} m²`;
  return { name, units: 'cm', items: out };
}

module.exports = { houseSpec, layoutHouse };
