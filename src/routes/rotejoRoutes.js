const express = require("express");
const router = express.Router();
const {
  registerRider,
  myProfile,
  listApplications,
  reviewApplication,
  getDocument,
} = require("../controllers/rotejoController");
const rides = require("../controllers/rotejoRideController");
const { authenticateUser, authorizeRoles } = require("../middleware/auth");
const { uploadRotejoDocuments, handleUploadError } = require("../middleware/upload");
const { ROLES } = require("../utils/roles");

const rider = [authenticateUser, authorizeRoles([ROLES.ROTEJO_RIDER])];

router.post("/riders/register", uploadRotejoDocuments, handleUploadError, registerRider);
router.get("/riders/me", ...rider, myProfile);

router.get("/riders", authenticateUser, authorizeRoles([ROLES.SUPER_ADMIN]), listApplications);
router.put("/riders/:userId/status", authenticateUser, authorizeRoles([ROLES.SUPER_ADMIN]), reviewApplication);
router.get("/riders/:userId/documents/:kind", authenticateUser, authorizeRoles([ROLES.SUPER_ADMIN]), getDocument);

// Any signed-in account can ride.
router.post("/rides", authenticateUser, rides.requestRide);
router.get("/rides/current", authenticateUser, rides.currentRide);
router.get("/rides/mine", authenticateUser, rides.myRides);
router.post("/rides/:id/cancel", authenticateUser, rides.cancelRide);
router.post("/rides/:id/rate", authenticateUser, rides.rateRide);

router.post("/rider/presence", ...rider, rides.setPresence);
router.get("/rider/feed", ...rider, rides.riderFeed);
router.post("/rides/:id/accept", ...rider, rides.acceptOffer);
router.post("/rides/:id/decline", ...rider, rides.declineOffer);
router.post("/rides/:id/position", ...rider, rides.updatePosition);
router.post("/rides/:id/arrived", ...rider, rides.markArrived);
router.post("/rides/:id/start", ...rider, rides.startTrip);
router.post("/rides/:id/complete", ...rider, rides.completeTrip);

module.exports = router;
