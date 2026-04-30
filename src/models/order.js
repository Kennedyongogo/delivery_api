const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const buildOrderNumber = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(
      Math.random() * 90 + 10
    )}`;
    return `ORD-${year}${month}${day}-${suffix}`;
  };

  const Order = sequelize.define(
    "Order",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      order_number: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      customer_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
      },
      rider_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: "users",
          key: "id",
        },
      },
      status: {
        type: DataTypes.ENUM(
          "pending",
          "confirmed",
          "preparing",
          "ready_for_pickup",
          "picked_up",
          "delivered",
          "cancelled"
        ),
        defaultValue: "pending",
      },
      subtotal: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      delivery_fee: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0.0,
      },
      total: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      delivery_address: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      delivery_latitude: {
        type: DataTypes.DECIMAL(10, 8),
        allowNull: true,
      },
      delivery_longitude: {
        type: DataTypes.DECIMAL(11, 8),
        allowNull: true,
      },
      payment_method: {
        type: DataTypes.ENUM("cash", "card", "mpesa"),
        defaultValue: "cash",
      },
      payment_status: {
        type: DataTypes.ENUM("pending", "paid", "failed"),
        defaultValue: "pending",
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      estimated_delivery_time: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      actual_delivery_time: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      cancelled_by: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: "users",
          key: "id",
        },
      },
      cancel_reason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "orders",
      timestamps: true,
    }
  );

  // Set required order number before Sequelize not-null validation runs.
  Order.beforeValidate((order) => {
    if (!order.order_number) {
      order.order_number = buildOrderNumber();
    }
  });

  Order.beforeCreate((order) => {
    if (!order.order_number) {
      order.order_number = buildOrderNumber();
    }
  });

  return Order;
};
