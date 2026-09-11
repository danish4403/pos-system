# Ledger POS

A point-of-sale system that reads bills and price tags from photos instead of
manual data entry. Real backend, real database, admin login, discount and
payment handling, and a Windows desktop installer — works fully offline
except for the photo-scanning feature itself (which needs internet to reach
the AI model that reads the images).

## Installing on Windows

In this delivery you should have **`Ledger POS Setup 1.0.0.exe`**. That's it —
double-click it, click through the installer (you can choose the install
folder), and it adds a desktop + start menu shortcut called "Ledger POS".
No Node.js, no terminal, no `npm install` needed for this path — everything
is bundled inside.

Your data (inventory, sales, settings) is stored per-user under
`%APPDATA%\Ledger POS\data` — separate from the installed program, so
reinstalling or updating the app later won't touch it. **Back that folder up
occasionally** (copy it to a USB drive or cloud folder now and then) — it's
the only copy of your inventory and sales history.

The very first time you do anything admin-only (scan a bill, edit an item,
view sales/settings), it'll ask you to choose an admin password — that's
your shop's password from then on. There's no "forgot password" recovery
built in, so write it down somewhere safe.

### Turning on photo scanning

Photo scanning (reading bills and tags from photos) needs an Anthropic API
key — get one free at **console.anthropic.com**, then paste it into
**Settings → Photo scanning** inside the app. You pay a small amount per
photo scanned after that (a few paise to a couple of rupees per image).
Everything else in the app works without a key.

## What's actually "real" here

- **Backend**: a Node.js/Express server — not a browser toy. It's the only
  thing that talks to the database and the only thing that holds your
  Anthropic API key (never sent to the browser in plaintext).
- **Database**: an embedded file-based store. No separate database software
  to install. Fine for a single shop's catalog and sales history.
- **Admin control**: selling is never gated — that stays fast. Cost prices,
  margins, profit, sales history, and editing/settings are locked behind a
  password you set on first use.
- **Offline**: everything works with no internet except the photo-scan
  feature, which needs a connection to reach Claude's vision model.
- **Desktop app**: the installer wraps this exact same server + frontend in
  Electron — there's no separate "desktop" codebase to keep in sync.

## Features

- **Scan a bill photo** → reads item name, quantity, cost price, code, and a
  best-guess category for each line. You set your margin (a shop-wide
  default, editable per item) and it computes your selling price.
- **Ring up a sale** three ways: photograph the item's tag, scan a barcode
  with a USB/Bluetooth scanner (acts like a keyboard — scan into the search
  box), or search manually.
- **Discounts at checkout** — either a percentage off, or just type the
  final price you're charging and it back-calculates the discount.
- **Payment method** — Cash, UPI, Card, or Due (partial or unpaid; you can
  record additional payments later against a due sale from Sales History).
- **Dashboard** — stock levels, low-stock warnings, and an items-by-category
  breakdown.
- **Sales history** (admin) — today's per-item summary (quantity sold and
  profit earned after any discount), full sale-by-sale breakdown, and
  outstanding dues across all customers.
- **Home page** — editable shop name, address, phone, a welcome message, and
  a custom background photo. This is the landing screen when the app opens.

## Running it another way (without the installer)

If you'd rather run it from source (e.g. on Mac/Linux, or to modify it):

1. Install [Node.js](https://nodejs.org) (LTS).
2. In this folder: `npm install`
3. `npm start`, then open **http://localhost:3000**

Or to run the desktop-app version without building an installer:
`npm install`, then `npm run electron`.

## Rebuilding the Windows installer yourself

If you ever change the code and want a fresh installer:
```
npm install
npm run dist
```
This produces `dist_electron/Ledger POS Setup <version>.exe`. Building this
way works on Windows, Mac, or Linux (on Linux you'll need `wine` installed
for the Windows build step — `sudo apt install wine64 wine32:i386` on
Ubuntu/Debian). Building natively on a Windows machine is the most reliable
path if you run into any issues.

## Scaling up later

This is a real backend + database + admin system, but it's sized for one
device. If you later want a second till or another shop location sharing
the same live inventory, the path is:

1. Swap the JSON file store (`server/db.js`) for a real client-server
   database (PostgreSQL is the natural choice).
2. Host the backend somewhere reachable by all your devices.
3. Point every device at that server's address instead of `localhost`.

Every route file only talks to the functions in `db.js`, so step 1 is a
contained change.

## Nice-to-haves (didn't build these yet — ask if you want them)

- Auto-start on Windows boot.
- Receipt printer support (real thermal printer instead of print-to-PDF).
- CSV export of sales, automated daily backups.
- A custom app icon (currently uses the default Electron icon).

## Project structure

```
pos-system/
  electron/
    main.js           — desktop app wrapper (starts the same server, opens a window)
  server/
    index.js           — server entry point
    db.js                — the embedded database
    auth.js               — admin password hashing & session check
    routes/
      auth.js               — login/logout/setup
      inventory.js           — CRUD for stock (category, cost/margin hidden from non-admins)
      sales.js                — checkout (discount, payment, due) + history (admin only)
      settings.js               — shop/home page settings, API key, admin password change
      vision.js                  — proxies photo-reading requests to Claude
  public/
    index.html         — the whole frontend (one file, no build step)
  data/                 — your database when running from source — back this up
  dist_electron/         — the built Windows installer lives here after `npm run dist`
```
