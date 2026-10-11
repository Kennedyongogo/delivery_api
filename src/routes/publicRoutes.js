const express = require("express");
const router = express.Router();
const { optionalAuth } = require("../middleware/auth");
const { listPublicShops, getPublicShop, getPublicShopReviews, createReview } = require("../controllers/reviewController");

// No sign-in needed. A valid token links a review to the account; without one it is anonymous.
router.get("/shops", listPublicShops);
router.get("/shops/:id", getPublicShop);
router.get("/shops/:id/reviews", getPublicShopReviews);
router.post("/shops/:id/reviews", optionalAuth, createReview);

module.exports = router;
