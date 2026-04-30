const { UserAddress } = require("../models");

const getMyAddresses = async (req, res) => {
  try {
    const addresses = await UserAddress.findAll({
      where: { user_id: req.user.id },
      order: [
        ["is_default", "DESC"],
        ["createdAt", "DESC"],
      ],
    });
    return res.status(200).json({ success: true, data: addresses });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const createAddress = async (req, res) => {
  try {
    const { label, address_line, latitude, longitude, is_default } = req.body;
    if (!address_line) {
      return res.status(400).json({ success: false, message: "Address is required" });
    }
    if (is_default === true) {
      await UserAddress.update(
        { is_default: false },
        { where: { user_id: req.user.id, is_default: true } }
      );
    }
    const address = await UserAddress.create({
      user_id: req.user.id,
      label: label || "Other",
      address_line,
      latitude: latitude || null,
      longitude: longitude || null,
      is_default: is_default === true,
    });
    return res.status(201).json({ success: true, data: address });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const updateAddress = async (req, res) => {
  try {
    const address = await UserAddress.findByPk(req.params.id);
    if (!address || address.user_id !== req.user.id) {
      return res.status(404).json({ success: false, message: "Address not found" });
    }
    const { label, address_line, latitude, longitude, is_default } = req.body;
    if (is_default === true) {
      await UserAddress.update(
        { is_default: false },
        { where: { user_id: req.user.id, is_default: true } }
      );
    }
    await address.update({
      label: label ?? address.label,
      address_line: address_line ?? address.address_line,
      latitude: latitude ?? address.latitude,
      longitude: longitude ?? address.longitude,
      is_default: is_default ?? address.is_default,
    });
    return res.status(200).json({ success: true, data: address });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const deleteAddress = async (req, res) => {
  try {
    const address = await UserAddress.findByPk(req.params.id);
    if (!address || address.user_id !== req.user.id) {
      return res.status(404).json({ success: false, message: "Address not found" });
    }
    await address.destroy();
    return res.status(200).json({ success: true, message: "Address deleted" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getMyAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
};
