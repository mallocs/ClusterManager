'use strict';

/**
 * Tool for applying defaults. Any property in defaults will be overwritten by a corresponding
 * property in opts. If the property does not exist, the default remains. Only properties in 
 * defaults will be included in the final object.
 * 
 * @param {object} [defaults]
 * @param {object} [opts]
 * @returns {object} 
 */
 function applyDefaults(defaults, opts) {
    if (typeof defaults !== "object") return {};
    if (typeof opts !== "object") return defaults;
    for (var index in defaults) {
        if (typeof opts[index] === "undefined") {
            opts[index] = defaults[index];
        }
    }
    return opts;
}

module.exports = applyDefaults;