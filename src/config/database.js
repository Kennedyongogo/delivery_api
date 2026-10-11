// config/database.js
require("dotenv").config();
const { Sequelize } = require("sequelize");
const config = require("./config");

// Determine which connection to use based on NODE_ENV
const isProduction = process.env.NODE_ENV === "production";

// ✅ Create main Sequelize instance (PgBouncer in production, direct in other environments)
const sequelize = new Sequelize(
  isProduction
    ? config.database.pgbouncer.database
    : config.database.direct.database,
  isProduction
    ? config.database.pgbouncer.username
    : config.database.direct.username,
  isProduction
    ? config.database.pgbouncer.password
    : config.database.direct.password,
  {
    host: isProduction
      ? config.database.pgbouncer.host
      : config.database.direct.host,
    port: isProduction
      ? config.database.pgbouncer.port
      : config.database.direct.port,
    dialect: "postgres",
    logging: false,
    pool: {
      max: isProduction ? 20 : 10, // More connections for PgBouncer in production
      min: isProduction ? 2 : 0,
      acquire: 30000,
      idle: 10000,
    },
    // The database is remote: keep-alive stops idle sockets from being dropped silently, and the
    // query timeout frees a pool slot if a socket dies mid-query instead of hanging every request.
    dialectOptions: {
      ...(isProduction ? { application_name: "construction_management_api" } : {}),
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      query_timeout: 20000,
    },
  }
);

// ✅ Create direct database instance for migrations and admin operations
const directSequelize = new Sequelize(
  config.database.direct.database,
  config.database.direct.username,
  config.database.direct.password,
  {
    host: config.database.direct.host,
    port: config.database.direct.port,
    dialect: "postgres",
    logging: false,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    dialectOptions: {
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    },
  }
);

// Test connections
const testConnections = async () => {
  try {
    await sequelize.authenticate();
    console.log(
      `✅ ${
        isProduction ? "PgBouncer" : "Direct"
      } connection established successfully.`
    );

    await directSequelize.authenticate();
    console.log("✅ Direct database connection established successfully.");
  } catch (error) {
    console.error("❌ Database connection error:", error);
    throw error;
  }
};

// Export both instances
module.exports = {
  sequelize, // Main connection (PgBouncer in production, direct in other environments)
  directSequelize, // Direct connection for migrations
  testConnections,
};
