const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const OrderItem = sequelize.define(
    "OrderItem",
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
      menu_item_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "menu_items",
          key: "id",
        },
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        validate: {
          min: 1,
        },
      },
      unit_price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      subtotal: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      special_instructions: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "order_items",
      timestamps: true,
    }
  );

  OrderItem.beforeCreate((orderItem) => {
    const qty = Number(orderItem.quantity || 0);
    const unitPrice = Number(orderItem.unit_price || 0);
    orderItem.subtotal = (qty * unitPrice).toFixed(2);
  });

  OrderItem.beforeUpdate((orderItem) => {
    if (orderItem.changed("quantity") || orderItem.changed("unit_price")) {
      const qty = Number(orderItem.quantity || 0);
      const unitPrice = Number(orderItem.unit_price || 0);
      orderItem.subtotal = (qty * unitPrice).toFixed(2);
    }
  });

  return OrderItem;
};
