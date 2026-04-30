const { User, AuditLog } = require("../models");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const config = require("../config/config");
const { Op } = require("sequelize");
const { convertToRelativePath } = require("../utils/filePath");
const allowedPublicRoles = ["customer"];

const sanitizeUser = (user) => {
  const plain = user.get ? user.get({ plain: true }) : user;
  delete plain.password;
  return plain;
};

const signToken = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, type: "user", role: user.role },
    config.jwtSecret,
    { expiresIn: "7d" }
  );

const setupOwner = async (req, res) => {
  try {
    const existingOwner = await User.findOne({ where: { role: "owner" } });
    if (existingOwner) {
      return res.status(400).json({
        success: false,
        message: "Owner already exists. Please login instead.",
      });
    }

    const { full_name, email, password, phone } = req.body;
    if (!full_name || !email || !password || !phone) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const existing = await User.findOne({ where: { email } });
    if (existing) {
      return res.status(400).json({ success: false, message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const owner = await User.create({
      full_name,
      email,
      password: hashedPassword,
      phone,
      role: "owner",
      is_active: true,
      profile_image: req.file ? convertToRelativePath(req.file.path) : null,
    });

    await AuditLog.create({
      user_id: owner.id,
      action: "owner_setup",
      details: { message: "First owner account created" },
      ip_address: req.ip,
    });

    const token = signToken(owner);
    return res.status(201).json({
      success: true,
      data: { user: sanitizeUser(owner), token },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const register = async (req, res) => {
  try {
    const { full_name, email, password, phone, role } = req.body;
    const requestedRole = role || "customer";
    if (!allowedPublicRoles.includes(requestedRole)) {
      return res.status(400).json({
        success: false,
        message: "Public registration allows only customer",
      });
    }
    const existing = await User.findOne({ where: { email } });
    if (existing) {
      return res.status(400).json({ success: false, message: "Email already exists" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      full_name,
      email,
      password: hashedPassword,
      phone,
      role: requestedRole,
      profile_image: req.file ? convertToRelativePath(req.file.path) : null,
    });
    return res.status(201).json({ success: true, data: sanitizeUser(user) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const createStaff = async (req, res) => {
  try {
    if (req.user.role !== "owner") {
      return res.status(403).json({ success: false, message: "Only owner can create staff" });
    }
    const { full_name, email, password, phone } = req.body;
    const existing = await User.findOne({ where: { email } });
    if (existing) {
      return res.status(400).json({ success: false, message: "Email already exists" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const staff = await User.create({
      full_name,
      email,
      password: hashedPassword,
      phone,
      role: "staff",
      created_by: req.user.id,
    });
    await AuditLog.create({
      user_id: req.user.id,
      action: "create_staff",
      details: { staff_id: staff.id, email: staff.email },
      ip_address: req.ip,
    });
    return res.status(201).json({ success: true, data: sanitizeUser(staff) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }
    if (!user.is_active) {
      return res.status(403).json({ success: false, message: "Account is inactive" });
    }
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }
    await user.update({ last_login: new Date() });
    const token = signToken(user);
    return res.status(200).json({ success: true, data: { user: sanitizeUser(user), token } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 10, role, search, sortBy = "createdAt", sortOrder = "DESC" } = req.query;
    const whereClause = {};
    if (role) whereClause.role = role;
    if (search) {
      whereClause[Op.or] = [
        { full_name: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } },
        { phone: { [Op.like]: `%${search}%` } },
      ];
    }
    const pageNum = Number.parseInt(page, 10);
    const limitNum = Number.parseInt(limit, 10);
    const { count, rows } = await User.findAndCountAll({
      where: whereClause,
      attributes: { exclude: ["password"] },
      limit: limitNum,
      offset: (pageNum - 1) * limitNum,
      order: [[sortBy, sortOrder]],
    });
    return res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        total: count,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(count / limitNum),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getUserById = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, { attributes: { exclude: ["password"] } });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    return res.status(200).json({ success: true, data: user });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (req.user.role !== "owner" && req.user.id !== user.id) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const allowed = [
      "full_name",
      "email",
      "phone",
      "is_available",
      "current_latitude",
      "current_longitude",
      "total_deliveries",
      "rating",
      "is_active",
    ];
    const updateData = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updateData[key] = req.body[key];
    }
    if (req.file) updateData.profile_image = convertToRelativePath(req.file.path);
    await user.update(updateData);
    return res.status(200).json({ success: true, data: sanitizeUser(user) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const changePassword = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (req.user.id !== user.id && req.user.role !== "owner") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const { currentPassword, newPassword } = req.body;
    if (req.user.id === user.id) {
      const ok = await bcrypt.compare(currentPassword, user.password);
      if (!ok) return res.status(401).json({ success: false, message: "Current password is incorrect" });
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    await user.update({ password: hashed });
    return res.status(200).json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const updateRole = async (req, res) => {
  try {
    if (req.user.role !== "owner") {
      return res.status(403).json({ success: false, message: "Only owner can update roles" });
    }
    const { role } = req.body;
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    await user.update({ role });
    return res.status(200).json({ success: true, data: sanitizeUser(user) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const toggleActiveStatus = async (req, res) => {
  try {
    if (req.user.role !== "owner") {
      return res.status(403).json({ success: false, message: "Only owner can change status" });
    }
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    await user.update({ is_active: !user.is_active });
    return res.status(200).json({ success: true, data: sanitizeUser(user) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const deleteUser = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (req.user.role !== "owner" && req.user.id !== user.id) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    await user.destroy();
    return res.status(200).json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getDashboardStats = async (req, res) => {
  try {
    const [totalUsers, activeUsers, totalOwners, totalStaff, totalRiders, totalCustomers] = await Promise.all([
      User.count(),
      User.count({ where: { is_active: true } }),
      User.count({ where: { role: "owner" } }),
      User.count({ where: { role: "staff" } }),
      User.count({ where: { role: "rider" } }),
      User.count({ where: { role: "customer" } }),
    ]);
    return res.status(200).json({
      success: true,
      data: { stats: { totalUsers, activeUsers, totalOwners, totalStaff, totalRiders, totalCustomers } },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const ownerExists = async (req, res) => {
  try {
    const count = await User.count({ where: { role: "owner" } });
    return res.status(200).json({
      success: true,
      data: { exists: count > 0, count },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
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
  deleteUser,
  getDashboardStats,
};
