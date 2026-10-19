/** Typed, normalised view over the GSettings schema. */
export class Prefs {
    #s;

    constructor(gsettings) {
        this.#s = gsettings;
    }

    get raw() { return this.#s; }
    get historySize() { return this.#s.get_int('history-size'); }
    get maxTextBytes() { return this.#s.get_int('max-text-kb') * 1024; }
    get maxImageBytes() { return this.#s.get_int('max-image-mb') * 1024 * 1024; }
    get maxTotalBytes() { return this.#s.get_int('max-total-mb') * 1024 * 1024; }
    get popupPosition() { return this.#s.get_string('popup-position'); }
    get pasteOnSelect() { return this.#s.get_boolean('paste-on-select'); }
    get showIndicator() { return this.#s.get_boolean('show-indicator'); }
    get excludedApps() { return lower(this.#s.get_strv('excluded-apps')); }
    get terminalApps() { return lower(this.#s.get_strv('terminal-apps')); }

    get privateMode() { return this.#s.get_boolean('private-mode'); }
    set privateMode(v) { this.#s.set_boolean('private-mode', v); }

    /** Store limits derived from the current settings. */
    get limits() {
        return {maxEntries: this.historySize, maxTotalBytes: this.maxTotalBytes};
    }

    connect(fn) {
        return this.#s.connect('changed', (_s, key) => fn(key));
    }

    disconnect(id) {
        if (id) this.#s.disconnect(id);
    }
}

function lower(list) {
    return list.map(s => s.toLowerCase());
}
