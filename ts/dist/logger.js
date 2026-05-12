const PREFIX = '[cat-inspector]';
export function createLogger(level = 'info') {
    const order = ['debug', 'info', 'warn', 'error'];
    const min = order.indexOf(level);
    function emit(lv, fn, args) {
        if (order.indexOf(lv) < min)
            return;
        fn(PREFIX, ...args);
    }
    return {
        debug: (...args) => emit('debug', console.log, args),
        info: (...args) => emit('info', console.log, args),
        warn: (...args) => emit('warn', console.warn, args),
        error: (...args) => emit('error', console.error, args),
    };
}
//# sourceMappingURL=logger.js.map