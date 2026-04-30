const express = require("express");
const router = express.Router();
const { authenticateUser } = require("../middleware/auth");
const {
  getMyNotifications,
  markNotificationRead,
  markAllRead,
} = require("../controllers/notificationController");

router.use(authenticateUser);
router.get("/", getMyNotifications);
router.patch("/read-all", markAllRead);
router.patch("/:id/read", markNotificationRead);

module.exports = router;
