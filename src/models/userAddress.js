const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const UserAddress = sequelize.define(
    "UserAddress",
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
      label: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "Home",
      },
      address_line: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      latitude: {
        type: DataTypes.DECIMAL(10, 8),
        allowNull: true,
      },
      longitude: {
        type: DataTypes.DECIMAL(11, 8),
        allowNull: true,
      },
      is_default: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      tableName: "user_addresses",
      timestamps: true,
    }
  );

  return UserAddress;
};
