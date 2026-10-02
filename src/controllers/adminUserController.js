const { User, AuditLog, sequelize } = require("../models");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const config = require("../config/config");
const { Op } = require("sequelize");
const { convertToRelativePath } = require("../utils/filePath");
const { ROLES, ALL_ROLES, SHOP_MEMBER_ROLES, SHOP_ROLES } = require("../utils/roles");
const allowedPublicRoles = [ROLES.CUSTOMER];

// A shop is identified by its owner: the owner's own id, or `created_by` for its staff and riders.
const shopIdOf = (user) => {
  if (user.role === ROLES.SHOP_OWNER) return user.id;
  if (SHOP_MEMBER_ROLES.includes(user.role)) return user.created_by || null;
  return null;
};

// Where-clause for the accounts of the actor's own shop: the owner plus its staff and riders.
const shopScope = (actor) => {
  const shopId = shopIdOf(actor);
  if (!shopId) return { id: actor.id };
  return { [Op.or]: [{ id: shopId }, { created_by: shopId, role: SHOP_MEMBER_ROLES }] };
};

// Outside the super admin console, shop accounts are only visible within their own shop.
// Other roles (customers, Rotejo riders, super admins) stay visible as before.
const visibleUsersScope = (actor) =>
  actor.role === ROLES.SUPER_ADMIN ? null : { [Op.or]: [shopScope(actor), { role: { [Op.notIn]: SHOP_ROLES } }] };

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
    const existingOwner = await User.findOne({ where: { role: ROLES.SHOP_OWNER } });
    if (existingOwner) {
      return res.status(400).json({
        success: false,
        message: "Shop owner already exists. Please login instead.",
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
      role: ROLES.SHOP_OWNER,
      is_active: true,
      profile_image: req.file ? convertToRelativePath(req.file.path) : null,
    });

    await AuditLog.create({
      user_id: owner.id,
      action: "owner_setup",
      details: { message: "First shop owner account created" },
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
    const requestedRole = role || ROLES.CUSTOMER;
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

// Shop owners create the staff and shop riders who work for their shop.
const createStaff = async (req, res) => {
  try {
    if (req.user.role !== ROLES.SHOP_OWNER) {
      return res.status(403).json({ success: false, message: "Only shop owner can create staff" });
    }
    const full_name = String(req.body.full_name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const phone = String(req.body.phone || "").trim();
    const password = String(req.body.password || "");
    const role = req.body.role || ROLES.STAFF;

    if (!SHOP_MEMBER_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: `Role must be one of: ${SHOP_MEMBER_ROLES.join(", ")}` });
    }
    if (!full_name || !email || !phone || !password) {
      return res.status(400).json({ success: false, message: "Name, email, phone and password are required" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "Enter a valid email address" });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    const existing = await User.findOne({ where: { email: { [Op.iLike]: email } } });
    if (existing) {
      return res.status(409).json({ success: false, message: "An account with this email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const member = await sequelize.transaction(async (transaction) => {
      const created = await User.create(
        {
          full_name,
          email,
          password: hashedPassword,
          phone,
          role,
          is_active: true,
          created_by: req.user.id,
        },
        { transaction }
      );
      await AuditLog.create(
        {
          user_id: req.user.id,
          action: role === ROLES.SHOP_RIDER ? "create_shop_rider" : "create_staff",
          details: { user_id: created.id, role, email: created.email },
          ip_address: req.ip,
        },
        { transaction }
      );
      return created;
    });

    return res.status(201).json({ success: true, data: sanitizeUser(member) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const createShopOwner = async (req, res) => {
  try {
    const full_name = String(req.body.full_name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const phone = String(req.body.phone || "").trim();
    const password = String(req.body.password || "");

    if (!full_name || !email || !phone || !password) {
      return res.status(400).json({ success: false, message: "Name, email, phone and password are required" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "Enter a valid email address" });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    const existing = await User.findOne({ where: { email: { [Op.iLike]: email } } });
    if (existing) {
      return res.status(409).json({ success: false, message: "An account with this email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const owner = await sequelize.transaction(async (transaction) => {
      const created = await User.create(
        {
          full_name,
          email,
          password: hashedPassword,
          phone,
          role: ROLES.SHOP_OWNER,
          is_active: true,
        },
        { transaction }
      );
      await AuditLog.create(
        {
          user_id: req.user.id,
          action: "create_shop_owner",
          details: { user_id: created.id, email: created.email },
          ip_address: req.ip,
        },
        { transaction }
      );
      return created;
    });

    return res.status(201).json({ success: true, data: sanitizeUser(owner) });
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

const USER_LIST_DEFAULT_LIMIT = 10;
const USER_LIST_MAX_LIMIT = 100;
const USER_SORT_FIELDS = ["createdAt", "updatedAt", "full_name", "email", "last_login"];

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const escapeLike = (value) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

const getAllUsers = async (req, res) => {
  try {
    const { role, search } = req.query;
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, USER_LIST_DEFAULT_LIMIT), USER_LIST_MAX_LIMIT);
    const sortBy = USER_SORT_FIELDS.includes(req.query.sortBy) ? req.query.sortBy : "createdAt";
    const sortOrder = String(req.query.sortOrder).toUpperCase() === "ASC" ? "ASC" : "DESC";

    if (role && !ALL_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: `Role must be one of: ${ALL_ROLES.join(", ")}` });
    }

    const whereClause = {};
    if (role) whereClause.role = role;
    const visible = visibleUsersScope(req.user);
    if (visible) whereClause[Op.and] = [visible];
    const term = typeof search === "string" ? search.trim() : "";
    if (term) {
      const pattern = `%${escapeLike(term)}%`;
      whereClause[Op.or] = [
        { full_name: { [Op.iLike]: pattern } },
        { email: { [Op.iLike]: pattern } },
        { phone: { [Op.iLike]: pattern } },
      ];
    }

    const { count, rows } = await User.findAndCountAll({
      where: whereClause,
      attributes: { exclude: ["password"] },
      limit,
      offset: (page - 1) * limit,
      // `id` breaks ties so rows never repeat or go missing between pages.
      order: [
        [sortBy, sortOrder === "ASC" ? "ASC NULLS LAST" : "DESC NULLS LAST"],
        ["id", "ASC"],
      ],
    });

    const totalPages = Math.ceil(count / limit);
    return res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        total: count,
        page,
        limit,
        totalPages,
        hasPrevPage: page > 1,
        hasNextPage: page < totalPages,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getUserById = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, { attributes: { exclude: ["password"] } });
    if (!user || !canSeeUser(req.user, user)) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    return res.status(200).json({ success: true, data: user });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const canSeeUser = (actor, target) => {
  if (actor.id === target.id || actor.role === ROLES.SUPER_ADMIN || !SHOP_ROLES.includes(target.role)) return true;
  const shopId = shopIdOf(actor);
  return Boolean(shopId) && shopId === shopIdOf(target);
};

// Shop owners manage the staff and riders of their own shop, never another shop's accounts.
const canManageUser = (actor, target) =>
  actor.id === target.id ||
  actor.role === ROLES.SUPER_ADMIN ||
  (actor.role === ROLES.SHOP_OWNER && SHOP_MEMBER_ROLES.includes(target.role) && target.created_by === actor.id);

const updateProfile = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (!canManageUser(req.user, user)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const isSelf = req.user.id === user.id;
    const updateData = {};

    if (req.body.full_name !== undefined) {
      const fullName = String(req.body.full_name).trim();
      if (!fullName) return res.status(400).json({ success: false, message: "Full name can't be empty" });
      updateData.full_name = fullName;
    }
    if (req.body.email !== undefined) {
      const email = String(req.body.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, message: "Enter a valid email address" });
      }
      const taken = await User.findOne({ where: { email: { [Op.iLike]: email }, id: { [Op.ne]: user.id } } });
      if (taken) {
        return res.status(409).json({ success: false, message: "An account with this email already exists" });
      }
      updateData.email = email;
    }
    if (req.body.phone !== undefined) {
      const phone = String(req.body.phone).trim();
      if (!phone) return res.status(400).json({ success: false, message: "Phone number can't be empty" });
      updateData.phone = phone;
    }
    if (req.body.is_active !== undefined) {
      const isActive = req.body.is_active === true || req.body.is_active === "true";
      if (isSelf && !isActive) {
        return res.status(400).json({ success: false, message: "You can't deactivate your own account" });
      }
      if (!isSelf) updateData.is_active = isActive;
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
    if (!canManageUser(req.user, user)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ success: false, message: "New password must be at least 6 characters" });
    }
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
    if (req.user.role !== ROLES.SHOP_OWNER) {
      return res.status(403).json({ success: false, message: "Only shop owner can update roles" });
    }
    const { role } = req.body;
    if (!SHOP_MEMBER_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Role must be one of: ${SHOP_MEMBER_ROLES.join(", ")}`,
      });
    }
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (user.id === req.user.id || !canManageUser(req.user, user)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    await user.update({ role });
    return res.status(200).json({ success: true, data: sanitizeUser(user) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const toggleActiveStatus = async (req, res) => {
  try {
    if (req.user.role !== ROLES.SHOP_OWNER) {
      return res.status(403).json({ success: false, message: "Only shop owner can change status" });
    }
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (user.id === req.user.id || !canManageUser(req.user, user)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
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
    if (!canManageUser(req.user, user)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    await user.destroy();
    return res.status(200).json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const countRole = (actor, role) => {
  const visible = visibleUsersScope(actor);
  return User.count({ where: visible ? { role, [Op.and]: [visible] } : { role } });
};

const getDashboardStats = async (req, res) => {
  try {
    const [
      totalUsers,
      activeUsers,
      totalShopOwners,
      totalStaff,
      totalRotejoRiders,
      totalShopRiders,
      totalCustomers,
      totalSuperAdmins,
    ] = await Promise.all([
      User.count(),
      User.count({ where: { is_active: true } }),
      countRole(req.user, ROLES.SHOP_OWNER),
      countRole(req.user, ROLES.STAFF),
      User.count({ where: { role: ROLES.ROTEJO_RIDER } }),
      countRole(req.user, ROLES.SHOP_RIDER),
      User.count({ where: { role: ROLES.CUSTOMER } }),
      User.count({ where: { role: ROLES.SUPER_ADMIN } }),
    ]);
    return res.status(200).json({
      success: true,
      data: {
        stats: {
          totalUsers,
          activeUsers,
          totalShopOwners,
          totalStaff,
          totalRotejoRiders,
          totalShopRiders,
          totalRiders: totalRotejoRiders + totalShopRiders,
          totalCustomers,
          totalSuperAdmins,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const ownerExists = async (req, res) => {
  try {
    const count = await User.count({ where: { role: ROLES.SHOP_OWNER } });
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
  createShopOwner,
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
