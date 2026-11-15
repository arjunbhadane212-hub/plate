# Plate: a personal photo calorie tracker

Snap a photo, see your calories, fix anything in the chat, and track day/week/month/year.
No account and no cloud. All data stays on your phone (IndexedDB).

## Features
- **Home**: week strip, calories left ring, protein/carbs/fat left, the day's meals with thumbnails, a streak counter, and a date picker for back-filling.
- **Log a meal**: + → Scan food (camera) / Photo library / Describe it.
- **Result screen**: photo, calories, macros, a servings stepper (¼ to 4), and an ingredient list. Tap an item to adjust its grams.
- **Fix results chat**: plain-English corrections that update totals live, including undo.
- **Progress**: Day / Week / Month / Year totals, a stacked macro bar chart against your goal, daily average, avg vs goal, days on target, top foods, and streak.
- **Settings**: daily goals, a goal calculator (Mifflin-St Jeor), JSON backup export/import, and delete all.
- **Installable PWA**: full-screen from the home screen, works offline.

## How calories are estimated
1. **Identify** what's on the plate and **how many grams** of each item. Right now you tell the chat this. Later a vision model (Gemini) will do it from the photo.
2. **Ground**: calories and macros come from the built-in USDA-based table (`js/foods.js`, about 190 foods with household units), not from the AI's guess. Models name foods well but get the numbers wrong and tend to under-count.
3. **Correct**: the chat engine (`js/chat.js`) handles corrections offline and deterministically.

Chat examples: `2 eggs and toast with butter`, `you missed the rice`, `remove the sauce`,
`that's quinoa not rice`, `the chicken was 200g`, `3 eggs not 2`, `more rice`, `double the toast`,
`I only ate half`, `shared it with 2 friends`, `protein bar 210 kcal`, `undo`.

## Connecting Gemini (next step)
Everything is wired through `js/ai.js`. Implement `geminiProvider.analyzePhoto()` (send `PHOTO_PROMPT` + image and parse the JSON),
pass the result through `groundItems()`, and set `ACTIVE = geminiProvider`.

## Run locally
```bash
python3 -m http.server 5173 -d /Users/user/plate
```
Open http://localhost:5173.

## Install on your phone
The app needs to be served over **HTTPS** for offline install (any static host works: Vercel, Netlify, GitHub Pages).
- **iPhone**: open the URL in **Safari** → Share → **Add to Home Screen**.
- **Android**: open the URL in **Chrome** → ⋮ → **Install app**.

Data lives on the device. Use Settings → Export backup now and then.
