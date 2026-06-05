/** Business settings — adjust for your operator in Ghana */
export const CONFIG = {
  currency: "GHS",
  /** Default pickup price — collector overrides per-pickup after inspection */
  pickupPriceGhs: 5,
  /** Platform fee taken from each paid pickup (your revenue) */
  platformFeePercent: 10,
  defaultCenter: { lat: 5.6037, lng: -0.187, zoom: 13 },
};

export function formatGhs(amount) {
  return `GH₵ ${Number(amount).toFixed(2)}`;
}

export function calcFees(pickupPrice) {
  const platformFee = (pickupPrice * CONFIG.platformFeePercent) / 100;
  const collectorGets = pickupPrice - platformFee;
  return { platformFee, collectorGets, total: pickupPrice };
}
