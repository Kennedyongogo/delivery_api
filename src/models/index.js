const { sequelize } = require("../config/database");

const User = require("./adminUser")(sequelize);
const AuditLog = require("./auditTrail")(sequelize);
const MenuItem = require("./menuItem")(sequelize);

const models = { User, AuditLog, MenuItem };

// Initialize models in correct order (parent tables first)
const initializeModels = async () => {
  try {
    console.log("🔄 Creating/updating tables...");

    // Use alter: false to prevent schema conflicts in production
    console.log("📋 Syncing tables...");

    await User.sync({ force: false, alter: false });
    await AuditLog.sync({ force: false, alter: false });
    await MenuItem.sync({ force: false, alter: false });

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

    console.log("✅ All associations set up successfully");
  } catch (error) {
    console.error("❌ Error during setupAssociations:", error);
  }
};

module.exports = { ...models, initializeModels, setupAssociations, sequelize };
