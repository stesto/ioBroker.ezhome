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
    wsClient!: ws.client;
    wsConnection!: ws.connection;
    heartbeatInterval!: ioBroker.Interval;

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

    public onWsError = (error: Error): void => {
        this.log.debug("[ws] connection error: " + error.name + " (" + error.message + ")");
    };

    public onWsClose = (_: number, desc: string): void => {
        this.log.debug("[ws] connection closed: " + desc);
        this.connectToClient();
    };

    public onWsStateDefinitionsMessage = (msg: ws.Message): void => {
        if (msg.type !== "utf8") return;
        this.log.debug("[ws] receives state definitions");
        // this.wsConnection.removeAllListeners();
        this.wsConnection.removeListener("message", this.onWsStateDefinitionsMessage);
        this.wsConnection.on("message", this.onWsStateUpdateMessage);

        const devices = JSON.parse(msg.utf8Data);
        for (const device of devices) {
            for (const state of device.states) {
                const stateId: string = state.id;
                delete state.id;
                this.setObjectNotExistsAsync(device.id + "." + stateId, {
                    type: "state",
                    common: state as ioBroker.StateCommon,
                    native: {},
                });
                this.subscribeStates(device.id + "." + stateId);
            }
        }
    };

    public onWsStateUpdateMessage = (msg: ws.Message): void => {
        if (msg.type !== "utf8") return;

        if (msg.utf8Data == "{}") {
            this.handleHeartbeat();
            return;
        }
        // this.log.debug(msg.utf8Data);
        const devices = JSON.parse(msg.utf8Data);

        for (const device of devices) {
            for (const state in device.s) {
                this.setState(device.i + "." + state, device.s[state], true);
            }
        }
    };

    public sendHeartbeat(): void {
        if (this.wsConnection) {
            this.wsConnection.send("{}");
            this.log.debug("[ws] heartbeat sent");
        }
    }

    public handleHeartbeat(): void {
        this.log.debug("[ws] got heartbeat response");
    }

    public onWsConnected = (connection: ws.connection): void => {
        this.wsConnection = connection;
        this.log.debug("[ws] connected");
        connection.on("error", this.onWsError);
        connection.on("close", this.onWsClose);
        connection.on("message", this.onWsStateDefinitionsMessage);
        this.clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = this.setInterval(this.sendHeartbeat.bind(this), 5 * 60 * 1000);
        this.log.debug("[ws] attached connection callbacks");
    };

    public connectToClient(): void {
        this.wsClient.connect("ws://192.168.69.45/ws");
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        // Initialize your adapter heres
        this.wsClient = new ws.client();

        this.wsClient.on("connectFailed", this.onWsError);
        this.wsClient.on("connect", this.onWsConnected);
        this.log.debug("[ws] attached client callbacks");

        this.connectToClient();

        // Reset the connection indicator during startup
        // this.setState("info.connection", false, true);

        // The adapters config (in the instance object everything under the attribute "native") is accessible via
        // this.config:
        // this.log.info("config option1: " + this.config.option1);
        // this.log.info("config option2: " + this.config.option2);

        /*
		For every state in the system there has to be also an object of type state
		Here a simple template for a boolean variable named "testVariable"
		Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
		*/
        // await this.setObjectNotExistsAsync("testVariable", {
        //     type: "state",
        //     common: {
        //         name: "testVariable",
        //         type: "boolean",
        //         role: "indicator",
        //         read: true,
        //         write: true,
        //     },
        //     native: {},
        // });

        // In order to get state updates, you need to subscribe to them. The following line adds a subscription for our variable we have created above.
        // this.subscribeStates("testVariable");
        // You can also add a subscription for multiple states. The following line watches all states starting with "lights."
        // this.subscribeStates("lights.*");
        // Or, if you really must, you can also watch all states. Don't do this if you don't need to. Otherwise this will cause a lot of unnecessary load on the system:
        // this.subscribeStates("*");

        /*
			setState examples
			you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
		*/
        // the variable testVariable is set to true as command (ack=false)
        // await this.setStateAsync("testVariable", true);

        // same thing, but the value is flagged "ack"
        // ack should be always set to true if the value is received from or acknowledged from the target system
        // await this.setStateAsync("testVariable", { val: true, ack: true });

        // same thing, but the state is deleted after 30s (getState will return null afterwards)
        // await this.setStateAsync("testVariable", { val: true, ack: true, expire: 30 });

        // examples for the checkPassword/checkGroup functions
        // let result = await this.checkPasswordAsync("admin", "iobroker");
        // this.log.info("check user admin pw iobroker: " + result);

        // result = await this.checkGroupAsync("admin", "admin");
        // this.log.info("check group user admin group admin: " + result);
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     */
    private onUnload(callback: () => void): void {
        try {
            // Here you must clear all timeouts or intervals that may still be active
            // clearTimeout(timeout1);
            // clearTimeout(timeout2);
            // ...
            // clearInterval(interval1);
            this.wsConnection.close();
            this.clearInterval(this.heartbeatInterval);
            callback();
        } catch (e) {
            callback();
        }
    }

    // If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
    // You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
    // /**
    //  * Is called if a subscribed object changes
    //  */
    // private onObjectChange(id: string, obj: ioBroker.Object | null | undefined): void {
    //     if (obj) {
    //         // The object was changed
    //         this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
    //     } else {
    //         // The object was deleted
    //         this.log.info(`object ${id} deleted`);
    //     }
    // }

    /**
     * Is called if a subscribed state changes
     */
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (!state || state.ack) return;
        if (!this.wsConnection.connected) {
            this.log.debug("[ws] no client connected. Skip sending values");
            return;
        }
        const idSplit: string[] = id.split(".");
        const obj: any = {};
        obj[idSplit[idSplit.length - 1]] = state.val;
        const arr = [{ i: Number(idSplit[idSplit.length - 2]), s: obj }];
        // this.log.debug(JSON.stringify(arr));
        this.wsConnection.sendUTF(JSON.stringify(arr));

        this.log.debug("[ws] send new state values");
    }

    // If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
    // /**
    //  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
    //  * Using this method requires "common.messagebox" property to be set to true in io-package.json
    //  */
    // private onMessage(obj: ioBroker.Message): void {
    //     if (typeof obj === "object" && obj.message) {
    //         if (obj.command === "send") {
    //             // e.g. send email or pushover or whatever
    //             this.log.info("send command");

    //             // Send response in callback if required
    //             if (obj.callback) this.sendTo(obj.from, obj.command, "Message received", obj.callback);
    //         }
    //     }
    // }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Ezhome(options);
} else {
    // otherwise start the instance directly
    (() => new Ezhome())();
}
