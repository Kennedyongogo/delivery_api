const express = require("express");
const router = express.Router();
const { authenticateUser, authorizeRoles } = require("../middleware/auth");
const {
  getOrders,
  getOrderById,
  createOrder,
  updateOrderStatus,
  getOrderTimeline,
  assignRider,
  getAvailableOrders,
  updateRiderLocation,
  getOrderLiveLocation,
} = require("../controllers/orderController");

router.use(authenticateUser);

router.post("/", authorizeRoles(["customer"]), createOrder);
router.get("/", getOrders);
router.get("/available", authorizeRoles(["rider"]), getAvailableOrders);
router.get("/:id/live-location", getOrderLiveLocation);
router.get("/:id/timeline", getOrderTimeline);
router.get("/:id", getOrderById);
router.put("/:id/status", updateOrderStatus);
router.put("/:id/assign-rider", authorizeRoles(["owner"]), assignRider);
router.put("/:id/rider-location", authorizeRoles(["rider"]), updateRiderLocation);

module.exports = router;
