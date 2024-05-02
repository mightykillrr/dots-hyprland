import Hyprland from 'resource:///com/github/Aylur/ags/service/hyprland.js';
import Service from 'resource:///com/github/Aylur/ags/service.js';
import * as Utils from 'resource:///com/github/Aylur/ags/utils.js';
const { exec, execAsync } = Utils;

import { clamp } from '../modules/.miscutils/mathfuncs.js';

class BrightnessServiceBase extends Service {
    static {
        Service.register(
            this,
            { 'screen-changed': ['float'], },
            { 'screen-value': ['float', 'rw'], },
        );
    }

    _screenValue = 0;

    // the getter has to be in snake_case
    get screen_value() { return this._screenValue; }

    // the setter has to be in snake_case too
    set screen_value(percent) {
        percent = clamp(percent, 0, 1);
        this._screenValue = percent;

        Utils.execAsync(this.setBrightnessCmd(percent))
            .then(() => {
                // signals has to be explicity emitted
                this.emit('screen-changed', percent);
                this.notify('screen-value');

                // or use Service.changed(propName: string) which does the above two
                // this.changed('screen');
            })
            .catch(print);
    }

    // overwriting connectWidget method, lets you
    // change the default event that widgets connect to
    connectWidget(widget, callback, event = 'screen-changed') {
        super.connectWidget(widget, callback, event);
    }
}

class BrightnessCtlService extends BrightnessServiceBase {
    static {
        Service.register(this);
    }

    constructor() {
        super();
        const current = Number(exec('brightnessctl g'));
        const max = Number(exec('brightnessctl m'));
        this._screenValue = current / max;
    }

    setBrightnessCmd(percent) {
        return `brightnessctl s ${percent * 100}% -q`;
    }
}

class BrightnessDdcService extends BrightnessServiceBase {
    static {
        Service.register(this);
    }

    constructor(monitor = 0) {
        super();
        // don't use Hyprland.getMonitor(id), Hyprland monitor id isn't consistent
        // with Gdk, but the Array ordering is (magically)
        this._sn = Hyprland.monitors[monitor].serial;
        Utils.execAsync(`ddcutil --sn ${this._sn} getvcp 10 --brief`)
            .then((out) => {
                // only the last line is useful
                out = out.split('\n');
                out = out[out.length - 1];

                out = out.split(' ');
                const current = Number(out[3]);
                const max = Number(out[4]);
                this._screenValue = current / max;
            })
            .catch(print);
    }

    setBrightnessCmd(percent) {
        return `ddcutil --sn ${this._sn} setvcp 10 ${Math.round(percent * 100)}`;
    }
}

async function listDdcMonitorsSn() {
    let ddcSn = [];
    try {
        const out = await Utils.execAsync('ddcutil detect --brief');
        const displays = out.split('\n\n');
        displays.forEach(display => {
            const reg = /^Display \d+/;
            if (!reg.test(display))
                return;
            const lines = display.split('\n');
            const sn = lines[3].split(':')[3];
            ddcSn.push(sn);
        });
    } catch (err) {
        print(err);
    }
    return ddcSn;
}

// Service instance
const numMonitors = Hyprland.monitors.length;
const service = Array(numMonitors);
const ddcSn = await listDdcMonitorsSn();
for (let i = 0; i < service.length; i++) {
    const monitorName = Hyprland.monitors[i].name;
    const monitorSn = Hyprland.monitors[i].serial;
    const preferredController = userOptions.brightness.controllers[monitorName]
        || userOptions.brightness.controllers.default || "auto";
    if (preferredController) {
        switch (preferredController) {
            case "brightnessctl":
                service[i] = new BrightnessCtlService();
                break;
            case "ddcutil":
                service[i] = new BrightnessDdcService(i);
                break;
            case "auto":
                if (ddcSn.includes(monitorSn))
                    service[i] = new BrightnessDdcService(i);
                else
                    service[i] = new BrightnessCtlService();
                break;
            default:
                throw new Error(`Unknown brightness controller ${preferredController}`);
        }
    }
}

// make it global for easy use with cli
globalThis.brightness = service[0];

// export to use in other modules
export default service;
