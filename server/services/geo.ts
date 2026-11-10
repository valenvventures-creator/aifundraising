/**
 * Geocoding for trip planning. Uses Google Geocoding when GOOGLE_MAPS_API_KEY is
 * configured; otherwise falls back to a built-in gazetteer of major US/Canadian
 * cities (city-level precision only). Results are stored on the donor record.
 */
import type { Db } from '../db/pool.js';
import { many } from '../db/pool.js';
import { config } from '../config.js';

const GAZ: Record<string, [number, number]> = {
  'new york,ny': [40.7128, -74.006], 'los angeles,ca': [34.0522, -118.2437], 'chicago,il': [41.8781, -87.6298], 'houston,tx': [29.7604, -95.3698],
  'phoenix,az': [33.4484, -112.074], 'philadelphia,pa': [39.9526, -75.1652], 'san antonio,tx': [29.4241, -98.4936], 'san diego,ca': [32.7157, -117.1611],
  'dallas,tx': [32.7767, -96.797], 'austin,tx': [30.2672, -97.7431], 'fort worth,tx': [32.7555, -97.3308], 'jacksonville,fl': [30.3322, -81.6557],
  'columbus,oh': [39.9612, -82.9988], 'charlotte,nc': [35.2271, -80.8431], 'indianapolis,in': [39.7684, -86.1581], 'san francisco,ca': [37.7749, -122.4194],
  'seattle,wa': [47.6062, -122.3321], 'denver,co': [39.7392, -104.9903], 'washington,dc': [38.9072, -77.0369], 'boston,ma': [42.3601, -71.0589],
  'nashville,tn': [36.1627, -86.7816], 'franklin,tn': [35.9251, -86.8689], 'brentwood,tn': [36.0331, -86.7828], 'murfreesboro,tn': [35.8456, -86.3903],
  'hendersonville,tn': [36.3048, -86.62], 'clarksville,tn': [36.5298, -87.3595], 'knoxville,tn': [35.9606, -83.9207], 'memphis,tn': [35.1495, -90.049],
  'chattanooga,tn': [35.0456, -85.3097], 'atlanta,ga': [33.749, -84.388], 'birmingham,al': [33.5186, -86.8104], 'louisville,ky': [38.2527, -85.7585],
  'lexington,ky': [38.0406, -84.5037], 'detroit,mi': [42.3314, -83.0458], 'grand rapids,mi': [42.9634, -85.6681], 'minneapolis,mn': [44.9778, -93.265],
  'st. louis,mo': [38.627, -90.1994], 'kansas city,mo': [39.0997, -94.5786], 'oklahoma city,ok': [35.4676, -97.5164], 'tulsa,ok': [36.154, -95.9928],
  'omaha,ne': [41.2565, -95.9345], 'raleigh,nc': [35.7796, -78.6382], 'durham,nc': [35.994, -78.8986], 'greensboro,nc': [36.0726, -79.792],
  'charleston,sc': [32.7765, -79.9311], 'greenville,sc': [34.8526, -82.394], 'richmond,va': [37.5407, -77.436], 'virginia beach,va': [36.8529, -75.978],
  'baltimore,md': [39.2904, -76.6122], 'pittsburgh,pa': [40.4406, -79.9959], 'cleveland,oh': [41.4993, -81.6944], 'cincinnati,oh': [39.1031, -84.512],
  'milwaukee,wi': [43.0389, -87.9065], 'orlando,fl': [28.5383, -81.3792], 'tampa,fl': [27.9506, -82.4572], 'miami,fl': [25.7617, -80.1918],
  'las vegas,nv': [36.1699, -115.1398], 'salt lake city,ut': [40.7608, -111.891], 'portland,or': [45.5152, -122.6784], 'sacramento,ca': [38.5816, -121.4944],
  'san jose,ca': [37.3382, -121.8863], 'albuquerque,nm': [35.0844, -106.6504], 'boise,id': [43.615, -116.2023], 'colorado springs,co': [38.8339, -104.8214],
  'new orleans,la': [29.9511, -90.0715], 'little rock,ar': [34.7465, -92.2896], 'jackson,ms': [32.2988, -90.1848], 'des moines,ia': [41.5868, -93.625],
  'toronto,on': [43.6532, -79.3832], 'vancouver,bc': [49.2827, -123.1207], 'calgary,ab': [51.0447, -114.0719], 'ottawa,on': [45.4215, -75.6972],
  'montreal,qc': [45.5017, -73.5673], 'edmonton,ab': [53.5461, -113.4938], 'winnipeg,mb': [49.8951, -97.1384],
};

function key(city: string, region?: string | null) { return `${city.trim().toLowerCase()},${(region ?? '').trim().toLowerCase()}`; }

export function gazetteer(city?: string | null, region?: string | null): { lat: number; lng: number } | null {
  if (!city) return null;
  const exact = GAZ[key(city, region)];
  if (exact) return { lat: exact[0], lng: exact[1] };
  const c = city.trim().toLowerCase();
  const hit = Object.entries(GAZ).find(([k]) => k.split(',')[0] === c);
  return hit ? { lat: hit[1][0], lng: hit[1][1] } : null;
}

async function google(address: string) {
  if (!config.google.mapsKey) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${config.google.mapsKey}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const j: any = await r.json();
  const loc = j.results?.[0]?.geometry?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}

/** "Nashville, TN" or "Nashville" → coordinates. Also tries known donor coordinates in that city. */
export async function geocodeCity(db: Db, text: string, region?: string | null, postal?: string | null) {
  const [c, r] = text.includes(',') ? text.split(',').map((s) => s.trim()) : [text.trim(), region ?? null];
  const g = await google([c, r, postal].filter(Boolean).join(', ')).catch(() => null);
  if (g) return g;
  const z = gazetteer(c, r);
  if (z) return z;
  const known = await many(db, `SELECT avg(lat) lat, avg(lng) lng FROM donors WHERE lower(city)=lower($1) AND lat IS NOT NULL HAVING count(*)>0`, [c]);
  return known[0] ? { lat: Number(known[0].lat), lng: Number(known[0].lng) } : null;
}

/** Fill lat/lng for donors with a city but no coordinates. */
export async function geocodeDonors(db: Db, limit = 200) {
  const rows = await many(db, `SELECT id, address1, city, region, postal_code, country FROM donors WHERE lat IS NULL AND city IS NOT NULL AND NOT archived LIMIT $1`, [limit]);
  let n = 0;
  for (const d of rows) {
    const g = (await google([d.address1, d.city, d.region, d.postal_code, d.country].filter(Boolean).join(', ')).catch(() => null)) ?? gazetteer(d.city, d.region);
    if (g) { await db.query(`UPDATE donors SET lat=$2, lng=$3 WHERE id=$1`, [d.id, g.lat, g.lng]); n++; }
  }
  return n;
}
