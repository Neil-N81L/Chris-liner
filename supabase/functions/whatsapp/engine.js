// Chris Liner WhatsApp booking conversation. Pure logic: no network or Deno APIs,
// so it runs the same in the edge function and in the Node test simulator.

export const STOPS = ["Windhoek", "Rehoboth", "Mariental", "Keetmanshoop", "Aus", "Rosh Pinah", "Oranjemund"];
export const SEATS = 13;
// Toyota Quantum, back to front 4-3-3-2-2 with the driver in front: seat 1 beside the driver, 2-3, 4-6, 7-9, rear bench 10-13.
export const DIRS = {
  "WHK-OMD": { from: "Windhoek", to: "Oranjemund", label: "Windhoek → Oranjemund" },
  "OMD-WHK": { from: "Oranjemund", to: "Windhoek", label: "Oranjemund → Windhoek" },
};
const TZ = "Africa/Windhoek";
const IDLE_MS = 30 * 60 * 1000;
const HANDOFF_MS = 12 * 60 * 60 * 1000;
const MAX_PAX = 6;
const DATE_ROWS = 10;

export const route = (dir) => (dir === "WHK-OMD" ? STOPS.slice() : STOPS.slice().reverse());

// ---------- dates ----------
export const todayISO = (now) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
const nowMinutes = (now) => { const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now).split(":").map(Number); return h * 60 + m; };
const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays = (s, n) => { const d = parseISO(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const isSaturday = (s) => parseISO(s).getUTCDay() === 6;
const fmt = (s, o) => parseISO(s).toLocaleDateString("en-GB", { timeZone: "UTC", ...o });
export const shortDate = (s) => fmt(s, { weekday: "short", day: "numeric", month: "short" });
export const longDate = (s) => fmt(s, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
export const nad = (n) => "N$ " + Math.round(Number(n) || 0).toLocaleString("en-GB");

// ---------- fares and times (same rules as the staff app) ----------
export function legFare(cfg, dir, a, b) {
  const r = route(dir); const F = cfg.fares || {};
  return Math.max(Number(cfg.minFare) || 0, Math.round(Math.abs((Number(F[r[b]]) || 0) - (Number(F[r[a]]) || 0))));
}
export function stopMinutes(cfg, dir, i) {
  const r = route(dir); const H = cfg.hours || {};
  const off = dir === "WHK-OMD" ? Number(H[r[i]]) || 0 : (Number(H.Oranjemund) || 0) - (Number(H[r[i]]) || 0);
  const [h, m] = ((cfg[dir] && cfg[dir].time) || "07:00").split(":").map(Number);
  return Math.round(h * 60 + m + off * 60);
}
export const stopTime = (cfg, dir, i) => { const t = ((stopMinutes(cfg, dir, i) % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };

export const overlaps = (a, b) => a.from < b.to && b.from < a.to;
export function freeSeats(taken, from, to, bus = 1) {
  const out = [];
  for (let s = 1; s <= SEATS; s++) if (!taken.some((t) => (t.bus_no || 1) === bus && t.seat === s && overlaps({ from: t.from_idx, to: t.to_idx }, { from, to }))) out.push(s);
  return out;
}
// How many buses run this date and direction: the daily default, or more if staff added buses or bookings use them.
export function busCount(cfg, dir, trips, taken) {
  const dflt = Number(cfg.busesPerDay?.[dir]) || 1;
  return Math.max(dflt, ...trips.map((t) => t.bus_no), ...taken.map((t) => t.bus_no || 1));
}
export const localPhone = (waId) => { const d = String(waId || "").replace(/\D/g, ""); return d.startsWith("264") ? "0" + d.slice(3) : "+" + d; };
const prettyPhone = (p) => { const d = p.replace(/\D/g, ""); return d.length === 10 && d.startsWith("0") ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : p; };

// ---------- message builders ----------
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
export const text = (body) => ({ kind: "text", body });
export const buttons = (body, btns) => ({ kind: "buttons", body, buttons: btns.slice(0, 3).map(([id, title]) => ({ id, title: clip(title, 20) })) });
export const list = (body, button, rows) => ({ kind: "list", body, button: clip(button, 20), rows: rows.slice(0, 10).map(([id, title, description]) => ({ id, title: clip(title, 24), ...(description ? { description: clip(description, 72) } : {}) })) });

// Match a reply against choices: the tapped id, the option number, or the start of its title.
function pick(input, rows) {
  if (input.id) { const r = rows.find((r) => r[0] === input.id); if (r) return r; }
  const t = (input.text || "").trim().toLowerCase();
  if (!t) return null;
  if (/^\d+$/.test(t)) { const r = rows[Number(t) - 1]; if (r) return r; }
  return rows.find((r) => r[1].toLowerCase() === t) || rows.find((r) => r[1].toLowerCase().startsWith(t) && t.length >= 3) || null;
}

const GREETINGS = new Set(["hi", "hello", "hallo", "hey", "menu", "start", "restart", "good morning", "good day", "goeie more", "moro", "howzit"]);
const CANCEL_WORDS = new Set(["cancel", "stop", "quit", "exit"]);
const STAFF_WORDS = new Set(["staff", "agent", "human", "person", "call me", "help"]);

// ---------- prompts per step ----------
function menuMsg(cfg, name) {
  return buttons(`Hi${name ? " " + name : ""}, welcome to *Chris Liner*. We run a daily bus between Windhoek and Oranjemund, Sunday to Friday, stopping at Rehoboth, Mariental, Keetmanshoop, Aus and Rosh Pinah.\n\nWhat would you like to do?`,
    [["menu_book", "Book a seat"], ["menu_mine", "My bookings"], ["menu_staff", "Talk to staff"]]);
}
function dateRows(st, now) {
  const rows = []; const t = todayISO(now);
  for (let i = 0; rows.length < DATE_ROWS && i < 30; i++) {
    const d = addDays(t, i); if (isSaturday(d)) continue;
    rows.push([`date_${d}`, shortDate(d), i === 0 ? "Today" : i === 1 ? "Tomorrow" : ""]);
  }
  return rows;
}
const fromRows = (cfg, st) => route(st.dir).slice(0, -1).map((s, i) => [`from_${i}`, s, `Bus leaves about ${stopTime(cfg, st.dir, i)}`]);
const toRows = (cfg, st) => route(st.dir).map((s, i) => [`to_${i}`, s, `${nad(legFare(cfg, st.dir, st.from, i))} · arrives about ${stopTime(cfg, st.dir, i)}`]).slice(st.from + 1);
const countRows = (st) => Array.from({ length: Math.min(MAX_PAX, st.maxFree) }, (_, i) => [`count_${i + 1}`, i === 0 ? "1 person" : `${i + 1} people`, ""]);
const legLabel = (st) => `${route(st.dir)[st.from]} → ${route(st.dir)[st.to]}`;

function prompt(step, st, cfg, ctx) {
  switch (step) {
    case "dir": return buttons("Which way are you travelling?", [["dir_WHK-OMD", "To Oranjemund"], ["dir_OMD-WHK", "To Windhoek"]]);
    case "date": return list(`*${DIRS[st.dir].label}*\nWhich day do you want to travel? There is no bus on Saturdays.`, "Choose a day", dateRows(st, ctx.now));
    case "from": return list(`*${shortDate(st.date)}*, ${DIRS[st.dir].label}\nWhere will you get on the bus?`, "Getting on at", fromRows(cfg, st));
    case "to": return list(`Getting on at *${route(st.dir)[st.from]}* (about ${stopTime(cfg, st.dir, st.from)}).\nWhere will you get off?`, "Getting off at", toRows(cfg, st));
    case "count": return list(`*${legLabel(st)}*, ${shortDate(st.date)}\nFare ${nad(legFare(cfg, st.dir, st.from, st.to))} per person. ${st.freeByBus.reduce((n, f) => n + f.length, 0)} seats are free.\n\nHow many people are travelling?`, "Number of people", countRows(st));
    case "seats": {
      return buttons(`${st.buses > 1 ? `You'll travel on *Bus ${st.bus}*.\n` : ""}Free seats: ${st.free.join(", ")}\n\nSeat 1 is in front beside the driver, then rows 2-3, 4-6 and 7-9, and 10 to 13 are the back bench.\n\nReply with the seat number${st.count > 1 ? `s you want, e.g. ${st.free.slice(0, st.count).join(", ")}` : " you want"}, or tap below.`,
        [["seats_any", st.count > 1 ? "Any seats together" : "Any free seat"]]);
    }
    case "names": return text(st.count > 1 ? `What is the full name of passenger ${st.names.length + 1} of ${st.count} (seat ${st.seats[st.names.length]}), as on their ID?` : "What is the passenger's full name, as on their ID?");
    case "phone": return buttons(`Which cell number should we use for this booking?\n\nTap below to use ${prettyPhone(localPhone(ctx.waId))}, or type another number.`, [["phone_same", "Use this number"]]);
    case "pay": return buttons(`How will you pay the ${nad(legFare(cfg, st.dir, st.from, st.to) * st.count)}?`, [["pay_Cash", "Cash on the bus"], ["pay_EFT", "EFT"], ["pay_eWallet", "eWallet"]]);
    case "confirm": {
      const fare = legFare(cfg, st.dir, st.from, st.to);
      const lines = [
        "*Please check your booking*", "",
        `Trip: ${legLabel(st)}`,
        `Date: ${longDate(st.date)}`,
        ...(st.buses > 1 ? [`Bus: ${st.bus}`] : []),
        `Board at: ${route(st.dir)[st.from]}${st.from === 0 && cfg[st.dir]?.point ? ` (${cfg[st.dir].point})` : ""}, about ${stopTime(cfg, st.dir, st.from)}`,
        ...st.seats.map((s, i) => `Seat ${s}: ${st.names[i]}`),
        `Cell: ${prettyPhone(st.phone)}`,
        `Fare: ${nad(fare * st.count)}${st.count > 1 ? ` (${st.count} × ${nad(fare)})` : ""}, paying by ${st.pay}`,
      ];
      return buttons(lines.join("\n"), [["confirm_yes", "Confirm booking"], ["confirm_restart", "Start over"], ["confirm_no", "Cancel"]]);
    }
  }
  return menuMsg(cfg, ctx.profileName);
}

async function loadFree(st, cfg, deps) {
  const [taken, trips] = await Promise.all([deps.getTaken(st.date, st.dir), deps.getTrips(st.date, st.dir)]);
  st.buses = busCount(cfg, st.dir, trips, taken);
  st.freeByBus = Array.from({ length: st.buses }, (_, i) => freeSeats(taken, st.from, st.to, i + 1));
  st.maxFree = Math.max(...st.freeByBus.map((f) => f.length));
}
// Put the group on the first bus with enough free seats for the whole stretch.
function chooseBus(st) {
  const i = st.freeByBus.findIndex((f) => f.length >= st.count);
  if (i < 0) return false;
  st.bus = i + 1; st.free = st.freeByBus[i]; return true;
}

function nextAfterTo(st, cfg, ctx, deps) {
  return (async () => {
    await loadFree(st, cfg, deps);
    if (!st.maxFree) {
      st.step = "date";
      return [text(`Sorry, the bus is full from ${legLabel(st)} on ${shortDate(st.date)}. Please pick another day.`), prompt("date", st, cfg, ctx)];
    }
    st.step = "count";
    return [prompt("count", st, cfg, ctx)];
  })();
}

const randRef = (rng) => { const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = "CL-"; for (let i = 0; i < 5; i++) s += a[Math.floor(rng() * a.length)]; return s; };

// ---------- main entry ----------
// input: { id?: string, text?: string, payload?: string }   ctx: { waId, profileName, now: Date, rng? }
// deps: getSession, saveSession, getSettings, getTaken(date, dir), getTrips(date, dir), insertBookings(rows), myBookings(waId, fromDate),
//       answerReconfirm(baseRef, waId, yes) -> the bookings it changed
export async function handle(input, ctx, deps) {
  const cfg = await deps.getSettings();
  const saved = (await deps.getSession(ctx.waId)) || {};
  const nowMs = ctx.now.getTime();
  let st = saved.step ? saved : { step: "menu" };
  const t = (input.text || "").trim().toLowerCase();
  const out = [];
  const reply = (...m) => out.push(...m);
  const save = async () => { st.at = nowMs; await deps.saveSession(ctx.waId, st); return out; };

  // Answer to the day-before "are you still travelling?" message.
  let rc = null;
  if (input.payload && /^rc_(yes|no):/.test(input.payload)) rc = { yes: input.payload.startsWith("rc_yes"), ref: input.payload.split(":")[1] };
  else if (st.rc && (st.step === "menu" || st.step === "handoff") && /^(yes|y|keep|ja)\b/.test(t)) rc = { yes: true, ref: st.rc };
  else if (st.rc && (st.step === "menu" || st.step === "handoff") && /^(no|n|cancel|nee)\b/.test(t)) rc = { yes: false, ref: st.rc };
  if (rc) {
    const rows = await deps.answerReconfirm(rc.ref, ctx.waId, rc.yes);
    delete st.rc;
    if (!rows.length) reply(text(`We couldn't find an active booking ${rc.ref} for this number. Send *staff* if you need help.`));
    else if (rc.yes) {
      const b = rows[0];
      reply(text(`Thank you, your booking *${rc.ref}* stays confirmed. See you on ${shortDate(b.trip_date)} at ${route(b.dir)[b.from_idx]}, about ${stopTime(cfg, b.dir, b.from_idx)}.`));
    } else reply(text(`Your booking *${rc.ref}* is cancelled and the seat${rows.length > 1 ? "s are" : " is"} released. Send *menu* if you want to book another day.`));
    return save();
  }

  // Staff are handling this chat: stay quiet unless the customer asks for the menu.
  if (st.step === "handoff") {
    if (GREETINGS.has(t) || t === "book" || nowMs - (st.at || 0) > HANDOFF_MS) st = { step: "menu" };
    else return out;
    reply(menuMsg(cfg, ctx.profileName)); return save();
  }
  if (st.step !== "menu" && nowMs - (st.at || 0) > IDLE_MS) { st = { step: "menu" }; }

  if (CANCEL_WORDS.has(t) && st.step !== "menu") { st = { step: "menu" }; reply(text("No problem, nothing was booked.")); reply(menuMsg(cfg, ctx.profileName)); return save(); }
  if (STAFF_WORDS.has(t) || input.id === "menu_staff") {
    st = { step: "handoff" };
    reply(text(`Thanks, one of our staff will reply in this chat. You can also call ${cfg.staffPhones || "081 331 1175 / 081 295 7277"}.\n\nTo use the booking assistant again, send *menu*.`));
    return save();
  }
  if (GREETINGS.has(t) || (st.step === "menu" && !input.id && t !== "book")) { st = { step: "menu" }; reply(menuMsg(cfg, ctx.profileName)); return save(); }

  const again = (msg) => { if (msg) reply(text(msg)); reply(prompt(st.step, st, cfg, ctx)); return save(); };

  switch (st.step) {
    case "menu": {
      if (input.id === "menu_mine") {
        const rows = await deps.myBookings(ctx.waId, todayISO(ctx.now));
        if (!rows.length) reply(text("You have no upcoming bookings with this WhatsApp number."));
        else reply(text("*Your upcoming bookings*\n\n" + rows.map((b) => `${b.ref}: ${shortDate(b.trip_date)}, ${route(b.dir)[b.from_idx]} → ${route(b.dir)[b.to_idx]}, ${(b.bus_no || 1) > 1 ? `bus ${b.bus_no}, ` : ""}seat ${b.seat}, ${b.name}${b.paid ? " (paid)" : ` (${nad(b.fare)} to pay)`}`).join("\n") + "\n\nTo change or cancel a booking, send *staff*."));
        reply(menuMsg(cfg, null)); return save();
      }
      if (input.id === "menu_book" || t === "book") { st = { step: "dir" }; return again(); }
      reply(menuMsg(cfg, ctx.profileName)); return save();
    }
    case "dir": {
      const r = pick(input, [["dir_WHK-OMD", "To Oranjemund"], ["dir_OMD-WHK", "To Windhoek"]]) ||
        (/^(w|from w)/.test(t) ? ["dir_WHK-OMD"] : /^(o|from o)/.test(t) ? ["dir_OMD-WHK"] : null);
      if (!r) return again("Please tap one of the two directions.");
      st.dir = r[0].slice(4); st.step = "date"; return again();
    }
    case "date": {
      const r = pick(input, dateRows(st, ctx.now));
      if (!r) return again("Please choose a day from the list. There is no bus on Saturdays.");
      st.date = r[0].slice(5); st.step = "from"; return again();
    }
    case "from": {
      const r = pick(input, fromRows(cfg, st));
      if (!r) return again("Please choose where you get on from the list.");
      const i = Number(r[0].slice(5));
      if (st.date === todayISO(ctx.now) && stopMinutes(cfg, st.dir, i) - nowMinutes(ctx.now) < 30) {
        st.step = "date"; return again(`Sorry, today's bus leaves ${r[1]} at about ${stopTime(cfg, st.dir, i)}, which is too soon to book. Please pick another day.`);
      }
      st.from = i; st.step = "to"; return again();
    }
    case "to": {
      const r = pick(input, toRows(cfg, st));
      if (!r) return again("Please choose where you get off from the list.");
      st.to = Number(r[0].slice(3));
      reply(...(await nextAfterTo(st, cfg, ctx, deps))); return save();
    }
    case "count": {
      const r = pick(input, countRows(st));
      if (!r) return again(`Please choose how many people, from 1 to ${Math.min(MAX_PAX, st.maxFree)}. For bigger groups, send *staff*.`);
      st.count = Number(r[0].slice(6)); chooseBus(st); st.step = "seats"; return again();
    }
    case "seats": {
      let seats;
      if (input.id === "seats_any" || /^any/.test(t)) seats = st.free.slice(0, st.count);
      else {
        seats = [...new Set((t.match(/\d+/g) || []).map(Number))];
        const bad = seats.filter((s) => !st.free.includes(s));
        if (bad.length) return again(`Seat${bad.length > 1 ? "s" : ""} ${bad.join(", ")} ${bad.length > 1 ? "are" : "is"} not free for your trip.`);
        if (seats.length !== st.count) return again(`Please send ${st.count} seat number${st.count > 1 ? "s" : ""}.`);
      }
      st.seats = seats; st.names = []; st.step = "names"; return again();
    }
    case "names": {
      const name = (input.text || "").trim().replace(/\s+/g, " ");
      if (name.length < 3 || /\d/.test(name) || !/\s/.test(name)) return again("Please send the full name (first name and surname).");
      st.names.push(name.slice(0, 80));
      if (st.names.length < st.count) return again();
      st.step = "phone"; return again();
    }
    case "phone": {
      if (input.id === "phone_same" || /^(same|this|yes)/.test(t)) st.phone = localPhone(ctx.waId);
      else {
        const d = (input.text || "").replace(/[^\d+]/g, "");
        if (!/^(\+?264|0)\d{8,9}$/.test(d)) return again("That doesn't look like a Namibian cell number. Please send it like 081 234 5678.");
        st.phone = d.startsWith("0") ? d : "0" + d.replace(/^\+?264/, "");
      }
      st.step = "pay"; return again();
    }
    case "pay": {
      const r = pick(input, [["pay_Cash", "Cash on the bus"], ["pay_EFT", "EFT"], ["pay_eWallet", "eWallet"]]) || (/cash/.test(t) ? ["pay_Cash"] : /eft|bank/.test(t) ? ["pay_EFT"] : /wallet|ewallet|blue/.test(t) ? ["pay_eWallet"] : null);
      if (!r) return again("Please tap how you will pay.");
      st.pay = r[0].slice(4); st.step = "confirm"; return again();
    }
    case "confirm": {
      if (input.id === "confirm_restart" || /^start/.test(t)) { st = { step: "dir" }; return again(); }
      if (input.id === "confirm_no" || /^no/.test(t)) { st = { step: "menu" }; reply(text("Booking cancelled. Nothing was booked.")); reply(menuMsg(cfg, null)); return save(); }
      if (!(input.id === "confirm_yes" || /^(yes|confirm|ok)/.test(t))) return again("Please tap *Confirm booking* to book these seats.");
      const fare = legFare(cfg, st.dir, st.from, st.to);
      const base = randRef(ctx.rng || Math.random);
      const rows = st.seats.map((seat, i) => ({
        ref: st.count > 1 ? `${base}-${i + 1}` : base, trip_date: st.date, dir: st.dir, bus_no: st.bus || 1, seat, from_idx: st.from, to_idx: st.to,
        name: st.names[i], phone: st.phone, fare, paid: false, method: "", notes: `Will pay by ${st.pay}`, source: "whatsapp", wa_id: ctx.waId,
      }));
      const res = await deps.insertBookings(rows);
      if (res.conflict) {
        await loadFree(st, cfg, deps);
        if (!chooseBus(st)) { st.step = "date"; return again(`Sorry, someone has just booked the last seats from ${legLabel(st)} on ${shortDate(st.date)}. Please pick another day.`); }
        st.step = "seats"; return again("Sorry, one of those seats was just booked by someone else. Please choose again.");
      }
      const done = [
        `✅ *Booked!* Reference *${base}*`, "",
        `${legLabel(st)}, ${longDate(st.date)}${st.buses > 1 ? `, Bus ${st.bus}` : ""}`,
        `Be at ${route(st.dir)[st.from]}${st.from === 0 && cfg[st.dir]?.point ? ` (${cfg[st.dir].point})` : ""} by about ${stopTime(cfg, st.dir, st.from)}.`,
        ...st.seats.map((s, i) => `Seat ${s}: ${st.names[i]}${st.count > 1 ? ` (${base}-${i + 1})` : ""}`),
        `Total ${nad(fare * st.count)}.`, "",
        cfg.payment || "", "",
        `Questions? Send *staff* or call ${cfg.staffPhones || "081 331 1175 / 081 295 7277"}.`,
      ];
      st = { step: "menu" };
      reply(text(done.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n")));
      return save();
    }
  }
  st = { step: "menu" }; reply(menuMsg(cfg, ctx.profileName)); return save();
}

// ---------- day-before reconfirmation ----------
export const waFromLocal = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.startsWith("0") ? "264" + d.slice(1) : d; };
export const baseRef = (ref) => String(ref).replace(/-\d+$/, "");
export const tomorrowISO = (now) => addDays(todayISO(now), 1);

// Group tomorrow's unreconfirmed bookings into one message per passenger phone and booking.
export function reconfirmBatches(rows, cfg) {
  const groups = new Map();
  for (const b of rows) {
    const to = waFromLocal(b.phone) || b.wa_id; if (!to) continue;
    const key = to + "|" + baseRef(b.ref) + "|" + (b.bus_no || 1);
    if (!groups.has(key)) groups.set(key, { to, ref: baseRef(b.ref), rows: [] });
    groups.get(key).rows.push(b);
  }
  return [...groups.values()].map((g) => {
    const b = g.rows[0]; const r = route(b.dir);
    return { ...g, ids: g.rows.map((x) => x.id), params: [
      b.name.split(" ")[0],
      longDate(b.trip_date),
      `${r[b.from_idx]} to ${r[b.to_idx]}`,
      g.rows.map((x) => x.seat).sort((x, y) => x - y).join(", ") + ((b.bus_no || 1) > 1 ? ` on Bus ${b.bus_no}` : ""),
      r[b.from_idx],
      stopTime(cfg, b.dir, b.from_idx),
      g.ref,
    ] };
  });
}
