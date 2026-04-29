const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const AuditLog = sequelize.define(
    "AuditLog",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
      },
      action: {
        type: DataTypes.ENUM(
          "create_order",
          "update_order",
          "cancel_order",
          "accept_order",
          "mark_ready",
          "assign_rider",
          "update_menu",
          "delete_menu",
          "create_menu_item",
          "update_menu_item",
          "delete_menu_item",
          "toggle_menu_availability",
          "create_staff",
          "delete_staff",
          "owner_setup"
        ),
        allowNull: false,
      },
      details: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      ip_address: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      tableName: "audit_logs",
      timestamps: true,
    }
  );

  return AuditLog;
};
