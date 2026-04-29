const express = require("express");
const router = express.Router();
const {
  setupOwner,
  ownerExists,
  register,
  createStaff,
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

// Public routes
router.post("/login", login);
router.get("/owner-exists", ownerExists);
router.post("/setup-owner", uploadProfileImage, handleUploadError, setupOwner);
router.post("/register", uploadProfileImage, handleUploadError, register);

// Owner creates staff
router.post(
  "/staff",
  authenticateUser,
  authorizeRoles(["owner"]),
  createStaff
);

router.get("/dashboard/stats", authenticateUser, authorizeRoles(["owner", "staff"]), getDashboardStats);
router.get("/", authenticateUser, authorizeRoles(["owner", "staff"]), getAllUsers);
router.get("/:id", authenticateUser, getUserById);

router.put(
  "/:id",
  authenticateUser,
  uploadProfileImage,
  handleUploadError,
  updateProfile
);

router.put("/:id/password", authenticateUser, changePassword);
router.put("/:id/role", authenticateUser, authorizeRoles(["owner"]), updateRole);
router.put("/:id/toggle-status", authenticateUser, authorizeRoles(["owner"]), toggleActiveStatus);

router.delete("/:id", authenticateUser, deleteUser);

// Error handling middleware
router.use(errorHandler);

module.exports = router;
