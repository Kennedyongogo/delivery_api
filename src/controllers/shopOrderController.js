const { Op } = require("sequelize");
const { sequelize, Order, OrderItem, OrderStatusEvent, Notification, Shop, ShopProduct, User, AuditLog } = require("../models");
const { ROLES } = require("../utils/roles");
const { findShopFor } = require("./shopController");

const MAX_LINES = 30;
const MAX_QTY = 20;
const MAX_ADDRESS = 300;
const MAX_PLACE = 200;
const MAX_NOTE = 500;
// Customers can take an order back until the shop starts preparing it.
const CANCELLABLE = ["pending", "confirmed"];

const ORDER_SHOP_ATTRIBUTES = ["id", "name", "logo_url", "phone", "whatsapp", "address", "latitude", "longitude", "opening_hours"];
const ITEM_ATTRIBUTES = ["id", "product_id", "name", "unit", "image", "quantity", "unit_price", "subtotal"];

const customerOrderInclude = [
  { model: OrderItem, as: "items", attributes: ITEM_ATTRIBUTES },
  { model: Shop, as: "shop", attributes: ORDER_SHOP_ATTRIBUTES },
  { model: User, as: "rider", attributes: ["id", "full_name", "phone"] },
];

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value));

class ValidationError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const sendError = (res, error) => {
  if (error instanceof ValidationError) {
    return res.status(error.status).json({ success: false, message: error.message, ...error.extra });
  }
  return res.status(500).json({ success: false, message: error.message });
};

const text = (value, max, label) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length > max) throw new ValidationError(`${label} must be ${max} characters or fewer.`);
  return trimmed;
};

const coordinate = (value, limit) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > limit) throw new ValidationError("The delivery pin isn't a valid location.");
  return parsed;
};

// Merges repeated products and checks quantities; returns [{ product_id, quantity }].
const readLines = (items) => {
  if (!Array.isArray(items) || !items.length) throw new ValidationError("Your bag is empty.");
  const merged = new Map();
  for (const item of items) {
    const quantity = Number(item?.quantity);
    if (!isUuid(item?.product_id) || !Number.isInteger(quantity) || quantity < 1) {
      throw new ValidationError("Each item needs a product and a quantity of at least 1.");
    }
    merged.set(item.product_id, (merged.get(item.product_id) ?? 0) + quantity);
  }
  if (merged.size > MAX_LINES) throw new ValidationError(`An order can have at most ${MAX_LINES} different items.`);
  return [...merged].map(([product_id, quantity]) => ({ product_id, quantity: Math.min(quantity, MAX_QTY) }));
};

const notifyShop = async (shop, order, transaction) => {
  const staff = await User.findAll({
    where: { is_active: true, [Op.or]: [{ id: shop.owner_id }, { shop_id: shop.id, role: ROLES.STAFF }] },
    attributes: ["id"],
    transaction,
  });
  if (!staff.length) return;
  await Notification.bulkCreate(
    staff.map((user) => ({
      user_id: user.id,
      order_id: order.id,
      title: "New order",
      message: `Order ${order.order_number} · ${Number(order.total).toLocaleString("en-KE")} KES is waiting for you to accept it.`,
      type: "order_update",
    })),
    { transaction }
  );
};

/* ---------- Customers ---------- */

const placeShopOrder = async (req, res) => {
  try {
    const body = req.body ?? {};
    if (!isUuid(body.shop_id)) throw new ValidationError("Pick a shop to order from.");
    const lines = readLines(body.items);
    const address = text(body.delivery_address, MAX_ADDRESS, "The house or landmark");
    const place = text(body.delivery_place, MAX_PLACE, "The pin name");
    const notes = text(body.notes, MAX_NOTE, "The note");
    const latitude = coordinate(body.delivery_latitude, 90);
    const longitude = coordinate(body.delivery_longitude, 180);
    if ((latitude === null) !== (longitude === null)) throw new ValidationError("The delivery pin isn't a valid location.");
    if (!address && !place) throw new ValidationError("Pin your spot on the map or add your house and landmark.");

    const shop = await Shop.findOne({ where: { id: body.shop_id, is_active: true } });
    if (!shop) throw new ValidationError("This shop isn't taking orders on Kabi right now.", 404);

    const products = await ShopProduct.findAll({
      where: { id: lines.map((line) => line.product_id), shop_id: shop.id, is_available: true },
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    const unavailable = lines.filter((line) => !byId.has(line.product_id)).map((line) => line.product_id);
    if (unavailable.length) {
      throw new ValidationError(
        unavailable.length === lines.length
          ? "Nothing in your bag is available any more."
          : "Some items in your bag are no longer available. We've taken them out.",
        409,
        { unavailable }
      );
    }

    const items = lines.map(({ product_id, quantity }) => {
      const product = byId.get(product_id);
      const unitPrice = Number(product.price);
      return {
        product_id,
        quantity,
        name: product.name,
        unit: product.unit,
        image: product.images?.[0] ?? product.image_url ?? null,
        unit_price: unitPrice.toFixed(2),
        subtotal: (unitPrice * quantity).toFixed(2),
      };
    });
    const subtotal = items.reduce((sum, item) => sum + Number(item.subtotal), 0);

    const orderId = await sequelize.transaction(async (transaction) => {
      const order = await Order.create(
        {
          customer_id: req.user.id,
          shop_id: shop.id,
          subtotal: subtotal.toFixed(2),
          delivery_fee: "0.00",
          total: subtotal.toFixed(2),
          delivery_address: address || place,
          delivery_place: place || null,
          delivery_latitude: latitude,
          delivery_longitude: longitude,
          payment_method: "cash",
          notes: notes || null,
          status: "pending",
        },
        { transaction }
      );
      await OrderItem.bulkCreate(
        items.map((item) => ({ ...item, order_id: order.id })),
        { transaction }
      );
      await OrderStatusEvent.create(
        { order_id: order.id, changed_by: req.user.id, old_status: null, new_status: "pending", note: "Order placed" },
        { transaction }
      );
      await notifyShop(shop, order, transaction);
      return order.id;
    });

    AuditLog.create({
      user_id: req.user.id,
      action: "create_order",
      details: { order_id: orderId, shop_id: shop.id, total: subtotal },
      ip_address: req.ip,
    }).catch(() => {});

    const order = await Order.findByPk(orderId, { include: customerOrderInclude });
    return res.status(201).json({ success: true, data: order, message: "Order placed" });
  } catch (error) {
    return sendError(res, error);
  }
};

const listMyOrders = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const { count, rows } = await Order.findAndCountAll({
      where: { customer_id: req.user.id, shop_id: { [Op.ne]: null } },
      include: customerOrderInclude,
      order: [["createdAt", "DESC"]],
      limit,
      offset: (page - 1) * limit,
      distinct: true,
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

const findMyOrder = async (req) => {
  if (!isUuid(req.params.id)) return null;
  return Order.findOne({ where: { id: req.params.id, customer_id: req.user.id }, include: customerOrderInclude });
};

const orderWithEvents = async (order) => {
  const events = await OrderStatusEvent.findAll({
    where: { order_id: order.id },
    attributes: ["id", "old_status", "new_status", "note", "createdAt"],
    order: [["createdAt", "ASC"]],
  });
  return { ...order.toJSON(), events };
};

const getMyOrder = async (req, res) => {
  try {
    const order = await findMyOrder(req);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    return res.status(200).json({ success: true, data: await orderWithEvents(order) });
  } catch (error) {
    return sendError(res, error);
  }
};

const cancelMyOrder = async (req, res) => {
  try {
    const order = await findMyOrder(req);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (!CANCELLABLE.includes(order.status)) {
      throw new ValidationError("The shop has already started on this order, so it can't be cancelled here. Call the shop instead.");
    }
    const reason = text(req.body?.reason, MAX_NOTE, "The reason");
    const oldStatus = order.status;
    await order.update({ status: "cancelled", cancelled_by: req.user.id, cancel_reason: reason || "Cancelled by the customer" });
    await OrderStatusEvent.create({
      order_id: order.id,
      changed_by: req.user.id,
      old_status: oldStatus,
      new_status: "cancelled",
      note: reason || "Cancelled by the customer",
    });
    if (order.shop) {
      const shop = await Shop.findByPk(order.shop_id, { attributes: ["id", "owner_id"] });
      if (shop) {
        await Notification.create({
          user_id: shop.owner_id,
          order_id: order.id,
          title: "Order cancelled",
          message: `The customer cancelled order ${order.order_number}.`,
          type: "order_update",
        });
      }
    }
    return res.status(200).json({ success: true, data: await orderWithEvents(await findMyOrder(req)), message: "Order cancelled" });
  } catch (error) {
    return sendError(res, error);
  }
};

/* ---------- Shop desk ---------- */

const listShopRiders = async (req, res) => {
  try {
    const shop = await findShopFor(req.user);
    if (!shop) return res.status(200).json({ success: true, data: [] });
    const riders = await User.findAll({
      where: { shop_id: shop.id, role: ROLES.SHOP_RIDER, is_active: true },
      attributes: ["id", "full_name", "phone"],
      order: [["full_name", "ASC"]],
    });
    return res.status(200).json({ success: true, data: riders });
  } catch (error) {
    return sendError(res, error);
  }
};

module.exports = { placeShopOrder, listMyOrders, getMyOrder, cancelMyOrder, listShopRiders };
