const express = require("express");
const router = express.Router();
const { authenticateUser, authorizeRoles } = require("../middleware/auth");
const { uploadShopLogo, uploadProductImages, handleUploadError } = require("../middleware/upload");
const {
  getMyShop,
  saveMyShop,
  deleteMyShop,
  listShops,
  getShopById,
  listMyProducts,
  getMyProduct,
  createProduct,
  updateProduct,
  deleteProduct,
} = require("../controllers/shopController");
const { ROLES, ADMIN_ROLES } = require("../utils/roles");

const ownerOnly = authorizeRoles([ROLES.SHOP_OWNER]);
const shopTeam = authorizeRoles(ADMIN_ROLES);
const superAdminOnly = authorizeRoles([ROLES.SUPER_ADMIN]);

router.use(authenticateUser);

// The signed-in owner's (or staff member's) own shop. Staff can read but never write.
router.get("/mine", shopTeam, getMyShop);
router.put("/mine", ownerOnly, uploadShopLogo, handleUploadError, saveMyShop);
router.delete("/mine", ownerOnly, deleteMyShop);

router.get("/mine/products", shopTeam, listMyProducts);
router.get("/mine/products/:productId", shopTeam, getMyProduct);
router.post("/mine/products", ownerOnly, uploadProductImages, handleUploadError, createProduct);
router.put("/mine/products/:productId", ownerOnly, uploadProductImages, handleUploadError, updateProduct);
router.delete("/mine/products/:productId", ownerOnly, deleteProduct);

// Super admins see every shop's profile, but not their products.
router.get("/", superAdminOnly, listShops);
router.get("/:id", superAdminOnly, getShopById);

module.exports = router;
