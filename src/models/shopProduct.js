const { DataTypes } = require("sequelize");
const { SHOP_CATEGORIES, MAX_PRODUCT_IMAGES } = require("../utils/shopCategories");

module.exports = (sequelize) => {
  const ShopProduct = sequelize.define(
    "ShopProduct",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      shop_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "shops",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      category: {
        type: DataTypes.ENUM(...SHOP_CATEGORIES),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: { min: 0 },
      },
      // What one `price` buys, e.g. "20 L", "13 kg", "1 plate".
      unit: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },
      // Null means stock isn't tracked for this product.
      stock_quantity: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 0 },
      },
      // Upload paths in display order; the first is the cover.
      images: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
        validate: {
          isPathList(value) {
            if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) {
              throw new Error("Images must be a list of file paths.");
            }
            if (value.length > MAX_PRODUCT_IMAGES) {
              throw new Error(`A product can have at most ${MAX_PRODUCT_IMAGES} photos.`);
            }
          },
        },
      },
      // Mirrors images[0] so clients that only show one photo keep working.
      image_url: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      is_available: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
    },
    {
      tableName: "shop_products",
      timestamps: true,
      indexes: [{ fields: ["shop_id", "category"] }],
    }
  );

  return ShopProduct;
};
