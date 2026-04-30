const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const OrderStatusEvent = sequelize.define(
    "OrderStatusEvent",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      order_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "orders",
          key: "id",
        },
      },
      changed_by: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
      },
      old_status: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      new_status: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      note: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "order_status_events",
      timestamps: true,
    }
  );

  return OrderStatusEvent;
};
