const {
  Order,
  OrderItem,
  MenuItem,
  User,
  AuditLog,
  OrderStatusEvent,
  Notification,
  Shop,
} = require("../models");
const { ROLES, RIDER_ROLES, ADMIN_ROLES, isRider } = require("../utils/roles");
const { findShopFor } = require("./shopController");

const ORDER_INCLUDE = [
  {
    model: OrderItem,
    as: "items",
    include: [{ model: MenuItem, as: "menu_item" }],
  },
  { model: Shop, as: "shop", attributes: ["id", "name", "logo_url", "phone", "address", "latitude", "longitude"] },
];

// Shop owners and staff only see and act on their own shop's orders.
const shopAllows = async (user, order) => {
  if (!ADMIN_ROLES.includes(user.role)) return true;
  if (!order.shop_id) return true;
  const shop = await findShopFor(user);
  return Boolean(shop) && shop.id === order.shop_id;
};

const notifyRiders = async (order, title, message) => {
  const where = order.shop_id
    ? { shop_id: order.shop_id, role: ROLES.SHOP_RIDER, is_active: true }
    : { role: RIDER_ROLES, is_active: true };
  const riders = order.rider_id ? [{ id: order.rider_id }] : await User.findAll({ where, attributes: ["id"] });
  return riders.map((rider) => ({ user_id: rider.id, order_id: order.id, title, message, type: "delivery" }));
};

const createNotificationsForStatusChange = async ({
  order,
  oldStatus,
  newStatus,
}) => {
  const notifications = [];
  const orderLabel = order.order_number || order.id;

  if (newStatus === "confirmed") {
    notifications.push({
      user_id: order.customer_id,
      order_id: order.id,
      title: "Order Confirmed",
      message: `Your order ${orderLabel} was confirmed.`,
      type: "order_update",
    });
  }
  if (newStatus === "preparing") {
    notifications.push({
      user_id: order.customer_id,
      order_id: order.id,
      title: "Kitchen Preparing",
      message: `Your order ${orderLabel} is being prepared.`,
      type: "order_update",
    });
  }
  if (newStatus === "ready_for_pickup") {
    notifications.push({
      user_id: order.customer_id,
      order_id: order.id,
      title: "Order Ready",
      message: `Your order ${orderLabel} is packed and waiting for a rider.`,
      type: "order_update",
    });
    notifications.push(...(await notifyRiders(order, "New Delivery Available", `Order ${orderLabel} is ready for pickup.`)));
  }
  if (newStatus === "picked_up") {
    notifications.push({
      user_id: order.customer_id,
      order_id: order.id,
      title: "Rider On The Way",
      message: `Order ${orderLabel} was picked up and is on the way.`,
      type: "delivery",
    });
  }
  if (newStatus === "delivered") {
    notifications.push({
      user_id: order.customer_id,
      order_id: order.id,
      title: "Delivered",
      message: `Your order ${orderLabel} has been delivered. Enjoy!`,
      type: "delivery",
    });
  }
  if (newStatus === "cancelled") {
    notifications.push({
      user_id: order.customer_id,
      order_id: order.id,
      title: "Order Cancelled",
      message: `Your order ${orderLabel} was cancelled.`,
      type: "order_update",
      metadata: { oldStatus, newStatus },
    });
  }

  if (notifications.length > 0) {
    await Notification.bulkCreate(notifications);
  }
};

const toNullableNumber = (value) => {
  if (value === null || value === undefined || value == "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getOrders = async (req, res) => {
  try {
    const { status, limit = 50, page = 1 } = req.query;
    const limitNum = Number.parseInt(limit, 10) || 50;
    const pageNum = Number.parseInt(page, 10) || 1;
    const offset = (pageNum - 1) * limitNum;

    const whereClause = {};
    if (status) whereClause.status = status;
    if (req.user.role === ROLES.CUSTOMER) whereClause.customer_id = req.user.id;
    if (isRider(req.user.role)) whereClause.rider_id = req.user.id;
    if (ADMIN_ROLES.includes(req.user.role)) {
      const shop = await findShopFor(req.user);
      if (!shop) {
        return res.status(200).json({
          success: true,
          data: [],
          pagination: { total: 0, page: pageNum, limit: limitNum, totalPages: 0 },
        });
      }
      whereClause.shop_id = shop.id;
    }

    const { count, rows } = await Order.findAndCountAll({
      where: whereClause,
      include: [
        ...ORDER_INCLUDE,
        { model: User, as: "customer", attributes: ["id", "full_name", "phone"] },
        { model: User, as: "rider", attributes: ["id", "full_name", "phone"] },
      ],
      order: [["createdAt", "DESC"]],
      limit: limitNum,
      offset,
      distinct: true,
    });

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        total: count,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(count / limitNum),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getOrderById = async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id, {
      include: [
        ...ORDER_INCLUDE,
        {
          model: User,
          as: "customer",
          attributes: ["id", "full_name", "phone", "email"],
        },
        { model: User, as: "rider", attributes: ["id", "full_name", "phone"] },
      ],
    });

    if (!order || !(await shopAllows(req.user, order))) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (req.user.role === ROLES.CUSTOMER && order.customer_id !== req.user.id) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    if (isRider(req.user.role) && order.rider_id !== req.user.id) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    return res.status(200).json({ success: true, data: order });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const createOrder = async (req, res) => {
  try {
    const {
      items,
      delivery_address,
      delivery_latitude,
      delivery_longitude,
      payment_method,
      notes,
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Order must have items" });
    }
    if (!delivery_address) {
      return res
        .status(400)
        .json({ success: false, message: "Delivery address is required" });
    }

    let subtotal = 0;
    const orderItems = [];
    for (const item of items) {
      const quantity = Number.parseInt(item.quantity, 10);
      if (!item.menu_item_id || Number.isNaN(quantity) || quantity < 1) {
        return res.status(400).json({
          success: false,
          message: "Each order item requires menu_item_id and valid quantity",
        });
      }
      const menuItem = await MenuItem.findByPk(item.menu_item_id);
      if (!menuItem) {
        return res.status(404).json({
          success: false,
          message: `Item ${item.menu_item_id} not found`,
        });
      }
      if (!menuItem.available) {
        return res.status(400).json({
          success: false,
          message: `${menuItem.name} is not available`,
        });
      }

      const unitPrice = Number(menuItem.price);
      const itemSubtotal = unitPrice * quantity;
      subtotal += itemSubtotal;
      orderItems.push({
        menu_item_id: item.menu_item_id,
        quantity,
        unit_price: unitPrice.toFixed(2),
        subtotal: itemSubtotal.toFixed(2),
        special_instructions: item.special_instructions || null,
      });
    }

    const deliveryFee = 2.5;
    const total = subtotal + deliveryFee;
    const order = await Order.create({
      customer_id: req.user.id,
      subtotal: subtotal.toFixed(2),
      delivery_fee: deliveryFee.toFixed(2),
      total: total.toFixed(2),
      delivery_address,
      delivery_latitude: delivery_latitude || null,
      delivery_longitude: delivery_longitude || null,
      payment_method: payment_method || "cash",
      notes: notes || null,
      status: "pending",
    });

    for (const item of orderItems) {
      await OrderItem.create({
        order_id: order.id,
        ...item,
      });
    }

    await AuditLog.create({
      user_id: req.user.id,
      action: "create_order",
      details: { order_id: order.id, total: order.total },
      ip_address: req.ip,
    });

    const fullOrder = await Order.findByPk(order.id, {
      include: [
        {
          model: OrderItem,
          as: "items",
          include: [{ model: MenuItem, as: "menu_item" }],
        },
      ],
    });

    await OrderStatusEvent.create({
      order_id: order.id,
      changed_by: req.user.id,
      old_status: null,
      new_status: "pending",
      note: "Order placed",
    });

    return res.status(201).json({
      success: true,
      data: fullOrder,
      message: "Order created successfully",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const updateOrderStatus = async (req, res) => {
  try {
    const { status, cancel_reason } = req.body;
    const order = await Order.findByPk(req.params.id);
    if (!order || !(await shopAllows(req.user, order))) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (!status) {
      return res.status(400).json({ success: false, message: "Status is required" });
    }

    const validTransitions = {
      pending: ["confirmed", "cancelled"],
      confirmed: ["preparing", "cancelled"],
      preparing: ["ready_for_pickup", "cancelled"],
      ready_for_pickup: ["picked_up", "cancelled"],
      picked_up: ["delivered", "cancelled"],
      delivered: [],
      cancelled: [],
    };
    if (!validTransitions[order.status].includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status transition from ${order.status} to ${status}`,
      });
    }

    if (["confirmed", "preparing", "ready_for_pickup"].includes(status)) {
      if (!ADMIN_ROLES.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: "Only shop owner/staff can update to this status",
        });
      }
    }

    // Until riders have their own app, the shop desk can mark its own deliveries on the way and delivered.
    const shopDesk = Boolean(order.shop_id) && ADMIN_ROLES.includes(req.user.role);
    if (["picked_up", "delivered"].includes(status) && !shopDesk) {
      if (!isRider(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: "Only rider can update to this status",
        });
      }
      if (!order.rider_id) {
        return res.status(403).json({
          success: false,
          message: "Order must be assigned by shop owner before rider actions",
        });
      }
      if (order.rider_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: "Only assigned rider can update this order",
        });
      }
    }

    if (status === "cancelled" && req.user.role === ROLES.CUSTOMER) {
      if (order.customer_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: "Customers can only cancel their own orders",
        });
      }
      const cancellable = order.shop_id ? ["pending", "confirmed"] : ["pending", "confirmed", "preparing"];
      if (!cancellable.includes(order.status)) {
        return res.status(400).json({
          success: false,
          message: "Order can no longer be cancelled",
        });
      }
    }

    const oldStatus = order.status;
    if (status === "cancelled") {
      await order.update({
        status,
        cancelled_by: req.user.id,
        cancel_reason: cancel_reason || null,
      });
    } else if (status === "delivered") {
      await order.update({
        status,
        actual_delivery_time: new Date(),
      });
    } else {
      await order.update({ status });
    }

    await AuditLog.create({
      user_id: req.user.id,
      action: "update_order",
      details: {
        order_id: order.id,
        old_status: oldStatus,
        new_status: status,
      },
      ip_address: req.ip,
    });
    await OrderStatusEvent.create({
      order_id: order.id,
      changed_by: req.user.id,
      old_status: oldStatus,
      new_status: status,
      note: cancel_reason || null,
    });
    await createNotificationsForStatusChange({
      order,
      oldStatus,
      newStatus: status,
    });

    return res.status(200).json({
      success: true,
      data: order,
      message: `Order status updated to ${status}`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getOrderTimeline = async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id);
    if (!order || !(await shopAllows(req.user, order))) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (req.user.role === ROLES.CUSTOMER && order.customer_id !== req.user.id) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    if (isRider(req.user.role) && order.rider_id !== req.user.id) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const events = await OrderStatusEvent.findAll({
      where: { order_id: order.id },
      include: [
        {
          model: User,
          as: "changed_by_user",
          attributes: ["id", "full_name", "role"],
        },
      ],
      order: [["createdAt", "ASC"]],
    });
    return res.status(200).json({ success: true, data: events });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const assignRider = async (req, res) => {
  try {
    const { rider_id } = req.body;
    const order = await Order.findByPk(req.params.id);
    if (!order || !(await shopAllows(req.user, order))) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (["delivered", "cancelled"].includes(order.status)) {
      return res.status(400).json({ success: false, message: `This order is already ${order.status}.` });
    }

    const rider = await User.findByPk(rider_id);
    if (!rider || !rider.is_active || !isRider(rider.role)) {
      return res.status(400).json({ success: false, message: "Invalid rider" });
    }
    if (order.shop_id && (rider.role !== ROLES.SHOP_RIDER || rider.shop_id !== order.shop_id)) {
      return res.status(400).json({ success: false, message: "Pick one of your shop's riders." });
    }

    await order.update({ rider_id });
    await AuditLog.create({
      user_id: req.user.id,
      action: "assign_rider",
      details: { order_id: order.id, rider_id },
      ip_address: req.ip,
    });
    await OrderStatusEvent.create({
      order_id: order.id,
      changed_by: req.user.id,
      old_status: order.status,
      new_status: order.status,
      note: `Rider assigned: ${rider.full_name}`,
    });
    const label = order.order_number || order.id;
    await Notification.bulkCreate([
      {
        user_id: order.customer_id,
        order_id: order.id,
        title: "Rider Assigned",
        message: `${rider.full_name} will deliver your order ${label}.`,
        type: "delivery",
      },
      {
        user_id: rider.id,
        order_id: order.id,
        title: "New Delivery",
        message: `You have been assigned order ${label}.`,
        type: "delivery",
      },
    ]);

    return res.status(200).json({
      success: true,
      data: order,
      message: "Rider assigned successfully",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getAvailableOrders = async (req, res) => {
  try {
    // Shop riders only pick up their own shop's orders.
    const where = { status: "ready_for_pickup", rider_id: null };
    if (req.user.role === ROLES.SHOP_RIDER) where.shop_id = req.user.shop_id ?? null;
    const orders = await Order.findAll({
      where,
      include: [
        ...ORDER_INCLUDE,
        { model: User, as: "customer", attributes: ["id", "full_name", "phone"] },
      ],
      order: [["createdAt", "ASC"]],
    });

    return res.status(200).json({ success: true, data: orders });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const updateRiderLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const lat = toNullableNumber(latitude);
    const lng = toNullableNumber(longitude);

    if (lat === null || lng === null) {
      return res.status(400).json({
        success: false,
        message: "Valid latitude and longitude are required",
      });
    }

    const order = await Order.findByPk(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (!isRider(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Only rider can update location",
      });
    }

    if (!order.rider_id || order.rider_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Only assigned rider can update this order location",
      });
    }

    await order.update({
      rider_current_latitude: lat,
      rider_current_longitude: lng,
      rider_location_updated_at: new Date(),
    });

    return res.status(200).json({
      success: true,
      data: {
        order_id: order.id,
        rider_id: order.rider_id,
        rider_current_latitude: order.rider_current_latitude,
        rider_current_longitude: order.rider_current_longitude,
        rider_location_updated_at: order.rider_location_updated_at,
      },
      message: "Rider location updated",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getOrderLiveLocation = async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id, {
      include: [
        { model: User, as: "customer", attributes: ["id"] },
        { model: User, as: "rider", attributes: ["id", "full_name", "phone"] },
      ],
    });
    if (!order || !(await shopAllows(req.user, order))) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (req.user.role === ROLES.CUSTOMER && order.customer_id !== req.user.id) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    if (isRider(req.user.role) && order.rider_id !== req.user.id) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    return res.status(200).json({
      success: true,
      data: {
        order_id: order.id,
        rider_id: order.rider_id,
        delivery_latitude: order.delivery_latitude,
        delivery_longitude: order.delivery_longitude,
        rider_current_latitude: order.rider_current_latitude,
        rider_current_longitude: order.rider_current_longitude,
        rider_location_updated_at: order.rider_location_updated_at,
        rider: order.rider,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getOrders,
  getOrderById,
  createOrder,
  updateOrderStatus,
  getOrderTimeline,
  assignRider,
  getAvailableOrders,
  updateRiderLocation,
  getOrderLiveLocation,
};
