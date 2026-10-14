const { DataTypes } = require("sequelize");

const ROTEJO_STATUSES = ["pending", "approved", "rejected"];

// A Rotejo rider's application: where they ride, their licence and ID, the bike, and document photos.
module.exports = (sequelize) => {
  const RotejoProfile = sequelize.define(
    "RotejoProfile",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      stage: { type: DataTypes.STRING(80), allowNull: false },
      id_number: { type: DataTypes.STRING(20), allowNull: false },
      licence_number: { type: DataTypes.STRING(30), allowNull: false },
      bike_make: { type: DataTypes.STRING(40), allowNull: false },
      bike_model: { type: DataTypes.STRING(60), allowNull: false },
      bike_year: { type: DataTypes.INTEGER, allowNull: false },
      bike_colour: { type: DataTypes.STRING(30), allowNull: false },
      plate: { type: DataTypes.STRING(20), allowNull: false },
      // { kind: relative file path }, e.g. { id_front: "uploads/rotejo/..." }. Never served publicly.
      documents: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      status: {
        type: DataTypes.ENUM(...ROTEJO_STATUSES),
        allowNull: false,
        defaultValue: "pending",
      },
      review_note: { type: DataTypes.TEXT, allowNull: true },
      // Presence: an online rider whose phone checked in recently can be offered rides.
      online: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      lat: { type: DataTypes.DOUBLE, allowNull: true },
      lng: { type: DataTypes.DOUBLE, allowNull: true },
      last_seen: { type: DataTypes.DATE, allowNull: true },
      reviewed_by: { type: DataTypes.UUID, allowNull: true },
      reviewed_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "rotejo_profiles",
      timestamps: true,
    }
  );

  return RotejoProfile;
};

module.exports.ROTEJO_STATUSES = ROTEJO_STATUSES;
