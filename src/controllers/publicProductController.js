const { Op } = require("sequelize");
const { Shop, ShopProduct } = require("../models");
const { SHOP_CATEGORIES } = require("../utils/shopCategories");

// What the public sees of a product. stock_quantity stays private until the point-of-sale ships.
const PUBLIC_PRODUCT_ATTRIBUTES = ["id", "shop_id", "name", "category", "description", "price", "unit", "images", "image_url", "createdAt"];

// Just enough of the shop for a buyer to see who sells it and how to order.
const PRODUCT_SHOP_ATTRIBUTES = ["id", "name", "logo_url", "phone", "whatsapp", "address", "opening_hours"];

const PRODUCT_SORTS = {
  newest: [["createdAt", "DESC"]],
  price_asc: [["price", "ASC"], ["name", "ASC"]],
  price_desc: [["price", "DESC"], ["name", "ASC"]],
  name: [["name", "ASC"]],
};

const LIST_MAX_LIMIT = 60;

const toPage = (query, fallbackLimit) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(LIST_MAX_LIMIT, Math.max(1, Number.parseInt(query.limit, 10) || fallbackLimit));
  return { page, limit, offset: (page - 1) * limit };
};

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value));

const sendError = (res, error) => res.status(500).json({ success: false, message: error.message });

const categoryError = (category) =>
  category && !SHOP_CATEGORIES.includes(category) ? `Category must be one of: ${SHOP_CATEGORIES.join(", ")}` : null;

const likeFilter = (search) => ({ [Op.iLike]: `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` });

const listPublicShopProducts = async (req, res) => {
  try {
    const shop = isUuid(req.params.id) && (await Shop.findOne({ where: { id: req.params.id, is_active: true }, attributes: ["id"] }));
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found" });

    const products = await ShopProduct.findAll({
      where: { shop_id: shop.id, is_available: true },
      attributes: PUBLIC_PRODUCT_ATTRIBUTES,
      order: [["category", "ASC"], ["name", "ASC"]],
    });
    return res.status(200).json({ success: true, data: products });
  } catch (error) {
    return sendError(res, error);
  }
};

const listPublicProducts = async (req, res) => {
  try {
    const { page, limit, offset } = toPage(req.query, 24);
    const invalid = categoryError(req.query.category);
    if (invalid) return res.status(400).json({ success: false, message: invalid });

    const where = { is_available: true };
    if (req.query.category) where.category = req.query.category;

    const search = String(req.query.search || "").trim();
    if (search) {
      const like = likeFilter(search);
      where[Op.or] = [{ name: like }, { description: like }, { "$shop.name$": like }];
    }

    const { count, rows } = await ShopProduct.findAndCountAll({
      where,
      attributes: PUBLIC_PRODUCT_ATTRIBUTES,
      include: [{ model: Shop, as: "shop", where: { is_active: true }, attributes: PRODUCT_SHOP_ATTRIBUTES }],
      order: PRODUCT_SORTS[req.query.sort] ?? PRODUCT_SORTS.newest,
      limit,
      offset,
      subQuery: false,
    });

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: { total: count, page, limit, totalPages: Math.ceil(count / limit) },
    });
  } catch (error) {
    return sendError(res, error);
  }
};

module.exports = { listPublicShopProducts, listPublicProducts };
