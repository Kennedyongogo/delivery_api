const express = require("express");
const router = express.Router();
const {
  registerRider,
  myProfile,
  listApplications,
  reviewApplication,
  getDocument,
} = require("../controllers/rotejoController");
const { authenticateUser, authorizeRoles } = require("../middleware/auth");
const { uploadRotejoDocuments, handleUploadError } = require("../middleware/upload");
const { ROLES } = require("../utils/roles");

router.post("/riders/register", uploadRotejoDocuments, handleUploadError, registerRider);
router.get("/riders/me", authenticateUser, authorizeRoles([ROLES.ROTEJO_RIDER]), myProfile);

router.get("/riders", authenticateUser, authorizeRoles([ROLES.SUPER_ADMIN]), listApplications);
router.put("/riders/:userId/status", authenticateUser, authorizeRoles([ROLES.SUPER_ADMIN]), reviewApplication);
router.get("/riders/:userId/documents/:kind", authenticateUser, authorizeRoles([ROLES.SUPER_ADMIN]), getDocument);

module.exports = router;
