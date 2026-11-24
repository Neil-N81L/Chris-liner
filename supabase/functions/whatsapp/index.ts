// Chris Liner WhatsApp booking bot: WhatsApp Cloud API webhook on Supabase Edge Functions.
// Secrets (Supabase dashboard > Edge Functions > Secrets):
//   WHATSAPP_TOKEN            permanent access token of the Meta system user
//   WHATSAPP_PHONE_NUMBER_ID  the Chris Liner number's Phone number ID in Meta
//   WHATSAPP_VERIFY_TOKEN     any secret phrase; type the same phrase into Meta's webhook settings
//   WHATSAPP_APP_SECRET       the Meta app's App Secret, used to check that requests come from Meta
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { handle, reconfirmBatches, tripDetailBatches, tomorrowISO, todayISO, waFromLocal, baseRef, route, stopTime, boardAt, longDate, DIRS } from "./engine.js";

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const GRAPH = "https://graph.facebook.com/v21.0";

const deps = {
  async getSettings() {
    const { data, error } = await db.from("settings").select("data").eq("id", 1).single();
    if (error) throw error;
    return data.data;
  },
  async getSession(waId: string) {
    const { data } = await db.from("wa_sessions").select("state").eq("wa_id", waId).maybeSingle();
    return data?.state ?? null;
  },
  async saveSession(waId: string, state: unknown) {
    const { error } = await db.from("wa_sessions").upsert({ wa_id: waId, state, updated_at: new Date().toISOString() });
    if (error) throw error;
  },
  async getTaken(date: string, dir: string) {
    const { data, error } = await db.from("bookings").select("bus_no, seat, from_idx, to_idx").eq("trip_date", date).eq("dir", dir).eq("status", "confirmed");
    if (error) throw error;
    return data ?? [];
  },
  async getTrips(date: string, dir: string) {
    const { data, error } = await db.from("trips").select("bus_no").eq("trip_date", date).eq("dir", dir);
    if (error) throw error;
    return data ?? [];
  },
  async insertBookings(rows: unknown[]) {
    const { error } = await db.from("bookings").insert(rows);
    if (!error) return { ok: true };
    if (error.code === "23P01" || error.code === "23505") return { conflict: true }; // seat overlap or duplicate ref
    throw error;
  },
  async answerReconfirm(ref: string, waId: string, yes: boolean) {
    if (!/^CL-[A-Z0-9]{5}$/.test(ref)) return [];
    const { data, error } = await db.from("bookings").select("id, ref, phone, wa_id, trip_date, dir, from_idx, seat")
      .eq("status", "confirmed").or(`ref.eq.${ref},ref.like.${ref}-%`);
    if (error) throw error;
    const mine = (data ?? []).filter((b) => baseRef(b.ref) === ref && (b.wa_id === waId || waFromLocal(b.phone) === waId));
    if (!mine.length) return [];
    const patch = yes ? { reconfirm_status: "yes", reconfirm_answered_at: new Date().toISOString() }
      : { reconfirm_status: "no", reconfirm_answered_at: new Date().toISOString(), status: "cancelled" };
    const { error: e2 } = await db.from("bookings").update(patch).in("id", mine.map((b) => b.id));
    if (e2) throw e2;
    return mine;
  },
  async myBookings(waId: string, fromDate: string) {
    const { data, error } = await db.from("bookings").select("ref, trip_date, dir, bus_no, seat, from_idx, to_idx, name, fare, paid")
      .eq("wa_id", waId).eq("status", "confirmed").gte("trip_date", fromDate).order("trip_date").order("seat").limit(10);
    if (error) throw error;
    return data ?? [];
  },
};

type Out = { kind: string; body: string; buttons?: { id: string; title: string }[]; button?: string; rows?: { id: string; title: string; description?: string }[] };

function toGraph(to: string, m: Out) {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  if (m.kind === "buttons") return { ...base, type: "interactive", interactive: { type: "button", body: { text: m.body.slice(0, 1024) }, action: { buttons: m.buttons!.map((b) => ({ type: "reply", reply: b })) } } };
  if (m.kind === "list") return { ...base, type: "interactive", interactive: { type: "list", body: { text: m.body.slice(0, 1024) }, action: { button: m.button, sections: [{ title: "Options", rows: m.rows }] } } };
  return { ...base, type: "text", text: { body: m.body.slice(0, 4096), preview_url: false } };
}
async function send(to: string, m: Out) {
  const r = await fetch(`${GRAPH}/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" }, body: JSON.stringify(toGraph(to, m)),
  });
  if (!r.ok) console.error("send failed", r.status, await r.text());
}

// Day-before message. WhatsApp only allows approved templates outside the 24-hour chat window.
async function sendTemplate(to: string, params: string[], ref: string) {
  const payload = {
    messaging_product: "whatsapp", to, type: "template",
    template: {
      name: env("WHATSAPP_RECONFIRM_TEMPLATE") || "booking_reconfirm", language: { code: env("WHATSAPP_TEMPLATE_LANG") || "en" },
      components: [
        { type: "body", parameters: params.map((p) => ({ type: "text", text: p })) },
        { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: `rc_yes:${ref}` }] },
        { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: `rc_no:${ref}` }] },
      ],
    },
  };
  const r = await fetch(`${GRAPH}/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  if (!r.ok) console.error("template send failed", r.status, await r.text());
  return r.ok;
}

// ---------- driver manifest ----------
// Each bus on a trip has a secret manifest_token (trips table). The driver's link opens docs/driver.html, which reads this JSON.
const MANIFEST_PAGE = env("MANIFEST_PAGE_URL") || "https://neil-n81l.github.io/Chris-liner-Bookings/driver.html";
async function manifestJSON(token: string) {
  const { data: trip } = await db.from("trips").select("trip_date, dir, bus_no, vehicle_id").eq("manifest_token", token).maybeSingle();
  if (!trip || trip.trip_date < todayISO(new Date(Date.now() - 2 * 86400000))) return null; // links stop working two days after the trip
  const [cfg, veh, bk, trips] = await Promise.all([
    deps.getSettings(),
    trip.vehicle_id ? db.from("vehicles").select("name, reg, driver").eq("id", trip.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("bookings").select("seat, name, phone, from_idx, to_idx, pickup, notes, paid, fare, reconfirm_status").eq("trip_date", trip.trip_date).eq("dir", trip.dir).eq("bus_no", trip.bus_no).eq("status", "confirmed").order("seat"),
    db.from("trips").select("bus_no").eq("trip_date", trip.trip_date).eq("dir", trip.dir),
  ]);
  const r = route(trip.dir);
  return {
    date: trip.trip_date, dateText: longDate(trip.trip_date), dir: trip.dir, route: DIRS[trip.dir].label, bus: trip.bus_no,
    buses: Math.max(Number(cfg.busesPerDay?.[trip.dir]) || 1, ...(trips.data ?? []).map((t: any) => t.bus_no)),
    vehicle: veh.data ? { name: veh.data.name, reg: veh.data.reg, driver: veh.data.driver } : null,
    stops: r.map((name, i) => ({ name, time: stopTime(cfg, trip.dir, i), where: boardAt(cfg, trip.dir, i) })),
    passengers: (bk.data ?? []).map((b: any) => ({ seat: b.seat, name: b.name, phone: b.phone, on: b.from_idx, off: b.to_idx, pickup: b.pickup, notes: b.notes, paid: b.paid, fare: Number(b.fare), reconfirm: b.reconfirm_status })),
    updated: new Date().toISOString(),
  };
}
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET", "Cache-Control": "no-store" };

// Evening before: tell each driver (vehicle with a driver cell number) that tomorrow's list is ready, with their live link.
async function sendDriverTemplate(to: string, params: string[], token: string) {
  const payload = {
    messaging_product: "whatsapp", to, type: "template",
    template: {
      name: env("WHATSAPP_DRIVER_TEMPLATE") || "driver_manifest", language: { code: env("WHATSAPP_TEMPLATE_LANG") || "en" },
      components: [
        { type: "body", parameters: params.map((p) => ({ type: "text", text: p })) },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: token }] },
      ],
    },
  };
  const r = await fetch(`${GRAPH}/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  if (!r.ok) console.error("driver template failed", r.status, await r.text());
  return r.ok;
}
// Final message to passengers: trip confirmed, seat, bus, pick-up spot and time, driver's name.
async function sendTripDetails(now: Date) {
  const date = tomorrowISO(now);
  const [cfg, bk, tr] = await Promise.all([
    deps.getSettings(),
    db.from("bookings").select("id, ref, phone, wa_id, name, trip_date, dir, bus_no, from_idx, to_idx, seat").eq("status", "confirmed").eq("trip_date", date).is("final_sent_at", null),
    db.from("trips").select("dir, bus_no, vehicles(driver)").eq("trip_date", date),
  ]);
  if (bk.error) throw bk.error;
  const drivers: Record<string, string> = {};
  for (const t of (tr.data ?? []) as any[]) if (t.vehicles?.driver) drivers[`${t.dir}|${t.bus_no}`] = t.vehicles.driver;
  let sent = 0, failed = 0;
  for (const g of tripDetailBatches(bk.data ?? [], cfg, drivers)) {
    const payload = { messaging_product: "whatsapp", to: g.to, type: "template", template: {
      name: env("WHATSAPP_TRIP_TEMPLATE") || "trip_details", language: { code: env("WHATSAPP_TEMPLATE_LANG") || "en" },
      components: [{ type: "body", parameters: g.params.map((p: string) => ({ type: "text", text: p })) }] } };
    const r = await fetch(`${GRAPH}/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (r.ok) { sent++; await db.from("bookings").update({ final_sent_at: now.toISOString() }).in("id", g.ids); }
    else { failed++; console.error("trip details failed", r.status, await r.text()); }
  }
  return { sent, failed };
}
async function sendDriverManifests(now: Date) {
  const date = tomorrowISO(now);
  const { data: trips, error } = await db.from("trips").select("dir, bus_no, manifest_token, vehicle_id, vehicles(driver, driver_phone)")
    .eq("trip_date", date).is("manifest_sent_at", null).not("vehicle_id", "is", null);
  if (error) throw error;
  let sent = 0, skipped = 0;
  for (const t of (trips ?? []) as any[]) {
    const to = waFromLocal(t.vehicles?.driver_phone || "");
    if (to.length < 11) { skipped++; continue; }
    const { count } = await db.from("bookings").select("id", { count: "exact", head: true }).eq("trip_date", date).eq("dir", t.dir).eq("bus_no", t.bus_no).eq("status", "confirmed");
    const ok = await sendDriverTemplate(to, [(t.vehicles?.driver || "driver").split(" ")[0], longDate(date), `${DIRS[t.dir].label}, Bus ${t.bus_no}`, String(count ?? 0)], t.manifest_token);
    if (ok) { sent++; await db.from("trips").update({ manifest_sent_at: now.toISOString() }).eq("manifest_token", t.manifest_token); }
  }
  return { sent, skipped };
}

// Scheduled jobs, called by pg_cron (see migration 004) with a one-time x-cron-token.
//   task=send:    message everyone travelling tomorrow who hasn't been asked yet
//   task=noreply: mark today's unanswered requests as no_reply so staff can follow up
//   task=drivers: (20:00) send each driver the link to tomorrow's live list, and each passenger their final trip details
async function runJob(task: string) {
  const now = new Date();
  if (task === "drivers") {
    if (!env("WHATSAPP_TOKEN")) return { skipped: "WhatsApp is not connected yet" };
    return { drivers: await sendDriverManifests(now), passengers: await sendTripDetails(now) };
  }
  if (task === "noreply") {
    const { data, error } = await db.from("bookings").update({ reconfirm_status: "no_reply" })
      .eq("status", "confirmed").eq("reconfirm_status", "sent").lte("trip_date", todayISO(now)).select("id");
    if (error) throw error;
    return { marked: data?.length ?? 0 };
  }
  if (!env("WHATSAPP_TOKEN")) return { skipped: "WhatsApp is not connected yet" };
  const cfg = await deps.getSettings();
  const { data, error } = await db.from("bookings").select("id, ref, phone, wa_id, name, trip_date, dir, bus_no, from_idx, to_idx, seat")
    .eq("status", "confirmed").eq("trip_date", tomorrowISO(now)).is("reconfirm_sent_at", null);
  if (error) throw error;
  let sent = 0, failed = 0;
  for (const g of reconfirmBatches(data ?? [], cfg)) {
    const ok = await sendTemplate(g.to, g.params, g.ref);
    await db.from("bookings").update({ reconfirm_status: ok ? "sent" : "failed", reconfirm_sent_at: now.toISOString() }).in("id", g.ids);
    if (ok) {
      sent++;
      const prev = (await deps.getSession(g.to)) ?? { step: "menu" };
      await deps.saveSession(g.to, { ...prev, rc: g.ref });
    } else failed++;
  }
  return { sent, failed };
}

async function validSignature(req: Request, raw: string) {
  const secret = env("WHATSAPP_APP_SECRET");
  if (!secret) return false; // refuse everything until the App Secret is set
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = "sha256=" + [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== sig.length) return false;
  let diff = 0; for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

function inputOf(msg: any) {
  if (msg.type === "text") return { text: msg.text?.body ?? "" };
  if (msg.type === "interactive") { const r = msg.interactive?.button_reply ?? msg.interactive?.list_reply; return { id: r?.id, text: r?.title ?? "" }; }
  if (msg.type === "button") return { text: msg.button?.text ?? "", payload: msg.button?.payload ?? "" };
  return { text: "" };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.has("manifest")) {
    const token = url.searchParams.get("manifest") ?? "";
    if (!/^[0-9a-f-]{36}$/.test(token)) return new Response("Not found", { status: 404, headers: CORS });
    const m = await manifestJSON(token).catch((e) => { console.error("manifest failed", e); return null; });
    return m ? Response.json(m, { headers: CORS }) : new Response("Not found", { status: 404, headers: CORS });
  }
  if (req.method === "GET") {
    // Meta's one-time webhook check
    if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === env("WHATSAPP_VERIFY_TOKEN") && env("WHATSAPP_VERIFY_TOKEN"))
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    return new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const cron = req.headers.get("x-cron-token");
  if (cron !== null) {
    // The scheduled job created this one-time token in the database a moment ago.
    if (!/^[0-9a-f-]{36}$/.test(cron)) return new Response("Forbidden", { status: 403 });
    const { data: tok } = await db.from("cron_tokens").delete().eq("token", cron).gte("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString()).select("token");
    if (!tok?.length) return new Response("Forbidden", { status: 403 });
    try { return Response.json(await runJob(url.searchParams.get("task") ?? "send")); }
    catch (e) { console.error("job failed", e); return new Response("Job failed", { status: 500 }); }
  }
  const raw = await req.text();
  if (!(await validSignature(req, raw))) return new Response("Bad signature", { status: 401 });

  let body: any; try { body = JSON.parse(raw); } catch { return new Response("ok"); }
  for (const entry of body.entry ?? []) for (const change of entry.changes ?? []) {
    const v = change.value ?? {};
    const names: Record<string, string> = {};
    for (const c of v.contacts ?? []) names[c.wa_id] = c.profile?.name ?? "";
    for (const msg of v.messages ?? []) {
      try {
        const waId = msg.from;
        // Meta can deliver the same message twice: skip one we already handled.
        const prev = await deps.getSession(waId);
        if (prev?.lastMsg === msg.id) continue;
        const sessionDeps = { ...deps, saveSession: (id: string, st: any) => deps.saveSession(id, { ...st, lastMsg: msg.id }) };
        const replies = await handle(inputOf(msg), { waId, profileName: (names[waId] || "").split(" ")[0], now: new Date() }, sessionDeps);
        for (const m of replies) await send(waId, m);
      } catch (e) {
        console.error("message failed", e);
        await send(msg.from, { kind: "text", body: "Sorry, something went wrong on our side. Please try again, or call 081 331 1175 / 081 295 7277." }).catch(() => {});
      }
    }
  }
  return new Response("ok");
});
