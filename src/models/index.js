const { sequelize } = require("../config/database");

const User = require("./adminUser")(sequelize);
const AuditLog = require("./auditTrail")(sequelize);
const MenuItem = require("./menuItem")(sequelize);
const Order = require("./order")(sequelize);
const OrderItem = require("./orderItem")(sequelize);
const OrderStatusEvent = require("./orderStatusEvent")(sequelize);
const Notification = require("./notification")(sequelize);
const UserAddress = require("./userAddress")(sequelize);

const models = {
  User,
  AuditLog,
  MenuItem,
  Order,
  OrderItem,
  OrderStatusEvent,
  Notification,
  UserAddress,
};

// Initialize models in correct order (parent tables first)
const initializeModels = async () => {
  try {
    console.log("🔄 Creating/updating tables...");

    // Use alter: false to prevent schema conflicts in production
    console.log("📋 Syncing tables...");

    await User.sync({ force: false, alter: false });
    await AuditLog.sync({ force: false, alter: false });
    await MenuItem.sync({ force: false, alter: false });
    await Order.sync({ force: false, alter: false });
    await OrderItem.sync({ force: false, alter: false });
    await OrderStatusEvent.sync({ force: false, alter: false });
    await Notification.sync({ force: false, alter: false });
    await UserAddress.sync({ force: false, alter: false });

    console.log("✅ All models synced successfully");
  } catch (error) {
    console.error("❌ Error syncing models:", error);
    console.error("❌ Error details:", {
      name: error.name,
      message: error.message,
      parent: error.parent?.message,
      original: error.original?.message,
      sql: error.sql,
    });
    throw error;
  }
};

const setupAssociations = () => {
  try {
    models.User.hasMany(models.User, { as: "Staff", foreignKey: "created_by" });
    models.User.belongsTo(models.User, {
      as: "Owner",
      foreignKey: "created_by",
    });
    models.User.hasMany(models.AuditLog, { foreignKey: "user_id" });
    models.AuditLog.belongsTo(models.User, { foreignKey: "user_id" });
    models.User.hasMany(models.MenuItem, {
      foreignKey: "created_by",
      as: "createdMenuItems",
    });
    models.MenuItem.belongsTo(models.User, {
      foreignKey: "created_by",
      as: "creator",
    });
    models.User.hasMany(models.Order, {
      as: "customer_orders",
      foreignKey: "customer_id",
    });
    models.User.hasMany(models.Order, {
      as: "rider_orders",
      foreignKey: "rider_id",
    });
    models.Order.belongsTo(models.User, {
      as: "customer",
      foreignKey: "customer_id",
    });
    models.Order.belongsTo(models.User, { as: "rider", foreignKey: "rider_id" });
    models.Order.hasMany(models.OrderItem, {
      as: "items",
      foreignKey: "order_id",
    });
    models.OrderItem.belongsTo(models.Order, { foreignKey: "order_id" });
    models.OrderItem.belongsTo(models.MenuItem, {
      foreignKey: "menu_item_id",
      as: "menu_item",
    });
    models.MenuItem.hasMany(models.OrderItem, {
      as: "order_items",
      foreignKey: "menu_item_id",
    });
    models.Order.hasMany(models.OrderStatusEvent, {
      as: "status_events",
      foreignKey: "order_id",
    });
    models.OrderStatusEvent.belongsTo(models.Order, { foreignKey: "order_id" });
    models.User.hasMany(models.OrderStatusEvent, {
      as: "status_changes",
      foreignKey: "changed_by",
    });
    models.OrderStatusEvent.belongsTo(models.User, {
      as: "changed_by_user",
      foreignKey: "changed_by",
    });
    models.User.hasMany(models.Notification, {
      as: "notifications",
      foreignKey: "user_id",
    });
    models.Notification.belongsTo(models.User, { foreignKey: "user_id" });
    models.Order.hasMany(models.Notification, {
      as: "notifications",
      foreignKey: "order_id",
    });
    models.Notification.belongsTo(models.Order, { foreignKey: "order_id" });
    models.User.hasMany(models.UserAddress, {
      as: "addresses",
      foreignKey: "user_id",
    });
    models.UserAddress.belongsTo(models.User, { foreignKey: "user_id" });

    console.log("✅ All associations set up successfully");
  } catch (error) {
    console.error("❌ Error during setupAssociations:", error);
  }
};

module.exports = { ...models, initializeModels, setupAssociations, sequelize };
