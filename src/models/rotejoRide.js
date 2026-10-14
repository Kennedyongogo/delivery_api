const { DataTypes } = require("sequelize");

const RIDE_STATUSES = ["searching", "coming", "arrived", "on_trip", "completed", "cancelled"];
const LIVE_RIDE_STATUSES = ["searching", "coming", "arrived", "on_trip"];

// A Rotejo boda ride: requested by any signed-in account, offered to riders one at a time.
module.exports = (sequelize) => {
  const RotejoRide = sequelize.define(
    "RotejoRide",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      customer_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      rider_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      status: { type: DataTypes.ENUM(...RIDE_STATUSES), allowNull: false, defaultValue: "searching" },
      pickup_lat: { type: DataTypes.DOUBLE, allowNull: false },
      pickup_lng: { type: DataTypes.DOUBLE, allowNull: false },
      pickup_label: { type: DataTypes.STRING(160), allowNull: false },
      dest_lat: { type: DataTypes.DOUBLE, allowNull: false },
      dest_lng: { type: DataTypes.DOUBLE, allowNull: false },
      dest_label: { type: DataTypes.STRING(160), allowNull: false },
      // Route from pickup to destination as [[lat, lng], ...], as quoted to the customer.
      path: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      meters: { type: DataTypes.DOUBLE, allowNull: false },
      seconds: { type: DataTypes.DOUBLE, allowNull: false },
      fare: { type: DataTypes.INTEGER, allowNull: false },
      pin: { type: DataTypes.STRING(4), allowNull: false },
      // The rider currently being asked, and until when.
      offered_to: { type: DataTypes.UUID, allowNull: true },
      offer_expires_at: { type: DataTypes.DATE, allowNull: true },
      declined_by: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      // Live rider position on the current leg (to pickup, then to destination).
      rider_lat: { type: DataTypes.DOUBLE, allowNull: true },
      rider_lng: { type: DataTypes.DOUBLE, allowNull: true },
      leg_from_lat: { type: DataTypes.DOUBLE, allowNull: true },
      leg_from_lng: { type: DataTypes.DOUBLE, allowNull: true },
      progress: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
      // Stars the customer gave the rider, and the rider gave the customer.
      rider_rating: { type: DataTypes.INTEGER, allowNull: true },
      customer_rating: { type: DataTypes.INTEGER, allowNull: true },
      cancelled_by: { type: DataTypes.STRING(20), allowNull: true },
      cancel_reason: { type: DataTypes.STRING(120), allowNull: true },
      accepted_at: { type: DataTypes.DATE, allowNull: true },
      arrived_at: { type: DataTypes.DATE, allowNull: true },
      started_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      cancelled_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "rotejo_rides",
      timestamps: true,
      indexes: [{ fields: ["customer_id"] }, { fields: ["rider_id"] }, { fields: ["status"] }],
    }
  );

  return RotejoRide;
};

module.exports.RIDE_STATUSES = RIDE_STATUSES;
module.exports.LIVE_RIDE_STATUSES = LIVE_RIDE_STATUSES;
