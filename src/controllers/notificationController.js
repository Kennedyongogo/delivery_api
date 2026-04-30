const { Notification } = require("../models");

const getMyNotifications = async (req, res) => {
  try {
    const notifications = await Notification.findAll({
      where: { user_id: req.user.id },
      order: [["createdAt", "DESC"]],
      limit: 100,
    });
    return res.status(200).json({ success: true, data: notifications });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const markNotificationRead = async (req, res) => {
  try {
    const notification = await Notification.findByPk(req.params.id);
    if (!notification || notification.user_id !== req.user.id) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }
    await notification.update({ is_read: true });
    return res.status(200).json({ success: true, data: notification });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const markAllRead = async (req, res) => {
  try {
    await Notification.update(
      { is_read: true },
      { where: { user_id: req.user.id, is_read: false } }
    );
    return res.status(200).json({ success: true, message: "All notifications marked as read" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getMyNotifications,
  markNotificationRead,
  markAllRead,
};
