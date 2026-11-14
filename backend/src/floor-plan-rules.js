// Architectural rules for AI floor plans: what DeepSeek is told, and a checker
// that measures each plan against the same rules so bad layouts get sent back
// to be fixed. Sizes follow common Kenyan practice and the Kenya building code
// (habitable rooms: window area at least 1/10 of the floor, opening part 1/20).
// All plan units are centimetres; x grows right, y grows down.

const RULES_TEXT = `ARCHITECTURAL RULES (follow all of them; plans are checked and sent back if they break them)
ZONING
- Public zone near the main entrance: living room, dining, guest toilet. Private zone away from the entrance: bedrooms and their bathrooms. Service zone together: kitchen, store, laundry, back door.
- The kitchen is next to the dining area (or open to the living/dining room), never only reachable through a bedroom.
CIRCULATION
- Every room opens onto a corridor, hall or the living/dining room. A bedroom is NEVER reached through another bedroom. A bathroom or toilet NEVER opens directly into the kitchen or dining room.
- Corridors are 100-150 cm wide and short: corridors and halls together under 15% of the floor area.
- An en-suite opens only into its own bedroom.
LIGHT AND AIR
- Every habitable room (bedroom, living, dining, kitchen, study) has at least one outside wall with a window. Window width is at least 1/10 of the room's floor area spread along the wall (e.g. a 12 m² bedroom needs at least 120 cm of window).
- Bathrooms and toilets sit on an outside wall with a small window (60 cm) for ventilation.
- Windows go on outside walls only, never on a wall between two rooms.
SIZES (minimums; aim above them)
- Living room at least 14 m², narrow side at least 300 cm. Master bedroom at least 12 m². Other bedrooms at least 9 m², narrow side at least 270 cm. Kitchen at least 6 m², narrow side at least 200 cm. Bathroom at least 3 m². Toilet at least 1.2 m² (about 100 x 140). Dining at least 8 m².
- Rooms are not long and thin: the long side is at most twice the short side (corridors excepted).
- Spans: no room wider than 550 cm in both directions without being a living/hall space (keeps beams and slabs economical).
WET AREAS
- Group the kitchen, bathrooms, toilets and laundry close together, sharing walls where possible, to keep plumbing short.
DOORS
- Main entrance 90-100 cm wide, on an outside wall of the living room or entrance hall. Internal doors 80-90 cm. Bathroom and toilet doors 70-80 cm.
- A door sits at least 10 cm from a room corner, its box fully inside the room it opens into, and does not hit another door or furniture when it swings.
FURNITURE AND CLEARANCES
- Beds have their head against a solid wall (not under a window if avoidable) with at least 60 cm free on the open sides. Wardrobes need 90 cm free in front.
- Kitchen: counter along an outside wall under the window; cooker, sink (counter) and fridge form a working triangle; 100 cm free in front of counters.
- Furniture never blocks a door or covers a window, and every item sits fully inside its room.
SHAPE
- Keep the outline simple (rectangle or L-shape) and line up internal walls, which is cheaper to build. Rooms touch with no gaps and no overlaps.`;

const norm = (s) => String(s || '').toLowerCase();
const isRoom = (i) => i.kind === 'room';
const type = (name) => {
  const n = norm(name);
  if (/corridor|hall|passage|lobby|entr/.test(n)) return 'corridor';
  if (/en-?suite/.test(n)) return 'ensuite';
  if (/bath|shower/.test(n)) return 'bathroom';
  if (/toilet|wc|cloak/.test(n)) return 'toilet';
  if (/master/.test(n)) return 'master';
  if (/bed/.test(n)) return 'bedroom';
  if (/kitchen/.test(n)) return 'kitchen';
  if (/dining/.test(n)) return 'dining';
  if (/living|lounge|sitting/.test(n)) return 'living';
  if (/study|office/.test(n)) return 'study';
  if (/store|laundry|pantry|dsq|garage|parking|veranda|balcony|terrace|porch/.test(n)) return 'other';
  return 'room';
};
const HABITABLE = new Set(['master', 'bedroom', 'living', 'dining', 'kitchen', 'study']);
const WET = new Set(['bathroom', 'toilet', 'ensuite']);
const MIN = { living: [14e4, 300], master: [12e4, 280], bedroom: [9e4, 270], kitchen: [6e4, 200], dining: [8e4, 250], bathroom: [3e4, 150], ensuite: [2.5e4, 140], toilet: [1.2e4, 90], study: [7e4, 240] };
const m2 = (cm2) => Math.round(cm2 / 1e3) / 10;

function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
const inside = (p, r, pad = 0) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
const centre = (i) => ({ x: i.x + i.w / 2, y: i.y + i.h / 2 });

/** Which parts of a room's four edges touch the outside (no other room beyond them). */
function outsideEdges(r, rooms) {
  const edges = [
    { side: 'top', len: r.w, probe: (t) => ({ x: r.x + t, y: r.y - 15 }) },
    { side: 'bottom', len: r.w, probe: (t) => ({ x: r.x + t, y: r.y + r.h + 15 }) },
    { side: 'left', len: r.h, probe: (t) => ({ x: r.x - 15, y: r.y + t }) },
    { side: 'right', len: r.h, probe: (t) => ({ x: r.x + r.w + 15, y: r.y + t }) },
  ];
  let total = 0;
  for (const e of edges) {
    let free = 0;
    for (let t = 10; t < e.len; t += 20) { const p = e.probe(t); if (!rooms.some((o) => o !== r && inside(p, o))) free += 20; }
    total += free;
  }
  return total;
}
/** The room(s) a door connects: rooms its box touches. */
function doorRooms(d, rooms) {
  const box = { x: d.x - 15, y: d.y - 15, w: d.w + 30, h: d.h + 30 };
  return rooms.filter((r) => overlap(box, r) > 0);
}

/** Check a plan against the rules. Returns a list of plain problems, worst first. */
function checkPlan(plan, prompt) {
  const items = plan.items || [];
  const rooms = items.filter(isRoom);
  const doors = items.filter((i) => i.kind === 'door');
  const windows = items.filter((i) => i.kind === 'window');
  const furniture = items.filter((i) => !['room', 'wall', 'door', 'window', 'stairs'].includes(i.kind));
  const issues = [];
  const area = rooms.reduce((t, r) => t + r.w * r.h, 0);

  // Overlapping rooms.
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const o = overlap(rooms[i], rooms[j]);
    if (o > 5000) issues.push(`"${rooms[i].name}" and "${rooms[j].name}" overlap by ${m2(o)} m². Rooms must touch, not overlap.`);
  }
  // Gaps inside the outline (bounding box much larger than the rooms, beyond an L-shape).
  if (rooms.length) {
    const x0 = Math.min(...rooms.map((r) => r.x)), y0 = Math.min(...rooms.map((r) => r.y));
    const x1 = Math.max(...rooms.map((r) => r.x + r.w)), y1 = Math.max(...rooms.map((r) => r.y + r.h));
    let holes = 0;
    for (let x = x0 + 25; x < x1; x += 50) for (let y = y0 + 25; y < y1; y += 50) {
      const p = { x, y };
      if (rooms.some((r) => inside(p, r))) continue;
      // A point is a hole if rooms surround it on all four sides (not just an outside corner of an L).
      const hit = (dx, dy) => { for (let k = 1; k < 60; k++) { const q = { x: x + dx * k * 25, y: y + dy * k * 25 }; if (q.x < x0 || q.x > x1 || q.y < y0 || q.y > y1) return false; if (rooms.some((r) => inside(q, r))) return true; } return false; };
      if (hit(1, 0) && hit(-1, 0) && hit(0, 1) && hit(0, -1)) holes += 2500;
    }
    if (holes > 20000) issues.push(`There are empty gaps of about ${m2(holes)} m² between rooms. Rooms must touch with no gaps.`);
  }
  // Sizes and proportions.
  for (const r of rooms) {
    const t = type(r.name), a = r.w * r.h, short = Math.min(r.w, r.h), long = Math.max(r.w, r.h);
    const mn = MIN[t];
    if (mn && (a < mn[0] || short < mn[1])) issues.push(`"${r.name}" is ${m2(a)} m² (${r.w}x${r.h} cm): too small. It needs at least ${m2(mn[0])} m² and a narrow side of at least ${mn[1]} cm.`);
    if (t !== 'corridor' && t !== 'other' && long > 2 * short + 20) issues.push(`"${r.name}" is long and thin (${r.w}x${r.h} cm). Keep the long side at most twice the short side.`);
    if (t === 'corridor' && short < 100) issues.push(`"${r.name}" is ${short} cm wide; corridors need 100-150 cm.`);
  }
  const corr = rooms.filter((r) => type(r.name) === 'corridor').reduce((s, r) => s + r.w * r.h, 0);
  if (area && corr / area > 0.18) issues.push(`Corridors take ${Math.round((corr / area) * 100)}% of the floor; keep them under 15% so more space goes to rooms.`);
  // Outside walls and windows for light and air.
  for (const r of rooms) {
    const t = type(r.name);
    if (!HABITABLE.has(t) && !WET.has(t)) continue;
    if (t === 'ensuite') continue;
    if (outsideEdges(r, rooms) < 60) issues.push(`"${r.name}" has no outside wall, so it gets no daylight or air. Put it on the outside of the building.`);
    const win = windows.filter((w) => inside(centre(w), r, 25));
    const winLen = win.reduce((s, w) => s + Math.max(w.w, w.h), 0);
    if (!win.length) issues.push(`"${r.name}" has no window. Add one on its outside wall.`);
    else if (HABITABLE.has(t) && winLen < (r.w * r.h) / 1e4 * 10 - 10) issues.push(`"${r.name}" has ${winLen} cm of window for ${m2(r.w * r.h)} m²; it needs at least ${Math.round((r.w * r.h) / 1e4 * 10)} cm (1/10 of the floor area).`);
  }
  for (const w of windows) {
    const c = centre(w), horiz = w.w >= w.h;
    const sideA = horiz ? { x: c.x, y: c.y - 30 } : { x: c.x - 30, y: c.y };
    const sideB = horiz ? { x: c.x, y: c.y + 30 } : { x: c.x + 30, y: c.y };
    const ra = rooms.find((r) => inside(sideA, r)), rb = rooms.find((r) => inside(sideB, r));
    if (ra && rb && ra !== rb) issues.push(`A window at (${w.x},${w.y}) is on the wall between "${ra.name}" and "${rb.name}". Windows go on outside walls only.`);
    if (!ra && !rb) issues.push(`A window at (${w.x},${w.y}) is not on any room's wall.`);
  }
  // Doors: every room reachable, and the right rooms connected.
  for (const r of rooms) {
    const t = type(r.name);
    if (t === 'other' && /veranda|balcony|terrace|porch|parking|garage/.test(norm(r.name))) continue;
    // An open corridor or dining area joined to the living room needs no door of its own.
    if ((t === 'corridor' || t === 'dining') && rooms.some((o) => o !== r && ['living', 'corridor', 'dining'].includes(type(o.name)) && overlap({ x: r.x - 5, y: r.y - 5, w: r.w + 10, h: r.h + 10 }, o) > 0)) continue;
    const mine = doors.filter((d) => doorRooms(d, rooms).includes(r));
    if (!mine.length) { issues.push(`"${r.name}" has no door. Every room needs a door on a wall it shares with a corridor, hall or living area.`); continue; }
    for (const d of mine) {
      const others = doorRooms(d, rooms).filter((o) => o !== r);
      for (const o of others) {
        const ot = type(o.name);
        if ((t === 'bedroom' || t === 'master') && (ot === 'bedroom' || ot === 'master')) issues.push(`"${r.name}" opens into "${o.name}". A bedroom must never be reached through another bedroom.`);
        if (WET.has(t) && t !== 'ensuite' && (ot === 'kitchen' || ot === 'dining')) issues.push(`"${r.name}" opens straight into "${o.name}". Bathrooms and toilets open onto a corridor or hall, not the kitchen or dining.`);
        if (t === 'ensuite' && !(ot === 'master' || ot === 'bedroom')) issues.push(`"${r.name}" (en-suite) opens into "${o.name}". An en-suite opens only into its bedroom.`);
      }
    }
  }
  if (!doors.some((d) => rooms.some((r) => outsideEdges(r, rooms) > 0 && doorRooms(d, rooms).length === 1 && ['living', 'corridor', 'dining', 'kitchen'].includes(type(r.name))))) {
    issues.push('There is no main entrance door on an outside wall of the living room or entrance hall.');
  }
  // Furniture inside rooms and clear of doors.
  for (const f of furniture) {
    if (['car', 'plant'].includes(f.kind)) continue;
    const host = rooms.find((r) => f.x >= r.x - 5 && f.y >= r.y - 5 && f.x + f.w <= r.x + r.w + 5 && f.y + f.h <= r.y + r.h + 5);
    if (!host) issues.push(`The ${f.name || f.kind} at (${f.x},${f.y}) is not fully inside a room.`);
    for (const d of doors) if (overlap(f, d) > 400) { issues.push(`The ${f.name || f.kind} blocks a door at (${d.x},${d.y}).`); break; }
  }
  // Total area against the brief.
  const want = /(\d{2,4})\s*(m²|m2|sqm|square met)/i.exec(String(prompt || ''));
  if (want) {
    const target = Number(want[1]) * 1e4;
    if (area && Math.abs(area - target) / target > 0.15) issues.push(`The rooms add up to ${m2(area)} m² but the brief asks for about ${want[1]} m². Resize the rooms to match.`);
  }
  // Wet areas grouped.
  const wet = rooms.filter((r) => WET.has(type(r.name)) || type(r.name) === 'kitchen');
  if (wet.length >= 3) {
    const cs = wet.map(centre); const cx = cs.reduce((s, p) => s + p.x, 0) / cs.length, cy = cs.reduce((s, p) => s + p.y, 0) / cs.length;
    const far = wet.filter((r, i) => Math.hypot(cs[i].x - cx, cs[i].y - cy) > 900);
    if (far.length) issues.push(`Wet rooms are spread out (${far.map((r) => r.name).join(', ')} far from the others). Group the kitchen, bathrooms and toilets to share plumbing.`);
  }
  return [...new Set(issues)];
}

// ---------------------------------------------------------------------------
// Automatic repairs: the things code can fix exactly, so DeepSeek only has to
// get the layout right. Run on every plan before it is checked.
const r10 = (v) => Math.round(v / 10) * 10;

/** The longest stretch of a room's walls with nothing beyond it (outside), as {side, from, to}. */
function longestOutsideRun(r, rooms) {
  const sides = [
    { side: 'top', len: r.w, at: (t) => ({ x: r.x + t, y: r.y - 15 }) },
    { side: 'bottom', len: r.w, at: (t) => ({ x: r.x + t, y: r.y + r.h + 15 }) },
    { side: 'left', len: r.h, at: (t) => ({ x: r.x - 15, y: r.y + t }) },
    { side: 'right', len: r.h, at: (t) => ({ x: r.x + r.w + 15, y: r.y + t }) },
  ];
  let best = null;
  for (const s of sides) {
    let start = null;
    for (let t = 10; t <= s.len; t += 10) {
      const free = t < s.len && !rooms.some((o) => o !== r && inside(s.at(t), o));
      if (free && start === null) start = t;
      if ((!free || t >= s.len) && start !== null) {
        const run = { side: s.side, from: start, to: t, len: t - start };
        if (!best || run.len > best.len) best = run;
        start = null;
      }
    }
  }
  return best;
}

/** Move a door or window so its nearest side sits exactly on the closest room wall line. */
function snapToWall(it, rooms, isWindow) {
  const xs = new Set(), ys = new Set();
  rooms.forEach((r) => { xs.add(r.x); xs.add(r.x + r.w); ys.add(r.y); ys.add(r.y + r.h); });
  const near = (v, set) => { let b = null; for (const s of set) if (b === null || Math.abs(s - v) < Math.abs(b - v)) b = s; return b; };
  if (isWindow) {
    if (it.w >= it.h) { const y = near(it.y + it.h / 2, ys); if (y !== null && Math.abs(y - (it.y + it.h / 2)) <= 60) it.y = y - it.h / 2; }
    else { const x = near(it.x + it.w / 2, xs); if (x !== null && Math.abs(x - (it.x + it.w / 2)) <= 60) it.x = x - it.w / 2; }
    return;
  }
  // Door: align whichever of its four sides is closest to a wall line.
  const cand = [
    { d: (y) => y - it.y, v: near(it.y, ys), axis: 'y', off: 0 },
    { d: (y) => y - (it.y + it.h), v: near(it.y + it.h, ys), axis: 'y', off: -it.h },
    { d: (x) => x - it.x, v: near(it.x, xs), axis: 'x', off: 0 },
    { d: (x) => x - (it.x + it.w), v: near(it.x + it.w, xs), axis: 'x', off: -it.w },
  ].filter((c) => c.v !== null).map((c) => ({ ...c, gap: Math.abs(c.d(c.v)) })).sort((a, b) => a.gap - b.gap)[0];
  if (cand && cand.gap > 0 && cand.gap <= 40) { if (cand.axis === 'y') it.y = cand.v + cand.off; else it.x = cand.v + cand.off; }
}

/** Repair a plan in place-safe copy: area, windows, doors, furniture, rounding. Returns the new plan. */
function autoFix(plan, prompt) {
  const items = (plan.items || []).map((i) => ({ ...i }));
  let rooms = items.filter(isRoom);
  if (!rooms.length) return plan;
  // 1. Scale to the area asked for (rooms grow or shrink; doors, windows and furniture keep their size).
  const want = /(\d{2,4})\s*(m²|m2|sqm|square met)/i.exec(String(prompt || ''));
  const area = rooms.reduce((t, r) => t + r.w * r.h, 0);
  if (want && area) {
    const target = Number(want[1]) * 1e4, k = Math.sqrt(target / area);
    if (Math.abs(k - 1) > 0.05 && k > 0.5 && k < 2) {
      for (const i of items) {
        if (isRoom(i)) { const x1 = r10((i.x + i.w) * k), y1 = r10((i.y + i.h) * k); i.x = r10(i.x * k); i.y = r10(i.y * k); i.w = x1 - i.x; i.h = y1 - i.y; }
        else { const cx = (i.x + i.w / 2) * k, cy = (i.y + i.h / 2) * k; i.x = r10(cx - i.w / 2); i.y = r10(cy - i.h / 2); }
      }
    }
  }
  rooms = items.filter(isRoom);
  // 2. Doors and windows onto the wall lines.
  items.forEach((i) => { if (i.kind === 'door') snapToWall(i, rooms, false); if (i.kind === 'window') snapToWall(i, rooms, true); });
  // 3. Windows on inside walls, or on no wall, go.
  let out = items.filter((w) => {
    if (w.kind !== 'window') return true;
    const c = centre(w), horiz = w.w >= w.h;
    const a = rooms.find((r) => inside(horiz ? { x: c.x, y: c.y - 30 } : { x: c.x - 30, y: c.y }, r));
    const b = rooms.find((r) => inside(horiz ? { x: c.x, y: c.y + 30 } : { x: c.x + 30, y: c.y }, r));
    return !(a && b && a !== b) && (a || b);
  });
  // 4. Every habitable and wet room gets enough window on its longest outside wall.
  for (const r of rooms) {
    const t = type(r.name);
    if (!(HABITABLE.has(t) || (WET.has(t) && t !== 'ensuite'))) continue;
    const have = out.filter((w) => w.kind === 'window' && inside(centre(w), r, 25)).reduce((s, w) => s + Math.max(w.w, w.h), 0);
    const need = WET.has(t) ? 60 : Math.max(120, Math.ceil(((r.w * r.h) / 1e4) * 10 / 10) * 10);
    if (have >= need) continue;
    const run = longestOutsideRun(r, rooms);
    if (!run || run.len < 60) continue;
    const len = Math.min(r10(need - have >= 60 ? need - have : 60), run.len - 20);
    if (len < 50) continue;
    const mid = (run.from + run.to) / 2;
    const name = WET.has(t) ? 'Small window' : 'Window';
    if (run.side === 'top' || run.side === 'bottom') out.push({ kind: 'window', name, x: r10(r.x + mid - len / 2), y: (run.side === 'top' ? r.y : r.y + r.h) - 10, w: len, h: 20, rot: 0 });
    else out.push({ kind: 'window', name, x: (run.side === 'left' ? r.x : r.x + r.w) - 10, y: r10(r.y + mid - len / 2), w: 20, h: len, rot: 1 });
  }
  // 4b. Every room gets a door onto the right neighbour (corridor/hall first), placed on the shared wall.
  const sharedWall = (r, o) => {
    if (Math.abs(r.y - (o.y + o.h)) < 5 || Math.abs(r.y + r.h - o.y) < 5) {
      const a = Math.max(r.x, o.x), b = Math.min(r.x + r.w, o.x + o.w);
      return b - a > 0 ? { side: Math.abs(r.y - (o.y + o.h)) < 5 ? 'top' : 'bottom', a, b } : null;
    }
    if (Math.abs(r.x - (o.x + o.w)) < 5 || Math.abs(r.x + r.w - o.x) < 5) {
      const a = Math.max(r.y, o.y), b = Math.min(r.y + r.h, o.y + o.h);
      return b - a > 0 ? { side: Math.abs(r.x - (o.x + o.w)) < 5 ? 'left' : 'right', a, b } : null;
    }
    return null;
  };
  const prefer = (t) => (t === 'ensuite' ? ['master', 'bedroom'] : (t === 'bedroom' || t === 'master' || WET.has(t)) ? ['corridor', 'living'] : t === 'kitchen' ? ['dining', 'corridor', 'living'] : ['corridor', 'living', 'dining']);
  for (const r of rooms) {
    const t = type(r.name);
    if (t === 'corridor' || (t === 'other' && /veranda|balcony|terrace|porch|parking|garage/.test(norm(r.name)))) continue;
    const hasDoor = out.some((d) => d.kind === 'door' && overlap({ x: d.x - 15, y: d.y - 15, w: d.w + 30, h: d.h + 30 }, r) > 0);
    if (hasDoor) continue;
    const dw = WET.has(t) ? 80 : 90;
    let placed = false;
    for (const want of prefer(t)) {
      for (const o of rooms.filter((x) => x !== r && type(x.name) === want)) {
        const w = sharedWall(r, o);
        if (!w || w.b - w.a < dw + 30) continue;
        const at = r10(w.a + 20);
        if (w.side === 'top') out.push({ kind: 'door', name: 'Door', x: at, y: r.y, w: dw, h: dw, rot: 0 });
        else if (w.side === 'bottom') out.push({ kind: 'door', name: 'Door', x: at, y: r.y + r.h - dw, w: dw, h: dw, rot: 2 });
        else if (w.side === 'left') out.push({ kind: 'door', name: 'Door', x: r.x, y: at, w: dw, h: dw, rot: 1 });
        else out.push({ kind: 'door', name: 'Door', x: r.x + r.w - dw, y: at, w: dw, h: dw, rot: 3 });
        placed = true; break;
      }
      if (placed) break;
    }
  }
  // 5. Furniture must sit inside a room and clear of doors; anything else is dropped.
  const doors = out.filter((i) => i.kind === 'door');
  out = out.filter((f) => {
    if (['room', 'wall', 'door', 'window', 'stairs', 'car', 'plant'].includes(f.kind)) return true;
    const host = rooms.find((r) => f.x >= r.x - 5 && f.y >= r.y - 5 && f.x + f.w <= r.x + r.w + 5 && f.y + f.h <= r.y + r.h + 5);
    return host && !doors.some((d) => overlap(f, d) > 400);
  });
  // 6. Everything on the 10 cm grid.
  out.forEach((i) => { i.x = r10(i.x); i.y = r10(i.y); i.w = Math.max(10, r10(i.w)); i.h = Math.max(10, r10(i.h)); });
  return { ...plan, items: out };
}

// A good plan to copy (2-bedroom house, about 72 m²): rooms tile with no gaps,
// every room opens off the corridor, windows on outside walls, wet rooms together.
const EXAMPLE_PLAN = JSON.stringify({ name: '2-bedroom house, 72 m²', units: 'cm', items: [
  { kind: 'room', name: 'Living room', x: 0, y: 0, w: 520, h: 380 }, { kind: 'room', name: 'Kitchen', x: 520, y: 0, w: 380, h: 380 },
  { kind: 'room', name: 'Corridor', x: 0, y: 380, w: 900, h: 120 }, { kind: 'room', name: 'Bedroom 1', x: 0, y: 500, w: 350, h: 300 },
  { kind: 'room', name: 'Bathroom', x: 350, y: 500, w: 200, h: 300 }, { kind: 'room', name: 'Bedroom 2', x: 550, y: 500, w: 350, h: 300 },
  { kind: 'door', name: 'Front door', x: 0, y: 150, w: 90, h: 90, rot: 1 }, { kind: 'door', name: 'Door', x: 400, y: 290, w: 90, h: 90, rot: 0 },
  { kind: 'door', name: 'Door', x: 780, y: 290, w: 90, h: 90, rot: 0 }, { kind: 'door', name: 'Door', x: 240, y: 500, w: 90, h: 90, rot: 2 },
  { kind: 'door', name: 'Door', x: 400, y: 500, w: 80, h: 80, rot: 2 }, { kind: 'door', name: 'Door', x: 580, y: 500, w: 90, h: 90, rot: 2 },
  { kind: 'window', name: 'Window', x: 180, y: -10, w: 200, h: 20, rot: 0 }, { kind: 'window', name: 'Window', x: 640, y: -10, w: 150, h: 20, rot: 0 },
  { kind: 'window', name: 'Window', x: 110, y: 790, w: 120, h: 20, rot: 0 }, { kind: 'window', name: 'Window', x: 420, y: 790, w: 60, h: 20, rot: 0 },
  { kind: 'window', name: 'Window', x: 660, y: 790, w: 120, h: 20, rot: 0 },
  { kind: 'sofa', name: 'Sofa', x: 150, y: 280, w: 200, h: 90, rot: 2 }, { kind: 'cooker', name: 'Cooker', x: 530, y: 10, w: 60, h: 60, rot: 0 },
  { kind: 'counter', name: 'Counter', x: 590, y: 10, w: 240, h: 60, rot: 0 }, { kind: 'fridge', name: 'Fridge', x: 830, y: 10, w: 60, h: 70, rot: 0 },
  { kind: 'table', name: 'Dining table', x: 580, y: 180, w: 160, h: 90, rot: 0 }, { kind: 'bed', name: 'Double bed', x: 10, y: 620, w: 200, h: 160, rot: 3 },
  { kind: 'wardrobe', name: 'Wardrobe', x: 280, y: 610, w: 60, h: 180, rot: 1 }, { kind: 'basin', name: 'Basin', x: 360, y: 620, w: 50, h: 60, rot: 3 },
  { kind: 'toilet', name: 'Toilet', x: 380, y: 720, w: 40, h: 70, rot: 2 }, { kind: 'shower', name: 'Shower', x: 450, y: 700, w: 90, h: 90, rot: 0 },
  { kind: 'bed', name: 'Double bed', x: 690, y: 620, w: 200, h: 160, rot: 1 },
] });

module.exports = { RULES_TEXT, checkPlan, autoFix, EXAMPLE_PLAN };
