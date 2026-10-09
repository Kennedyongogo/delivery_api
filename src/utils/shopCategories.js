// The three business areas Kabi covers. A shop can deal in any of them; each product belongs to exactly one.
const SHOP_CATEGORIES = Object.freeze(["water", "gas", "fastfood"]);

const SOCIAL_PLATFORMS = Object.freeze(["facebook", "instagram", "x", "tiktok", "youtube", "linkedin"]);

const WEEK_DAYS = Object.freeze(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Opening hours are a list of `{ days, open, close }` (or `{ days, all_day: true }`) entries,
 * e.g. Mon–Fri 09:00–21:00 plus Sat 10:00–18:00. Days missing from every entry are closed.
 * A close time earlier than the open time means the shop closes after midnight.
 * Returns the cleaned list, or throws an Error with a message fit for the shop owner.
 */
const normalizeOpeningHours = (value) => {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Opening hours must be a list.");
  if (value.length > WEEK_DAYS.length) throw new Error("Use at most 7 opening-hours rows.");

  const seen = new Set();
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") throw new Error("Each opening-hours row must be an object.");
      const days = [...new Set(Array.isArray(entry.days) ? entry.days.map(String) : [])];
      if (!days.length) throw new Error("Pick at least one day for every opening-hours row.");
      const unknown = days.filter((day) => !WEEK_DAYS.includes(day));
      if (unknown.length) throw new Error(`Unknown days: ${unknown.join(", ")}`);
      for (const day of days) {
        if (seen.has(day)) throw new Error(`${day[0].toUpperCase()}${day.slice(1)} appears in more than one opening-hours row.`);
        seen.add(day);
      }
      days.sort((a, b) => WEEK_DAYS.indexOf(a) - WEEK_DAYS.indexOf(b));

      if (entry.all_day === true || entry.all_day === "true") return { days, all_day: true };
      const open = String(entry.open ?? "");
      const close = String(entry.close ?? "");
      if (!TIME_RE.test(open) || !TIME_RE.test(close)) throw new Error("Opening hours need times like 09:00 and 21:00.");
      if (open === close) throw new Error("Opening and closing times can't be the same. Use “Open 24 hours” instead.");
      return { days, open, close };
    })
    .sort((a, b) => WEEK_DAYS.indexOf(a.days[0]) - WEEK_DAYS.indexOf(b.days[0]));
};

const MAX_PRODUCT_IMAGES = 10;

module.exports = { SHOP_CATEGORIES, SOCIAL_PLATFORMS, WEEK_DAYS, MAX_PRODUCT_IMAGES, normalizeOpeningHours };
