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
    this.devices = {};
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  async onReady() {
    this.setObjectNotExists("deviceIPs", {
      type: "state",
      common: {
        read: true,
        write: true,
        role: "list",
        name: "IP-Addresses",
        type: "string"
      },
      native: {}
    });
    this.getStateAsync("deviceIPs").then((state) => {
      const ipRegex = /(?:[0-9]{1,3}\.){3}[0-9]{1,3}/g;
      const ips = `${state == null ? void 0 : state.val}`.match(ipRegex);
      if (ips === null) {
        this.log.error("No IPs found");
        return;
      }
      this.log.debug(`Found IPs: ${ips.join(", ")}`);
      for (const ip of ips) {
        const dev = new EzHomeDevice(this, ip, ip.split(".")[3]);
        this.devices[dev.id] = dev;
        dev.connect();
      }
      this.setState("deviceIPs", ips.join("\n"), true);
      this.setState("info.connection", true, true);
    });
  }
  onUnload(callback) {
    try {
      this.setState("info.connection", false, true);
      for (const devId in this.devices) {
        const dev = this.devices[devId];
        dev.shutdown();
        this.clearInterval(dev.heartbeatInterval);
      }
      callback();
    } catch (e) {
      callback();
    }
  }
  onStateChange(id, state) {
    if (!state || state.ack)
      return;
    const stateIdSplit = id.replace(`${this.namespace}.`, "").split(".");
    const devId = stateIdSplit[0];
    stateIdSplit.shift();
    this.devices[devId].stateChanged(stateIdSplit, state.val);
  }
}
class EzHomeDevice {
  constructor(ezHome, ip, id) {
    this.shouldShutdown = false;
    this.onWsError = (error) => {
      this.ezHome.log.debug(`[ws|${this.id}] connection error: ${error.name} (${error.message})`);
    };
    this.onWsConnected = (connection) => {
      this.wsConnection = connection;
      this.ezHome.log.debug(`[ws|${this.id}] connected`);
      connection.on("error", this.onWsError);
      connection.on("close", this.onWsClose);
      connection.on("message", this.onWsStateDefinitionsMessage);
      this.heartbeatInterval = this.ezHome.setInterval(() => this.sendHeartbeat(), 5 * 60 * 1e3);
      this.ezHome.log.debug(`[ws|${this.id}] attached connection callbacks`);
    };
    this.onWsClose = (_, desc) => {
      this.ezHome.log.debug(`[ws|${this.id}] connection closed: ${desc}`);
      this.ezHome.clearInterval(this.heartbeatInterval);
      if (!this.shouldShutdown) {
        this.connect();
      }
    };
    this.onWsStateDefinitionsMessage = (msg) => {
      if (msg.type !== "utf8")
        return;
      this.ezHome.log.debug(`[ws|${this.id}] received state definitions`);
      this.wsConnection.removeListener("message", this.onWsStateDefinitionsMessage);
      this.wsConnection.on("message", this.onWsStateUpdateMessage);
      const virtualDevices = JSON.parse(msg.utf8Data);
      for (const virtualDev of virtualDevices) {
        for (const state of virtualDev.states) {
          const stateId = state.id;
          delete state.id;
          const statePath = [this.id, virtualDev.id, stateId].join(".");
          this.ezHome.setObjectNotExistsAsync(statePath, {
            type: "state",
            common: state,
            native: {}
          });
          this.ezHome.subscribeStates(statePath);
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
          this.ezHome.setState([this.id, device.i, state].join("."), device.s[state], true);
        }
      }
    };
    this.ezHome = ezHome;
    this.ip = ip;
    this.id = id;
  }
  getUrl() {
    return `ws://${this.ip}/ws`;
  }
  connect() {
    this.wsClient = new ws.client();
    this.wsClient.on("connectFailed", this.onWsError);
    this.wsClient.on("connect", this.onWsConnected);
    this.wsClient.connect(this.getUrl());
  }
  sendHeartbeat() {
    if (this.wsConnection) {
      this.wsConnection.send("{}");
      this.ezHome.log.debug(`[ws|${this.id}] heartbeat sent`);
    }
  }
  handleHeartbeat() {
    this.ezHome.log.debug(`[ws|${this.id}] got heartbeat response`);
  }
  stateChanged(path, val) {
    const obj = {};
    obj[path[1]] = val;
    const arr = [{ i: Number(path[0]), s: obj }];
    this.wsConnection.sendUTF(JSON.stringify(arr));
    this.ezHome.log.debug(`[ws|${this.id}] sent: ${path.join(".")} -> ${val}`);
  }
  shutdown() {
    var _a;
    this.shouldShutdown = true;
    (_a = this.wsConnection) == null ? void 0 : _a.close();
  }
}
if (require.main !== module) {
  module.exports = (options) => new Ezhome(options);
} else {
  (() => new Ezhome())();
}
//# sourceMappingURL=main.js.map
