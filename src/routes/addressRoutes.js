const express = require("express");
const router = express.Router();
const { authenticateUser, authorizeRoles } = require("../middleware/auth");
const {
  getMyAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
} = require("../controllers/addressController");

router.use(authenticateUser);
router.use(authorizeRoles(["customer"]));

router.get("/", getMyAddresses);
router.post("/", createAddress);
router.put("/:id", updateAddress);
router.delete("/:id", deleteAddress);

module.exports = router;
