const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");

const User = require("./users")(sequelize);
const AuditLog = require("./auditTrail")(sequelize);
const MenuItem = require("./menuItem")(sequelize);
const Order = require("./order")(sequelize);
const OrderItem = require("./orderItem")(sequelize);
const OrderStatusEvent = require("./orderStatusEvent")(sequelize);
const Notification = require("./notification")(sequelize);
const UserAddress = require("./userAddress")(sequelize);
const Shop = require("./shop")(sequelize);
const ShopProduct = require("./shopProduct")(sequelize);

const models = {
  User,
  AuditLog,
  MenuItem,
  Order,
  OrderItem,
  OrderStatusEvent,
  Notification,
  UserAddress,
  Shop,
  ShopProduct,
};

// sync({ alter: false }) never changes an existing Postgres enum type, so values added to a
// model's ENUM later would be rejected by the database until they are added here.
const syncEnumValues = async (model) => {
  for (const [name, attribute] of Object.entries(model.rawAttributes)) {
    if (!(attribute.type instanceof DataTypes.ENUM)) continue;
    const typeName = `enum_${model.getTableName()}_${attribute.field || name}`;
    const [rows] = await sequelize.query(`SELECT unnest(enum_range(NULL::"${typeName}"))::text AS value`);
    const existing = new Set(rows.map((row) => row.value));
    for (const value of attribute.type.values) {
      if (existing.has(value)) continue;
      await sequelize.query(`ALTER TYPE "${typeName}" ADD VALUE IF NOT EXISTS '${value.replace(/'/g, "''")}'`);
      console.log(`➕ Added "${value}" to ${typeName}`);
    }
  }
};

// shops.opening_hours started out as free text; it is now a JSONB list of structured entries.
// Old free-text values can't be parsed reliably, so they are reset and owners re-enter them.
const migrateOpeningHours = async () => {
  const [[column]] = await sequelize.query(
    "SELECT data_type FROM information_schema.columns WHERE table_name = 'shops' AND column_name = 'opening_hours'"
  );
  if (!column || column.data_type === "jsonb") return;
  await sequelize.query(`
    ALTER TABLE shops ALTER COLUMN opening_hours DROP DEFAULT;
    ALTER TABLE shops ALTER COLUMN opening_hours TYPE JSONB USING '[]'::jsonb;
    ALTER TABLE shops ALTER COLUMN opening_hours SET DEFAULT '[]'::jsonb;
    ALTER TABLE shops ALTER COLUMN opening_hours SET NOT NULL;
  `);
  console.log("🔁 Converted shops.opening_hours to JSONB");
};

// Staff and shop riders belong to their owner's shop through users.shop_id. Older databases lack the
// column; members created before it existed are linked to the shop their creator owns.
const migrateUserShop = async () => {
  await sequelize.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS shop_id UUID;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_shop_id_fkey') THEN
        ALTER TABLE users ADD CONSTRAINT users_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE SET NULL;
      END IF;
    END $$;
    CREATE INDEX IF NOT EXISTS users_shop_id ON users (shop_id);
    UPDATE users u SET shop_id = s.id
      FROM shops s
      WHERE u.shop_id IS NULL AND u.created_by = s.owner_id AND u.role IN ('staff', 'shop_rider');
  `);
};

// Products started with a single image_url; they now keep an ordered images list (image_url mirrors the cover).
const migrateProductImages = async () => {
  await sequelize.query(`
    ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb;
    UPDATE shop_products SET images = jsonb_build_array(image_url)
      WHERE image_url IS NOT NULL AND images = '[]'::jsonb;
  `);
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
    await Shop.sync({ force: false, alter: false });
    await migrateOpeningHours();
    await migrateUserShop();
    await ShopProduct.sync({ force: false, alter: false });
    await migrateProductImages();

    for (const model of Object.values(models)) {
      await syncEnumValues(model);
    }

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
    models.User.hasOne(models.Shop, { as: "shop", foreignKey: "owner_id" });
    models.Shop.belongsTo(models.User, { as: "owner", foreignKey: "owner_id" });
    models.Shop.hasMany(models.ShopProduct, { as: "products", foreignKey: "shop_id", onDelete: "CASCADE" });
    models.ShopProduct.belongsTo(models.Shop, { as: "shop", foreignKey: "shop_id" });
    models.Shop.hasMany(models.User, { as: "members", foreignKey: "shop_id", constraints: false });
    models.User.belongsTo(models.Shop, { as: "workplace", foreignKey: "shop_id", constraints: false });

    console.log("✅ All associations set up successfully");
  } catch (error) {
    console.error("❌ Error during setupAssociations:", error);
  }
};

module.exports = { ...models, initializeModels, setupAssociations, sequelize };
