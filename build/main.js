var __create = Object.create;
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target, mod));
var utils = __toESM(require("@iobroker/adapter-core"));
var ws = __toESM(require("websocket"));
class Ezhome extends utils.Adapter {
  constructor(options = {}) {
    super(__spreadProps(__spreadValues({}, options), {
      name: "ezhome"
    }));
    this.onWsError = (error) => {
      this.log.debug("[ws] connection error: " + error.name + " (" + error.message + ")");
    };
    this.onWsClose = (_, desc) => {
      this.log.debug("[ws] connection closed: " + desc);
      this.connectToClient();
    };
    this.onWsStateDefinitionsMessage = (msg) => {
      if (msg.type !== "utf8")
        return;
      this.log.debug("[ws] receives state definitions");
      this.wsConnection.removeListener("message", this.onWsStateDefinitionsMessage);
      this.wsConnection.on("message", this.onWsStateUpdateMessage);
      const devices = JSON.parse(msg.utf8Data);
      for (const device of devices) {
        for (const state of device.states) {
          const stateId = state.id;
          delete state.id;
          this.setObjectNotExistsAsync(device.id + "." + stateId, {
            type: "state",
            common: state,
            native: {}
          });
          this.subscribeStates(device.id + "." + stateId);
        }
      }
    };
    this.onWsStateUpdateMessage = (msg) => {
      if (msg.type !== "utf8")
        return;
      if (msg.utf8Data == "{}") {
        this.handleHeartbeat();
        return;
      }
      const devices = JSON.parse(msg.utf8Data);
      for (const device of devices) {
        for (const state in device.s) {
          this.setState(device.i + "." + state, device.s[state], true);
        }
      }
    };
    this.onWsConnected = (connection) => {
      this.wsConnection = connection;
      this.log.debug("[ws] connected");
      connection.on("error", this.onWsError);
      connection.on("close", this.onWsClose);
      connection.on("message", this.onWsStateDefinitionsMessage);
      this.clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = this.setInterval(this.sendHeartbeat.bind(this), 6e4);
      this.log.debug("[ws] attached connection callbacks");
    };
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  sendHeartbeat() {
    if (this.wsConnection) {
      this.wsConnection.send("{}");
      this.log.debug("[ws] heartbeat sent");
    }
  }
  handleHeartbeat() {
    this.log.debug("[ws] got heartbeat response");
  }
  connectToClient() {
    this.wsClient.connect("ws://192.168.69.45/ws");
  }
  async onReady() {
    this.wsClient = new ws.client();
    this.wsClient.on("connectFailed", this.onWsError);
    this.wsClient.on("connect", this.onWsConnected);
    this.log.debug("[ws] attached client callbacks");
    this.connectToClient();
  }
  onUnload(callback) {
    try {
      this.wsConnection.close();
      this.clearInterval(this.heartbeatInterval);
      callback();
    } catch (e) {
      callback();
    }
  }
  onStateChange(id, state) {
    if (!state || state.ack)
      return;
    if (!this.wsConnection.connected) {
      this.log.debug("[ws] no client connected. Skip sending values");
      return;
    }
    const idSplit = id.split(".");
    const obj = {};
    obj[idSplit[idSplit.length - 1]] = state.val;
    const arr = [{ i: Number(idSplit[idSplit.length - 2]), s: obj }];
    this.wsConnection.sendUTF(JSON.stringify(arr));
    this.log.debug("[ws] send new state values");
  }
}
if (require.main !== module) {
  module.exports = (options) => new Ezhome(options);
} else {
  (() => new Ezhome())();
}
//# sourceMappingURL=main.js.map
