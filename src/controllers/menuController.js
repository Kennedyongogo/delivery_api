const { MenuItem, AuditLog } = require("../models");
const { convertToRelativePath } = require("../utils/filePath");

const getMenuItems = async (req, res) => {
  try {
    const { category, availableOnly = "true", featuredOnly = "false" } = req.query;
    const whereClause = {};

    if (category && category !== "All") whereClause.category = category;
    if (availableOnly === "true") whereClause.available = true;
    if (featuredOnly === "true") whereClause.is_featured = true;

    const menuItems = await MenuItem.findAll({
      where: whereClause,
      order: [["category", "ASC"], ["name", "ASC"]],
    });

    return res.status(200).json({ success: true, data: menuItems });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getMenuItemById = async (req, res) => {
  try {
    const menuItem = await MenuItem.findByPk(req.params.id);
    if (!menuItem) {
      return res.status(404).json({ success: false, message: "Menu item not found" });
    }
    return res.status(200).json({ success: true, data: menuItem });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const createMenuItem = async (req, res) => {
  try {
    const {
      name,
      price,
      description,
      category,
      available,
      is_featured,
      preparation_time,
      calories,
    } = req.body;

    if (!name || price === undefined) {
      return res.status(400).json({
        success: false,
        message: "Name and price are required",
      });
    }

    const menuItem = await MenuItem.create({
      name,
      price,
      description: description || null,
      category: category || "Main",
      image_url: req.file ? convertToRelativePath(req.file.path) : null,
      available: available !== undefined ? available : true,
      is_featured: is_featured || false,
      preparation_time: preparation_time || 15,
      calories: calories || null,
      created_by: req.user.id,
    });

    await AuditLog.create({
      user_id: req.user.id,
      action: "create_menu_item",
      details: { menu_item_id: menuItem.id, name: menuItem.name },
      ip_address: req.ip,
    });

    return res.status(201).json({
      success: true,
      data: menuItem,
      message: "Menu item created successfully",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const updateMenuItem = async (req, res) => {
  try {
    const menuItem = await MenuItem.findByPk(req.params.id);
    if (!menuItem) {
      return res.status(404).json({ success: false, message: "Menu item not found" });
    }

    const {
      name,
      price,
      description,
      category,
      available,
      is_featured,
      preparation_time,
      calories,
    } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (price !== undefined) updateData.price = price;
    if (description !== undefined) updateData.description = description;
    if (category !== undefined) updateData.category = category;
    if (available !== undefined) updateData.available = available;
    if (is_featured !== undefined) updateData.is_featured = is_featured;
    if (preparation_time !== undefined) updateData.preparation_time = preparation_time;
    if (calories !== undefined) updateData.calories = calories;
    if (req.file) updateData.image_url = convertToRelativePath(req.file.path);

    await menuItem.update(updateData);

    await AuditLog.create({
      user_id: req.user.id,
      action: "update_menu_item",
      details: { menu_item_id: menuItem.id, name: menuItem.name },
      ip_address: req.ip,
    });

    return res.status(200).json({
      success: true,
      data: menuItem,
      message: "Menu item updated successfully",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const deleteMenuItem = async (req, res) => {
  try {
    const menuItem = await MenuItem.findByPk(req.params.id);
    if (!menuItem) {
      return res.status(404).json({ success: false, message: "Menu item not found" });
    }

    const itemName = menuItem.name;
    await menuItem.destroy();

    await AuditLog.create({
      user_id: req.user.id,
      action: "delete_menu_item",
      details: { menu_item_id: req.params.id, name: itemName },
      ip_address: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: "Menu item deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const toggleAvailability = async (req, res) => {
  try {
    const menuItem = await MenuItem.findByPk(req.params.id);
    if (!menuItem) {
      return res.status(404).json({ success: false, message: "Menu item not found" });
    }

    await menuItem.update({ available: !menuItem.available });

    await AuditLog.create({
      user_id: req.user.id,
      action: "toggle_menu_availability",
      details: { menu_item_id: menuItem.id, available: menuItem.available },
      ip_address: req.ip,
    });

    return res.status(200).json({
      success: true,
      data: menuItem,
      message: `Item is now ${menuItem.available ? "available" : "unavailable"}`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getCategories = async (req, res) => {
  return res.status(200).json({
    success: true,
    data: ["Burgers", "Pizza", "Chicken", "Drinks", "Desserts", "Salads", "Main"],
  });
};

module.exports = {
  getMenuItems,
  getMenuItemById,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  toggleAvailability,
  getCategories,
};
