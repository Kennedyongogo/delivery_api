const ROLES = Object.freeze({
  CUSTOMER: "customer",
  ROTEJO_RIDER: "rotejo_rider",
  SHOP_RIDER: "shop_rider",
  STAFF: "staff",
  SHOP_OWNER: "shop_owner",
  SUPER_ADMIN: "super_admin",
});

const ALL_ROLES = Object.values(ROLES);
const RIDER_ROLES = [ROLES.ROTEJO_RIDER, ROLES.SHOP_RIDER];
const ADMIN_ROLES = [ROLES.SHOP_OWNER, ROLES.STAFF];
// Staff and shop riders belong to the shop owner who created them (`users.created_by`).
const SHOP_MEMBER_ROLES = [ROLES.STAFF, ROLES.SHOP_RIDER];
const SHOP_ROLES = [ROLES.SHOP_OWNER, ...SHOP_MEMBER_ROLES];

const isRider = (role) => RIDER_ROLES.includes(role);

module.exports = { ROLES, ALL_ROLES, RIDER_ROLES, ADMIN_ROLES, SHOP_MEMBER_ROLES, SHOP_ROLES, isRider };
