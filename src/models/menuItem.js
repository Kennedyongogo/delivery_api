const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const MenuItem = sequelize.define(
    "MenuItem",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      image_url: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      category: {
        type: DataTypes.ENUM(
          "Burgers",
          "Pizza",
          "Chicken",
          "Drinks",
          "Desserts",
          "Salads",
          "Main"
        ),
        defaultValue: "Main",
      },
      available: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      is_featured: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      preparation_time: {
        type: DataTypes.INTEGER,
        defaultValue: 15,
      },
      calories: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      created_by: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: "users",
          key: "id",
        },
      },
    },
    {
      tableName: "menu_items",
      timestamps: true,
    }
  );

  return MenuItem;
};
