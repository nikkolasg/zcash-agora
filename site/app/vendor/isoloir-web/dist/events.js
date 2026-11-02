// A small typed emitter: the session's events for the app.
export class Emitter {
    listeners = new Map();
    on(event, fn) {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(fn);
        return () => set.delete(fn);
    }
    emit(event, value) {
        for (const fn of this.listeners.get(event) ?? []) {
            try {
                fn(value);
            }
            catch {
                // a listener's failure is the app's, not the session's
            }
        }
    }
}
/** The server's clock, learned from checkpoints (SPEC §4: each carries the ingest's time). */
export class ServerClock {
    local;
    bound = null;
    live = null;
    constructor(local) {
        this.local = local;
    }
    /**
     * A checkpoint is read after it was signed, never before: its time minus
     * the local time is a lower bound of the offset (it corrects a clock
     * that is behind). One that arrived live on a relay is the offset.
     */
    note(unixSeconds, isLive = false) {
        const o = unixSeconds * 1000 - this.local();
        this.bound = this.bound === null ? o : Math.max(this.bound, o);
        if (isLive)
            this.live = o;
    }
    /** The server's now, in milliseconds. */
    now() {
        return this.local() + (this.live ?? Math.max(0, this.bound ?? 0));
    }
}
//# sourceMappingURL=events.js.map