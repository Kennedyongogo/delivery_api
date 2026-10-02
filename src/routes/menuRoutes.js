const express = require("express");
const router = express.Router();
const { authenticateUser, authorizeRoles } = require("../middleware/auth");
const { uploadMenuImage, handleUploadError } = require("../middleware/upload");
const {
  getMenuItems,
  getMenuItemById,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  toggleAvailability,
  getCategories,
} = require("../controllers/menuController");
const { ROLES, ADMIN_ROLES } = require("../utils/roles");

router.get("/", getMenuItems);
router.get("/categories", getCategories);
router.get("/:id", getMenuItemById);

router.post(
  "/",
  authenticateUser,
  authorizeRoles(ADMIN_ROLES),
  uploadMenuImage,
  handleUploadError,
  createMenuItem
);

router.put(
  "/:id",
  authenticateUser,
  authorizeRoles(ADMIN_ROLES),
  uploadMenuImage,
  handleUploadError,
  updateMenuItem
);

router.delete("/:id", authenticateUser, authorizeRoles([ROLES.SHOP_OWNER]), deleteMenuItem);

router.patch(
  "/:id/toggle-availability",
  authenticateUser,
  authorizeRoles(ADMIN_ROLES),
  toggleAvailability
);

module.exports = router;
