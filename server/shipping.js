import shipping from '../data/shipping.json' with { type: 'json' };

export function publicShipping(source = shipping) {
  const zones = (source.rates || []).map((rate) => ({
    fee: rate.fee,
    provinces: [...rate.provinces],
  }));
  return {
    estimate: source.estimate || '7 to 14 business days',
    zones,
    rates: zones.flatMap((zone) => zone.provinces.map((province) => ({ province, fee: zone.fee }))),
  };
}

export function shippingForProvince(province, source = shipping) {
  const name = String(province || '').trim();
  if (!name) return null;
  for (const zone of source.rates || []) {
    if (!zone.provinces.includes(name)) continue;
    if (typeof zone.fee !== 'number' || !Number.isFinite(zone.fee) || zone.fee < 0) return null;
    const feeCents = Math.round(zone.fee * 100);
    return { province: name, fee: zone.fee, feeCents, label: `${name} delivery` };
  }
  return null;
}
