# GIBBZ Transport WhatsApp booking bot

Customers message the GIBBZ Transport WhatsApp number (081 207 3832) and the bot books their seats. It asks for:

1. direction (to Lüderitz or to Windhoek)
2. travel day (the next 10 days; the bus runs every day)
3. where they get on and where they get off (Windhoek, Rehoboth, Kalkrand, Mariental, Keetmanshoop, Aus, Lüderitz), with the fare, the approximate time and the pick-up spot at each stop
4. how many people (1 to 6; bigger groups are passed to staff)
5. which seats (the bot lists the free seats for that stretch, or picks any free seats). The Quantum seats 13 passengers: seat 1 is beside the driver, then rows 2-3, 4-6 and 7-9, and 10-13 is the back bench.
6. each passenger's full name
7. a cell number (by default the WhatsApp number they are using)
8. how they will pay (cash on the bus, EFT or eWallet)
9. a summary, then **Confirm booking**

The customer gets a reference such as `GZ-7KQ2M`. A seat can't be sold twice on overlapping stretches, because the database refuses it. The customer can also send *My bookings*, *staff* to hand the chat to a person (the bot then stays quiet for 12 hours or until they send *menu*), or *cancel* at any point.

The route is Windhoek, Rehoboth, Kalkrand, Mariental, Keetmanshoop, Aus and Lüderitz (B1 and B4). In the database the direction codes are still `WHK-OMD` (Windhoek to Lüderitz) and `OMD-WHK` (Lüderitz to Windhoek), from the company's earlier name and route.

## Day-before reconfirmation

Every day at 17:00 (Windhoek time), the bot sends a WhatsApp message to each passenger travelling the next day. The message asks if they still want the booking and has two buttons:
- **Yes, keep it** marks the booking as reconfirmed.
- **Cancel booking** cancels it and frees the seat straight away.

At 05:00 on the day of travel, bookings with no answer are marked "No reply to reconfirm", so staff can phone those passengers. Bookings are not cancelled automatically.

WhatsApp only lets a business message someone first with a template that Meta has approved. Create the template in **WhatsApp Manager > Message templates > Create template**:

- **Category:** Utility
- **Name:** `booking_reconfirm`
- **Language:** English (`en`)
- **Body:**

  > Hi {{1}}, this is GIBBZ Transport. You are booked for {{2}}, {{3}}, seat {{4}}. Please be at {{5}} by about {{6}}. Do you still want this booking? Reference {{7}}.

- **Buttons:** two *Quick reply* buttons, `Yes, keep it` and `Cancel booking`, in that order.

Meta usually approves templates within minutes to a day.

## Driver lists (paperless manifest)

Each driver gets their bus's passenger list on WhatsApp, with a link to a live page that updates itself when bookings change. The page lists every stop in order, who gets on and off, a **Call** button for each passenger, and how much cash to collect.

- **Set it up:** under **Fares & times > Buses & fleet**, enter each vehicle's driver and **Driver cell**. Then, on **Book a seat**, choose the vehicle for each bus in step 4.
- **Send it by hand (works now):** on the **Manifest** tab, click **Send to driver on WhatsApp**. WhatsApp opens on your phone or computer with the list and the live link filled in, ready to send to the driver.
- **Automatic (once WhatsApp is connected):** every evening at 20:00, the bot sends each driver the link to tomorrow's list. This needs a second template in **WhatsApp Manager > Message templates**:
  - **Category:** Utility
  - **Name:** `driver_manifest`
  - **Language:** English (`en`)
  - **Body:** `Hi {{1}}, your GIBBZ Transport passenger list for {{2}}, {{3}}, is ready: {{4}} passengers booked so far. Tap below to open it. The list updates itself if bookings change.`
  - **Button:** *Visit website*, type *Dynamic*, URL `https://neil-n81l.github.io/Chris-liner/driver.html?t={{1}}`, button text `Open passenger list`

A driver's link only works for their own bus and stops working two days after the trip.

## Final trip details for passengers

At 20:00 the evening before travel, after the 17:00 confirmations, the bot sends every passenger who is still booked a final message: their seat and bus, the pick-up spot and time, and the driver's name. The driver's name comes from the vehicle chosen for that bus. If no vehicle is chosen yet, the message says the driver is "to be confirmed". This needs a third template:

- **Category:** Utility
- **Name:** `trip_details`
- **Language:** English (`en`)
- **Body:** `Hi {{1}}, your GIBBZ Transport trip is confirmed. {{2}}, {{3}}, seat {{4}}. Please be at {{5}} by {{6}}. Your driver is {{7}}. Reference {{8}}. Safe travels!`

## Several buses a day

Each direction can run up to six buses on the same day (Bus 1, Bus 2 and so on). Seats are booked per bus, so seat 4 on Bus 1 and seat 4 on Bus 2 are different seats.

- **Normal number of buses:** set *Buses on a normal day* for each direction under **Fares & times**. The default is one bus each way.
- **An extra bus for one day:** on **Book a seat**, pick the day and direction and click **+ Add bus**. An extra bus with no bookings can be removed again.
- **Vehicles:** list your Quantums (name, registration, usual driver) under **Fares & times > Buses & fleet**, then choose which vehicle runs each bus on a trip. The driver's manifest shows the bus and vehicle.
- **WhatsApp:** the bot puts a customer's group on the first bus that has enough free seats for their whole stretch, and tells them which bus they're on. The day-before message says "on Bus 2" when it isn't Bus 1.

## Staff site

The staff site works like the earlier booking page, but it reads and writes the same bookings as the bot. It has a seat map, a manifest showing who booked on WhatsApp and who has reconfirmed, and the fares and times, which the bot also uses. The files are in `docs/`, and GitHub Pages publishes them.

To add a staff member:

1. In Supabase, open **Authentication > Users > Add user > Create new user**. Enter their email and a password, and tick **Auto confirm**.
2. In **Table editor > staff**, insert a row with their email in lower case and their name.

Only people on the `staff` list can see or change bookings. Under **Authentication > Sign in / Providers**, turn off **Allow new users to sign up**, so that only users you add can log in.

## What is already running

- **Supabase project:** `chris-liner` (in Neil-N81L's Org, London region, free plan). Its tables are `bookings`, `settings` (fares, stop times, payment text, buses per day), `wa_sessions` (where each chat is up to), `vehicles` (the fleet), `trips` (which buses run on a date and which vehicle each one is) and `staff` (who may log in to the staff site).
- **Scheduled jobs:** the reconfirmation runs daily (pg_cron). Before WhatsApp is connected, it does nothing.
- **Webhook URL:** `https://dntpwkkkcfgrlderqgxt.supabase.co/functions/v1/whatsapp`
- **Security:** the webhook refuses every message until the WhatsApp secrets below are set.

## What you need to set up (about an hour)

### 1. Meta business account and app

1. Go to <https://business.facebook.com> and create a Meta Business account for GIBBZ Transport, if there isn't one yet.
2. Go to <https://developers.facebook.com/apps>, then **Create app** > **Other** > **Business**, and link it to that business account.
3. In the app, add the **WhatsApp** product.

### 2. Phone number

WhatsApp Cloud API needs a number that is **not** in use on the normal WhatsApp or WhatsApp Business app. You have two choices:

- Register a new number (a new SIM is fine) under **WhatsApp > API Setup > Add phone number**.
- Move 081 207 3832 to the API. That number then stops working in the WhatsApp phone app, and staff reply from the Meta Business Suite inbox or a connected tool instead.

Meta checks the number with an SMS or a call. The business display name ("GIBBZ Transport") also has to be approved.

### 3. Permanent access token

1. In **Business settings > Users > System users**, add a system user with the Admin role.
2. Give it the app and the WhatsApp account as assets.
3. Click **Generate token** with the permissions `whatsapp_business_messaging` and `whatsapp_business_management`. Copy the token.

### 4. Secrets in Supabase

In the Supabase dashboard, open project **chris-liner** > **Edge Functions** > **Secrets** and add:

| Name | Value |
|---|---|
| `WHATSAPP_TOKEN` | the token from step 3 |
| `WHATSAPP_PHONE_NUMBER_ID` | **WhatsApp > API Setup** > *Phone number ID* (a long number, not the phone number itself) |
| `WHATSAPP_APP_SECRET` | **App settings > Basic** > *App secret* |
| `WHATSAPP_VERIFY_TOKEN` | any phrase you make up, e.g. `gibbz-2026-bus` |

### 5. Connect the webhook

1. In the Meta app, open **WhatsApp > Configuration > Webhook** and click **Edit**.
2. For *Callback URL*, enter `https://dntpwkkkcfgrlderqgxt.supabase.co/functions/v1/whatsapp`.
3. For *Verify token*, enter the same phrase you set as `WHATSAPP_VERIFY_TOKEN`.
4. Click **Verify and save**, then subscribe to the **messages** field.

### 6. Test

Send "Hi" to the number from your own phone. While the app is in development mode, Meta only delivers to test numbers you add under **API Setup**. Publish the app (Meta asks for a privacy policy URL) when you're ready for customers.

## Things to fill in

The fares, stop times and payment text are placeholders in the `settings` table:

- prices between stops (the price list under Fares & times; known so far: Lüderitz to Windhoek N$ 500, Rehoboth N$ 470, Mariental N$ 430, Keetmanshoop N$ 260; Windhoek to Keetmanshoop N$ 300)
- hours from Windhoek to each stop
- minimum fare
- departure time and departure point for each direction
- payment instructions, including bank details for EFT

Send the real values and Claude will update them.

## Costs

- **Supabase:** free plan.
- **Meta:** charges per conversation. Replies within 24 hours of a customer's message are free of the per-message template charge, but Meta's pricing changes, so check current WhatsApp pricing for Namibia on Meta's site.

## Testing the conversation without WhatsApp

```
node test/sim.mjs
```

This plays a sample chat against an in-memory database and prints the bot's replies.
