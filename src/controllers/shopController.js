const path = require("path");
const { Op } = require("sequelize");
const { Shop, ShopProduct, User, AuditLog } = require("../models");
const { convertToRelativePath } = require("../utils/filePath");
const { deleteFile } = require("../middleware/upload");
const { ROLES, SHOP_MEMBER_ROLES } = require("../utils/roles");
const {
  SHOP_CATEGORIES,
  SOCIAL_PLATFORMS,
  MAX_PRODUCT_IMAGES,
  normalizeOpeningHours,
} = require("../utils/shopCategories");

const OWNER_ATTRIBUTES = ["id", "full_name", "email", "phone", "profile_image", "is_active"];
const LIST_DEFAULT_LIMIT = 12;
const LIST_MAX_LIMIT = 60;

// Owners have exactly one shop; staff and shop riders belong to the shop their owner created.
const findShopFor = (user) => {
  if (user.role === ROLES.SHOP_OWNER) return Shop.findOne({ where: { owner_id: user.id } });
  if (SHOP_MEMBER_ROLES.includes(user.role) && user.shop_id && user.created_by) {
    return Shop.findOne({ where: { id: user.shop_id, owner_id: user.created_by } });
  }
  return null;
};

const removeUpload = (relativePath) =>
  relativePath && deleteFile(path.join(__dirname, "..", "..", relativePath));

const audit = (req, action, details) =>
  AuditLog.create({ user_id: req.user.id, action, details, ip_address: req.ip }).catch(() => {});

class ValidationError extends Error {}

// Multipart bodies carry every value as a string, so arrays and objects arrive JSON-encoded.
const parseJson = (value, fallback) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return value;
  if (!value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    throw new ValidationError("Malformed form data, please try again.");
  }
};

const text = (value) => {
  if (value === undefined) return undefined;
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
};

const number = (value, label) => {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new ValidationError(`${label} must be a number.`);
  return parsed;
};

const toBool = (value) => {
  if (value === undefined) return undefined;
  return value === true || value === "true" || value === "1";
};

const sendError = (res, error) => {
  if (error instanceof ValidationError) {
    return res.status(400).json({ success: false, message: error.message });
  }
  if (error.name === "SequelizeUniqueConstraintError") {
    return res.status(409).json({ success: false, message: "You already have a shop. Each shop owner can only have one." });
  }
  if (error.name === "SequelizeValidationError") {
    return res.status(400).json({ success: false, message: error.errors.map((e) => e.message).join(" ") });
  }
  return res.status(500).json({ success: false, message: error.message });
};

const readShopBody = (body) => {
  const values = {
    name: text(body.name),
    description: text(body.description),
    phone: text(body.phone),
    alt_phone: text(body.alt_phone),
    email: text(body.email),
    whatsapp: text(body.whatsapp),
    website: text(body.website),
    address: text(body.address),
    latitude: number(body.latitude, "Latitude"),
    longitude: number(body.longitude, "Longitude"),
  };

  const hours = parseJson(body.opening_hours, []);
  if (hours !== undefined) {
    try {
      values.opening_hours = normalizeOpeningHours(hours);
    } catch (error) {
      throw new ValidationError(error.message);
    }
  }

  const categories = parseJson(body.categories, []);
  if (categories !== undefined) {
    if (!Array.isArray(categories)) throw new ValidationError("Categories must be a list.");
    values.categories = [...new Set(categories.map(String))];
  }

  const services = parseJson(body.services, []);
  if (services !== undefined) {
    if (!Array.isArray(services)) throw new ValidationError("Services must be a list.");
    values.services = [...new Set(services.map((s) => String(s).trim()).filter(Boolean))].slice(0, 30);
  }

  const socials = parseJson(body.social_links, {});
  if (socials !== undefined) {
    if (!socials || typeof socials !== "object" || Array.isArray(socials)) {
      throw new ValidationError("Social links must be an object.");
    }
    values.social_links = Object.fromEntries(
      SOCIAL_PLATFORMS.map((platform) => [platform, text(socials[platform])]).filter(([, value]) => value)
    );
  }

  for (const key of Object.keys(values)) if (values[key] === undefined) delete values[key];
  return values;
};

const getMyShop = async (req, res) => {
  try {
    const shop = await findShopFor(req.user);
    return res.status(200).json({ success: true, data: shop });
  } catch (error) {
    return sendError(res, error);
  }
};

// Creates the owner's shop on first save and updates it afterwards.
const saveMyShop = async (req, res) => {
  const uploaded = req.file ? convertToRelativePath(req.file.path) : null;
  try {
    const values = readShopBody(req.body);
    const shop = await Shop.findOne({ where: { owner_id: req.user.id } });

    for (const [key, label] of [["name", "Shop name"], ["phone", "Phone number"], ["address", "Address"]]) {
      if (!shop && !values[key]) throw new ValidationError(`${label} is required.`);
      if (shop && key in values && !values[key]) throw new ValidationError(`${label} can't be empty.`);
    }
    if ((!shop || values.categories) && !values.categories?.length) {
      throw new ValidationError("Pick at least one of: water, gas, fastfood.");
    }

    if (shop && values.categories) {
      const dropped = shop.categories.filter((category) => !values.categories.includes(category));
      if (dropped.length) {
        const inUse = await ShopProduct.count({ where: { shop_id: shop.id, category: dropped } });
        if (inUse) {
          throw new ValidationError(
            `You still have ${inUse} ${inUse === 1 ? "product" : "products"} in ${dropped.join(", ")}. Delete them before removing that category.`
          );
        }
      }
    }

    const previousLogo = shop?.logo_url;
    if (uploaded) values.logo_url = uploaded;
    else if (toBool(req.body.remove_logo)) values.logo_url = null;

    const saved = shop
      ? await shop.update(values)
      : await Shop.create({ ...values, owner_id: req.user.id });

    // Staff and riders the owner added before (re)creating the shop now belong to it.
    if (!shop) {
      await User.update(
        { shop_id: saved.id },
        { where: { created_by: req.user.id, role: SHOP_MEMBER_ROLES, shop_id: null } }
      );
    }

    if (previousLogo && previousLogo !== saved.logo_url) await removeUpload(previousLogo);
    audit(req, shop ? "update_shop" : "create_shop", { shop_id: saved.id, name: saved.name });

    return res.status(shop ? 200 : 201).json({ success: true, data: saved });
  } catch (error) {
    await removeUpload(uploaded);
    return sendError(res, error);
  }
};

const deleteMyShop = async (req, res) => {
  try {
    const shop = await Shop.findOne({ where: { owner_id: req.user.id } });
    if (!shop) return res.status(404).json({ success: false, message: "You don't have a shop profile yet." });

    const products = await ShopProduct.findAll({ where: { shop_id: shop.id }, attributes: ["images", "image_url"] });
    await shop.destroy();
    await Promise.all([shop.logo_url, ...products.flatMap(productImages)].map(removeUpload));
    audit(req, "delete_shop", { shop_id: shop.id, name: shop.name, products: products.length });

    return res.status(200).json({ success: true, message: "Shop deleted" });
  } catch (error) {
    return sendError(res, error);
  }
};

// Super admin directory: shop profiles only, products are never included.
const listShops = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(LIST_MAX_LIMIT, Math.max(1, Number.parseInt(req.query.limit, 10) || LIST_DEFAULT_LIMIT));
    const where = {};

    if (req.query.category) {
      if (!SHOP_CATEGORIES.includes(req.query.category)) {
        return res.status(400).json({ success: false, message: `Category must be one of: ${SHOP_CATEGORIES.join(", ")}` });
      }
      where.categories = { [Op.contains]: [req.query.category] };
    }

    const search = String(req.query.search || "").trim();
    if (search) {
      const like = { [Op.iLike]: `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` };
      where[Op.or] = [{ name: like }, { address: like }, { phone: like }, { email: like }];
    }

    const { count, rows } = await Shop.findAndCountAll({
      where,
      include: [{ model: User, as: "owner", attributes: OWNER_ATTRIBUTES }],
      order: [["createdAt", "DESC"]],
      limit,
      offset: (page - 1) * limit,
    });

    const totals = await Promise.all(
      SHOP_CATEGORIES.map((category) => Shop.count({ where: { categories: { [Op.contains]: [category] } } }))
    );

    return res.status(200).json({
      success: true,
      data: rows,
      stats: { total: await Shop.count(), ...Object.fromEntries(SHOP_CATEGORIES.map((c, i) => [c, totals[i]])) },
      pagination: { total: count, page, limit, totalPages: Math.ceil(count / limit) },
    });
  } catch (error) {
    return sendError(res, error);
  }
};

const getShopById = async (req, res) => {
  try {
    const shop = await Shop.findByPk(req.params.id, {
      include: [{ model: User, as: "owner", attributes: OWNER_ATTRIBUTES }],
    });
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found" });
    return res.status(200).json({ success: true, data: shop });
  } catch (error) {
    return sendError(res, error);
  }
};

const readProductBody = (body) => {
  const values = {
    name: text(body.name),
    category: text(body.category),
    description: text(body.description),
    unit: text(body.unit),
    price: number(body.price, "Price"),
    stock_quantity: number(body.stock_quantity, "Stock"),
    is_available: toBool(body.is_available),
  };
  if (values.stock_quantity !== undefined && values.stock_quantity !== null) {
    if (!Number.isInteger(values.stock_quantity)) throw new ValidationError("Stock must be a whole number.");
  }
  for (const key of Object.keys(values)) if (values[key] === undefined) delete values[key];
  return values;
};

const listMyProducts = async (req, res) => {
  try {
    const shop = await findShopFor(req.user);
    if (!shop) return res.status(200).json({ success: true, data: [] });

    const where = { shop_id: shop.id };
    if (req.query.category && SHOP_CATEGORIES.includes(req.query.category)) where.category = req.query.category;

    const products = await ShopProduct.findAll({ where, order: [["category", "ASC"], ["name", "ASC"]] });
    return res.status(200).json({ success: true, data: products });
  } catch (error) {
    return sendError(res, error);
  }
};

const getMyProduct = async (req, res) => {
  try {
    const shop = await findShopFor(req.user);
    const product = shop && (await ShopProduct.findOne({ where: { id: req.params.productId, shop_id: shop.id } }));
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    return res.status(200).json({ success: true, data: product });
  } catch (error) {
    return sendError(res, error);
  }
};

const requireOwnShop = async (req) => {
  const shop = await Shop.findOne({ where: { owner_id: req.user.id } });
  if (!shop) throw new ValidationError("Create your shop profile before adding products.");
  return shop;
};

const checkCategory = (shop, category) => {
  if (!SHOP_CATEGORIES.includes(category)) {
    throw new ValidationError(`Category must be one of: ${SHOP_CATEGORIES.join(", ")}`);
  }
  if (!shop.categories.includes(category)) {
    throw new ValidationError(`Your shop doesn't deal in ${category}. Add it to your shop profile first.`);
  }
};

const uploadedPaths = (req) => (req.files ?? []).map((file) => convertToRelativePath(file.path));

const productImages = (product) => {
  if (!product) return [];
  if (product.images?.length) return product.images;
  return product.image_url ? [product.image_url] : [];
};

/**
 * `images` is the full photo list in display order (first is the cover). Each entry is either a
 * path the product already has or "new:N", the Nth file uploaded in `product_images`.
 * Without `images`, existing photos are kept and new uploads are appended.
 */
const resolveImages = (body, uploads, current) => {
  const order = parseJson(body.images, []);
  let images;
  if (order === undefined) {
    images = [...current, ...uploads];
  } else {
    if (!Array.isArray(order)) throw new ValidationError("Images must be a list.");
    images = order.map((entry) => {
      const ref = /^new:(\d+)$/.exec(String(entry));
      if (ref) {
        const uploaded = uploads[Number(ref[1])];
        if (!uploaded) throw new ValidationError("A photo failed to upload, please add it again.");
        return uploaded;
      }
      if (!current.includes(entry)) throw new ValidationError("One of the photos no longer exists. Reload and try again.");
      return entry;
    });
    images = [...new Set(images)];
  }
  if (images.length > MAX_PRODUCT_IMAGES) {
    throw new ValidationError(`A product can have at most ${MAX_PRODUCT_IMAGES} photos.`);
  }
  return images;
};

const removeUnused = (paths, keep) => Promise.all(paths.filter((p) => !keep.includes(p)).map(removeUpload));

const createProduct = async (req, res) => {
  const uploads = uploadedPaths(req);
  try {
    const shop = await requireOwnShop(req);
    const values = readProductBody(req.body);
    if (!values.name) throw new ValidationError("Product name is required.");
    if (values.price === undefined || values.price === null) throw new ValidationError("Price is required.");
    checkCategory(shop, values.category);

    const images = resolveImages(req.body, uploads, []);
    const product = await ShopProduct.create({ ...values, shop_id: shop.id, images, image_url: images[0] ?? null });
    await removeUnused(uploads, images);
    audit(req, "create_shop_product", { shop_id: shop.id, product_id: product.id, name: product.name, images: images.length });
    return res.status(201).json({ success: true, data: product });
  } catch (error) {
    await Promise.all(uploads.map(removeUpload));
    return sendError(res, error);
  }
};

const updateProduct = async (req, res) => {
  const uploads = uploadedPaths(req);
  try {
    const shop = await requireOwnShop(req);
    const product = await ShopProduct.findOne({ where: { id: req.params.productId, shop_id: shop.id } });
    if (!product) {
      await Promise.all(uploads.map(removeUpload));
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const values = readProductBody(req.body);
    if ("name" in values && !values.name) throw new ValidationError("Product name can't be empty.");
    if ("price" in values && values.price === null) throw new ValidationError("Price is required.");
    if ("category" in values) checkCategory(shop, values.category);

    const previous = productImages(product);
    values.images = resolveImages(req.body, uploads, previous);
    values.image_url = values.images[0] ?? null;

    await product.update(values);
    await removeUnused([...previous, ...uploads], values.images);
    audit(req, "update_shop_product", { shop_id: shop.id, product_id: product.id, name: product.name, images: values.images.length });
    return res.status(200).json({ success: true, data: product });
  } catch (error) {
    await Promise.all(uploads.map(removeUpload));
    return sendError(res, error);
  }
};

const deleteProduct = async (req, res) => {
  try {
    const shop = await requireOwnShop(req);
    const product = await ShopProduct.findOne({ where: { id: req.params.productId, shop_id: shop.id } });
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });

    await product.destroy();
    await Promise.all(productImages(product).map(removeUpload));
    audit(req, "delete_shop_product", { shop_id: shop.id, product_id: product.id, name: product.name });
    return res.status(200).json({ success: true, message: "Product deleted" });
  } catch (error) {
    return sendError(res, error);
  }
};

module.exports = {
  getMyShop,
  saveMyShop,
  deleteMyShop,
  listShops,
  getShopById,
  listMyProducts,
  getMyProduct,
  createProduct,
  updateProduct,
  deleteProduct,
};
