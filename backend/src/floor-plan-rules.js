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
- Living room at least 14 m², narrow side at least 300 cm. Master bedroom at least 11 m². Other bedrooms at least 9 m², narrow side at least 270 cm. Kitchen at least 6 m², narrow side at least 200 cm. Bathroom at least 3 m². Toilet at least 1.2 m² (about 100 x 140). Dining at least 8 m².
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
- Keep the outline simple (rectangle or L-shape, at most 8 outside corners) and line up internal walls, which is cheaper to build. Rooms touch with no gaps and no overlaps. Nothing sticks out of the outline at odd depths: veranda, store and toilets fit inside the rectangle or line up with the building edge.
- No small leftover pieces: every room is a real, usable room (at least 2 m² and 90 cm wide). Do not split one bathroom into two fragments.
ENTRANCE AND OUTDOOR SPACE
- The main entrance door (100 cm) is on an outside wall of the living room or an entrance hall, never into a corridor deep in the house or a bedroom.
- A veranda goes at the FRONT, sharing a wall with the living room (or dining), and you step from the veranda into the living room. Never put the veranda behind a bedroom or only reachable through a bedroom.
LIVING, DINING, KITCHEN
- Living and dining share a wall with a wide opening (150 cm or more) between them, or are one open room. The kitchen shares a wall with the dining (or living) room.
SERVICE ROOMS AND BATHROOMS
- A store, pantry or laundry opens off the kitchen, corridor or dining room, never through a bedroom.
- If there are bedrooms without an en-suite, a shared bathroom opens off the corridor so they can reach it without crossing another room. An en-suite sits inside the master bedroom's footprint edge and opens only into it.
- Corridors are short: no corridor longer than 12 m (under 10 m for 3 bedrooms or fewer). Put the bedrooms around a short corridor or hall instead of along one long passage.
- A bathroom or toilet is NEVER reached through another bathroom or an en-suite. The shared bathroom opens straight off the corridor.
- One corridor, not pieces: never split a corridor or hall into parts with a wall and a door between them.
- A bedroom is NEVER reached through the kitchen or the dining room. Bedrooms open off a corridor, a hall or (in small houses) the living room.
STOREYS, PARKING, VERANDA
- A maisonette, two-storey or duplex (or any "ground floor" plan) MUST have a staircase: kind "stairs", at least 100 x 270 cm, off the living room or entrance hall, never inside a bedroom, kitchen or bathroom.
- Parking: each car needs 250 x 500 cm. Two cars side by side need about 550 x 550 cm (or 300 x 1100 cm one behind the other). Every car is drawn fully inside the parking area. Parking and veranda do NOT count toward the floor area asked for.
- The veranda is at least 300 cm long and 150 cm deep and runs along the living room, inside the building line (not a small box stuck on).
- The size you write in the plan name must be the size you actually draw.
FURNITURE IN THE RIGHT ROOM
- Beds and wardrobes only in bedrooms. Toilet, shower, bath and basin only in bathrooms, toilets and en-suites. Cooker, fridge and counter only in the kitchen. Nothing at all stands in a corridor.
- Every bathroom has a toilet, a basin and a shower or bath; a separate toilet has a toilet and a small basin; an en-suite has a toilet, basin and shower.
EVERY ROOM FURNISHED SENSIBLY
- Every bedroom has a bed (master: double 160x200 or 180x200; others: double or single) and a wardrobe. The living room has seating; the dining room a table and chairs; the kitchen a counter, cooker and fridge.
- Furniture never stands in front of a window: wardrobes, counters and tall items go on solid walls; a bed head goes against a solid wall.
- Kitchen working triangle: the fridge stands next to the counter run (touching it or the cooker), not alone across the room.
DOORS DON'T CLASH
- Two door swings never overlap. Where several rooms open onto the same piece of corridor, stagger the doors along it.`;

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
const MIN = { living: [14e4, 300], master: [11e4, 280], bedroom: [9e4, 270], kitchen: [6e4, 200], dining: [8e4, 250], bathroom: [3e4, 150], ensuite: [2.5e4, 140], toilet: [1.2e4, 90], study: [7e4, 240] };
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
    for (let t = 10; t < e.len; t += 20) { const p = e.probe(t); if (!rooms.some((o) => o !== r && !OUTDOOR.test(norm(o.name)) && inside(p, o))) free += 20; }
    total += free;
  }
  return total;
}
/** The room(s) a door connects: rooms its box touches. */
function doorRooms(d, rooms) {
  // The door's room is the one its square sits in; the other room is straight across
  // the wall the square touches (probed at the door's middle), not any neighbour near a corner.
  const c = centre(d);
  const host = rooms.find((r) => inside(c, r));
  if (!host) { const box = { x: d.x - 15, y: d.y - 15, w: d.w + 30, h: d.h + 30 }; return rooms.filter((r) => overlap(box, r) > 0); }
  // The wall it sits on is the CLOSEST edge (a door 20 cm from a corner is still on its side wall).
  const edges = [
    { gap: Math.abs(d.y - host.y), probe: { x: c.x, y: host.y - 20 } },
    { gap: Math.abs(d.y + d.h - (host.y + host.h)), probe: { x: c.x, y: host.y + host.h + 20 } },
    { gap: Math.abs(d.x - host.x), probe: { x: host.x - 20, y: c.y } },
    { gap: Math.abs(d.x + d.w - (host.x + host.w)), probe: { x: host.x + host.w + 20, y: c.y } },
  ].sort((a, b) => a.gap - b.gap);
  if (edges[0].gap > 20) return [host];
  const probe = edges[0].probe;
  const other = rooms.find((r) => r !== host && inside(probe, r));
  return other ? [host, other] : [host];
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
    if (mn && a < mn[0]) issues.push(`"${r.name}" is ${m2(a)} m² (${r.w}x${r.h} cm): too small. It needs at least ${m2(mn[0])} m² and a narrow side of at least ${mn[1]} cm.`);
    else if (mn && short < mn[1]) issues.push(`"${r.name}" is only ${short} cm wide (${r.w}x${r.h} cm): too narrow to use. Make its narrow side at least ${mn[1]} cm.`);
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
    const indoor = rooms.filter((r) => !OUTDOOR.test(norm(r.name)));
    const ra = indoor.find((r) => inside(sideA, r)), rb = indoor.find((r) => inside(sideB, r));
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
  // Furniture inside rooms and clear of doors.
  for (const f of furniture) {
    if (['car', 'plant'].includes(f.kind)) continue;
    const host = rooms.find((r) => f.x >= r.x - 5 && f.y >= r.y - 5 && f.x + f.w <= r.x + r.w + 5 && f.y + f.h <= r.y + r.h + 5);
    if (!host) issues.push(`The ${f.name || f.kind} at (${f.x},${f.y}) is not fully inside a room.`);
    for (const d of doors) if (overlap(f, d) > 400) { issues.push(`The ${f.name || f.kind} blocks a door at (${d.x},${d.y}).`); break; }
  }
  // Total (indoor) area against the brief, or against the size the plan's own name gives.
  const target = areaTarget(prompt, plan), indoor = indoorArea(rooms);
  if (target && indoor && Math.abs(indoor - target) / target > 0.15) issues.push(`The indoor rooms add up to ${m2(indoor)} m² but the plan should be about ${m2(target)} m² (veranda and parking don't count). Resize the rooms to match.`);
  issues.push(...stairsAndParkingIssues(plan, prompt, rooms, items));
  // Wet areas grouped.
  const wet = rooms.filter((r) => WET.has(type(r.name)) || type(r.name) === 'kitchen');
  if (wet.length >= 3) {
    const cs = wet.map(centre); const cx = cs.reduce((s, p) => s + p.x, 0) / cs.length, cy = cs.reduce((s, p) => s + p.y, 0) / cs.length;
    const far = wet.filter((r, i) => Math.hypot(cs[i].x - cx, cs[i].y - cy) > 900);
    if (far.length) issues.push(`Wet rooms are spread out (${far.map((r) => r.name).join(', ')} far from the others). Group the kitchen, bathrooms and toilets to share plumbing.`);
  }
  issues.push(...layoutIssues(rooms, doors));
  issues.push(...furnishingIssues(rooms, doors, windows, furniture));
  return [...new Set(issues)];
}

// ---- Area, stairs and parking ----
const OUTDOOR = /veranda|porch|terrace|balcony|parking|garage|carport/;
/** Indoor floor area (cm²): veranda, parking and the like are left out. */
const indoorArea = (rooms) => rooms.filter((r) => !OUTDOOR.test(norm(r.name))).reduce((t, r) => t + r.w * r.h, 0);
/** The floor area the plan should have (cm²): from the brief, else from the plan's own name, else none. */
function areaTarget(prompt, plan) {
  const re = /(\d{2,4})\s*(m²|m2|sqm|square met)/i;
  const m = re.exec(String(prompt || '')) || re.exec(String((plan && plan.name) || ''));
  return m ? Number(m[1]) * 1e4 : 0;
}
const STOREY = /maisonette|two[- ]?stor(e)?y|double[- ]?stor(e)?y|duplex|upstairs|ground floor|first floor|storeyed/i;
const needsStairs = (prompt, plan) => STOREY.test(String(prompt || '')) || STOREY.test(String((plan && plan.name) || ''));
/** How many cars the brief or plan name asks to park (0 if none). */
function carsWanted(prompt, plan) {
  const s = `${prompt || ''} ${(plan && plan.name) || ''}`.toLowerCase();
  const m = /(\d+|one|two|three|four)\s*(cars?|vehicles?)/.exec(s);
  if (!m && !/parking|garage|carport/.test(s)) return 0;
  if (!m) return 1;
  return { one: 1, two: 2, three: 3, four: 4 }[m[1]] || Math.min(6, Number(m[1]) || 1);
}
const CAR = { w: 250, h: 500 };

function stairsAndParkingIssues(plan, prompt, rooms, items) {
  const issues = [];
  if (needsStairs(prompt, plan)) {
    const st = items.filter((i) => i.kind === 'stairs');
    if (!st.length) issues.push('This is a storeyed house (maisonette) but there are no stairs. Add a staircase of at least 100 x 270 cm off the living room or entrance hall.');
    for (const s of st) {
      if (Math.min(s.w, s.h) < 90 || Math.max(s.w, s.h) < 250) issues.push(`The stairs are ${s.w}x${s.h} cm; a staircase needs at least 90-100 cm wide and 250-270 cm long.`);
      const r = rooms.find((x) => inside(centre(s), x));
      if (r && !['living', 'corridor', 'dining'].includes(type(r.name))) issues.push(`The stairs are in "${r.name}". Put the staircase off the living room, hall or corridor, never inside a bedroom, kitchen or bathroom.`);
    }
  }
  const want = carsWanted(prompt, plan);
  const parks = rooms.filter((r) => /parking|garage|carport/.test(norm(r.name)));
  if (want) {
    const space = parks.reduce((t, r) => t + r.w * r.h, 0);
    if (!parks.length) issues.push(`The brief asks for parking for ${want} car${want > 1 ? 's' : ''} but there is no parking area. Add one of at least ${want * 12.5} m².`);
    else if (space < want * CAR.w * CAR.h * 0.95) issues.push(`The parking is ${m2(space)} m² but ${want} car${want > 1 ? 's need' : ' needs'} at least ${want * 12.5} m² (each car 2.5 x 5 m: two side by side is 5.5 x 5.5 m).`);
  }
  for (const c of items.filter((i) => i.kind === 'car')) {
    if (!parks.some((p) => c.x >= p.x - 5 && c.y >= p.y - 5 && c.x + c.w <= p.x + p.w + 5 && c.y + c.h <= p.y + p.h + 5)) issues.push(`A car at (${c.x},${c.y}) sticks out of the parking area. Every car must be fully inside it.`);
  }
  for (const v of rooms.filter((r) => /veranda|porch/.test(norm(r.name)))) {
    if (Math.max(v.w, v.h) < 300 || Math.min(v.w, v.h) < 150) issues.push(`"${v.name}" is ${v.w}x${v.h} cm: too small to use. A veranda needs at least 300 cm long and 150 cm deep, running along the living room.`);
  }
  return issues;
}

// Which rooms each piece of furniture belongs in (null = anywhere).
const BED_HOMES = ['bedroom', 'master'];
const WET_HOMES = ['bathroom', 'toilet', 'ensuite'];
const KITCHEN_HOMES = ['kitchen'];
const homeOf = (kind) => (['bed', 'wardrobe'].includes(kind) ? BED_HOMES : ['toilet', 'shower', 'bath', 'basin'].includes(kind) ? WET_HOMES : ['cooker', 'fridge', 'counter'].includes(kind) ? KITCHEN_HOMES : null);

/** Furniture, door and wet-room rules learned from real AI plans. */
function furnishingIssues(rooms, doors, windows, furniture) {
  const issues = [];
  const linked = (d) => doorRooms(d, rooms);
  const inRoom = (f, r) => inside(centre(f), r);
  // Bathroom reached through another bathroom or an en-suite.
  for (const d of doors) {
    const l = linked(d);
    if (l.length === 2 && l.every((r) => WET.has(type(r.name)))) issues.push(`"${l[0].name}" and "${l[1].name}" open into each other. A bathroom is never reached through another bathroom or an en-suite; the shared bathroom opens off the corridor.`);
  }
  // Corridor split into pieces.
  for (const d of doors) {
    const l = linked(d);
    const cs = l.filter((r) => type(r.name) === 'corridor');
    if (cs.length >= 2) issues.push(`"${cs[0].name}" and "${cs[1].name}" are one passage split by a door. Join them into a single corridor with no wall or door between.`);
  }
  // Furniture in the wrong room.
  for (const f of furniture) {
    const r = rooms.find((x) => inside(centre(f), x));
    if (!r) continue;
    const t = type(r.name), home = homeOf(f.kind);
    if (t === 'corridor') { issues.push(`A ${f.name || f.kind} stands in "${r.name}". Keep corridors completely clear.`); continue; }
    if (home && !home.includes(t)) issues.push(`A ${f.name || f.kind} is in "${r.name}". ${home === WET_HOMES ? 'Bathroom fittings belong only in bathrooms, toilets and en-suites.' : home === BED_HOMES ? 'Beds and wardrobes belong only in bedrooms.' : 'Cookers, fridges and counters belong only in the kitchen.'}`);
  }
  // Bedrooms never through the kitchen or dining room.
  for (const d of doors) {
    const l = linked(d);
    const bed = l.find((r) => ['bedroom', 'master'].includes(type(r.name))), via = l.find((r) => ['kitchen', 'dining'].includes(type(r.name)));
    if (bed && via) issues.push(`"${bed.name}" opens into "${via.name}". A bedroom is never reached through the kitchen or dining room; open it off the corridor or hall.`);
  }
  // Wet rooms have their fittings.
  for (const r of rooms) {
    const t = type(r.name);
    if (!WET.has(t)) continue;
    const mine = furniture.filter((f) => inRoom(f, r)).map((f) => f.kind);
    const need = t === 'toilet' ? ['toilet'] : ['toilet', 'basin'];
    const missing = need.filter((k) => !mine.includes(k));
    if (t !== 'toilet' && !mine.includes('shower') && !mine.includes('bath')) missing.push('shower or bath');
    if (missing.length) issues.push(`"${r.name}" has no ${missing.join(', ')}. Draw its fittings so the client sees it works.`);
  }
  // Every bedroom has a bed; living seating; kitchen counter, cooker and fridge.
  for (const r of rooms) {
    const t = type(r.name), mine = furniture.filter((f) => inRoom(f, r)).map((f) => f.kind);
    if ((t === 'bedroom' || t === 'master') && !mine.includes('bed')) issues.push(`"${r.name}" has no bed. Every bedroom needs a bed (and a wardrobe) so the client can see it fits.`);
    if (t === 'kitchen') for (const k of ['counter', 'cooker', 'fridge']) if (!mine.includes(k)) issues.push(`"${r.name}" has no ${k}.`);
  }
  // Tall furniture in front of a window (a counter under a window is right, so it's not checked).
  for (const f of furniture.filter((x) => ['wardrobe', 'fridge'].includes(x.kind))) {
    for (const w of windows) {
      const horiz = w.w >= w.h;
      const along = horiz ? Math.min(f.x + f.w, w.x + w.w) - Math.max(f.x, w.x) : Math.min(f.y + f.h, w.y + w.h) - Math.max(f.y, w.y);
      const gap = horiz ? Math.min(Math.abs(f.y - (w.y + w.h)), Math.abs(w.y - (f.y + f.h))) : Math.min(Math.abs(f.x - (w.x + w.w)), Math.abs(w.x - (f.x + f.w)));
      if (along > 20 && gap <= 30) { issues.push(`The ${f.name || f.kind} stands in front of a window. Put it against a solid inside wall.`); break; }
    }
  }
  // Door swings that overlap.
  for (let i = 0; i < doors.length; i++) for (let j = i + 1; j < doors.length; j++) {
    if (overlap(doors[i], doors[j]) > 900) issues.push(`Two doors at (${doors[i].x},${doors[i].y}) and (${doors[j].x},${doors[j].y}) swing into each other. Space them apart along the wall.`);
  }
  // Kitchen working triangle: fridge beside the counter or cooker.
  for (const fr of furniture.filter((f) => f.kind === 'fridge')) {
    const near = furniture.some((o) => (o.kind === 'counter' || o.kind === 'cooker') && overlap({ x: fr.x - 15, y: fr.y - 15, w: fr.w + 30, h: fr.h + 30 }, o) > 0);
    if (!near) issues.push('The fridge stands alone away from the counter. Put it at the end of the counter run so the cooker, sink and fridge form a working triangle.');
  }
  return issues;
}

/** Share of a wall two rooms have in common (cm), or 0. */
function sharedLen(r, o) {
  if (Math.abs(r.y - (o.y + o.h)) < 5 || Math.abs(r.y + r.h - o.y) < 5) return Math.max(0, Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x));
  if (Math.abs(r.x - (o.x + o.w)) < 5 || Math.abs(r.x + r.w - o.x) < 5) return Math.max(0, Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y));
  return 0;
}
/** Corners of the building outline, counted on a 10 cm grid. Rectangle 4, L-shape 6. */
function outlineCorners(rooms) {
  if (!rooms.length) return 0;
  const S = 10;
  const x0 = Math.min(...rooms.map((r) => r.x)), y0 = Math.min(...rooms.map((r) => r.y));
  const W = Math.ceil((Math.max(...rooms.map((r) => r.x + r.w)) - x0) / S) + 2, H = Math.ceil((Math.max(...rooms.map((r) => r.y + r.h)) - y0) / S) + 2;
  if (W * H > 400000) return 0;
  const g = new Uint8Array(W * H);
  for (const r of rooms) for (let x = Math.floor((r.x - x0) / S) + 1; x < Math.ceil((r.x + r.w - x0) / S) + 1; x++) for (let y = Math.floor((r.y - y0) / S) + 1; y < Math.ceil((r.y + r.h - y0) / S) + 1; y++) g[y * W + x] = 1;
  let corners = 0;
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const a = g[y * W + x], b = g[y * W + x + 1], c = g[(y + 1) * W + x], d = g[(y + 1) * W + x + 1], n = a + b + c + d;
    if (n === 1 || n === 3) corners++;
    else if (n === 2 && a === d) corners += 2;
  }
  return corners;
}

/** Room-arrangement rules: outline, entrance, veranda, living/dining/kitchen, service rooms, bathrooms, corridors. */
function layoutIssues(rooms, doors) {
  const issues = [];
  const of = (t) => rooms.filter((r) => type(r.name) === t);
  const named = (re) => rooms.filter((r) => re.test(norm(r.name)));
  const linked = (d) => doorRooms(d, rooms);
  // Outline.
  const corners = outlineCorners(rooms);
  if (corners > 8) issues.push(`The building outline has ${corners} corners: rooms stick out at different depths. Make it a clean rectangle or L-shape (at most 8 corners) by lining up the outer rooms.`);
  // Fragments.
  for (const r of rooms) {
    const t = type(r.name), a = r.w * r.h, short = Math.min(r.w, r.h);
    if (t === 'corridor') continue;
    // Toilets are legitimately small (1.2 m²); everything else under 2 m² is a leftover.
    if (a < (t === 'toilet' ? 1.2e4 : 2e4) || short < 90) issues.push(`"${r.name}" is a leftover fragment (${r.w}x${r.h} cm). Merge it into a neighbouring room or make it a real room of at least 2 m² and 90 cm wide.`);
  }
  // Main entrance on the living room or an entrance hall.
  const entranceRooms = rooms.filter((r) => type(r.name) === 'living' || /hall|entr|lobby|foyer/.test(norm(r.name)));
  const hasEntrance = doors.some((d) => { const l = linked(d); return l.length === 1 && entranceRooms.includes(l[0]); })
    || doors.some((d) => { const l = linked(d); return l.length === 2 && l.some((r) => /veranda|porch/.test(norm(r.name))) && l.some((r) => entranceRooms.includes(r)); });
  if (entranceRooms.length && !hasEntrance) issues.push('The main entrance must be a door on an outside wall of the living room (or entrance hall), or from the front veranda into the living room.');
  // Veranda at the front, joined to living or dining, not behind a bedroom.
  for (const v of named(/veranda|porch|terrace/)) {
    if (!rooms.some((o) => ['living', 'dining'].includes(type(o.name)) && sharedLen(v, o) >= 100)) issues.push(`"${v.name}" does not touch the living or dining room. Put the veranda at the front, along the living room, and step from it into the living room.`);
    for (const d of doors) { const l = linked(d); if (l.includes(v) && l.some((o) => ['bedroom', 'master'].includes(type(o.name)))) issues.push(`"${v.name}" opens into a bedroom. The veranda should open into the living room.`); }
  }
  // Living - dining - kitchen.
  const living = of('living')[0], dining = of('dining')[0], kitchen = of('kitchen')[0];
  if (living && dining) {
    if (sharedLen(living, dining) < 100) issues.push(`"${dining.name}" does not share a wall with "${living.name}". Put dining next to the living room with a wide opening between them.`);
    else if (!doors.some((d) => { const l = linked(d); return l.includes(living) && l.includes(dining); })) issues.push(`"${living.name}" and "${dining.name}" have a solid wall between them. Add a wide opening (150 cm or more) so they connect.`);
  }
  if (kitchen && !rooms.some((o) => ['dining', 'living'].includes(type(o.name)) && sharedLen(kitchen, o) >= 100)) issues.push(`"${kitchen.name}" is not next to the dining or living room. Put the kitchen beside the dining area.`);
  // Service rooms never through a bedroom.
  for (const s of named(/store|pantry|laundry/)) {
    for (const d of doors) { const l = linked(d); if (l.includes(s) && l.some((o) => ['bedroom', 'master'].includes(type(o.name)))) issues.push(`"${s.name}" opens into a bedroom. A store opens off the kitchen, corridor or dining room.`); }
  }
  // Shared bathroom for bedrooms without an en-suite.
  const beds = rooms.filter((r) => ['bedroom', 'master'].includes(type(r.name)));
  const suites = of('ensuite').length;
  if (beds.length - suites > 0 && rooms.some((r) => type(r.name) === 'corridor')) {
    const shared = doors.some((d) => { const l = linked(d); return l.some((r) => ['bathroom', 'toilet'].includes(type(r.name))) && l.some((r) => type(r.name) === 'corridor'); });
    if (!shared) issues.push('There is no shared bathroom or toilet opening off the corridor, so bedrooms without an en-suite cannot reach one. Add a bathroom off the corridor.');
  }
  // Long corridors.
  // 10 m, plus 1.5 m per bedroom above 3, and never less than 0.7 x the square root of the indoor area (big houses).
  const maxCorr = Math.max(1000 + Math.max(0, rooms.filter((r) => ['bedroom', 'master'].includes(type(r.name))).length - 3) * 150, Math.round(Math.sqrt(indoorArea(rooms)) * 0.7));
  for (const c of of('corridor')) if (Math.max(c.w, c.h) > maxCorr) issues.push(`"${c.name}" is ${(Math.max(c.w, c.h) / 100).toFixed(1)} m long. Keep corridors under ${(maxCorr / 100).toFixed(1)} m for this many bedrooms: group the bedrooms around a short corridor or hall.`);
  return issues;
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
      const free = t < s.len && !rooms.some((o) => o !== r && !OUTDOOR.test(norm(o.name)) && inside(s.at(t), o));
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
  //    Indoor area only: a veranda or parking doesn't count. No size in the brief? Use the plan's own name.
  const target0 = areaTarget(prompt, plan), area = indoorArea(rooms);
  if (target0 && area) {
    const target = target0, k = Math.sqrt(target / area);
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
    const ind = rooms.filter((r) => !OUTDOOR.test(norm(r.name)));
    const a = ind.find((r) => inside(horiz ? { x: c.x, y: c.y - 30 } : { x: c.x - 30, y: c.y }, r));
    const b = ind.find((r) => inside(horiz ? { x: c.x, y: c.y + 30 } : { x: c.x + 30, y: c.y }, r));
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
  // 4c. Living and dining sharing a wall get a wide opening between them.
  const lv = rooms.find((r) => type(r.name) === 'living'), dn = rooms.find((r) => type(r.name) === 'dining');
  if (lv && dn) {
    const w = sharedWall(dn, lv);
    const joined = out.some((d) => d.kind === 'door' && overlap({ x: d.x - 15, y: d.y - 15, w: d.w + 30, h: d.h + 30 }, lv) > 0 && overlap({ x: d.x - 15, y: d.y - 15, w: d.w + 30, h: d.h + 30 }, dn) > 0);
    if (w && !joined && w.b - w.a >= 180) {
      const len = Math.min(180, r10(w.b - w.a - 40)), at = r10((w.a + w.b) / 2 - len / 2);
      if (w.side === 'top') out.push({ kind: 'door', name: 'Wide opening', x: at, y: dn.y, w: len, h: 90, rot: 0 });
      else if (w.side === 'bottom') out.push({ kind: 'door', name: 'Wide opening', x: at, y: dn.y + dn.h - 90, w: len, h: 90, rot: 2 });
      else if (w.side === 'left') out.push({ kind: 'door', name: 'Wide opening', x: dn.x, y: at, w: 90, h: len, rot: 1 });
      else out.push({ kind: 'door', name: 'Wide opening', x: dn.x + dn.w - 90, y: at, w: 90, h: len, rot: 3 });
    }
  }
  // 4d. A front door on the living room's outside wall when there is no main entrance.
  if (lv) {
    const into = (d) => rooms.filter((r) => overlap({ x: d.x - 15, y: d.y - 15, w: d.w + 30, h: d.h + 30 }, r) > 0);
    const hasFront = out.some((d) => d.kind === 'door' && into(d).length === 1 && into(d)[0] === lv);
    const viaVeranda = out.some((d) => d.kind === 'door' && into(d).includes(lv) && into(d).some((r) => /veranda|porch/.test(norm(r.name))));
    if (!hasFront && !viaVeranda) {
      const run = longestOutsideRun(lv, rooms);
      if (run && run.len >= 140) {
        // Near the start of the wall, so it doesn't land on the window centred on the same wall.
        const at = r10(run.from + 20);
        if (run.side === 'top') out.push({ kind: 'door', name: 'Front door', x: lv.x + at, y: lv.y, w: 100, h: 100, rot: 0 });
        else if (run.side === 'bottom') out.push({ kind: 'door', name: 'Front door', x: lv.x + at, y: lv.y + lv.h - 100, w: 100, h: 100, rot: 2 });
        else if (run.side === 'left') out.push({ kind: 'door', name: 'Front door', x: lv.x, y: lv.y + at, w: 100, h: 100, rot: 1 });
        else out.push({ kind: 'door', name: 'Front door', x: lv.x + lv.w - 100, y: lv.y + at, w: 100, h: 100, rot: 3 });
      }
    }
  }
  // 5. Furniture must sit inside a room and clear of doors; anything else is dropped.
  const doors = out.filter((i) => i.kind === 'door');
  out = out.filter((f) => {
    if (['room', 'wall', 'door', 'window', 'stairs', 'car', 'plant'].includes(f.kind)) return true;
    const host = rooms.find((r) => f.x >= r.x - 5 && f.y >= r.y - 5 && f.x + f.w <= r.x + r.w + 5 && f.y + f.h <= r.y + r.h + 5);
    return host && !doors.some((d) => overlap(f, d) > 400);
  });
  // 5b. Find a free spot in a room for a piece of furniture: against a wall, clear of doors, windows and other furniture.
  // tall: wardrobes, fridges and the like keep 40 cm clear of windows; low furniture (beds, toilets) may sit under one.
  const freeSpot = (r, w, h, tall = false) => {
    const others = out.filter((o) => !['room'].includes(o.kind));
    const wm = tall ? 40 : 0;
    const ok = (c) => c.x >= r.x + 10 && c.y >= r.y + 10 && c.x + c.w <= r.x + r.w - 10 && c.y + c.h <= r.y + r.h - 10
      && !others.some((o) => overlap(o.kind === 'door' ? { x: o.x - 10, y: o.y - 10, w: o.w + 20, h: o.h + 20 } : o.kind === 'window' ? { x: o.x - wm, y: o.y - wm, w: o.w + 2 * wm, h: o.h + 2 * wm } : o, c) > 0);
    const cands = [];
    for (const [cw, ch, rot] of [[w, h, 0], [h, w, 1]]) {
      cands.push({ x: r10(r.x + (r.w - cw) / 2), y: r.y + 10, w: cw, h: ch, rot: rot ? 3 : 0 }); // top wall
      cands.push({ x: r10(r.x + (r.w - cw) / 2), y: r.y + r.h - 10 - ch, w: cw, h: ch, rot: rot ? 1 : 2 }); // bottom wall
      cands.push({ x: r.x + 10, y: r10(r.y + (r.h - ch) / 2), w: cw, h: ch, rot: rot ? 3 : 0 }); // left wall
      cands.push({ x: r.x + r.w - 10 - cw, y: r10(r.y + (r.h - ch) / 2), w: cw, h: ch, rot: rot ? 1 : 2 }); // right wall
      // The four corners, so two cars, or a bed and a wardrobe, can share a wall.
      cands.push({ x: r.x + 10, y: r.y + 10, w: cw, h: ch, rot: rot ? 3 : 0 });
      cands.push({ x: r.x + r.w - 10 - cw, y: r.y + 10, w: cw, h: ch, rot: rot ? 3 : 0 });
      cands.push({ x: r.x + 10, y: r.y + r.h - 10 - ch, w: cw, h: ch, rot: rot ? 1 : 2 });
      cands.push({ x: r.x + r.w - 10 - cw, y: r.y + r.h - 10 - ch, w: cw, h: ch, rot: rot ? 1 : 2 });
    }
    return cands.find(ok) || null;
  };
  // 5b2. Furniture in the wrong room (a bed in the kitchen, a shower in a corridor) is removed.
  out = out.filter((f) => {
    const home = homeOf(f.kind);
    if (['room', 'wall', 'door', 'window', 'stairs', 'car', 'plant'].includes(f.kind)) return true;
    const r = rooms.find((x) => inside(centre(f), x));
    if (!r) return false;
    const t = type(r.name);
    if (t === 'corridor') return false;
    return !home || home.includes(t);
  });
  // 5b3. Cars that stick out of the parking go; the parking then gets as many cars as were asked for, where they fit.
  const parks = rooms.filter((r) => /parking|garage|carport/.test(norm(r.name)));
  out = out.filter((c) => c.kind !== 'car' || parks.some((p) => c.x >= p.x - 5 && c.y >= p.y - 5 && c.x + c.w <= p.x + p.w + 5 && c.y + c.h <= p.y + p.h + 5));
  const wantCars = carsWanted(prompt, plan);
  for (const p of parks) {
    while (out.filter((c) => c.kind === 'car').length < wantCars) {
      const spot = freeSpot(p, 180, 450);
      if (!spot) break;
      out.push({ kind: 'car', name: 'Car', ...spot });
    }
  }
  // 5b4. A storeyed house gets stairs off the living room, hall or corridor if it has none.
  if (needsStairs(prompt, plan) && !out.some((i) => i.kind === 'stairs')) {
    const hosts = [...rooms.filter((r) => /hall|entr|lobby|foyer/.test(norm(r.name))), ...rooms.filter((r) => type(r.name) === 'living'), ...rooms.filter((r) => type(r.name) === 'corridor'), ...rooms.filter((r) => type(r.name) === 'dining')];
    for (const h of hosts) { const spot = freeSpot(h, 100, 270); if (spot) { out.push({ kind: 'stairs', name: 'Stairs', ...spot, rot: spot.rot % 2 ? 1 : 0 }); break; } }
  }
  // 5c. Bedrooms without a bed get one.
  for (const r of rooms.filter((x) => ['bedroom', 'master'].includes(type(x.name)))) {
    if (out.some((f) => f.kind === 'bed' && inside(centre(f), r))) continue;
    const double = Math.min(r.w, r.h) >= 300 || type(r.name) === 'master';
    const spot = freeSpot(r, double ? 160 : 100, 200);
    if (spot) out.push({ kind: 'bed', name: double ? 'Double bed' : 'Single bed', ...spot });
  }
  // ...and a wardrobe on a free solid wall.
  for (const r of rooms.filter((x) => ['bedroom', 'master'].includes(type(x.name)))) {
    if (out.some((f) => f.kind === 'wardrobe' && inside(centre(f), r))) continue;
    const spot = freeSpot(r, 180, 60, true) || freeSpot(r, 120, 60, true);
    if (spot) out.push({ kind: 'wardrobe', name: 'Wardrobe', ...spot });
  }
  // 5c2. Bathrooms, toilets and en-suites get the fittings they are missing, where they fit.
  for (const r of rooms.filter((x) => WET.has(type(x.name)))) {
    const t = type(r.name);
    const has = (k) => out.some((f) => f.kind === k && inside(centre(f), r));
    // The shower first (the biggest piece), then the toilet and basin around it.
    const want = t === 'toilet' ? [['toilet', 40, 70], ['basin', 50, 40]] : [...(has('bath') ? [] : [['shower', 90, 90]]), ['toilet', 40, 70], ['basin', 60, 50]];
    for (const [k, w, h] of want) {
      if (has(k)) continue;
      const spot = freeSpot(r, w, h);
      if (spot) out.push({ kind: k, name: k.charAt(0).toUpperCase() + k.slice(1), ...spot });
    }
  }
  // 5c3. The kitchen gets a counter, cooker and fridge if any is missing (the fridge is then moved beside the counter below).
  for (const k of rooms.filter((x) => type(x.name) === 'kitchen')) {
    for (const [kind, w, h] of [['counter', 240, 60], ['cooker', 60, 60], ['fridge', 60, 70]]) {
      if (out.some((f) => f.kind === kind && inside(centre(f), k))) continue;
      const spot = freeSpot(k, w, h, kind === 'fridge');
      if (spot) out.push({ kind, name: kind.charAt(0).toUpperCase() + kind.slice(1), ...spot });
    }
  }
  // 5d. A fridge standing alone moves to the end of the counter run.
  for (const fr of out.filter((f) => f.kind === 'fridge')) {
    const k = rooms.find((r) => inside(centre(fr), r));
    const counter = out.find((c) => c.kind === 'counter' && k && inside(centre(c), k));
    if (!k || !counter) continue;
    if (overlap({ x: fr.x - 15, y: fr.y - 15, w: fr.w + 30, h: fr.h + 30 }, counter) > 0) continue;
    // The whole run: the counter plus a cooker joined to either end.
    const horiz = counter.w >= counter.h;
    const run = { ...counter };
    for (const ck of out.filter((c) => c.kind === 'cooker' && overlap({ x: run.x - 15, y: run.y - 15, w: run.w + 30, h: run.h + 30 }, c) > 0)) {
      const x0 = Math.min(run.x, ck.x), y0 = Math.min(run.y, ck.y);
      run.w = Math.max(run.x + run.w, ck.x + ck.w) - x0; run.h = Math.max(run.y + run.h, ck.y + ck.h) - y0; run.x = x0; run.y = y0;
    }
    // At either end of the run, or just round its corner (an L), always touching it.
    const tries = horiz
      ? [{ x: run.x + run.w, y: run.y }, { x: run.x - fr.w, y: run.y }, { x: run.x + run.w - fr.w, y: run.y + run.h }, { x: run.x, y: run.y + run.h }, { x: run.x + run.w - fr.w, y: run.y - fr.h }, { x: run.x, y: run.y - fr.h }]
      : [{ x: run.x, y: run.y + run.h }, { x: run.x, y: run.y - fr.h }, { x: run.x + run.w, y: run.y + run.h - fr.h }, { x: run.x + run.w, y: run.y }, { x: run.x - fr.w, y: run.y + run.h - fr.h }, { x: run.x - fr.w, y: run.y }];
    for (const p of tries) {
      const c = { x: p.x, y: p.y, w: fr.w, h: fr.h };
      const inK = c.x >= k.x && c.y >= k.y && c.x + c.w <= k.x + k.w && c.y + c.h <= k.y + k.h;
      if (inK && !out.some((o) => o !== fr && o.kind !== 'room' && o.kind !== 'window' && overlap(o, c) > 0)) { fr.x = c.x; fr.y = c.y; break; }
    }
  }
  // 5e. A wardrobe in front of a window moves to a free solid wall in the same room.
  for (const wd of out.filter((f) => f.kind === 'wardrobe')) {
    const blocks = out.some((w) => {
      if (w.kind !== 'window') return false;
      const horiz = w.w >= w.h;
      const along = horiz ? Math.min(wd.x + wd.w, w.x + w.w) - Math.max(wd.x, w.x) : Math.min(wd.y + wd.h, w.y + w.h) - Math.max(wd.y, w.y);
      const gap = horiz ? Math.min(Math.abs(wd.y - (w.y + w.h)), Math.abs(w.y - (wd.y + wd.h))) : Math.min(Math.abs(wd.x - (w.x + w.w)), Math.abs(w.x - (wd.x + wd.w)));
      return along > 20 && gap <= 30;
    });
    const r = rooms.find((x) => inside(centre(wd), x));
    if (!blocks || !r) continue;
    const i = out.indexOf(wd); out.splice(i, 1);
    const spot = freeSpot(r, Math.max(wd.w, wd.h), Math.min(wd.w, wd.h), true);
    out.push(spot ? { ...wd, ...spot } : wd);
  }
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
