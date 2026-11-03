import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:9000/api";
class SocketService {
  constructor() {
    this.socket = null;
    this.eventListeners = new Map();
  }

  // ✅ Initialize connection
  initializeConnection(socketPayload) {
    if (this.socket?.connected) {
      console.warn('⚠️ Socket already connected!');
      return;
    }

    console.log('🔗 Initializing socket with payload:', socketPayload);

    this.socket = io(SOCKET_URL, {
      transports: ['websocket'],
      query: socketPayload,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
      reconnectionDelayMax: 10000,
    });

    this.socket.on('connect', () => {
      console.log('✅ Connected to Socket.IO server with ID:', this.socket.id);
    });

    this.socket.on('connect_error', (error) => {
      console.error('❗ Connection Error:', error);
    });

    this.socket.on('disconnect', (reason) => {
      console.warn('⚡ Disconnected:', reason);
    });
  }

  // ✅ Disconnect socket
  disconnect() {
    if (this.socket) {
      console.log('❗ Disconnecting socket...');
      this.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
      this.eventListeners.clear();
    }
  }

  // ✅ Generic emit
  emitEvent(event, data) {
    if (this.socket) {
      console.log(`📤 Emitting Event: ${event}`, data);
      this.socket.emit(event, data);
    } else {
      console.error('❌ Socket not initialized!');
    }
  }

  // ✅ Generic on with duplicate prevention
  onEvent(event, callback) {
    if (!this.socket) {
      console.error('❌ Socket not initialized!');
      return;
    }

    if (this.eventListeners.has(event)) {
      console.log(`🔄 Removing existing listener for: ${event}`);
      this.offEvent(event);
    }

    console.log(`👂 Listening for Event: ${event}`);
    this.socket.on(event, callback);
    this.eventListeners.set(event, callback);
  }

  // ✅ Remove single event listener
  offEvent(event) {
    if (this.socket && this.eventListeners.has(event)) {
      console.log(`❌ Removing Listener for Event: ${event}`);
      const callback = this.eventListeners.get(event);
      this.socket.off(event, callback);
      this.eventListeners.delete(event);
    }
  }

  // ✅ Remove all listeners
  removeAllListeners() {
    if (this.socket) {
      console.log('🧹 Removing all listeners');
      this.eventListeners.forEach((callback, event) => {
        this.socket.off(event, callback);
      });
      this.eventListeners.clear();
    }
  }

  // =========================
  // TICKET CHAT HELPERS
  // =========================
  joinTicketRoom(ticketId, userId) {
    this.emitEvent('joinTicketRoom', { ticketId, userId });
  }

  sendTicketMessage({ ticketId, senderId, senderType, content }) {
    console.log("📤 Sending Ticket Msg:", { ticketId, senderId, senderType, content });
    this.emitEvent('ticketMessage', { ticketId, senderId, senderType, content });
  }

  onNewTicketMessage(callback) {
    this.onEvent('newTicketMessage', callback);
  }

  deleteTicketMessage({ ticketId, messageIds }) {
    console.log("🗑️ Deleting ticket message:", { ticketId, messageIds });
    this.emitEvent("deleteTicketMessage", { ticketId, messageIds });
  }

  onTicketMessageDeleted(callback) {
    this.onEvent("messageDeleted", callback);
  }

  // =========================
  // DRIVER-USER CHAT HELPERS
  // =========================
  joinDriverUserChatRoom(id, userId) {
    this.emitEvent('joinDriverUserChatRoom', { id, userId });
  }

  sendDriverUserChat({ id, senderId, receiverId, receiverType, content }) {
    this.emitEvent('driverUserChat', { id, senderId, receiverId, receiverType, content });
  }

  onReceiveDriverUserChat(callback) {
    this.onEvent('receiveDriverUserChat', callback);
  }

  markDriverUserChatAsRead(id, readerId) {
    this.emitEvent('markDriverUserChatAsRead', { id, readerId });
  }

  // =========================
  // DRIVER LIVE LOCATION HELPERS
  // =========================
  sendDriverLiveLocation({ rideId, rideBookingId, bookingId, driverId, lat, lng, heading, speed }) {
    this.emitEvent('driverLiveLocation', { rideId, rideBookingId, bookingId, driverId, lat, lng, heading, speed });
    console.log("📤 Sending Driver Live Location:", { rideId, rideBookingId, bookingId, driverId, lat, lng, heading, speed });
  }

  joinRideRoom(rideId, driverId) {
    this.emitEvent('joinRideRoom', { rideId, driverId });
  }

  leaveRideRoom(rideId) {
    this.emitEvent('leaveRideRoom', { rideId });
  }

  // =========================
  // SHAREABLE MAP TRACKING HELPERS
  // =========================

  // ✅ FIX: driverId check hata diya — "public" use hoga tracking page ke liye
  joinRideTrackingRoom(rideId) {
    if (!rideId) return console.warn("⚠️ rideId is required");
    console.log(`🚗 Joining ride tracking room: ${rideId}`);
    this.emitEvent("joinRideRoom", { rideId, driverId: "public" });
  }

  // ✅ FIX: condition fix kiya — sirf rideId check karo
  leaveRideTrackingRoom(rideId) {
    if (!rideId) return;
    console.log(`🚪 Leaving ride tracking room: ${rideId}`);
    this.emitEvent("leaveRideRoom", { rideId });
  }

  onRideLocationUpdate(callback) {
    console.log("👂 Listening for driver location updates");
    this.onEvent("updateDriverLocation", callback);
  }

  // ✅ NEW: Reconnect hone ke baad room rejoin karne ke liye
  // 'connect' event reconnect par bhi fire hota hai
  onReconnect(callback) {
    if (!this.socket) return;

    // ✅ Agar pehle se koi reconnect listener hai toh pehle hata do
    if (this.eventListeners.has('__reconnect__')) {
      this.socket.off('connect', this.eventListeners.get('__reconnect__'));
      this.eventListeners.delete('__reconnect__');
    }

    // ✅ Naya listener lagao aur Map mein track karo
    this.socket.on('connect', callback);
    this.eventListeners.set('__reconnect__', callback);
  }
}

export default new SocketService();
