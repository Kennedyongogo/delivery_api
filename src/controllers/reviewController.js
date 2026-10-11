const { Op, literal } = require("sequelize");
const { Shop, ShopReview, AuditLog } = require("../models");
const { SHOP_CATEGORIES } = require("../utils/shopCategories");

// What the public sees of a shop: its profile only, never the owner's account.
const PUBLIC_SHOP_ATTRIBUTES = [
  "id",
  "name",
  "description",
  "logo_url",
  "categories",
  "services",
  "phone",
  "alt_phone",
  "email",
  "whatsapp",
  "website",
  "social_links",
  "delivery_conditions",
  "address",
  "latitude",
  "longitude",
  "opening_hours",
  "createdAt",
];

const RATING_AVG = literal(
  '(SELECT COALESCE(ROUND(AVG(r.rating)::numeric, 2), 0) FROM shop_reviews r WHERE r.shop_id = "Shop"."id")'
);
const REVIEW_COUNT = literal('(SELECT COUNT(*) FROM shop_reviews r WHERE r.shop_id = "Shop"."id")');

const SHOP_SORTS = {
  rating: [[RATING_AVG, "DESC"], [REVIEW_COUNT, "DESC"], ["name", "ASC"]],
  reviews: [[REVIEW_COUNT, "DESC"], [RATING_AVG, "DESC"], ["name", "ASC"]],
  newest: [["createdAt", "DESC"]],
  name: [["name", "ASC"]],
};

const REVIEW_SORTS = {
  newest: [["createdAt", "DESC"]],
  highest: [["rating", "DESC"], ["createdAt", "DESC"]],
  lowest: [["rating", "ASC"], ["createdAt", "DESC"]],
};

const MAX_COMMENT = 2000;
const LIST_MAX_LIMIT = 60;

const toPage = (query, fallbackLimit) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(LIST_MAX_LIMIT, Math.max(1, Number.parseInt(query.limit, 10) || fallbackLimit));
  return { page, limit, offset: (page - 1) * limit };
};

const withRating = (shop) => {
  const json = shop.toJSON();
  return { ...json, rating_avg: Number(json.rating_avg) || 0, review_count: Number(json.review_count) || 0 };
};

// Anonymous reviews stay anonymous for everyone, shop owners and super admins included.
const presentReview = (review) => ({
  id: review.id,
  rating: review.rating,
  comment: review.comment,
  is_anonymous: review.is_anonymous,
  author_name: review.is_anonymous ? null : review.author_name,
  createdAt: review.createdAt,
  reply: review.owner_reply ? { text: review.owner_reply, createdAt: review.owner_reply_at } : null,
});

const ratingSummary = async (shopId) => {
  const rows = await ShopReview.findAll({
    where: { shop_id: shopId },
    attributes: ["rating", [literal("COUNT(*)"), "count"]],
    group: ["rating"],
    raw: true,
  });
  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of rows) breakdown[row.rating] = Number(row.count);
  const total = Object.values(breakdown).reduce((sum, n) => sum + n, 0);
  const sum = Object.entries(breakdown).reduce((acc, [stars, n]) => acc + Number(stars) * n, 0);
  return { average: total ? Math.round((sum / total) * 100) / 100 : 0, total, breakdown };
};

const listReviews = async (shopId, query) => {
  const { page, limit, offset } = toPage(query, 10);
  const order = REVIEW_SORTS[query.sort] ?? REVIEW_SORTS.newest;
  const where = { shop_id: shopId };
  const stars = Number.parseInt(query.rating, 10);
  if (stars >= 1 && stars <= 5) where.rating = stars;

  const { count, rows } = await ShopReview.findAndCountAll({ where, order, limit, offset });
  return {
    data: rows.map(presentReview),
    pagination: { total: count, page, limit, totalPages: Math.ceil(count / limit) },
  };
};

const sendError = (res, error) => res.status(500).json({ success: false, message: error.message });

/* ---------- Public directory ---------- */

const listPublicShops = async (req, res) => {
  try {
    const { page, limit, offset } = toPage(req.query, 12);
    const where = { is_active: true };

    if (req.query.category) {
      if (!SHOP_CATEGORIES.includes(req.query.category)) {
        return res.status(400).json({ success: false, message: `Category must be one of: ${SHOP_CATEGORIES.join(", ")}` });
      }
      where.categories = { [Op.contains]: [req.query.category] };
    }

    const search = String(req.query.search || "").trim();
    if (search) {
      const like = { [Op.iLike]: `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` };
      where[Op.or] = [{ name: like }, { address: like }, { description: like }];
    }

    const { count, rows } = await Shop.findAndCountAll({
      where,
      attributes: [...PUBLIC_SHOP_ATTRIBUTES, [RATING_AVG, "rating_avg"], [REVIEW_COUNT, "review_count"]],
      order: SHOP_SORTS[req.query.sort] ?? SHOP_SORTS.rating,
      limit,
      offset,
    });

    const counts = await Promise.all(
      SHOP_CATEGORIES.map((c) => Shop.count({ where: { is_active: true, categories: { [Op.contains]: [c] } } }))
    );

    return res.status(200).json({
      success: true,
      data: rows.map(withRating),
      stats: {
        total: await Shop.count({ where: { is_active: true } }),
        ...Object.fromEntries(SHOP_CATEGORIES.map((c, i) => [c, counts[i]])),
        reviews: await ShopReview.count({ where: { shop_id: { [Op.in]: literal("(SELECT id FROM shops WHERE is_active)") } } }),
      },
      pagination: { total: count, page, limit, totalPages: Math.ceil(count / limit) },
    });
  } catch (error) {
    return sendError(res, error);
  }
};

const findPublicShop = (id) =>
  Shop.findOne({
    where: { id, is_active: true },
    attributes: [...PUBLIC_SHOP_ATTRIBUTES, [RATING_AVG, "rating_avg"], [REVIEW_COUNT, "review_count"]],
  });

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value));

const getPublicShop = async (req, res) => {
  try {
    const shop = isUuid(req.params.id) && (await findPublicShop(req.params.id));
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found" });
    return res.status(200).json({ success: true, data: { ...withRating(shop), rating: await ratingSummary(shop.id) } });
  } catch (error) {
    return sendError(res, error);
  }
};

const getPublicShopReviews = async (req, res) => {
  try {
    const shop = isUuid(req.params.id) && (await Shop.findOne({ where: { id: req.params.id, is_active: true }, attributes: ["id"] }));
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found" });
    return res.status(200).json({ success: true, ...(await listReviews(shop.id, req.query)) });
  } catch (error) {
    return sendError(res, error);
  }
};

/* ---------- Posting reviews ---------- */

// Reviews are open to everyone, so cap how fast one person (account or IP) can post.
const RECENT_WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_SHOP = 3;
const MAX_OVERALL = 15;
const recentPosts = new Map();

const allowPost = (key, shopId) => {
  const now = Date.now();
  const posts = (recentPosts.get(key) ?? []).filter((post) => now - post.at < RECENT_WINDOW_MS);
  recentPosts.set(key, posts);
  if (posts.length >= MAX_OVERALL || posts.filter((post) => post.shopId === shopId).length >= MAX_PER_SHOP) return false;
  posts.push({ at: now, shopId });
  return true;
};

const createReview = async (req, res) => {
  try {
    const shop = isUuid(req.params.id) && (await Shop.findOne({ where: { id: req.params.id, is_active: true } }));
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found" });

    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: "Pick a rating from 1 to 5 stars." });
    }
    const comment = String(req.body.comment ?? "").trim();
    if (comment.length > MAX_COMMENT) {
      return res.status(400).json({ success: false, message: `Keep your review under ${MAX_COMMENT} characters.` });
    }

    const user = req.user ?? null;
    // A stale token must not silently turn a named review into an anonymous one.
    if (!user && req.header("Authorization")) {
      return res.status(401).json({ success: false, message: "Your session has expired. Sign in again to post with your name." });
    }
    if (user && (shop.owner_id === user.id || user.shop_id === shop.id)) {
      return res.status(403).json({ success: false, message: "You can't review a shop you own or work at." });
    }
    // Guests always post anonymously; signed-in users choose.
    const anonymous = !user || req.body.anonymous === true || req.body.anonymous === "true";

    if (!allowPost(user?.id ?? `ip:${req.ip}`, shop.id)) {
      return res.status(429).json({ success: false, message: "You've posted several reviews just now. Please try again in a few minutes." });
    }

    const review = await ShopReview.create({
      shop_id: shop.id,
      user_id: user?.id ?? null,
      is_anonymous: anonymous,
      author_name: anonymous ? null : user.full_name,
      rating,
      comment: comment || null,
    });

    return res.status(201).json({ success: true, data: presentReview(review), rating: await ratingSummary(shop.id) });
  } catch (error) {
    return sendError(res, error);
  }
};

/* ---------- Admin views ---------- */

const respondWithReviews = async (res, shopId, query) =>
  res.status(200).json({ success: true, summary: await ratingSummary(shopId), ...(await listReviews(shopId, query)) });

// The signed-in owner's (or staff member's) shop. Read-only: reviews are never edited or removed.
const getMyShopReviews = async (req, res) => {
  try {
    const { user } = req;
    const shop =
      user.role === "shop_owner"
        ? await Shop.findOne({ where: { owner_id: user.id }, attributes: ["id"] })
        : user.shop_id && user.created_by
          ? await Shop.findOne({ where: { id: user.shop_id, owner_id: user.created_by }, attributes: ["id"] })
          : null;
    if (!shop) {
      return res.status(200).json({
        success: true,
        summary: { average: 0, total: 0, breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
        data: [],
        pagination: { total: 0, page: 1, limit: 10, totalPages: 0 },
      });
    }
    return respondWithReviews(res, shop.id, req.query);
  } catch (error) {
    return sendError(res, error);
  }
};

/* ---------- Owner replies ---------- */

const MAX_REPLY = 1000;

const findOwnReview = async (req) => {
  if (!isUuid(req.params.reviewId)) return null;
  const shop = await Shop.findOne({ where: { owner_id: req.user.id }, attributes: ["id"] });
  if (!shop) return null;
  return ShopReview.findOne({ where: { id: req.params.reviewId, shop_id: shop.id } });
};

const audit = (req, action, details) =>
  AuditLog.create({ user_id: req.user.id, action, details, ip_address: req.ip }).catch(() => {});

// Adds or edits the owner's public reply. The review itself stays exactly as the customer wrote it.
const replyToReview = async (req, res) => {
  try {
    const text = String(req.body.reply ?? "").trim();
    if (!text) return res.status(400).json({ success: false, message: "Write a reply first." });
    if (text.length > MAX_REPLY) {
      return res.status(400).json({ success: false, message: `Keep your reply under ${MAX_REPLY} characters.` });
    }
    const review = await findOwnReview(req);
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });

    const edited = Boolean(review.owner_reply);
    await review.update({ owner_reply: text, owner_reply_at: new Date() });
    audit(req, "reply_shop_review", { review_id: review.id, shop_id: review.shop_id, edited });
    return res.status(200).json({ success: true, data: presentReview(review) });
  } catch (error) {
    return sendError(res, error);
  }
};

const deleteReply = async (req, res) => {
  try {
    const review = await findOwnReview(req);
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });
    if (review.owner_reply) {
      await review.update({ owner_reply: null, owner_reply_at: null });
      audit(req, "delete_shop_review_reply", { review_id: review.id, shop_id: review.shop_id });
    }
    return res.status(200).json({ success: true, data: presentReview(review) });
  } catch (error) {
    return sendError(res, error);
  }
};

const getShopReviewsById = async (req, res) => {
  try {
    const shop = isUuid(req.params.id) && (await Shop.findByPk(req.params.id, { attributes: ["id"] }));
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found" });
    return respondWithReviews(res, shop.id, req.query);
  } catch (error) {
    return sendError(res, error);
  }
};

module.exports = {
  listPublicShops,
  getPublicShop,
  getPublicShopReviews,
  createReview,
  getMyShopReviews,
  getShopReviewsById,
  replyToReview,
  deleteReply,
};
