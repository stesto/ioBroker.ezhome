/*
 * Created with @iobroker/create-adapter v2.1.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
// Load your modules here, e.g.:
// import * as fs from "fs";
import * as utils from "@iobroker/adapter-core";
import * as ws from "websocket";

class Ezhome extends utils.Adapter {
    devices: Record<string, EzHomeDevice> = {};

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: "ezhome",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        // this.on("objectChange", this.onObjectChange.bind(this));
        // this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        this.setObjectNotExists("deviceIPs", {
            type: "state",
            common: {
                read: true,
                write: true,
                role: "list",
                name: "IP-Addresses",
                type: "string",
            },
            native: {},
        });

        this.getStateAsync("deviceIPs").then((state) => {
            const ipRegex = /(?:[0-9]{1,3}\.){3}[0-9]{1,3}/g;
            const ips = `${state?.val}`.match(ipRegex);

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

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     */
    private onUnload(callback: () => void): void {
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

    /**
     * Is called if a subscribed state changes
     */
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (!state || state.ack) return;
        // if (!this.wsConnection.connected) {
        //     this.log.debug("[ws] no client connected. Skip sending values");
        //     return;
        // }
        const stateIdSplit = id.replace(`${this.namespace}.`, "").split(".");
        const devId = stateIdSplit[0];
        stateIdSplit.shift(); // removes id
        this.devices[devId].stateChanged(stateIdSplit, state.val);

        // const idSplit: string[] = id.split(".");
        // const obj: any = {};
        // obj[idSplit[idSplit.length - 1]] = state.val;
        // const arr = [{ i: Number(idSplit[idSplit.length - 2]), s: obj }];
        // // this.log.debug(JSON.stringify(arr));
        // this.wsConnection.sendUTF(JSON.stringify(arr));

        // this.log.debug("[ws] send new state values");
    }
}

class EzHomeDevice {
    ezHome: Ezhome;
    public ip: string;
    public id: string;

    public wsClient!: ws.client;
    public wsConnection!: ws.connection;
    public heartbeatInterval!: ioBroker.Interval;

    private shouldShutdown = false;

    public constructor(ezHome: Ezhome, ip: string, id: string) {
        this.ezHome = ezHome;
        this.ip = ip;
        this.id = id;
    }

    public getUrl(): string {
        return `ws://${this.ip}/ws`;
    }

    public connect(): void {
        this.wsClient = new ws.client();

        this.wsClient.on("connectFailed", this.onWsError);
        this.wsClient.on("connect", this.onWsConnected);

        this.wsClient.connect(this.getUrl());
    }

    onWsError = (error: Error): void => {
        this.ezHome.log.debug(`[ws|${this.id}] connection error: ${error.name} (${error.message})`);
    };

    onWsConnected = (connection: ws.connection): void => {
        this.wsConnection = connection;
        this.ezHome.log.debug(`[ws|${this.id}] connected`);

        connection.on("error", this.onWsError);
        connection.on("close", this.onWsClose);
        connection.on("message", this.onWsStateDefinitionsMessage);

        this.heartbeatInterval = this.ezHome.setInterval(() => this.sendHeartbeat(), 5 * 60 * 1000);
        this.ezHome.log.debug(`[ws|${this.id}] attached connection callbacks`);
    };

    onWsClose = (_: number, desc: string): void => {
        this.ezHome.log.debug(`[ws|${this.id}] connection closed: ${desc}`);
        this.ezHome.clearInterval(this.heartbeatInterval);

        if (!this.shouldShutdown) {
            this.connect();
        }
    };

    sendHeartbeat(): void {
        if (this.wsConnection) {
            this.wsConnection.send("{}");
            this.ezHome.log.debug(`[ws|${this.id}] heartbeat sent`);
        }
    }

    onWsStateDefinitionsMessage = (msg: ws.Message): void => {
        if (msg.type !== "utf8") return;
        this.ezHome.log.debug(`[ws|${this.id}] received state definitions`);

        this.wsConnection.removeListener("message", this.onWsStateDefinitionsMessage);
        this.wsConnection.on("message", this.onWsStateUpdateMessage);

        const virtualDevices = JSON.parse(msg.utf8Data);
        for (const virtualDev of virtualDevices) {
            for (const state of virtualDev.states) {
                const stateId: string = state.id;
                delete state.id;
                const statePath = [this.id, virtualDev.id, stateId].join(".");

                this.ezHome.setObjectNotExistsAsync(statePath, {
                    type: "state",
                    common: state as ioBroker.StateCommon,
                    native: {},
                });
                this.ezHome.subscribeStates(statePath);
            }
        }
    };

    onWsStateUpdateMessage = (msg: ws.Message): void => {
        if (msg.type !== "utf8") return;

        if (msg.utf8Data == "{}") {
            this.handleHeartbeat();
            return;
        }
        // this.log.debug(msg.utf8Data);
        const devices = JSON.parse(msg.utf8Data);

        for (const device of devices) {
            for (const state in device.s) {
                this.ezHome.setState([this.id, device.i, state].join("."), device.s[state], true);
            }
        }
    };

    handleHeartbeat(): void {
        this.ezHome.log.debug(`[ws|${this.id}] got heartbeat response`);
    }

    public stateChanged(path: string[], val: ioBroker.StateValue): void {
        const obj: any = {};
        obj[path[1]] = val;
        const arr = [{ i: Number(path[0]), s: obj }];
        this.wsConnection.sendUTF(JSON.stringify(arr));

        this.ezHome.log.debug(`[ws|${this.id}] sent: ${path.join(".")} -> ${val}`);
    }

    public shutdown(): void {
        this.shouldShutdown = true;
        this.wsConnection?.close();
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Ezhome(options);
} else {
    // otherwise start the instance directly
    (() => new Ezhome())();
}
