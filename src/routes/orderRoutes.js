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
const { ROLES, RIDER_ROLES } = require("../utils/roles");

router.use(authenticateUser);

router.post("/", authorizeRoles([ROLES.CUSTOMER]), createOrder);
router.get("/", getOrders);
router.get("/available", authorizeRoles(RIDER_ROLES), getAvailableOrders);
router.get("/:id/live-location", getOrderLiveLocation);
router.get("/:id/timeline", getOrderTimeline);
router.get("/:id", getOrderById);
router.put("/:id/status", updateOrderStatus);
router.put("/:id/assign-rider", authorizeRoles([ROLES.SHOP_OWNER]), assignRider);
router.put("/:id/rider-location", authorizeRoles(RIDER_ROLES), updateRiderLocation);

module.exports = router;
