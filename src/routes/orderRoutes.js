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
const { placeShopOrder, listMyOrders, getMyOrder, cancelMyOrder, listShopRiders } = require("../controllers/shopOrderController");
const { ROLES, RIDER_ROLES, ADMIN_ROLES } = require("../utils/roles");

router.use(authenticateUser);

router.post("/", authorizeRoles([ROLES.CUSTOMER]), createOrder);
router.get("/", getOrders);

// Customers ordering from a shop on the public site.
router.post("/shop", authorizeRoles([ROLES.CUSTOMER]), placeShopOrder);
router.get("/mine", authorizeRoles([ROLES.CUSTOMER]), listMyOrders);
router.get("/mine/:id", authorizeRoles([ROLES.CUSTOMER]), getMyOrder);
router.put("/mine/:id/cancel", authorizeRoles([ROLES.CUSTOMER]), cancelMyOrder);
router.get("/shop-riders", authorizeRoles(ADMIN_ROLES), listShopRiders);

router.get("/available", authorizeRoles(RIDER_ROLES), getAvailableOrders);
router.get("/:id/live-location", getOrderLiveLocation);
router.get("/:id/timeline", getOrderTimeline);
router.get("/:id", getOrderById);
router.put("/:id/status", updateOrderStatus);
router.put("/:id/assign-rider", authorizeRoles(ADMIN_ROLES), assignRider);
router.put("/:id/rider-location", authorizeRoles(RIDER_ROLES), updateRiderLocation);

module.exports = router;
