// ✅ Final Complete Code — ShareableMap.jsx
import React, { useState, useEffect, useRef } from "react";
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  Polyline,
} from "@react-google-maps/api";
import {
  MapPin,
  Clock,
  User,
  Car,
  CreditCard,
  AlertCircle,
  CheckCircle,
  Navigation,
  AlertTriangle,
  Info,
  Shield,
} from "lucide-react";
import socketService from "../utils/socket";

const GOOGLE_MAPS_API_KEY = "AIzaSyCcY-izWmGoLt6BQ1KK8hyE5JaI27R17Bs";
const API_BASE_URL =
  import.meta.env.VITE_BACKEND_URL || "http://localhost:9000/api";
const LIBRARIES = ["places", "geometry"];

const mapContainerStyle = { height: "100%", width: "100%" };
const mapOptions = {
  zoomControl: true,
  streetViewControl: true,
  mapTypeControl: false,
  fullscreenControl: false,
};

// ─────────────────────────────────────────────────────────────
// 🔧 UTILITY — Bearing angle between two lat/lng points
// ─────────────────────────────────────────────────────────────
function computeBearing(from, to) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const dLng = toRad(to.lng - from.lng);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// ─────────────────────────────────────────────────────────────
// 🔧 UTILITY — Lerp (Linear Interpolation) between two points
// ─────────────────────────────────────────────────────────────
function lerp(start, end, t) {
  return {
    lat: start.lat + (end.lat - start.lat) * t,
    lng: start.lng + (end.lng - start.lng) * t,
  };
}

// ─────────────────────────────────────────────────────────────
// 🔧 UTILITY — Rotated car icon using canvas
// ─────────────────────────────────────────────────────────────
function createRotatedCarIcon(bearing) {
  if (typeof window === "undefined" || !window.google) return null;

  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 48;
  const ctx = canvas.getContext("2d");

  ctx.translate(24, 24);
  ctx.rotate((bearing * Math.PI) / 180);

  // Car body
  ctx.fillStyle = "#F97316";
  ctx.beginPath();
  ctx.roundRect(-10, -18, 20, 36, 5);
  ctx.fill();

  // Windshield — front indicator (top)
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.beginPath();
  ctx.roundRect(-7, -14, 14, 8, 2);
  ctx.fill();

  // Rear window (bottom)
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.roundRect(-7, 6, 14, 6, 2);
  ctx.fill();

  return {
    url: canvas.toDataURL(),
    scaledSize: new window.google.maps.Size(48, 48),
    anchor: new window.google.maps.Point(24, 24),
  };
}

function ShareableMap() {
  const mapRef = useRef(null);
  const [tripData, setTripData] = useState(null);
  const [liveLocation, setLiveLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [routePath, setRoutePath] = useState([]);
  const [driverAddress, setDriverAddress] = useState("Fetching location...");

  // ── Refs ──────────────────────────────────────────────────
  const markerRef = useRef(null);
  const liveLocationRef = useRef(null);
  const animFrameRef = useRef(null);
  const animStartTimeRef = useRef(null);
  const animFromRef = useRef(null);
  const animToRef = useRef(null);
  const bearingRef = useRef(0);
  const isAnimatingRef = useRef(false);

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: LIBRARIES,
  });

  // ─────────────────────────────────────────────────────────────
  // ✅ Helper — is ride active (live tracking on)?
  // ─────────────────────────────────────────────────────────────
  const isRideActive = (status) =>
    status === "In Progress" || status === "Ride Started";

  // ✅ Helper — is ride completed?
  const isRideCompleted = (status) =>
    status === "Completed" || status === "Dropped";

  // ─────────────────────────────────────────────────────────────
  // URL se tripId nikalna
  // ─────────────────────────────────────────────────────────────
  const getTripIdFromURL = () => {
    const params = new URLSearchParams(window.location.search);
    return params.get("tripId") || "6982e014bbda598007f477a5";
  };

  const parseDriverLocation = (driverLocation) => {
    if (!driverLocation) return null;
    if (
      driverLocation.type === "Point" &&
      Array.isArray(driverLocation.coordinates)
    ) {
      return {
        lng: driverLocation.coordinates[0],
        lat: driverLocation.coordinates[1],
      };
    }
    if (driverLocation.lat && driverLocation.lng) return driverLocation;
    return null;
  };

  const decodePolyline = (encoded) => {
    if (!window.google?.maps?.geometry) return [];
    const path = window.google.maps.geometry.encoding.decodePath(encoded);
    return path.map((p) => ({ lat: p.lat(), lng: p.lng() }));
  };

  // ─────────────────────────────────────────────────────────────
  // Routes API — full route polyline
  // ─────────────────────────────────────────────────────────────
  const fetchRouteFromAPI = async (origin, destination, waypoints = []) => {
    try {
      const body = {
        origin: {
          location: { latLng: { latitude: origin.lat, longitude: origin.lng } },
        },
        destination: {
          location: {
            latLng: { latitude: destination.lat, longitude: destination.lng },
          },
        },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        computeAlternativeRoutes: false,
      };
      if (waypoints.length > 0) {
        body.intermediates = waypoints.map((wp) => ({
          location: { latLng: { latitude: wp.lat, longitude: wp.lng } },
        }));
      }
      const response = await fetch(
        "https://routes.googleapis.com/directions/v2:computeRoutes",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
            "X-Goog-FieldMask": "routes.polyline.encodedPolyline",
          },
          body: JSON.stringify(body),
        },
      );
      const data = await response.json();
      if (data.routes?.[0]?.polyline?.encodedPolyline) {
        return decodePolyline(data.routes[0].polyline.encodedPolyline);
      }
      return null;
    } catch (err) {
      console.error("❌ fetchRouteFromAPI failed:", err);
      return null;
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Trip data fetch
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchTripData = async () => {
      try {
        setLoading(true);
        const tripId = getTripIdFromURL();
        const response = await fetch(`${API_BASE_URL}/activeRide/${tripId}`);
        if (!response.ok) throw new Error("Failed to fetch trip data");

        const result = await response.json();
        if (result.success && result.data) {
          const apiData = result.data;
          const parsedDriverLocation = parseDriverLocation(
            apiData.driverLocation,
          );

          const transformedData = {
            _id: apiData._id,
            tripId: apiData.bookingId,
            status: apiData.status,
            pickup: {
              location: apiData.pickupLocation,
              coordinates: {
                lat: apiData.pickupCoordinates.lat,
                lng: apiData.pickupCoordinates.lng,
              },
              time: apiData.date,
            },
            stops: [],
            drop: apiData.dropLocation
              ? {
                  location: apiData.dropLocation,
                  coordinates: {
                    lat: apiData.dropCoordinates?.lat,
                    lng: apiData.dropCoordinates?.lng,
                  },
                  time: apiData.tripEndTime,
                }
              : null,
            tripStartTime: apiData.tripStartTime,
            tripEndTime: apiData.tripEndTime,
            driver: apiData.assignedDriver
              ? {
                  name: apiData.assignedDriver.name || "Not Assigned",
                  phone: apiData.assignedDriver.phone || "N/A",
                  email: apiData.assignedDriver.email || "N/A",
                  image: apiData.assignedDriver.image || "N/A",
                }
              : null,
            cab: {
              type: apiData.cabDetails?.vehicleType || "Unknown",
              model: apiData.cabDetails?.vehicleVariant || "Unknown",
              number: apiData.cabDetails?.vehicleNumber || "N/A",
              image: apiData.cabDetails?.cabImage,
            },
            payment: {
              advanceAmount: apiData.advanceAmount || 0,
              pendingAmount: apiData.pendingAmount || 0,
              totalAmount: apiData.totalAmount || 0,
              mode: apiData.paymentStatus,
            },
            currentLocation: parsedDriverLocation,
            rideType: apiData.rideType,
            bookingType: apiData.bookingType,
            pickups: apiData.pickups,

            // ── Fare recalculation ──
            isFareRecalculated: apiData.isFareRecalculated || false,
            isDropLocationChanged: apiData.isDropLocationChanged || false,
            fareRecalculationReason: apiData.fareRecalculationReason || null,
            extraCharges: apiData.extraCharges || 0,
            actualDropLocation: apiData.actualDropLocation || null,

            // ✅ Admin force end fields
            forcefullyEndedByAdmin: apiData.forcefullyEndedByAdmin || false,
            isAdminForceEndRecalculation:
              apiData.isAdminForceEndRecalculation || false,
            adminExtraKmAdded: apiData.adminExtraKmAdded || 0,
          };

          setTripData(transformedData);

          if (parsedDriverLocation) {
            setLiveLocation(parsedDriverLocation);
            liveLocationRef.current = parsedDriverLocation;
            reverseGeocode(parsedDriverLocation.lat, parsedDriverLocation.lng);
          }
        } else {
          setError(result.message || "Trip not found");
        }
      } catch (err) {
        console.error("Error fetching trip data:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchTripData();
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Full route polyline — ✅ Rental me skip
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!tripData || !isLoaded) return;
    if (tripData.rideType === "Rental" || !tripData.drop) return;

    const dropCoords =
      tripData.isDropLocationChanged &&
      tripData.actualDropLocation?.coordinates?.lat
        ? {
            lat: tripData.actualDropLocation.coordinates.lat,
            lng: tripData.actualDropLocation.coordinates.lng,
          }
        : tripData.drop.coordinates;

    const stopWaypoints = tripData.stops?.map((s) => s.coordinates) || [];
    fetchRouteFromAPI(
      tripData.pickup.coordinates,
      dropCoords,
      stopWaypoints,
    ).then((path) => {
      if (path) setRoutePath(path);
    });
  }, [tripData, isLoaded]);

  // ─────────────────────────────────────────────────────────────
  // ✅ OLA/UBER STYLE SMOOTH ANIMATION
  // ─────────────────────────────────────────────────────────────
  const ANIMATION_DURATION_MS = 3000;

  const smoothMoveTo = (from, to) => {
    if (!markerRef.current || !window.google) return;
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

    const newBearing = computeBearing(from, to);
    bearingRef.current = newBearing;
    animFromRef.current = from;
    animToRef.current = to;
    animStartTimeRef.current = null;
    isAnimatingRef.current = true;

    const animate = (timestamp) => {
      if (!isAnimatingRef.current) return;
      if (!animStartTimeRef.current) animStartTimeRef.current = timestamp;

      const elapsed = timestamp - animStartTimeRef.current;
      const rawT = Math.min(elapsed / ANIMATION_DURATION_MS, 1);
      const t = rawT < 0.5 ? 2 * rawT * rawT : -1 + (4 - 2 * rawT) * rawT;

      const current = lerp(animFromRef.current, animToRef.current, t);
      markerRef.current.setPosition(current);

      const rotatedIcon = createRotatedCarIcon(bearingRef.current);
      if (rotatedIcon) markerRef.current.setIcon(rotatedIcon);
      if (mapRef.current) mapRef.current.panTo(current);

      if (rawT < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        isAnimatingRef.current = false;
        liveLocationRef.current = to;
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);
  };

  // ─────────────────────────────────────────────────────────────
  // Reverse Geocoding
  // ─────────────────────────────────────────────────────────────
  const reverseGeocode = async (lat, lng) => {
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`,
      );
      const data = await response.json();
      if (data.results?.[0]?.formatted_address) {
        setDriverAddress(data.results[0].formatted_address);
      }
    } catch (err) {
      console.error("❌ Reverse geocoding failed:", err);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Socket — ✅ Sirf active rides ke liye
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!tripData?._id) return;
    if (!isRideActive(tripData.status)) {
      console.log("🔕 Ride not active — skipping socket connection");
      return;
    }

    const rideId = tripData._id;
    socketService.initializeConnection({ role: "public", rideId });

    const joinRoom = () => {
      socketService.joinRideTrackingRoom(rideId);
      console.log("🔗 Joined ride room:", rideId);
    };
    joinRoom();

    socketService.onReconnect(() => {
      console.log("🔄 Reconnected — rejoining room...");
      joinRoom();
    });

    socketService.onRideLocationUpdate((data) => {
      console.log("📡 Socket Location:", data);
      if (data?.lat && data?.lng) {
        const newLoc = { lat: data.lat, lng: data.lng };
        const prevLoc = liveLocationRef.current;
        if (prevLoc) smoothMoveTo(prevLoc, newLoc);
        reverseGeocode(data.lat, data.lng);
      }
    });

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      isAnimatingRef.current = false;
      socketService.leaveRideTrackingRoom(rideId);
      socketService.disconnect();
    };
  }, [tripData?._id, tripData?.status]);

  // ─────────────────────────────────────────────────────────────
  // Map onLoad — bounds fit
  // ─────────────────────────────────────────────────────────────
  const onLoad = (map) => {
    mapRef.current = map;
    if (tripData) {
      const bounds = new window.google.maps.LatLngBounds();
      bounds.extend(tripData.pickup.coordinates);
      if (tripData.rideType !== "Rental" && tripData.drop?.coordinates) {
        bounds.extend(tripData.drop.coordinates);
      }
      if (tripData.currentLocation) bounds.extend(tripData.currentLocation);
      if (
        tripData.rideType !== "Rental" &&
        tripData.isDropLocationChanged &&
        tripData.actualDropLocation?.coordinates?.lat
      ) {
        bounds.extend({
          lat: tripData.actualDropLocation.coordinates.lat,
          lng: tripData.actualDropLocation.coordinates.lng,
        });
      }
      map.fitBounds(bounds);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Loading / Error states
  // ─────────────────────────────────────────────────────────────
  if (!isLoaded || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-orange-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-orange-500 mx-auto mb-4"></div>
          <p className="text-gray-700 text-lg font-medium">
            Loading trip details...
          </p>
        </div>
      </div>
    );
  }

  if (loadError || error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            Error Loading
          </h2>
          <p className="text-gray-600">
            {error || "Please check your internet connection."}
          </p>
        </div>
      </div>
    );
  }

  if (!tripData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md text-center">
          <AlertCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            Trip Not Found
          </h2>
          <p className="text-gray-600">
            The requested trip could not be found.
          </p>
        </div>
      </div>
    );
  }

  const isRental = tripData.rideType === "Rental";

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-orange-50">
      {/* ── Header ── */}
      <header className="bg-white shadow-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="bg-gradient-to-br from-orange-500 to-orange-600 p-2 rounded-xl">
                <Navigation className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-800">
                  Live Trip Tracking
                </h1>
                <p className="text-sm text-gray-500">
                  Trip ID: {tripData.tripId}
                </p>
              </div>
            </div>
            {isRideActive(tripData.status) && (
              <div className="flex items-center space-x-2 bg-green-100 px-4 py-2 rounded-full">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-green-700 font-semibold text-sm">
                  {tripData.status}
                </span>
              </div>
            )}
            {isRideCompleted(tripData.status) && (
              <div className="bg-blue-100 px-4 py-2 rounded-full">
                <span className="text-blue-700 font-semibold text-sm">
                  {tripData.status}
                </span>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* ══════════════════════════════════════════════════════
            ✅ ALERT BANNERS — 4 scenarios covered
        ══════════════════════════════════════════════════════ */}

        {/* 1️⃣ Driver drop location changed — yellow */}
        {tripData.isFareRecalculated &&
          tripData.isDropLocationChanged &&
          !tripData.forcefullyEndedByAdmin && (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 rounded-lg shadow-md">
              <div className="flex items-start p-4">
                <AlertTriangle className="w-6 h-6 text-yellow-600 mr-3 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-yellow-800 mb-1">
                    ⚠️ Fare Adjusted — Drop Location Changed
                  </h3>
                  <p className="text-yellow-700 text-sm mb-2">
                    {tripData.fareRecalculationReason ||
                      "The fare has been recalculated due to route changes."}
                  </p>
                  {tripData.extraCharges > 0 && (
                    <div className="bg-yellow-100 rounded-md px-3 py-2 mt-2 inline-block">
                      <p className="text-yellow-900 font-semibold text-sm">
                        Additional Charges: ₹{tripData.extraCharges}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

        {/* 2️⃣ Admin force end WITH extraKm — red */}
        {tripData.forcefullyEndedByAdmin &&
          tripData.isAdminForceEndRecalculation &&
          tripData.isFareRecalculated && (
            <div className="bg-red-50 border-l-4 border-red-500 rounded-lg shadow-md">
              <div className="flex items-start p-4">
                <Shield className="w-6 h-6 text-red-600 mr-3 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-red-800 mb-1">
                    🔴 Ride Force Ended by Admin — Fare Adjusted
                  </h3>
                  <p className="text-red-700 text-sm mb-2">
                    {tripData.fareRecalculationReason ||
                      "This ride was forcefully ended by admin with extra km added."}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {tripData.adminExtraKmAdded > 0 && (
                      <div className="bg-red-100 rounded-md px-3 py-2 inline-block">
                        <p className="text-red-900 font-semibold text-sm">
                          Extra KM Added: {tripData.adminExtraKmAdded} km
                        </p>
                      </div>
                    )}
                    {tripData.extraCharges > 0 && (
                      <div className="bg-red-100 rounded-md px-3 py-2 inline-block">
                        <p className="text-red-900 font-semibold text-sm">
                          Extra Charges: ₹{tripData.extraCharges}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

        {/* 3️⃣ Admin force end WITHOUT extraKm — orange */}
        {tripData.forcefullyEndedByAdmin && !tripData.isFareRecalculated && (
          <div className="bg-orange-50 border-l-4 border-orange-500 rounded-lg shadow-md">
            <div className="flex items-start p-4">
              <Shield className="w-6 h-6 text-orange-600 mr-3 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-orange-800 mb-1">
                  🔴 Ride Force Ended by Admin
                </h3>
                <p className="text-orange-700 text-sm">
                  {tripData.fareRecalculationReason ||
                    "This ride was forcefully ended by admin. No fare changes were applied."}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 4️⃣ Rental ride badge — purple */}
        {isRental && (
          <div className="bg-purple-50 border-l-4 border-purple-400 rounded-lg shadow-md">
            <div className="flex items-center p-4">
              <Car className="w-5 h-5 text-purple-600 mr-3 flex-shrink-0" />
              <p className="text-purple-800 font-semibold text-sm">
                🚗 Rental Ride — No fixed drop location
              </p>
            </div>
          </div>
        )}

        {/* ── Map ── */}
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="h-[400px] sm:h-[500px] lg:h-[600px] relative">
            <GoogleMap
              mapContainerStyle={mapContainerStyle}
              center={liveLocation || tripData.pickup.coordinates}
              zoom={13}
              onLoad={onLoad}
              options={mapOptions}
            >
              {/* Blue route polyline — Rental me nahi */}
              {!isRental && routePath.length > 0 && (
                <Polyline
                  path={routePath}
                  options={{
                    strokeColor: "#2563EB",
                    strokeOpacity: 0.85,
                    strokeWeight: 5,
                  }}
                />
              )}

              {/* Pickup — Green A */}
              <Marker
                position={tripData.pickup.coordinates}
                icon={{
                  path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
                  fillColor: "#10B981",
                  fillOpacity: 1,
                  strokeColor: "#ffffff",
                  strokeWeight: 2,
                  scale: 2,
                  anchor: new window.google.maps.Point(12, 22),
                }}
                label={{
                  text: "A",
                  color: "#ffffff",
                  fontSize: "14px",
                  fontWeight: "bold",
                }}
              />

              {/* Drop marker — Rental me nahi */}
              {!isRental && tripData.drop?.coordinates && (
                <Marker
                  position={tripData.drop.coordinates}
                  icon={{
                    path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
                    fillColor: "#1507E0",
                    fillOpacity: tripData.isDropLocationChanged ? 0.4 : 1,
                    strokeColor: "#ffffff",
                    strokeWeight: 2,
                    scale: 2,
                    anchor: new window.google.maps.Point(12, 22),
                  }}
                  label={{
                    text: tripData.isDropLocationChanged ? "B₁" : "B",
                    color: "#ffffff",
                    fontSize: "14px",
                    fontWeight: "bold",
                  }}
                />
              )}

              {/* Actual Drop — Rental me nahi */}
              {!isRental &&
                tripData.isDropLocationChanged &&
                tripData.actualDropLocation?.coordinates?.lat && (
                  <Marker
                    position={{
                      lat: tripData.actualDropLocation.coordinates.lat,
                      lng: tripData.actualDropLocation.coordinates.lng,
                    }}
                    icon={{
                      path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
                      fillColor: "#EF4444",
                      fillOpacity: 1,
                      strokeColor: "#ffffff",
                      strokeWeight: 2,
                      scale: 2,
                      anchor: new window.google.maps.Point(12, 22),
                    }}
                    label={{
                      text: "B₂",
                      color: "#ffffff",
                      fontSize: "14px",
                      fontWeight: "bold",
                    }}
                  />
                )}

              {/* Live Cab Marker — Active AND Completed dono me */}
              {liveLocation && (
                <Marker
                  position={liveLocation}
                  onLoad={(marker) => {
                    markerRef.current = marker;
                    const icon = createRotatedCarIcon(bearingRef.current);
                    if (icon) marker.setIcon(icon);
                  }}
                  icon={{
                    url: "https://cdn-icons-png.flaticon.com/512/3097/3097144.png",
                    scaledSize: new window.google.maps.Size(40, 40),
                    anchor: new window.google.maps.Point(20, 20),
                  }}
                />
              )}

              {isRideCompleted(tripData.status) && (
                <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-white shadow-lg rounded-full px-6 py-3 flex items-center space-x-2">
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  <span className="font-semibold text-gray-800">
                    Trip Completed
                  </span>
                </div>
              )}
            </GoogleMap>
          </div>
        </div>

        {/* ── Trip Details Grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left — Route */}
          <div className="lg:col-span-2 bg-white rounded-2xl shadow-xl p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center">
              <MapPin className="w-6 h-6 text-orange-500 mr-2" />
              Trip Route
            </h2>
            <div className="space-y-6">
              {/* Pickup */}
              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0 w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                  <div className="w-4 h-4 bg-green-500 rounded-full"></div>
                </div>
                <div className="flex-1">
                  <p className="text-md text-gray-800 font-medium">
                    Pickup Location
                  </p>
                  <p className="text-gray-800 font-semibold">
                    {tripData.pickup.location}
                  </p>
                  <p className="text-sm text-gray-600 mt-1 flex items-center">
                    <Clock className="w-4 h-4 mr-1" /> {tripData.pickup.time}
                  </p>
                </div>
              </div>

              {/* Driver Location */}
              {liveLocation && (
                <div className="flex items-start space-x-4">
                  <div
                    className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${
                      isRideActive(tripData.status)
                        ? "bg-blue-100"
                        : "bg-gray-100"
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full ${
                        isRideActive(tripData.status)
                          ? "bg-blue-500 animate-pulse"
                          : "bg-gray-400"
                      }`}
                    ></div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <p
                        className={`text-md font-semibold ${
                          isRideActive(tripData.status)
                            ? "text-blue-600"
                            : "text-gray-600"
                        }`}
                      >
                        {isRideActive(tripData.status)
                          ? "Driver Current Location"
                          : "Driver Last Known Location"}
                      </p>
                      {isRideActive(tripData.status) && (
                        <div className="w-2 h-2 bg-blue-900 rounded-full animate-pulse"></div>
                      )}
                    </div>
                    <p className="text-gray-800 font-semibold mt-1">
                      {driverAddress}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {isRideActive(tripData.status)
                        ? "Live • Updates automatically"
                        : "Trip ended • Last recorded position"}
                    </p>
                  </div>
                </div>
              )}

              {/* Drop Location — Rental me nahi */}
              {!isRental && tripData.drop && (
                <div className="flex items-start space-x-4">
                  <div
                    className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${
                      tripData.isDropLocationChanged
                        ? "bg-gray-100"
                        : "bg-red-100"
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full ${
                        tripData.isDropLocationChanged
                          ? "bg-gray-400"
                          : "bg-red-500"
                      }`}
                    ></div>
                  </div>
                  <div className="flex-1">
                    <p className="text-md text-yellow-500 font-medium">
                      {tripData.isDropLocationChanged
                        ? "Original Drop Location"
                        : "Drop Location"}
                    </p>
                    <p
                      className={`font-semibold ${
                        tripData.isDropLocationChanged
                          ? "text-gray-500 line-through"
                          : "text-gray-800"
                      }`}
                    >
                      {tripData.drop.location}
                    </p>
                    <p className="text-sm text-gray-600 mt-1 flex items-center">
                      <Clock className="w-4 h-4 mr-1" /> {tripData.drop.time}
                    </p>
                  </div>
                </div>
              )}

              {/* Actual Drop — Rental me nahi */}
              {!isRental &&
                tripData.isDropLocationChanged &&
                tripData.actualDropLocation?.address && (
                  <div className="flex items-start space-x-4 bg-red-50 rounded-lg p-4 border-2 border-red-200">
                    <div className="flex-shrink-0 w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                      <div className="w-4 h-4 bg-red-500 rounded-full"></div>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <p className="text-sm text-red-700 font-semibold">
                          Actual Drop Location
                        </p>
                        <Info className="w-4 h-4 text-red-500" />
                      </div>
                      <p className="text-gray-800 font-semibold">
                        {tripData.actualDropLocation.address}
                      </p>
                      <p className="text-xs text-red-600 mt-2">
                        ⚠️ Drop location was changed during the trip
                      </p>
                    </div>
                  </div>
                )}

              {/* ✅ Admin Force End info block — no drop location change */}
              {tripData.forcefullyEndedByAdmin &&
                !tripData.isDropLocationChanged && (
                  <div className="flex items-start space-x-4 bg-orange-50 rounded-lg p-4 border-2 border-orange-200">
                    <div className="flex-shrink-0 w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
                      <Shield className="w-5 h-5 text-orange-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-orange-700 font-semibold mb-1">
                        Admin Force End
                      </p>
                      <p className="text-gray-700 text-sm">
                        {tripData.fareRecalculationReason ||
                          "This ride was forcefully ended by admin."}
                      </p>
                      {tripData.isAdminForceEndRecalculation &&
                        tripData.adminExtraKmAdded > 0 && (
                          <p className="text-xs text-orange-600 mt-2 font-medium">
                            Extra {tripData.adminExtraKmAdded} km added by admin
                          </p>
                        )}
                    </div>
                  </div>
                )}

              {/* Rental — no fixed destination */}
              {isRental && (
                <div className="flex items-start space-x-4 bg-purple-50 rounded-lg p-4 border-2 border-purple-200">
                  <div className="flex-shrink-0 w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
                    <Car className="w-5 h-5 text-purple-500" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-purple-700 font-semibold">
                      Rental Ride
                    </p>
                    <p className="text-gray-600 text-sm mt-1">
                      This is a rental ride. The drop location will be
                      determined at the end of the trip.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-blue-50 rounded-xl p-4">
                  <p className="text-sm text-gray-600 mb-1">Ride Type</p>
                  <p className="text-lg font-bold text-blue-700">
                    {tripData.rideType}
                  </p>
                </div>
                <div className="bg-purple-50 rounded-xl p-4">
                  <p className="text-sm text-gray-600 mb-1">Booking Type</p>
                  <p className="text-lg font-bold text-purple-700">
                    {tripData.bookingType}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right — Driver & Payment */}
          <div className="space-y-6">
            {/* Driver & Cab */}
            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center">
                <User className="w-6 h-6 text-orange-500 mr-2" />
                Driver & Cab Details
              </h2>
              {tripData.driver && (
                <div className="flex items-center space-x-4 mb-6">
                  <img
                    src={tripData.driver.image}
                    alt={tripData.driver.name}
                    className="w-20 h-20 rounded-full border-4 border-orange-100"
                  />
                  <div>
                    <p className="text-sm text-gray-500">Driver</p>
                    <p className="text-lg font-bold text-gray-800">
                      {tripData.driver.name}
                    </p>
                    <p className="text-sm text-gray-600">
                      {tripData.driver.phone}
                    </p>
                  </div>
                </div>
              )}
              <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-4 space-y-3">
                {tripData.cab.image && (
                  <div className="mb-3">
                    <img
                      src={tripData.cab.image}
                      alt="Cab"
                      className="w-full h-32 object-cover rounded-lg"
                    />
                  </div>
                )}
                <div className="flex items-center text-gray-700">
                  <Car className="w-5 h-5 text-orange-500 mr-3" />
                  <div>
                    <p className="text-sm text-gray-600">Vehicle</p>
                    <p className="font-semibold">
                      {tripData.cab.model} ({tripData.cab.type})
                    </p>
                  </div>
                </div>
                <div className="bg-white rounded-lg p-3 text-center mt-3">
                  <p className="text-sm text-gray-600 mb-1">Vehicle Number</p>
                  <p className="text-2xl font-bold text-gray-800 tracking-wider">
                    {tripData.cab.number}
                  </p>
                </div>
              </div>
            </div>

            {/* Payment */}
            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center">
                <CreditCard className="w-6 h-6 text-orange-500 mr-2" />
                Payment Details
              </h2>
              <div className="space-y-4">
                <div className="flex justify-between items-center py-3 border-b border-gray-200">
                  <span className="text-gray-600">Payment Status</span>
                  <span
                    className={`font-semibold px-3 py-1 rounded-full text-sm ${
                      tripData.payment.mode === "Paid"
                        ? "bg-green-100 text-green-700"
                        : tripData.payment.mode === "Advance Paid"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-red-100 text-red-700"
                    }`}
                  >
                    {tripData.payment.mode}
                  </span>
                </div>

                <div className="flex justify-between items-center py-3 border-b border-gray-200">
                  <span className="text-gray-600">Total Amount</span>
                  <span className="font-semibold text-gray-800">
                    ₹{tripData.payment.totalAmount}
                  </span>
                </div>

                {/* ✅ Extra Charges — driver drop change OR admin force end with extraKm */}
                {tripData.isFareRecalculated && tripData.extraCharges > 0 && (
                  <div className="flex justify-between items-center py-3 border-b border-red-200 bg-red-50 -mx-4 px-4 rounded">
                    <span className="text-red-700 font-medium">
                      {tripData.isAdminForceEndRecalculation
                        ? `Extra KM (${tripData.adminExtraKmAdded} km)`
                        : "Extra Charges"}
                    </span>
                    <span className="font-bold text-red-600">
                      +₹{tripData.extraCharges}
                    </span>
                  </div>
                )}

                {/* ✅ Admin Force End badge — even without extraKm */}
                {tripData.forcefullyEndedByAdmin && (
                  <div className="flex justify-between items-center py-3 border-b border-orange-200 bg-orange-50 -mx-4 px-4 rounded">
                    <span className="text-orange-700 font-medium">
                      Ended By
                    </span>
                    <span className="font-semibold text-orange-700 text-sm">
                      Admin (Force End)
                    </span>
                  </div>
                )}

                <div className="flex justify-between items-center py-3 border-b border-gray-200">
                  <span className="text-gray-600">Advance Paid</span>
                  <span className="font-bold text-green-600">
                    ₹{tripData.payment.advanceAmount}
                  </span>
                </div>

                {/* Remaining — Rental me nahi */}
                <div className="bg-orange-50 rounded-xl p-4 mt-4">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-gray-700">
                      Remaining
                    </span>
                    <span className="font-bold text-orange-600 text-xl">
                      ₹{tripData.payment.pendingAmount}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default ShareableMap;
