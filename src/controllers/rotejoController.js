const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const { User, RotejoProfile, AuditLog, sequelize } = require("../models");
const { ROLES } = require("../utils/roles");
const { ROTEJO_DOCUMENTS, deleteFile } = require("../middleware/upload");
const { convertToRelativePath } = require("../utils/filePath");

const UPLOADS_ROOT = path.join(__dirname, "..", "..");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const digits = (value) => String(value || "").replace(/\D/g, "");
const text = (value) => String(value || "").trim();

const uploadedFiles = (req) => Object.values(req.files || {}).flat();

const discardUploads = async (req) => {
  await Promise.all(uploadedFiles(req).map((file) => deleteFile(file.path)));
};

// Documents are listed by kind only; the file paths stay on the server.
const publicProfile = (profile) => {
  const plain = profile.get({ plain: true });
  plain.documents = Object.keys(plain.documents || {});
  return plain;
};

const validateApplication = (body, files) => {
  const thisYear = new Date().getFullYear();
  const year = Number(body.bike_year);
  if (text(body.full_name).length < 2) return "Add your full name as it appears on your ID.";
  if (!EMAIL.test(text(body.email).toLowerCase())) return "Enter a valid email address.";
  if (digits(body.phone).length < 10) return "Use a full phone number.";
  if (String(body.password || "").length < 6) return "Use at least 6 characters for the password.";
  if (text(body.stage).length < 2) return "Pick the stage you ride from.";
  const id = digits(body.id_number);
  if (id.length < 7 || id.length > 9) return "Enter the 7 or 8 digit number on your national ID.";
  if (text(body.licence_number).length < 5) return "Enter your driving licence number.";
  if (text(body.bike_make).length < 2) return "Pick the make of your motorbike.";
  if (text(body.bike_model).length < 1) return "Add the model of your motorbike.";
  if (!Number.isInteger(year) || year < 1990 || year > thisYear + 1) return "Enter the year your bike was made.";
  if (text(body.bike_colour).length < 3) return "Add the colour of your bike.";
  if (text(body.plate).replace(/\s/g, "").length < 6) return "Add the number plate on your bike, e.g. KMFB 482Q.";
  const missing = ROTEJO_DOCUMENTS.find((kind) => !files[kind]?.[0]);
  if (missing) return `Add the ${missing.replace("_", " ")} photo.`;
  return null;
};

// Public: a new rider applies with their account, bike, licence and document photos.
const registerRider = async (req, res) => {
  const files = req.files || {};
  const error = validateApplication(req.body, files);
  if (error) {
    await discardUploads(req);
    return res.status(400).json({ success: false, message: error });
  }
  const email = text(req.body.email).toLowerCase();
  try {
    if (await User.findOne({ where: { email } })) {
      await discardUploads(req);
      return res.status(400).json({ success: false, message: "Email already exists" });
    }
    const documents = Object.fromEntries(
      ROTEJO_DOCUMENTS.map((kind) => [kind, convertToRelativePath(files[kind][0].path)])
    );
    const { user, profile } = await sequelize.transaction(async (transaction) => {
      const user = await User.create(
        {
          full_name: text(req.body.full_name),
          email,
          phone: digits(req.body.phone),
          password: await bcrypt.hash(String(req.body.password), 10),
          role: ROLES.ROTEJO_RIDER,
          profile_image: documents.selfie,
        },
        { transaction }
      );
      const profile = await RotejoProfile.create(
        {
          user_id: user.id,
          stage: text(req.body.stage),
          id_number: digits(req.body.id_number),
          licence_number: text(req.body.licence_number).toUpperCase(),
          bike_make: text(req.body.bike_make),
          bike_model: text(req.body.bike_model),
          bike_year: Number(req.body.bike_year),
          bike_colour: text(req.body.bike_colour),
          plate: text(req.body.plate).toUpperCase().replace(/\s+/g, " "),
          documents,
        },
        { transaction }
      );
      await AuditLog.create(
        { user_id: user.id, action: "rotejo_apply", details: { profile_id: profile.id }, ip_address: req.ip },
        { transaction }
      );
      return { user, profile };
    });
    return res.status(201).json({
      success: true,
      data: { user: { id: user.id, full_name: user.full_name, email: user.email }, profile: publicProfile(profile) },
    });
  } catch (err) {
    await discardUploads(req);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// The signed-in rider's own application and review status.
const myProfile = async (req, res) => {
  try {
    const profile = await RotejoProfile.findOne({ where: { user_id: req.user.id } });
    if (!profile) return res.status(404).json({ success: false, message: "No Rotejo application yet" });
    return res.status(200).json({ success: true, data: publicProfile(profile) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const listApplications = async (req, res) => {
  try {
    const where = req.query.status ? { status: req.query.status } : {};
    const profiles = await RotejoProfile.findAll({
      where,
      include: [{ model: User, as: "rider", attributes: ["id", "full_name", "email", "phone", "is_active"] }],
      order: [["createdAt", "DESC"]],
    });
    return res.status(200).json({ success: true, data: profiles.map(publicProfile) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const reviewApplication = async (req, res) => {
  try {
    const { status, note } = req.body;
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ success: false, message: "Status must be approved or rejected" });
    }
    if (status === "rejected" && text(note).length < 3) {
      return res.status(400).json({ success: false, message: "Tell the rider what to fix" });
    }
    const profile = await RotejoProfile.findOne({ where: { user_id: req.params.userId } });
    if (!profile) return res.status(404).json({ success: false, message: "Application not found" });
    await profile.update({
      status,
      review_note: status === "rejected" ? text(note) : null,
      reviewed_by: req.user.id,
      reviewed_at: new Date(),
    });
    await AuditLog.create({
      user_id: req.user.id,
      action: `rotejo_${status}`,
      details: { rider_id: profile.user_id },
      ip_address: req.ip,
    });
    return res.status(200).json({ success: true, data: publicProfile(profile) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Reviewers open a document photo; the files are never public.
const getDocument = async (req, res) => {
  try {
    const profile = await RotejoProfile.findOne({ where: { user_id: req.params.userId } });
    const relative = profile?.documents?.[req.params.kind];
    if (!relative) return res.status(404).json({ success: false, message: "Document not found" });
    const absolute = path.join(UPLOADS_ROOT, relative);
    if (!absolute.startsWith(path.join(UPLOADS_ROOT, "uploads", "rotejo")) || !fs.existsSync(absolute)) {
      return res.status(404).json({ success: false, message: "Document not found" });
    }
    return res.sendFile(absolute);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { registerRider, myProfile, listApplications, reviewApplication, getDocument };
