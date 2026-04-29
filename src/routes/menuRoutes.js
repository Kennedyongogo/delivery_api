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

router.get("/", getMenuItems);
router.get("/categories", getCategories);
router.get("/:id", getMenuItemById);

router.post(
  "/",
  authenticateUser,
  authorizeRoles(["owner", "staff"]),
  uploadMenuImage,
  handleUploadError,
  createMenuItem
);

router.put(
  "/:id",
  authenticateUser,
  authorizeRoles(["owner", "staff"]),
  uploadMenuImage,
  handleUploadError,
  updateMenuItem
);

router.delete("/:id", authenticateUser, authorizeRoles(["owner"]), deleteMenuItem);

router.patch(
  "/:id/toggle-availability",
  authenticateUser,
  authorizeRoles(["owner", "staff"]),
  toggleAvailability
);

module.exports = router;
