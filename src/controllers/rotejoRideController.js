const { Op, fn, col } = require("sequelize");
const { User, RotejoProfile, RotejoRide } = require("../models");
const { LIVE_RIDE_STATUSES } = require("../models/rotejoRide");

const OFFER_MS = 15 * 1000;
const PRESENCE_MS = 60 * 1000;
const SEARCH_MS = 3 * 60 * 1000;
const RECENT_MS = 60 * 60 * 1000;
const MAX_PATH_POINTS = 300;

const text = (value) => String(value || "").trim();
const num = (value) => (value === null || value === undefined || value === "" ? NaN : Number(value));
const isLat = (value) => Number.isFinite(value) && value >= -90 && value <= 90;
const isLng = (value) => Number.isFinite(value) && value >= -180 && value <= 180;

const metersBetween = (aLat, aLng, bLat, bLng) => {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

const average = async (field, owner, id) => {
  const row = await RotejoRide.findOne({
    attributes: [
      [fn("AVG", col(field)), "avg"],
      [fn("COUNT", col(field)), "count"],
    ],
    where: { [owner]: id, [field]: { [Op.ne]: null } },
    raw: true,
  });
  return { rating: row?.avg ? Math.round(Number(row.avg) * 10) / 10 : null, ratings: Number(row?.count || 0) };
};

const riderCard = async (riderId) => {
  if (!riderId) return null;
  const [user, profile, score, trips] = await Promise.all([
    User.findByPk(riderId, { attributes: ["id", "full_name", "phone", "profile_image"] }),
    RotejoProfile.findOne({ where: { user_id: riderId } }),
    average("rider_rating", "rider_id", riderId),
    RotejoRide.count({ where: { rider_id: riderId, status: "completed" } }),
  ]);
  if (!user) return null;
  return {
    id: user.id,
    name: user.full_name,
    phone: user.phone,
    photo: user.profile_image,
    plate: profile?.plate || "",
    bike: profile ? `${profile.bike_colour} ${profile.bike_make} ${profile.bike_model}`.trim() : "",
    stage: profile?.stage || "",
    rating: score.rating,
    trips,
  };
};

const customerCard = async (customerId) => {
  const [user, score] = await Promise.all([
    User.findByPk(customerId, { attributes: ["id", "full_name", "phone"] }),
    average("customer_rating", "customer_id", customerId),
  ]);
  return user ? { id: user.id, name: user.full_name, phone: user.phone, rating: score.rating } : null;
};

// One view of a ride; the PIN goes to the customer only, offer timing to the rider being asked.
const rideView = async (ride, viewerId) => {
  const plain = ride.get({ plain: true });
  const isCustomer = plain.customer_id === viewerId;
  const view = {
    id: plain.id,
    status: plain.status,
    pickup: { lat: plain.pickup_lat, lng: plain.pickup_lng, label: plain.pickup_label },
    destination: { lat: plain.dest_lat, lng: plain.dest_lng, label: plain.dest_label },
    path: plain.path,
    meters: plain.meters,
    seconds: plain.seconds,
    fare: plain.fare,
    pin: isCustomer ? plain.pin : null,
    customer: await customerCard(plain.customer_id),
    rider: await riderCard(plain.rider_id),
    rider_position:
      plain.rider_lat === null || plain.rider_lng === null ? null : { lat: plain.rider_lat, lng: plain.rider_lng },
    leg_from:
      plain.leg_from_lat === null || plain.leg_from_lng === null
        ? null
        : { lat: plain.leg_from_lat, lng: plain.leg_from_lng },
    progress: plain.progress,
    rider_rating: plain.rider_rating,
    customer_rating: plain.customer_rating,
    cancelled_by: plain.cancelled_by,
    cancel_reason: plain.cancel_reason,
    requested_at: plain.createdAt,
    accepted_at: plain.accepted_at,
    arrived_at: plain.arrived_at,
    started_at: plain.started_at,
    completed_at: plain.completed_at,
    cancelled_at: plain.cancelled_at,
  };
  if (plain.offered_to === viewerId && plain.offer_expires_at) {
    view.offer_ms_left = Math.max(0, new Date(plain.offer_expires_at).getTime() - Date.now());
  }
  return view;
};

const busyRiderIds = async () => {
  const rows = await RotejoRide.findAll({
    attributes: ["rider_id", "offered_to", "offer_expires_at"],
    where: {
      status: { [Op.in]: LIVE_RIDE_STATUSES },
      [Op.or]: [{ rider_id: { [Op.ne]: null } }, { offered_to: { [Op.ne]: null } }],
    },
    raw: true,
  });
  const now = Date.now();
  const busy = new Set();
  for (const row of rows) {
    if (row.rider_id) busy.add(row.rider_id);
    if (row.offered_to && new Date(row.offer_expires_at).getTime() > now) busy.add(row.offered_to);
  }
  return busy;
};

// Moves one searching ride along: expire a stale offer, then ask the nearest free rider.
const dispatch = async (ride) => {
  if (ride.status !== "searching") return ride;
  const now = Date.now();
  if (ride.offered_to && new Date(ride.offer_expires_at).getTime() > now) return ride;
  const declined = new Set(ride.declined_by || []);
  if (ride.offered_to) declined.add(ride.offered_to);
  if (now - new Date(ride.createdAt).getTime() > SEARCH_MS) {
    return ride.update({
      status: "cancelled",
      offered_to: null,
      offer_expires_at: null,
      declined_by: [...declined],
      cancelled_by: "system",
      cancel_reason: "No rider took the ride. Try again in a moment.",
      cancelled_at: new Date(),
    });
  }
  const busy = await busyRiderIds();
  const riders = await RotejoProfile.findAll({
    where: {
      status: "approved",
      online: true,
      last_seen: { [Op.gte]: new Date(now - PRESENCE_MS) },
      lat: { [Op.ne]: null },
      lng: { [Op.ne]: null },
    },
    include: [{ model: User, as: "rider", attributes: ["id", "is_active"] }],
  });
  const nearest = riders
    .filter(
      (profile) =>
        profile.user_id !== ride.customer_id &&
        !declined.has(profile.user_id) &&
        !busy.has(profile.user_id) &&
        profile.rider?.is_active !== false
    )
    .map((profile) => ({
      id: profile.user_id,
      meters: metersBetween(profile.lat, profile.lng, ride.pickup_lat, ride.pickup_lng),
    }))
    .sort((a, b) => a.meters - b.meters)[0];
  return ride.update({
    offered_to: nearest ? nearest.id : null,
    offer_expires_at: nearest ? new Date(now + OFFER_MS) : null,
    declined_by: [...declined],
  });
};

const dispatchWaiting = async () => {
  const waiting = await RotejoRide.findAll({
    where: { status: "searching" },
    order: [["createdAt", "ASC"]],
    limit: 25,
  });
  for (const ride of waiting) await dispatch(ride);
};

const point = (value) => {
  const lat = num(value?.lat);
  const lng = num(value?.lng);
  return isLat(lat) && isLng(lng) ? { lat, lng, label: text(value?.label).slice(0, 160) } : null;
};

const cleanPath = (value) => {
  if (!Array.isArray(value)) return [];
  const points = value
    .map((pair) => (Array.isArray(pair) ? [num(pair[0]), num(pair[1])] : null))
    .filter((pair) => pair && isLat(pair[0]) && isLng(pair[1]));
  if (points.length <= MAX_PATH_POINTS) return points;
  const step = (points.length - 1) / (MAX_PATH_POINTS - 1);
  return Array.from({ length: MAX_PATH_POINTS }, (_, i) => points[Math.round(i * step)]);
};

const send = (res, status, data) => res.status(status).json({ success: true, data });
const fail = (res, status, message) => res.status(status).json({ success: false, message });

const handle = (work) => async (req, res) => {
  try {
    return await work(req, res);
  } catch (err) {
    return fail(res, 500, err.message);
  }
};

// ---- Customer ----

const requestRide = handle(async (req, res) => {
  const pickup = point(req.body.pickup);
  const destination = point(req.body.destination);
  const meters = num(req.body.meters);
  const seconds = num(req.body.seconds);
  const fare = Math.round(num(req.body.fare));
  if (!pickup || !pickup.label) return fail(res, 400, "Set where to pick you up.");
  if (!destination || !destination.label) return fail(res, 400, "Set where you are going.");
  if (metersBetween(pickup.lat, pickup.lng, destination.lat, destination.lng) < 50) {
    return fail(res, 400, "Pickup and destination are the same place.");
  }
  if (!Number.isFinite(meters) || meters <= 0 || !Number.isFinite(seconds) || seconds <= 0) {
    return fail(res, 400, "Price the ride first.");
  }
  if (!Number.isFinite(fare) || fare <= 0) return fail(res, 400, "Price the ride first.");
  const live = await RotejoRide.findOne({
    where: { customer_id: req.user.id, status: { [Op.in]: LIVE_RIDE_STATUSES } },
  });
  if (live) return fail(res, 409, "You already have a ride. Finish or cancel it first.");
  const ride = await RotejoRide.create({
    customer_id: req.user.id,
    pickup_lat: pickup.lat,
    pickup_lng: pickup.lng,
    pickup_label: pickup.label,
    dest_lat: destination.lat,
    dest_lng: destination.lng,
    dest_label: destination.label,
    path: cleanPath(req.body.path),
    meters,
    seconds,
    fare,
    pin: String(Math.floor(1000 + Math.random() * 9000)),
  });
  await dispatch(ride);
  return send(res, 201, await rideView(ride, req.user.id));
});

// The customer's live ride, or the last finished one still waiting for stars.
const currentRide = handle(async (req, res) => {
  await dispatchWaiting();
  const live = await RotejoRide.findOne({
    where: { customer_id: req.user.id, status: { [Op.in]: LIVE_RIDE_STATUSES } },
    order: [["createdAt", "DESC"]],
  });
  const ride =
    live ||
    (await RotejoRide.findOne({
      where: {
        customer_id: req.user.id,
        updatedAt: { [Op.gte]: new Date(Date.now() - RECENT_MS) },
        [Op.or]: [
          { status: "completed", rider_rating: null },
          { status: "cancelled", cancelled_by: { [Op.ne]: "customer" } },
        ],
      },
      order: [["updatedAt", "DESC"]],
    }));
  return send(res, 200, ride ? await rideView(ride, req.user.id) : null);
});

const myRides = handle(async (req, res) => {
  const rides = await RotejoRide.findAll({
    where: { customer_id: req.user.id },
    order: [["createdAt", "DESC"]],
    limit: 30,
  });
  const views = [];
  for (const ride of rides) views.push(await rideView(ride, req.user.id));
  return send(res, 200, views);
});

// Customers cancel any time before the trip starts; a rider who backs out sends it back to search.
const cancelRide = handle(async (req, res) => {
  const ride = await RotejoRide.findByPk(req.params.id);
  if (!ride) return fail(res, 404, "Ride not found");
  const me = req.user.id;
  if (ride.customer_id === me) {
    if (!["searching", "coming", "arrived"].includes(ride.status)) {
      return fail(res, 400, "This ride can no longer be cancelled.");
    }
    await ride.update({
      status: "cancelled",
      offered_to: null,
      offer_expires_at: null,
      cancelled_by: "customer",
      cancel_reason: text(req.body.reason).slice(0, 120) || null,
      cancelled_at: new Date(),
    });
    return send(res, 200, await rideView(ride, me));
  }
  if (ride.rider_id === me) {
    if (!["coming", "arrived"].includes(ride.status)) {
      return fail(res, 400, "Finish the trip instead.");
    }
    await ride.update({
      status: "searching",
      rider_id: null,
      rider_lat: null,
      rider_lng: null,
      leg_from_lat: null,
      leg_from_lng: null,
      progress: 0,
      accepted_at: null,
      arrived_at: null,
      declined_by: [...new Set([...(ride.declined_by || []), me])],
    });
    await dispatch(ride);
    return send(res, 200, null);
  }
  return fail(res, 404, "Ride not found");
});

const rateRide = handle(async (req, res) => {
  const stars = Math.round(num(req.body.stars));
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return fail(res, 400, "Pick 1 to 5 stars.");
  const ride = await RotejoRide.findByPk(req.params.id);
  if (!ride) return fail(res, 404, "Ride not found");
  if (ride.status !== "completed") return fail(res, 400, "Rate the ride once it is complete.");
  if (ride.customer_id === req.user.id) {
    if (ride.rider_rating) return fail(res, 400, "You already rated this ride.");
    await ride.update({ rider_rating: stars });
  } else if (ride.rider_id === req.user.id) {
    if (ride.customer_rating) return fail(res, 400, "You already rated this passenger.");
    await ride.update({ customer_rating: stars });
  } else {
    return fail(res, 404, "Ride not found");
  }
  return send(res, 200, await rideView(ride, req.user.id));
});

// ---- Rider ----

const approvedProfile = async (req, res) => {
  const profile = await RotejoProfile.findOne({ where: { user_id: req.user.id } });
  if (!profile) {
    fail(res, 404, "No Rotejo application yet");
    return null;
  }
  if (profile.status !== "approved") {
    fail(res, 403, "Your application is not approved yet.");
    return null;
  }
  return profile;
};

const setPresence = handle(async (req, res) => {
  const profile = await approvedProfile(req, res);
  if (!profile) return undefined;
  const online = req.body.online === true || req.body.online === "true";
  const lat = num(req.body.lat);
  const lng = num(req.body.lng);
  if (online && !(isLat(lat) && isLng(lng))) return fail(res, 400, "Share your location to go online.");
  await profile.update({
    online,
    ...(isLat(lat) && isLng(lng) ? { lat, lng } : {}),
    last_seen: new Date(),
  });
  if (!online) {
    await RotejoRide.update(
      { offered_to: null, offer_expires_at: null },
      { where: { status: "searching", offered_to: req.user.id } }
    );
  }
  return send(res, 200, { online: profile.online, lat: profile.lat, lng: profile.lng });
});

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

// Everything the rider's phone needs: a pending offer, the live job, a passenger to rate, and today's trips.
const riderFeed = handle(async (req, res) => {
  const profile = await RotejoProfile.findOne({ where: { user_id: req.user.id } });
  if (!profile) return fail(res, 404, "No Rotejo application yet");
  if (profile.online) await profile.update({ last_seen: new Date() });
  await dispatchWaiting();
  const me = req.user.id;
  const [offer, job, unrated, today, score] = await Promise.all([
    RotejoRide.findOne({
      where: { status: "searching", offered_to: me, offer_expires_at: { [Op.gt]: new Date() } },
    }),
    RotejoRide.findOne({ where: { rider_id: me, status: { [Op.in]: LIVE_RIDE_STATUSES } } }),
    RotejoRide.findOne({
      where: {
        rider_id: me,
        status: "completed",
        customer_rating: null,
        completed_at: { [Op.gte]: new Date(Date.now() - RECENT_MS) },
      },
      order: [["completed_at", "DESC"]],
    }),
    RotejoRide.findAll({
      where: { rider_id: me, status: "completed", completed_at: { [Op.gte]: startOfToday() } },
      order: [["completed_at", "DESC"]],
    }),
    average("rider_rating", "rider_id", me),
  ]);
  const todayViews = [];
  for (const ride of today) todayViews.push(await rideView(ride, me));
  return send(res, 200, {
    online: profile.online,
    status: profile.status,
    offer: offer ? await rideView(offer, me) : null,
    job: job ? await rideView(job, me) : null,
    to_rate: unrated ? await rideView(unrated, me) : null,
    today: todayViews,
    rating: score.rating,
    trips: await RotejoRide.count({ where: { rider_id: me, status: "completed" } }),
  });
});

const riderPoint = (body) => {
  const lat = num(body.lat);
  const lng = num(body.lng);
  return isLat(lat) && isLng(lng) ? { lat, lng } : null;
};

const acceptOffer = handle(async (req, res) => {
  const profile = await approvedProfile(req, res);
  if (!profile) return undefined;
  const me = req.user.id;
  const ride = await RotejoRide.findByPk(req.params.id);
  if (
    !ride ||
    ride.status !== "searching" ||
    ride.offered_to !== me ||
    new Date(ride.offer_expires_at).getTime() <= Date.now()
  ) {
    return fail(res, 410, "This request has moved to another rider.");
  }
  const busy = await RotejoRide.findOne({ where: { rider_id: me, status: { [Op.in]: LIVE_RIDE_STATUSES } } });
  if (busy) return fail(res, 409, "Finish your current trip first.");
  const at = riderPoint(req.body) || (profile.lat !== null ? { lat: profile.lat, lng: profile.lng } : null);
  const start = at || { lat: ride.pickup_lat, lng: ride.pickup_lng };
  await ride.update({
    status: "coming",
    rider_id: me,
    offered_to: null,
    offer_expires_at: null,
    accepted_at: new Date(),
    rider_lat: start.lat,
    rider_lng: start.lng,
    leg_from_lat: start.lat,
    leg_from_lng: start.lng,
    progress: 0,
  });
  return send(res, 200, await rideView(ride, me));
});

const declineOffer = handle(async (req, res) => {
  const me = req.user.id;
  const ride = await RotejoRide.findByPk(req.params.id);
  if (!ride || ride.status !== "searching" || ride.offered_to !== me) return send(res, 200, null);
  await ride.update({
    offered_to: null,
    offer_expires_at: null,
    declined_by: [...new Set([...(ride.declined_by || []), me])],
  });
  await dispatch(ride);
  return send(res, 200, null);
});

const myJob = async (req, res, statuses) => {
  const ride = await RotejoRide.findByPk(req.params.id);
  if (!ride || ride.rider_id !== req.user.id) {
    fail(res, 404, "Ride not found");
    return null;
  }
  if (!statuses.includes(ride.status)) {
    fail(res, 409, ride.status === "cancelled" ? "The passenger cancelled this ride." : "This step is already done.");
    return null;
  }
  return ride;
};

const updatePosition = handle(async (req, res) => {
  const at = riderPoint(req.body);
  if (!at) return fail(res, 400, "Send a valid location.");
  const ride = await myJob(req, res, ["coming", "arrived", "on_trip"]);
  if (!ride) return undefined;
  const progress = Math.min(1, Math.max(0, num(req.body.progress) || 0));
  await ride.update({ rider_lat: at.lat, rider_lng: at.lng, progress });
  await RotejoProfile.update({ ...at, last_seen: new Date() }, { where: { user_id: req.user.id } });
  return send(res, 200, { status: ride.status });
});

const markArrived = handle(async (req, res) => {
  const ride = await myJob(req, res, ["coming"]);
  if (!ride) return undefined;
  await ride.update({
    status: "arrived",
    arrived_at: new Date(),
    rider_lat: ride.pickup_lat,
    rider_lng: ride.pickup_lng,
    progress: 1,
  });
  return send(res, 200, await rideView(ride, req.user.id));
});

const startTrip = handle(async (req, res) => {
  const ride = await myJob(req, res, ["arrived"]);
  if (!ride) return undefined;
  if (text(req.body.pin) !== ride.pin) return fail(res, 400, "That PIN does not match. Ask the passenger again.");
  await ride.update({
    status: "on_trip",
    started_at: new Date(),
    rider_lat: ride.pickup_lat,
    rider_lng: ride.pickup_lng,
    leg_from_lat: ride.pickup_lat,
    leg_from_lng: ride.pickup_lng,
    progress: 0,
  });
  return send(res, 200, await rideView(ride, req.user.id));
});

const completeTrip = handle(async (req, res) => {
  const ride = await myJob(req, res, ["on_trip"]);
  if (!ride) return undefined;
  await ride.update({
    status: "completed",
    completed_at: new Date(),
    rider_lat: ride.dest_lat,
    rider_lng: ride.dest_lng,
    progress: 1,
  });
  return send(res, 200, await rideView(ride, req.user.id));
});

module.exports = {
  requestRide,
  currentRide,
  myRides,
  cancelRide,
  rateRide,
  setPresence,
  riderFeed,
  acceptOffer,
  declineOffer,
  updatePosition,
  markArrived,
  startTrip,
  completeTrip,
};
