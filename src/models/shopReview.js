const { DataTypes } = require("sequelize");

// Public reviews are published as posted, with no approval step.
module.exports = (sequelize) => {
  const ShopReview = sequelize.define(
    "ShopReview",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      shop_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "shops", key: "id" },
        onDelete: "CASCADE",
      },
      // Set when the reviewer was signed in, even if they chose to post anonymously. Never sent to clients.
      user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      is_anonymous: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      // The reviewer's name at the time of posting; null for anonymous reviews.
      author_name: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      rating: {
        type: DataTypes.SMALLINT,
        allowNull: false,
        validate: { min: 1, max: 5, isInt: true },
      },
      comment: {
        type: DataTypes.TEXT,
        allowNull: true,
        validate: { len: [0, 2000] },
      },
      // The shop owner's public reply; one per review, editable.
      owner_reply: {
        type: DataTypes.TEXT,
        allowNull: true,
        validate: { len: [0, 1000] },
      },
      owner_reply_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "shop_reviews",
      timestamps: true,
      indexes: [{ fields: ["shop_id", "createdAt"] }, { fields: ["user_id"] }],
    }
  );

  return ShopReview;
};
