const { DataTypes } = require("sequelize");
const { SHOP_CATEGORIES, normalizeOpeningHours } = require("../utils/shopCategories");

module.exports = (sequelize) => {
  const Shop = sequelize.define(
    "Shop",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      // One shop per shop owner; staff and shop riders reach it through their `users.created_by`.
      owner_id: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
        references: {
          model: "users",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      logo_url: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      categories: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        allowNull: false,
        defaultValue: [],
        validate: {
          validCategories(value) {
            if (!Array.isArray(value) || value.length === 0) {
              throw new Error("Pick at least one of: water, gas, fastfood");
            }
            const invalid = value.filter((category) => !SHOP_CATEGORIES.includes(category));
            if (invalid.length) throw new Error(`Unknown categories: ${invalid.join(", ")}`);
          },
        },
      },
      services: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        allowNull: false,
        defaultValue: [],
      },
      phone: {
        type: DataTypes.STRING(30),
        allowNull: false,
      },
      alt_phone: {
        type: DataTypes.STRING(30),
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: { isEmail: true },
      },
      whatsapp: {
        type: DataTypes.STRING(30),
        allowNull: true,
      },
      website: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Keys are from SOCIAL_PLATFORMS; values are handles or profile URLs as the owner typed them.
      social_links: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      address: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      latitude: {
        type: DataTypes.DECIMAL(10, 8),
        allowNull: true,
        validate: { min: -90, max: 90 },
      },
      longitude: {
        type: DataTypes.DECIMAL(11, 8),
        allowNull: true,
        validate: { min: -180, max: 180 },
      },
      // [{ days: ["mon", …], open: "09:00", close: "21:00" } | { days, all_day: true }]; see normalizeOpeningHours.
      opening_hours: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
        validate: {
          validHours(value) {
            normalizeOpeningHours(value);
          },
        },
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
    },
    {
      tableName: "shops",
      timestamps: true,
    }
  );

  return Shop;
};
