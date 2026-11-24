import { handle } from "../supabase/functions/whatsapp/engine.js";
const settings = { fares: { Windhoek: 0, Rehoboth: 100, Kalkrand: 200, Mariental: 250, Keetmanshoop: 400, Aus: 500, "Rosh Pinah": 550, Oranjemund: 600 }, hours: { Windhoek: 0, Rehoboth: 1, Kalkrand: 2.25, Mariental: 3.25, Keetmanshoop: 5.5, Aus: 8, "Rosh Pinah": 10, Oranjemund: 11 }, minFare: 100, "WHK-OMD": { time: "07:00", point: "Wika service station" }, "OMD-WHK": { time: "07:00", point: "Taxi rank" }, fareTable: { "Oranjemund|Windhoek": 600, "Oranjemund|Rehoboth": 580, "Rosh Pinah|Windhoek": 580, "Rehoboth|Rosh Pinah": 570, "Kalkrand|Oranjemund": 550, "Mariental|Oranjemund": 520, "Keetmanshoop|Oranjemund": 350, "Keetmanshoop|Rosh Pinah": 350 }, stopPoints: { Keetmanshoop: "Keetmanshoop Mall" }, payment: "Pay cash or EFT.", staffPhones: "081 331 1175" };
const sessions = {}; const bookings = [];
const deps = {
  getSettings: async () => settings, getSession: async (w) => sessions[w] ?? null, saveSession: async (w, s) => { sessions[w] = JSON.parse(JSON.stringify(s)); },
  getTaken: async (d, dir) => bookings.filter((b) => b.trip_date === d && b.dir === dir && b.status !== "cancelled"),
  getTrips: async () => [],
  insertBookings: async (rows) => { for (const r of rows) if (bookings.some((b) => b.status !== "cancelled" && b.trip_date === r.trip_date && b.dir === r.dir && (b.bus_no || 1) === (r.bus_no || 1) && b.seat === r.seat && b.from_idx < r.to_idx && r.from_idx < b.to_idx)) return { conflict: true }; bookings.push(...rows); return { ok: true }; },
  myBookings: async (w) => bookings.filter((b) => b.wa_id === w),
};
const now = new Date("2026-11-23T21:05:00Z");
async function say(w, input) {
  console.log(`\n>>> ${input.id ? "[tap " + input.id + "]" : input.text}`);
  const out = await handle(input, { waId: w, profileName: "Maria", now }, deps);
  for (const m of out) { console.log("BOT:", m.body); if (m.buttons) console.log("   buttons:", m.buttons.map((b) => b.title).join(" | ")); if (m.rows) console.log("   list:", m.rows.map((r) => r.title + (r.description ? " (" + r.description + ")" : "")).join(" | ")); }
}
const A = "264811112222", B = "264813334444";
await say(A, { text: "Hi" });
await say(A, { id: "menu_book" });
await say(A, { text: "windhoek" });
await say(A, { text: "2" });
await say(A, { id: "from_0" });
await say(A, { text: "Keetmanshoop" });
await say(A, { id: "count_2" });
await say(A, { text: "5, 20" });
await say(A, { text: "4 and 5" });
await say(A, { text: "Maria Nangolo" });
await say(A, { text: "Joe" });
await say(A, { text: "Joseph Nangolo" });
await say(A, { text: "0812345678" });
await say(A, { text: "eft" });
await say(A, { id: "confirm_yes" });
// B: Keetmanshoop -> Oranjemund wants seat 5 (should be free), then Mariental->Aus seat 4 (taken)
await say(B, { text: "book" });
await say(B, { id: "dir_WHK-OMD" }); await say(B, { id: "date_2026-11-24" }); await say(B, { id: "from_2" }); await say(B, { id: "to_4" });
await say(B, { id: "count_1" }); await say(B, { text: "4" });
await say(B, { text: "staff" }); await say(B, { text: "hello?" }); await say(B, { text: "menu" });
await say(A, { id: "menu_mine" });
console.log(bookings);

// ---- day-before reconfirmation ----
import { reconfirmBatches, waFromLocal, baseRef } from "../supabase/functions/whatsapp/engine.js";
bookings.forEach((b, i) => { b.id = i + 1; b.status = "confirmed"; });
deps.answerReconfirm = async (ref, w, yes) => {
  const mine = bookings.filter((b) => b.status === "confirmed" && baseRef(b.ref) === ref && (b.wa_id === w || waFromLocal(b.phone) === w));
  for (const b of mine) { b.reconfirm_status = yes ? "yes" : "no"; if (!yes) b.status = "cancelled"; }
  return mine;
};
const batches = reconfirmBatches(bookings.filter((b) => b.status === "confirmed"), settings);
console.log("\nRECONFIRM BATCHES:", JSON.stringify(batches.map((g) => ({ to: g.to, ref: g.ref, params: g.params }))));
const g = batches[0];
sessions[g.to] = { ...(sessions[g.to] || { step: "menu" }), rc: g.ref };
await say(g.to, { text: "No", payload: "" });
console.log(bookings.map((b) => `${b.ref} ${b.status} ${b.reconfirm_status}`));
await say(g.to, { text: "Yes, keep it", payload: `rc_yes:${g.ref}` });

// ---- two buses: fill bus 1 Windhoek -> Oranjemund on 25 Nov, then book again ----
settings.busesPerDay = { "WHK-OMD": 2, "OMD-WHK": 1 };
for (let seat = 1; seat <= 12; seat++) bookings.push({ ref: "CL-FULL" + seat, trip_date: "2026-11-25", dir: "WHK-OMD", bus_no: 1, seat, from_idx: 0, to_idx: 6, status: "confirmed", phone: "0810000000", name: "X Y" });
const C = "264819998888";
for (const inp of [{ text: "book" }, { id: "dir_WHK-OMD" }, { id: "date_2026-11-25" }, { id: "from_0" }, { id: "to_6" }, { id: "count_2" }, { id: "seats_any" }, { text: "Anna Smith" }, { text: "Ben Smith" }, { id: "phone_same" }, { id: "pay_Wallet" }, { id: "confirm_yes" }]) await say(C, inp);
console.log(bookings.filter((b) => b.wa_id === C).map((b) => `${b.ref} bus${b.bus_no} seat${b.seat}`));
