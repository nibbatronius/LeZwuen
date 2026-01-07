const crypto = require("crypto");

const BUCKETS = [
  { key: "250m", label: "Within 250m", meters: 250, column: "location_bucket" },
  { key: "1km", label: "Within 1km", meters: 1000, column: "location_bucket_1k" },
  { key: "5km", label: "Within 5km", meters: 5000, column: "location_bucket_5k" }
];

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function cellIdForMeters(lat, lng, meters) {
  const latSize = meters / 111320;
  const cos = Math.abs(Math.cos(toRadians(lat)));
  const lngSize = meters / (111320 * Math.max(0.2, cos));
  const latIndex = Math.floor(lat / latSize);
  const lngIndex = Math.floor(lng / lngSize);
  return `${latIndex}:${lngIndex}`;
}

function hashCellId(cellId, salt) {
  return crypto
    .createHash("sha256")
    .update(`${salt}:${cellId}`)
    .digest("hex")
    .slice(0, 16);
}

function computeBuckets(lat, lng, salt) {
  return BUCKETS.map((bucket) => {
    const cellId = cellIdForMeters(lat, lng, bucket.meters);
    const bucketId = hashCellId(cellId, salt);
    return {
      key: bucket.key,
      label: bucket.label,
      meters: bucket.meters,
      column: bucket.column,
      bucketId,
      roomKey: `${bucket.key}:${bucketId}`
    };
  });
}

function roomsFromUser(user) {
  if (!user) {
    return [];
  }

  return BUCKETS.map((bucket) => {
    const bucketId = user[bucket.column];
    if (!bucketId) {
      return null;
    }

    return {
      key: bucket.key,
      label: bucket.label,
      meters: bucket.meters,
      roomKey: `${bucket.key}:${bucketId}`
    };
  }).filter(Boolean);
}

function isRoomAllowed(roomKey, user) {
  const rooms = roomsFromUser(user);
  return rooms.some((room) => room.roomKey === roomKey);
}

function containsTradeKeywords(message) {
  if (!message) {
    return false;
  }

  return /\b(buy|sell|trade|swap|price|offer|for\s+sale|wtb|wts)\b/i.test(message);
}

function filterBlockedMessages(messages, blockedIds) {
  if (!Array.isArray(messages) || !blockedIds || blockedIds.size === 0) {
    return messages || [];
  }

  return messages.filter((message) => !blockedIds.has(message.user_id));
}

module.exports = {
  BUCKETS,
  computeBuckets,
  roomsFromUser,
  isRoomAllowed,
  containsTradeKeywords,
  filterBlockedMessages
};
