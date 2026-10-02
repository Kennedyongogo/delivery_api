const bcrypt = require("bcryptjs");
const { User, AuditLog, sequelize } = require("./src/models");

const EMAIL = "tmp-ui-owner@test.local";

(async () => {
  if (process.argv[2] === "clean") {
    const owner = await User.findOne({ where: { email: EMAIL } });
    if (owner) {
      const members = await User.findAll({ where: { created_by: owner.id } });
      const ids = [owner.id, ...members.map((m) => m.id)];
      await AuditLog.destroy({ where: { user_id: ids } });
      await User.destroy({ where: { id: members.map((m) => m.id) } });
      await owner.destroy();
      console.log(`removed ${ids.length} users`);
    }
  } else {
    await User.create({
      full_name: "Tmp UI Owner",
      email: EMAIL,
      phone: "0700099999",
      password: await bcrypt.hash("secret123", 10),
      role: "shop_owner",
      is_active: true,
    });
    console.log("created");
  }
  await sequelize.close();
})();
