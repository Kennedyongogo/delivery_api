const express = require("express");
const router = express.Router();
const {
  setupOwner,
  ownerExists,
  register,
  createStaff,
  createShopOwner,
  login,
  getAllUsers,
  getUserById,
  updateProfile,
  changePassword,
  updateRole,
  toggleActiveStatus,
  getDashboardStats,
  deleteUser,
} = require("../controllers/adminUserController");
const { 
  authenticateUser,
  authorizeRoles,
} = require("../middleware/auth");
const {
  uploadProfileImage,
  handleUploadError,
} = require("../middleware/upload");
const { errorHandler } = require("../middleware/errorHandler");
const { ROLES } = require("../utils/roles");

// Public routes
router.post("/login", login);
router.get("/owner-exists", ownerExists);
router.post("/setup-owner", uploadProfileImage, handleUploadError, setupOwner);
router.post("/register", uploadProfileImage, handleUploadError, register);

// Shop owner creates staff and riders
router.post(
  "/staff",
  authenticateUser,
  authorizeRoles([ROLES.SHOP_OWNER]),
  createStaff
);

router.post("/shop-owners", authenticateUser, authorizeRoles([ROLES.SUPER_ADMIN]), createShopOwner);

const USER_DIRECTORY_ROLES = [ROLES.SHOP_OWNER, ROLES.SUPER_ADMIN];

router.get("/dashboard/stats", authenticateUser, authorizeRoles(USER_DIRECTORY_ROLES), getDashboardStats);
router.get("/", authenticateUser, authorizeRoles(USER_DIRECTORY_ROLES), getAllUsers);
router.get("/:id", authenticateUser, getUserById);

router.put(
  "/:id",
  authenticateUser,
  uploadProfileImage,
  handleUploadError,
  updateProfile
);

router.put("/:id/password", authenticateUser, changePassword);
router.put("/:id/role", authenticateUser, authorizeRoles([ROLES.SHOP_OWNER]), updateRole);
router.put("/:id/toggle-status", authenticateUser, authorizeRoles([ROLES.SHOP_OWNER]), toggleActiveStatus);

router.delete("/:id", authenticateUser, deleteUser);

// Error handling middleware
router.use(errorHandler);

module.exports = router;
