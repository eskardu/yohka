type Point = {
  id: string;
  orderNumber: number;
  latitude: number;
  longitude: number;
};

function distanceKm(a: Pick<Point, "latitude" | "longitude">, b: Pick<Point, "latitude" | "longitude">) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthKm * Math.asin(Math.sqrt(h));
}

export function sortByNearestNeighbor(
  start: Pick<Point, "latitude" | "longitude">,
  points: Point[]
) {
  const remaining = [...points];
  const sorted: Point[] = [];
  let current = start;

  while (remaining.length > 0) {
    remaining.sort((a, b) => distanceKm(current, a) - distanceKm(current, b));
    const next = remaining.shift();
    if (!next) break;
    sorted.push(next);
    current = next;
  }

  return sorted;
}

export function buildGoogleMapsDirectionsUrl(
  start: Pick<Point, "latitude" | "longitude">,
  points: Point[]
) {
  const sorted = sortByNearestNeighbor(start, points);
  return buildGoogleMapsDirectionsUrlFromSorted(start, sorted);
}

export function buildGoogleMapsDirectionsUrlFromSorted(
  start: Pick<Point, "latitude" | "longitude">,
  sorted: Point[]
) {
  const routes = buildGoogleMapsDirectionChunks(start, sorted);
  const firstRoute = routes[0];
  return { url: firstRoute?.url ?? buildSingleRouteUrl(start, []), sorted, routes };
}

function buildSingleRouteUrl(
  start: Pick<Point, "latitude" | "longitude">,
  points: Point[]
) {
  const origin = `${start.latitude},${start.longitude}`;
  const destination = points.at(-1)
    ? `${points.at(-1)!.latitude},${points.at(-1)!.longitude}`
    : origin;
  const waypoints = points
    .slice(0, -1)
    .map((point) => `${point.latitude},${point.longitude}`)
    .join("|");
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);
  if (waypoints) url.searchParams.set("waypoints", waypoints);
  return url.toString();
}

export function buildGoogleMapsDirectionChunks(
  start: Pick<Point, "latitude" | "longitude">,
  sorted: Point[],
  maxOrdersPerRoute = 9
) {
  const routes: Array<{
    url: string;
    index: number;
    orders: Point[];
    startOrderNumber: number | null;
    endOrderNumber: number | null;
  }> = [];
  let routeStart = start;
  let previousOrder: Point | null = null;

  for (let index = 0; index < sorted.length; index += maxOrdersPerRoute) {
    const orders = sorted.slice(index, index + maxOrdersPerRoute);
    if (!orders.length) continue;

    routes.push({
      url: buildSingleRouteUrl(routeStart, orders),
      index: routes.length + 1,
      orders,
      startOrderNumber: previousOrder?.orderNumber ?? null,
      endOrderNumber: orders.at(-1)?.orderNumber ?? null
    });

    previousOrder = orders.at(-1) ?? previousOrder;
    routeStart = previousOrder
      ? { latitude: previousOrder.latitude, longitude: previousOrder.longitude }
      : routeStart;
  }

  return routes;
}

export function buildPointMapsUrl(latitude: number, longitude: number) {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}
