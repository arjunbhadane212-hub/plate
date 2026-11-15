// Photo analysis + chat providers.
//
// HOW ESTIMATION WORKS (hybrid, most-accurate-first):
//  1. A vision model looks at the photo and returns ONLY: which foods, and how
//     many grams of each (plus its own kcal guess as a fallback).
//  2. `groundItems()` replaces the model's calorie numbers with values from the
//     built-in USDA-based food table whenever the food is recognised. Models are
//     much better at naming food than at knowing nutrition numbers, and
//     research shows they systematically under-estimate calories.
//  3. You correct anything in the chat. Simple corrections are handled locally
//     (instant, free, deterministic); fuzzy ones can go to the model.
//
// Today no API is connected, so photos open in "describe it" mode and the
// local chat engine does everything. To connect Gemini later, implement
// `geminiProvider.analyzePhoto` / `geminiProvider.revise` below and set
// `ACTIVE = geminiProvider`.

import { groundItems } from './nutrition.js';
import { applyMessage } from './chat.js';

/** Prompt to send with the photo once a model is attached. */
export const PHOTO_PROMPT = `You are a nutrition analyst. Identify every distinct food and drink visible in the photo, including oils, sauces, dressings and toppings.
For each item estimate the edible weight in grams using visual cues (plate ~26 cm, fork ~19 cm, hand, cup sizes).
Return JSON only: {"name": "short meal name", "items": [{"name": "food name", "grams": number, "kcal": number, "protein": number, "carbs": number, "fat": number, "confidence": 0-1}]}.
Use common food names (e.g. "white rice", "grilled chicken breast", "butter chicken"). Do not merge separate foods.`;

const localProvider = {
  id: 'local',
  label: 'Manual mode (no AI)',
  connected: false,
  async analyzePhoto(/* dataUrl */) { return null; },
  async revise(meal, message) { return applyMessage(meal, message); },
};

// eslint-disable-next-line no-unused-vars
const geminiProvider = {
  id: 'gemini',
  label: 'Gemini',
  connected: true,
  async analyzePhoto(dataUrl) {
    // TODO(next step): POST to Gemini with PHOTO_PROMPT + image, parse JSON, then:
    // const json = await callGemini(...);
    // return { name: json.name, items: groundItems(json.items) };
    throw new Error('Gemini not connected yet');
  },
  async revise(meal, message) {
    // Try the deterministic local engine first; fall back to the model only
    // when the local engine didn't understand.
    const local = applyMessage(meal, message);
    if (local.changed || local.undo) return local;
    throw new Error('Gemini not connected yet');
  },
};

let ACTIVE = localProvider;

export const ai = {
  get connected() { return ACTIVE.connected; },
  get label() { return ACTIVE.label; },
  analyzePhoto: (d) => ACTIVE.analyzePhoto(d),
  revise: (m, msg) => ACTIVE.revise(m, msg),
};

export { groundItems };
